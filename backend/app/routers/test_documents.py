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

from app.auth import create_access_token
from app.database import SessionLocal
from app.main import app
from app.models import Organization, User
import app.routers.documents as documents_module

client = TestClient(app)


class _FakeS3:
    def __init__(self) -> None:
        self.put_calls: list[tuple[str, str, bytes]] = []

    def put_object(self, Bucket: str, Key: str, Body: bytes) -> None:  # noqa: N803
        self.put_calls.append((Bucket, Key, Body))

    def delete_object(self, Bucket: str, Key: str) -> None:  # noqa: N803
        pass


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
