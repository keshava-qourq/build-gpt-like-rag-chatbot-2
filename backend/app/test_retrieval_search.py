"""Tests for `retrieval.search`: semantic ranking across the whole ready
library, the threshold, the 5-8 result bounds and the no-filter-argument
contract (AC-053, AC-054, AC-055, AC-056).

Placed alongside `app/retrieval.py` (rather than under `backend/tests/`)
because this task's write scope does not include the top-level tests
directory; following the same convention as `app/test_ingestion_failure_reasons.py`.
"""

from __future__ import annotations

import asyncio
import inspect
import uuid
from datetime import UTC, datetime

import pytest

from app.database import SessionLocal
from app.models import Chunk, Document, Organization, User
from app.retrieval import MAX_RESULTS, RELEVANCE_THRESHOLD, search


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def org(db):
    organization = Organization(id=uuid.uuid4(), name="Search Org", created_at=datetime.now(UTC))
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


def _make_document(db, org, uploader, *, status="ready", filename="doc.txt"):
    document = Document(
        id=uuid.uuid4(),
        org_id=org.id,
        uploader_id=uploader.id,
        filename=filename,
        format="txt",
        size_bytes=10,
        s3_key=f"{uuid.uuid4()}-key",
        status=status,
        created_at=datetime.now(UTC),
    )
    db.add(document)
    db.commit()
    db.refresh(document)
    return document


def _add_chunk(db, org, document, *, ordinal, text, embedding, page_start=None, page_end=None):
    chunk = Chunk(
        org_id=org.id,
        document_id=document.id,
        ordinal=ordinal,
        text=text,
        embedding=embedding,
        embedding_model="fake-model",
        embedding_dim=len(embedding),
        page_start=page_start,
        page_end=page_end,
    )
    db.add(chunk)
    db.commit()
    db.refresh(chunk)
    return chunk


class _FakeEmbeddingsProvider:
    """Returns the fixed query vector configured at construction time,
    regardless of the text passed in -- the similarity-to-each-chunk
    geometry is set up directly on the stored chunk embeddings instead."""

    model_name = "fake-model"

    def __init__(self, query_embedding):
        self._query_embedding = query_embedding

    @property
    def dimension(self):
        return len(self._query_embedding)

    async def embed(self, texts):
        return [self._query_embedding for _ in texts]


QUERY_VECTOR = [1.0, 0.0, 0.0]


def _run_search(db, org_id, *, query_vector=QUERY_VECTOR):
    return asyncio.run(
        search(
            db,
            org_id,
            "what does the document say?",
            embeddings_provider=_FakeEmbeddingsProvider(query_vector),
        )
    )


# ---------------------------------------------------------------------------
# AC-053: matches across every ready document in the workspace, regardless of
# uploader; chunks from non-ready documents are excluded.
# ---------------------------------------------------------------------------


def test_search_spans_every_ready_document_regardless_of_uploader(db, org, user):
    other_user = User(
        id=uuid.uuid4(),
        org_id=org.id,
        email=f"{uuid.uuid4()}@example.com",
        password_hash="x",
        role="member",
        is_active=True,
        created_at=datetime.now(UTC),
    )
    db.add(other_user)
    db.commit()

    doc_a = _make_document(db, org, user, filename="a.txt")
    doc_b = _make_document(db, org, other_user, filename="b.txt")
    not_ready_doc = _make_document(db, org, user, status="processing", filename="c.txt")

    chunk_a = _add_chunk(db, org, doc_a, ordinal=0, text="from a", embedding=[0.9, 0.1, 0.0])
    chunk_b = _add_chunk(db, org, doc_b, ordinal=0, text="from b", embedding=[0.8, 0.2, 0.0])
    _add_chunk(db, org, not_ready_doc, ordinal=0, text="from c", embedding=[1.0, 0.0, 0.0])

    results = _run_search(db, org.id)
    result_chunk_ids = {sc.chunk.id for sc in results}

    assert chunk_a.id in result_chunk_ids
    assert chunk_b.id in result_chunk_ids
    assert all(sc.chunk.document_id != not_ready_doc.id for sc in results)


def test_search_is_org_scoped(db, org, user):
    other_org = Organization(id=uuid.uuid4(), name="Other Org", created_at=datetime.now(UTC))
    db.add(other_org)
    db.commit()
    other_user = User(
        id=uuid.uuid4(),
        org_id=other_org.id,
        email=f"{uuid.uuid4()}@example.com",
        password_hash="x",
        role="member",
        is_active=True,
        created_at=datetime.now(UTC),
    )
    db.add(other_user)
    db.commit()

    own_doc = _make_document(db, org, user)
    other_doc = _make_document(db, other_org, other_user)
    own_chunk = _add_chunk(db, org, own_doc, ordinal=0, text="mine", embedding=[1.0, 0.0, 0.0])
    _add_chunk(db, other_org, other_doc, ordinal=0, text="theirs", embedding=[1.0, 0.0, 0.0])

    results = _run_search(db, org.id)
    result_chunk_ids = {sc.chunk.id for sc in results}

    assert own_chunk.id in result_chunk_ids
    assert len(results) == 1


# ---------------------------------------------------------------------------
# AC-054: ordered by similarity, capped at MAX_RESULTS, above-threshold only.
# ---------------------------------------------------------------------------


def test_results_are_ordered_by_descending_similarity_and_capped(db, org, user):
    document = _make_document(db, org, user)
    # 10 chunks, each closer to the query vector than the last, all clearly
    # above threshold, so the MAX_RESULTS cap (not the threshold) is what's
    # exercised here.
    chunks = [
        _add_chunk(
            db,
            org,
            document,
            ordinal=i,
            text=f"chunk {i}",
            embedding=[1.0, 0.0001 * (10 - i), 0.0],
        )
        for i in range(10)
    ]

    results = _run_search(db, org.id)

    assert len(results) <= MAX_RESULTS
    scores = [sc.score for sc in results]
    assert scores == sorted(scores, reverse=True)
    # The closest chunk (smallest orthogonal component, i == 9) ranks first.
    assert results[0].chunk.id == chunks[9].id


# ---------------------------------------------------------------------------
# AC-055: only chunks above threshold come back -- no padding to a minimum.
# ---------------------------------------------------------------------------


def test_only_two_chunks_above_threshold_returns_exactly_two(db, org, user):
    document = _make_document(db, org, user)
    relevant_1 = _add_chunk(
        db, org, document, ordinal=0, text="relevant one", embedding=[1.0, 0.0, 0.0]
    )
    relevant_2 = _add_chunk(
        db, org, document, ordinal=1, text="relevant two", embedding=[0.99, 0.01, 0.0]
    )
    # Orthogonal to the query vector: cosine similarity 0, well under any
    # sane threshold.
    _add_chunk(db, org, document, ordinal=2, text="irrelevant", embedding=[0.0, 1.0, 0.0])
    _add_chunk(db, org, document, ordinal=3, text="also irrelevant", embedding=[0.0, 0.0, 1.0])

    results = _run_search(db, org.id)
    result_chunk_ids = {sc.chunk.id for sc in results}

    assert result_chunk_ids == {relevant_1.id, relevant_2.id}
    assert all(sc.score > RELEVANCE_THRESHOLD for sc in results)


def test_no_chunks_above_threshold_returns_empty_list(db, org, user):
    document = _make_document(db, org, user)
    _add_chunk(db, org, document, ordinal=0, text="unrelated", embedding=[0.0, 1.0, 0.0])

    results = _run_search(db, org.id)

    assert results == []


# ---------------------------------------------------------------------------
# AC-056: no document-filter / per-conversation scoping parameter exists.
# ---------------------------------------------------------------------------


def test_search_signature_accepts_no_document_filter_argument():
    parameters = inspect.signature(search).parameters
    assert set(parameters) == {"db", "org_id", "query", "embeddings_provider"}
    for name in parameters:
        assert "document" not in name
        assert "conversation" not in name


# ---------------------------------------------------------------------------
# Location metadata survives onto the result, for citation-building later.
# ---------------------------------------------------------------------------


def test_results_carry_location_metadata(db, org, user):
    document = _make_document(db, org, user)
    chunk = _add_chunk(
        db,
        org,
        document,
        ordinal=2,
        text="page content",
        embedding=[1.0, 0.0, 0.0],
        page_start=3,
        page_end=3,
    )

    results = _run_search(db, org.id)

    assert len(results) == 1
    [scored] = results
    assert scored.chunk.id == chunk.id
    assert scored.chunk.document_id == document.id
    assert scored.chunk.page_start == 3
    assert scored.chunk.page_end == 3
    assert scored.chunk.ordinal == 2
