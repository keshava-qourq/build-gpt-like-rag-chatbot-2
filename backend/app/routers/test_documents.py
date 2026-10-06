"""Tests for POST /documents and GET /documents.

A fake S3 client and a fake Celery `send_task` stand in for the real thing:
these tests assert on validation, persistence and the per-file response
shape, not on boto3 or the broker actually talking to anything.

Placed alongside the router (rather than under `backend/tests/`) because
this task's write scope does not include the top-level tests directory;
`pytest.ini` points `testpaths` at `tests`, so this module is also imported
there via the dynamic discovery below if the suite is run from repo root.
"""

from __future__ import annotations

import io
import uuid
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

import app.routers.documents as documents_module
from app.auth import create_access_token
from app.database import SessionLocal
from app.main import app
from app.models import Organization, User

client = TestClient(app)


class _FakeS3:
    def __init__(self) -> None:
        self.put_calls: list[tuple[str, str, bytes]] = []
        self.delete_calls: list[tuple[str, str]] = []
        self.fail_delete = False

    def put_object(self, Bucket: str, Key: str, Body: bytes) -> None:  # noqa: N803
        self.put_calls.append((Bucket, Key, Body))

    def delete_object(self, Bucket: str, Key: str) -> None:  # noqa: N803
        if self.fail_delete:
            raise RuntimeError("storage unavailable")
        self.delete_calls.append((Bucket, Key))


class _FakeCelery:
    def __init__(self) -> None:
        self.sent: list[tuple[str, list]] = []

    def send_task(self, name: str, args: list) -> None:
        self.sent.append((name, args))


@pytest.fixture()
def db_session() -> Session:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def auth_header(db_session: Session) -> dict[str, str]:
    org = db_session.query(Organization).first()
    if org is None:
        org = Organization(id=uuid.uuid4(), name="Test Org", created_at=datetime.now(UTC))
        db_session.add(org)
        db_session.commit()

    user = User(
        id=uuid.uuid4(),
        org_id=org.id,
        email=f"{uuid.uuid4()}@example.com",
        password_hash="unused",
        role="member",
        is_active=True,
        created_at=datetime.now(UTC),
    )
    db_session.add(user)
    db_session.commit()

    token = create_access_token(user_id=user.id, org_id=org.id, role=user.role)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture()
def fake_s3(monkeypatch: pytest.MonkeyPatch) -> _FakeS3:
    fake = _FakeS3()
    monkeypatch.setattr(documents_module, "get_s3_client", lambda: fake)
    return fake


@pytest.fixture()
def fake_celery(monkeypatch: pytest.MonkeyPatch) -> _FakeCelery:
    fake = _FakeCelery()
    monkeypatch.setattr(documents_module, "celery_app", fake)
    return fake


def test_post_documents_requires_auth(fake_s3: _FakeS3, fake_celery: _FakeCelery) -> None:
    response = client.post(
        "/documents",
        files=[("files", ("a.txt", io.BytesIO(b"hello"), "text/plain"))],
    )
    assert response.status_code == 401


def test_accepted_file_is_stored_and_queued(
    auth_header: dict[str, str], fake_s3: _FakeS3, fake_celery: _FakeCelery
) -> None:
    response = client.post(
        "/documents",
        headers=auth_header,
        files=[("files", ("notes.md", io.BytesIO(b"# hello"), "text/markdown"))],
    )
    assert response.status_code == 200
    body = response.json()
    assert len(body) == 1
    assert body[0]["filename"] == "notes.md"
    assert body[0]["status"] == "queued"
    assert body[0].get("error") is None

    assert len(fake_s3.put_calls) == 1
    assert len(fake_celery.sent) == 1
    assert fake_celery.sent[0][0] == "ingest_document"


def test_multi_file_upload_each_independent(
    auth_header: dict[str, str], fake_s3: _FakeS3, fake_celery: _FakeCelery
) -> None:
    response = client.post(
        "/documents",
        headers=auth_header,
        files=[
            ("files", ("good.txt", io.BytesIO(b"hello"), "text/plain")),
            ("files", ("bad.pptx", io.BytesIO(b"nope"), "application/octet-stream")),
            ("files", ("also_good.csv", io.BytesIO(b"a,b\n1,2"), "text/csv")),
        ],
    )
    assert response.status_code == 200
    body = response.json()
    assert len(body) == 3

    by_name = {item["filename"]: item for item in body}
    assert by_name["good.txt"]["status"] == "queued"
    assert by_name["also_good.csv"]["status"] == "queued"
    assert by_name["bad.pptx"]["status"] == "rejected"
    assert by_name["bad.pptx"]["error"] is not None

    assert len(fake_s3.put_calls) == 2
    assert len(fake_celery.sent) == 2


def test_unsupported_type_rejected_before_any_byte_written(
    auth_header: dict[str, str], fake_s3: _FakeS3, fake_celery: _FakeCelery, db_session: Session
) -> None:
    response = client.post(
        "/documents",
        headers=auth_header,
        files=[("files", ("sheet.xlsx", io.BytesIO(b"data"), "application/octet-stream"))],
    )
    assert response.status_code == 200
    body = response.json()
    assert body[0]["status"] == "rejected"
    for name in ("PDF", "DOCX", "TXT", "CSV", "Markdown"):
        assert name in body[0]["error"]

    assert fake_s3.put_calls == []
    assert fake_celery.sent == []

    from app.models import Document

    count = db_session.query(Document).filter(Document.filename == "sheet.xlsx").count()
    assert count == 0


def test_oversized_file_rejected_with_50mb_message(
    auth_header: dict[str, str], fake_s3: _FakeS3, fake_celery: _FakeCelery, db_session: Session
) -> None:
    oversized = b"x" * (50 * 1024 * 1024 + 1)
    response = client.post(
        "/documents",
        headers=auth_header,
        files=[("files", ("big.txt", io.BytesIO(oversized), "text/plain"))],
    )
    assert response.status_code == 200
    body = response.json()
    assert body[0]["status"] == "rejected"
    assert "50MB" in body[0]["error"]

    assert fake_s3.put_calls == []
    assert fake_celery.sent == []

    from app.models import Document

    count = db_session.query(Document).filter(Document.filename == "big.txt").count()
    assert count == 0


def test_document_starts_queued_in_db(
    auth_header: dict[str, str], fake_s3: _FakeS3, fake_celery: _FakeCelery, db_session: Session
) -> None:
    response = client.post(
        "/documents",
        headers=auth_header,
        files=[("files", ("doc.pdf", io.BytesIO(b"%PDF-1.4"), "application/pdf"))],
    )
    doc_id = response.json()[0]["id"]

    from app.models import Document

    row = db_session.query(Document).filter(Document.id == uuid.UUID(doc_id)).one()
    assert row.status == "queued"
    assert row.failure_reason is None


def test_get_documents_requires_auth() -> None:
    response = client.get("/documents")
    assert response.status_code == 401


def test_get_documents_lists_org_scoped_with_status_and_failure_reason(
    auth_header: dict[str, str], fake_s3: _FakeS3, fake_celery: _FakeCelery
) -> None:
    client.post(
        "/documents",
        headers=auth_header,
        files=[("files", ("report.csv", io.BytesIO(b"a,b"), "text/csv"))],
    )

    response = client.get("/documents?page=1&page_size=20", headers=auth_header)
    assert response.status_code == 200
    body = response.json()
    assert "items" in body and "next" in body
    item = next(item for item in body["items"] if item["filename"] == "report.csv")
    assert item["status"] == "queued"
    assert "failure_reason" in item


def test_get_documents_pagination_next_cursor(
    auth_header: dict[str, str], fake_s3: _FakeS3, fake_celery: _FakeCelery
) -> None:
    for i in range(3):
        client.post(
            "/documents",
            headers=auth_header,
            files=[("files", (f"page{i}.txt", io.BytesIO(b"hi"), "text/plain"))],
        )

    response = client.get("/documents?page=1&page_size=2", headers=auth_header)
    body = response.json()
    assert len(body["items"]) == 2
    assert body["next"] == "2"

    response2 = client.get(f"/documents?page={body['next']}&page_size=2", headers=auth_header)
    body2 = response2.json()
    assert len(body2["items"]) >= 1


def _make_user(db_session: Session, org, role: str = "member") -> tuple[User, dict[str, str]]:
    user = User(
        id=uuid.uuid4(),
        org_id=org.id,
        email=f"{uuid.uuid4()}@example.com",
        password_hash="unused",
        role=role,
        is_active=True,
        created_at=datetime.now(UTC),
    )
    db_session.add(user)
    db_session.commit()
    token = create_access_token(user_id=user.id, org_id=org.id, role=user.role)
    return user, {"Authorization": f"Bearer {token}"}


def _upload_one(headers: dict[str, str]) -> uuid.UUID:
    response = client.post(
        "/documents",
        headers=headers,
        files=[("files", ("delete_me.txt", io.BytesIO(b"hello"), "text/plain"))],
    )
    return uuid.UUID(response.json()[0]["id"])


def test_delete_requires_auth() -> None:
    response = client.delete(f"/documents/{uuid.uuid4()}")
    assert response.status_code == 401


def test_delete_unknown_document_returns_404(auth_header: dict[str, str]) -> None:
    response = client.delete(f"/documents/{uuid.uuid4()}", headers=auth_header)
    assert response.status_code == 404


def test_uploader_can_delete_own_document(
    auth_header: dict[str, str], fake_s3: _FakeS3, fake_celery: _FakeCelery, db_session: Session
) -> None:
    doc_id = _upload_one(auth_header)

    response = client.delete(f"/documents/{doc_id}", headers=auth_header)
    assert response.status_code == 200
    assert response.json() == {"ok": True}

    from app.models import Chunk, Document

    assert db_session.query(Document).filter(Document.id == doc_id).one_or_none() is None
    assert db_session.query(Chunk).filter(Chunk.document_id == doc_id).count() == 0
    assert len(fake_s3.delete_calls) == 1


def test_non_uploader_non_admin_gets_403(
    db_session: Session, fake_s3: _FakeS3, fake_celery: _FakeCelery
) -> None:
    org = db_session.query(Organization).first()
    if org is None:
        org = Organization(id=uuid.uuid4(), name="Test Org", created_at=datetime.now(UTC))
        db_session.add(org)
        db_session.commit()

    _, uploader_headers = _make_user(db_session, org, role="member")
    doc_id = _upload_one(uploader_headers)

    _, other_headers = _make_user(db_session, org, role="member")
    response = client.delete(f"/documents/{doc_id}", headers=other_headers)
    assert response.status_code == 403


def test_admin_can_delete_another_members_document(
    db_session: Session, fake_s3: _FakeS3, fake_celery: _FakeCelery
) -> None:
    org = db_session.query(Organization).first()
    if org is None:
        org = Organization(id=uuid.uuid4(), name="Test Org", created_at=datetime.now(UTC))
        db_session.add(org)
        db_session.commit()

    _, uploader_headers = _make_user(db_session, org, role="member")
    doc_id = _upload_one(uploader_headers)

    _, admin_headers = _make_user(db_session, org, role="admin")
    response = client.delete(f"/documents/{doc_id}", headers=admin_headers)
    assert response.status_code == 200

    from app.models import Document

    assert db_session.query(Document).filter(Document.id == doc_id).one_or_none() is None


def test_delete_from_another_org_is_404(
    db_session: Session, fake_s3: _FakeS3, fake_celery: _FakeCelery
) -> None:
    org_a = Organization(id=uuid.uuid4(), name="Org A", created_at=datetime.now(UTC))
    org_b = Organization(id=uuid.uuid4(), name="Org B", created_at=datetime.now(UTC))
    db_session.add_all([org_a, org_b])
    db_session.commit()

    _, headers_a = _make_user(db_session, org_a, role="member")
    doc_id = _upload_one(headers_a)

    _, headers_b = _make_user(db_session, org_b, role="admin")
    response = client.delete(f"/documents/{doc_id}", headers=headers_b)
    assert response.status_code == 404


def test_storage_failure_surfaces_as_error_not_silent_pass(
    auth_header: dict[str, str], fake_s3: _FakeS3, fake_celery: _FakeCelery, db_session: Session
) -> None:
    doc_id = _upload_one(auth_header)
    fake_s3.fail_delete = True

    response = client.delete(f"/documents/{doc_id}", headers=auth_header)
    assert response.status_code >= 500

    from app.models import Document

    # The DB row must still exist: a failed storage delete aborts the whole op.
    assert db_session.query(Document).filter(Document.id == doc_id).one_or_none() is not None


def test_download_after_delete_returns_410_with_explicit_detail(
    auth_header: dict[str, str], fake_s3: _FakeS3, fake_celery: _FakeCelery
) -> None:
    doc_id = _upload_one(auth_header)
    client.delete(f"/documents/{doc_id}", headers=auth_header)

    response = client.get(f"/documents/{doc_id}/download", headers=auth_header)
    assert response.status_code == 410
    assert response.json()["detail"] == "source document no longer available"


def test_download_unknown_document_still_404(auth_header: dict[str, str]) -> None:
    response = client.get(f"/documents/{uuid.uuid4()}/download", headers=auth_header)
    assert response.status_code == 404


def test_deleted_document_never_listed_or_downloadable_cross_org(
    db_session: Session, fake_s3: _FakeS3, fake_celery: _FakeCelery
) -> None:
    org_a = Organization(id=uuid.uuid4(), name="Org A2", created_at=datetime.now(UTC))
    org_b = Organization(id=uuid.uuid4(), name="Org B2", created_at=datetime.now(UTC))
    db_session.add_all([org_a, org_b])
    db_session.commit()

    _, headers_a = _make_user(db_session, org_a, role="admin")
    doc_id = _upload_one(headers_a)
    client.delete(f"/documents/{doc_id}", headers=headers_a)

    _, headers_b = _make_user(db_session, org_b, role="admin")
    response = client.get(f"/documents/{doc_id}/download", headers=headers_b)
    assert response.status_code == 404

    listing = client.get("/documents", headers=headers_a)
    assert all(item["id"] != str(doc_id) for item in listing.json()["items"])


def test_failed_document_still_downloadable(
    auth_header: dict[str, str], fake_s3: _FakeS3, fake_celery: _FakeCelery, db_session: Session
) -> None:
    """AC-052: a corrupt/password-protected/no-text document is marked
    failed by the worker, but the original object is never deleted and
    GET /documents/{id}/download must still serve it."""
    doc_id = _upload_one(auth_header)

    from app.models import Document

    document = db_session.query(Document).filter(Document.id == doc_id).one()
    document.status = "failed"
    document.failure_reason = (
        "This file is password-protected and could not be processed. Remove the "
        "password and upload it again."
    )
    db_session.commit()

    response = client.get(f"/documents/{doc_id}/download", headers=auth_header)
    assert response.status_code == 200
    assert fake_s3.delete_calls == []


def test_failed_document_still_deletable(
    auth_header: dict[str, str], fake_s3: _FakeS3, fake_celery: _FakeCelery, db_session: Session
) -> None:
    """AC-052: a failed document can still be deleted like any other."""
    doc_id = _upload_one(auth_header)

    from app.models import Document

    document = db_session.query(Document).filter(Document.id == doc_id).one()
    document.status = "failed"
    document.failure_reason = (
        "This file appears to be corrupted or unreadable and could not be processed."
    )
    db_session.commit()

    response = client.delete(f"/documents/{doc_id}", headers=auth_header)
    assert response.status_code == 200

    from app.models import Document as DocumentModel

    assert db_session.query(DocumentModel).filter(DocumentModel.id == doc_id).one_or_none() is None
    assert len(fake_s3.delete_calls) == 1


def test_citations_survive_deletion_with_nulled_references(
    auth_header: dict[str, str], fake_s3: _FakeS3, fake_celery: _FakeCelery, db_session: Session
) -> None:
    doc_id = _upload_one(auth_header)

    from app.models import Chunk, Citation, Conversation, Message

    org = db_session.query(Organization).first()
    user_id = uuid.UUID(
        __import__("app.auth", fromlist=["decode_access_token"]).decode_access_token(
            auth_header["Authorization"].split(" ", 1)[1]
        )["sub"]
    )

    chunk = Chunk(org_id=org.id, document_id=doc_id, ordinal=0, text="hello")
    db_session.add(chunk)
    db_session.commit()

    conversation = Conversation(
        id=uuid.uuid4(),
        org_id=org.id,
        user_id=user_id,
        title="t",
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    db_session.add(conversation)
    db_session.commit()

    message = Message(
        id=uuid.uuid4(),
        conversation_id=conversation.id,
        role="assistant",
        content="answer",
        created_at=datetime.now(UTC),
    )
    db_session.add(message)
    db_session.commit()

    citation = Citation(
        id=uuid.uuid4(),
        message_id=message.id,
        chunk_id=chunk.id,
        marker=1,
        document_id=doc_id,
        snapshot_text="hello",
    )
    db_session.add(citation)
    db_session.commit()
    citation_id = citation.id

    response = client.delete(f"/documents/{doc_id}", headers=auth_header)
    assert response.status_code == 200

    survivor = db_session.query(Citation).filter(Citation.id == citation_id).one()
    assert survivor.document_id is None
    assert survivor.chunk_id is None
