"""Tests for the ingestion worker: status transitions, extraction failure
reasons, and batch isolation (AC-017, AC-020, AC-021, AC-022)."""

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


def _make_document(db, org, user, *, fmt="txt", s3_key="any-key"):
    document = Document(
        id=uuid.uuid4(),
        org_id=org.id,
        uploader_id=user.id,
        filename="file." + fmt,
        format=fmt,
        size_bytes=10,
        s3_key=s3_key,
        status="queued",
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


def test_chunk_text_empty_returns_no_chunks():
    assert ingestion.chunk_text("   ") == []


# ---------------------------------------------------------------------------
# AC-039: ~800-1000 token chunks, ~15% overlap, measured with a real
# tokenizer for the configured embeddings model.
# ---------------------------------------------------------------------------


def test_chunk_text_produces_token_sized_chunks_with_target_overlap():
    tokenizer = ingestion._get_tokenizer()
    # Distinct words so each one is cheaply countable and tokenizes
    # predictably, unlike a long run of a single repeated character.
    text = " ".join(f"word{i}" for i in range(4000))

    chunks = ingestion.chunk_text(text, chunk_size=900, overlap=135, tokenizer=tokenizer)

    assert len(chunks) >= 3
    for chunk in chunks[:-1]:
        token_count = len(tokenizer.encode(chunk))
        assert 800 <= token_count <= 1000

    # Consecutive chunks share roughly the configured overlap: the tail of
    # one chunk's tokens reappears as the head of the next.
    first_tokens = tokenizer.encode(chunks[0])
    second_tokens = tokenizer.encode(chunks[1])
    overlap_tokens = first_tokens[-135:]
    assert second_tokens[: len(overlap_tokens)] == overlap_tokens


def test_chunk_text_short_document_yields_single_chunk():
    text = "Just a short passage, well under one chunk."
    chunks = ingestion.chunk_text(text)
    assert chunks == [text]


def test_extract_text_txt_success():
    assert ingestion.extract_text("txt", b"hello world") == "hello world"


def test_extract_text_unsupported_format_raises_unreadable():
    with pytest.raises(ingestion.ExtractionError, match="unreadable file"):
        ingestion.extract_text("xyz", b"data")


def test_extract_text_empty_raises_no_extractable_text():
    with pytest.raises(ingestion.ExtractionError, match="no extractable text"):
        ingestion.extract_text("txt", b"   ")


def test_extract_text_garbage_pdf_raises_unreadable_file():
    with pytest.raises(ingestion.ExtractionError, match="unreadable file"):
        ingestion.extract_text("pdf", b"not a real pdf")


def test_ingest_document_success_sets_ready_and_creates_chunks(db, org, user, monkeypatch):
    document = _make_document(db, org, user, fmt="txt")

    monkeypatch.setattr(ingestion, "_fetch_object", lambda key: b"some extractable content")
    monkeypatch.setattr(ingestion, "get_embeddings_provider", lambda: _FakeEmbeddingsProvider())

    ingestion.ingest_document(str(document.id))

    db.expire_all()
    refreshed = db.query(Document).filter(Document.id == document.id).one()
    assert refreshed.status == "ready"
    assert refreshed.failure_reason is None

    chunks = db.query(Chunk).filter(Chunk.document_id == document.id).all()
    assert len(chunks) == 1
    assert chunks[0].org_id == org.id
    assert chunks[0].embedding_model == "fake-model"


def test_ingest_document_no_extractable_text_fails_with_reason(db, org, user, monkeypatch):
    document = _make_document(db, org, user, fmt="txt")

    monkeypatch.setattr(ingestion, "_fetch_object", lambda key: b"   ")

    ingestion.ingest_document(str(document.id))

    db.expire_all()
    refreshed = db.query(Document).filter(Document.id == document.id).one()
    assert refreshed.status == "failed"
    assert refreshed.failure_reason == "no extractable text"
    assert db.query(Chunk).filter(Chunk.document_id == document.id).count() == 0


def test_ingest_document_unreadable_fetch_fails_with_reason(db, org, user, monkeypatch):
    document = _make_document(db, org, user, fmt="txt")

    def _raise(key):
        raise ingestion.ExtractionError("unreadable file")

    monkeypatch.setattr(ingestion, "_fetch_object", _raise)

    ingestion.ingest_document(str(document.id))

    db.expire_all()
    refreshed = db.query(Document).filter(Document.id == document.id).one()
    assert refreshed.status == "failed"
    assert refreshed.failure_reason == "unreadable file"


def test_ingest_document_always_exactly_one_status(db, org, user, monkeypatch):
    document = _make_document(db, org, user, fmt="txt")
    monkeypatch.setattr(ingestion, "_fetch_object", lambda key: b"content here")
    monkeypatch.setattr(ingestion, "get_embeddings_provider", lambda: _FakeEmbeddingsProvider())

    assert document.status == "queued"
    ingestion.ingest_document(str(document.id))

    db.expire_all()
    refreshed = db.query(Document).filter(Document.id == document.id).one()
    assert refreshed.status in {"queued", "processing", "ready", "failed"}
    assert refreshed.status == "ready"


def test_batch_isolation_one_failure_does_not_affect_other_document(db, org, user, monkeypatch):
    good = _make_document(db, org, user, fmt="txt", s3_key="good-key")
    bad = _make_document(db, org, user, fmt="txt", s3_key="bad-key")

    def _fetch(key):
        if key == "bad-key":
            raise ingestion.ExtractionError("unreadable file")
        return b"good content"

    monkeypatch.setattr(ingestion, "_fetch_object", _fetch)
    monkeypatch.setattr(ingestion, "get_embeddings_provider", lambda: _FakeEmbeddingsProvider())

    ingestion.ingest_document(str(bad.id))
    ingestion.ingest_document(str(good.id))

    db.expire_all()
    bad_refreshed = db.query(Document).filter(Document.id == bad.id).one()
    good_refreshed = db.query(Document).filter(Document.id == good.id).one()

    assert bad_refreshed.status == "failed"
    assert bad_refreshed.failure_reason == "unreadable file"
    assert good_refreshed.status == "ready"
    assert db.query(Chunk).filter(Chunk.document_id == good.id).count() == 1


def test_ingest_document_unknown_id_is_a_noop(db):
    # Does not raise even though no document exists for this id.
    ingestion.ingest_document(str(uuid.uuid4()))


# ---------------------------------------------------------------------------
# AC-042: a document shorter than one chunk yields a single chunk with its
# location metadata (here, PDF page) intact.
# ---------------------------------------------------------------------------


def test_short_pdf_document_yields_single_chunk_with_page_metadata(db, org, user, monkeypatch):
    import fitz

    pdf_doc = fitz.open()
    page = pdf_doc.new_page()
    page.insert_text((72, 72), "A short page, well under one chunk.")
    pdf_bytes = pdf_doc.tobytes()
    pdf_doc.close()

    document = _make_document(db, org, user, fmt="pdf")
    monkeypatch.setattr(ingestion, "_fetch_object", lambda key: pdf_bytes)
    monkeypatch.setattr(ingestion, "get_embeddings_provider", lambda: _FakeEmbeddingsProvider())

    ingestion.ingest_document(str(document.id))

    db.expire_all()
    chunks = db.query(Chunk).filter(Chunk.document_id == document.id).all()
    assert len(chunks) == 1
    assert chunks[0].page_start == 1
    assert chunks[0].page_end == 1
    assert "short page" in chunks[0].text


# ---------------------------------------------------------------------------
# AC-043 / AC-044: embedding model name and vector dimension are stored on
# the chunk row alongside the vector.
# ---------------------------------------------------------------------------


def test_chunks_record_embedding_model_and_dimension(db, org, user, monkeypatch):
    document = _make_document(db, org, user, fmt="txt")
    monkeypatch.setattr(ingestion, "_fetch_object", lambda key: b"some extractable content")
    monkeypatch.setattr(ingestion, "get_embeddings_provider", lambda: _FakeEmbeddingsProvider())

    ingestion.ingest_document(str(document.id))

    db.expire_all()
    chunks = db.query(Chunk).filter(Chunk.document_id == document.id).all()
    assert len(chunks) == 1
    assert chunks[0].embedding_model == "fake-model"
    assert chunks[0].embedding_dim == 3
    assert chunks[0].embedding == [0.1, 0.2, 0.3]


# ---------------------------------------------------------------------------
# AC-045: once every chunk is embedded and stored, the document's status
# becomes ready and its chunks are immediately retrievable org-wide.
# ---------------------------------------------------------------------------


def test_ready_document_chunks_are_immediately_retrievable(db, org, user, monkeypatch):
    from app.retrieval import ready_chunks_query

    document = _make_document(db, org, user, fmt="txt")
    monkeypatch.setattr(ingestion, "_fetch_object", lambda key: b"some extractable content")
    monkeypatch.setattr(ingestion, "get_embeddings_provider", lambda: _FakeEmbeddingsProvider())

    ingestion.ingest_document(str(document.id))

    db.expire_all()
    retrievable = ready_chunks_query(db, org.id).filter(Chunk.document_id == document.id).all()
    assert len(retrievable) == 1


# ---------------------------------------------------------------------------
# AC-046: provider errors/rate-limits with retries exhausted mark the
# document failed with the reason, and leave no chunks behind.
# ---------------------------------------------------------------------------


class _FailingEmbeddingsProvider:
    model_name = "fake-model"
    dimension = 3

    async def embed(self, texts):
        raise ingestion.EmbeddingProviderError("embedding provider error: rate limited")


def test_embedding_provider_exhausted_retries_marks_document_failed(db, org, user, monkeypatch):
    document = _make_document(db, org, user, fmt="txt")
    monkeypatch.setattr(ingestion, "_fetch_object", lambda key: b"some extractable content")
    monkeypatch.setattr(ingestion, "get_embeddings_provider", lambda: _FailingEmbeddingsProvider())

    ingestion.ingest_document(str(document.id))

    db.expire_all()
    refreshed = db.query(Document).filter(Document.id == document.id).one()
    assert refreshed.status == "failed"
    assert "embedding" in refreshed.failure_reason
    assert db.query(Chunk).filter(Chunk.document_id == document.id).count() == 0
