"""Tests for user-facing failure reasons and the zero-chunks guarantee on a
failed document (AC-050, AC-051, AC-052).

Placed alongside `app/ingestion.py` (rather than under `backend/tests/`)
because this task's write scope does not include the top-level tests
directory; following the same convention as `app/routers/test_documents.py`.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest

from app import ingestion
from app.database import SessionLocal
from app.models import Chunk, Document, Organization, User


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def org(db):
    organization = Organization(id=uuid.uuid4(), name="Test Org", created_at=datetime.now(UTC))
    db.add(organization)
    db.commit()
    return organization


@pytest.fixture
def user(db, org):
    u = User(
        id=uuid.uuid4(),
        org_id=org.id,
        email=f"{uuid.uuid4()}@example.com",
        password_hash="x",
        role="member",
        is_active=True,
        created_at=datetime.now(UTC),
    )
    db.add(u)
    db.commit()
    return u


def _make_document(db, org, user, *, fmt="txt", s3_key="any-key", status="queued"):
    document = Document(
        id=uuid.uuid4(),
        org_id=org.id,
        uploader_id=user.id,
        filename="file." + fmt,
        format=fmt,
        size_bytes=10,
        s3_key=s3_key,
        status=status,
        created_at=datetime.now(UTC),
    )
    db.add(document)
    db.commit()
    db.refresh(document)
    return document


class _FakeEmbeddingsProvider:
    model_name = "fake-model"
    dimension = 3

    async def embed(self, texts):
        return [[0.1, 0.2, 0.3] for _ in texts]


def _build_scanned_pdf_bytes() -> bytes:
    import fitz

    doc = fitz.open()
    doc.new_page()  # a page with no text layer: the scanned/image-only case
    data = doc.tobytes()
    doc.close()
    return data


def _build_encrypted_pdf_bytes() -> bytes:
    import fitz

    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), "secret content")
    data = doc.tobytes(encryption=fitz.PDF_ENCRYPT_AES_256, owner_pw="owner", user_pw="user")
    doc.close()
    return data


# ---------------------------------------------------------------------------
# AC-050: scanned/image-only PDF -> no-text reason, mentions scanned docs.
# ---------------------------------------------------------------------------


def test_scanned_pdf_fails_with_no_text_reason_naming_scanned_documents(db, org, user, monkeypatch):
    pdf_bytes = _build_scanned_pdf_bytes()
    document = _make_document(db, org, user, fmt="pdf")

    monkeypatch.setattr(ingestion, "_fetch_object", lambda key: pdf_bytes)

    ingestion.ingest_document(str(document.id))

    db.expire_all()
    refreshed = db.query(Document).filter(Document.id == document.id).one()
    assert refreshed.status == "failed"
    assert "no text could be extracted" in refreshed.failure_reason.lower()
    assert "scanned" in refreshed.failure_reason.lower()
    assert "not supported" in refreshed.failure_reason.lower()
    assert db.query(Chunk).filter(Chunk.document_id == document.id).count() == 0


# ---------------------------------------------------------------------------
# AC-052: password-protected and corrupt files get their own specific reason.
# ---------------------------------------------------------------------------


def test_password_protected_pdf_fails_with_password_reason(db, org, user, monkeypatch):
    pdf_bytes = _build_encrypted_pdf_bytes()
    document = _make_document(db, org, user, fmt="pdf")

    monkeypatch.setattr(ingestion, "_fetch_object", lambda key: pdf_bytes)

    ingestion.ingest_document(str(document.id))

    db.expire_all()
    refreshed = db.query(Document).filter(Document.id == document.id).one()
    assert refreshed.status == "failed"
    assert "password" in refreshed.failure_reason.lower()
    assert db.query(Chunk).filter(Chunk.document_id == document.id).count() == 0


def test_corrupt_pdf_fails_with_corrupt_reason_distinct_from_password_and_no_text(
    db, org, user, monkeypatch
):
    document = _make_document(db, org, user, fmt="pdf")

    monkeypatch.setattr(ingestion, "_fetch_object", lambda key: b"not a real pdf at all")

    ingestion.ingest_document(str(document.id))

    db.expire_all()
    refreshed = db.query(Document).filter(Document.id == document.id).one()
    assert refreshed.status == "failed"
    reason = refreshed.failure_reason.lower()
    assert "corrupt" in reason or "unreadable" in reason
    assert "password" not in reason
    assert "scanned" not in reason


def test_three_failure_reasons_are_mutually_distinct():
    assert (
        len(
            {
                ingestion.NO_TEXT_EXTRACTED_REASON,
                ingestion.CORRUPT_FILE_REASON,
                ingestion.PASSWORD_PROTECTED_REASON,
            }
        )
        == 3
    )


# ---------------------------------------------------------------------------
# AC-051: a failed document leaves zero chunk rows, including on a re-ingest
# of a previously 'ready' document.
# ---------------------------------------------------------------------------


def test_reingest_of_ready_document_that_then_fails_leaves_zero_chunks(db, org, user, monkeypatch):
    document = _make_document(db, org, user, fmt="txt")

    monkeypatch.setattr(ingestion, "_fetch_object", lambda key: b"some extractable content")
    monkeypatch.setattr(ingestion, "get_embeddings_provider", lambda: _FakeEmbeddingsProvider())
    ingestion.ingest_document(str(document.id))

    db.expire_all()
    ready = db.query(Document).filter(Document.id == document.id).one()
    assert ready.status == "ready"
    assert db.query(Chunk).filter(Chunk.document_id == document.id).count() == 1

    # Re-ingest the same document (e.g. a retry dispatched again) and this
    # time extraction fails.
    monkeypatch.setattr(ingestion, "_fetch_object", lambda key: b"   ")
    document.status = "queued"
    db.commit()

    ingestion.ingest_document(str(document.id))

    db.expire_all()
    refreshed = db.query(Document).filter(Document.id == document.id).one()
    assert refreshed.status == "failed"
    assert db.query(Chunk).filter(Chunk.document_id == document.id).count() == 0
