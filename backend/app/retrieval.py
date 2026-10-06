"""Retrieval eligibility and semantic search over the ready-document library.

Queued, processing and failed documents must never surface in retrieval or
citations (AC-023). Any handler that retrieves chunks for a query builds on
`ready_chunks_query` rather than querying `Chunk` directly, so the
`status == 'ready'` filter lives in exactly one place.

`search` embeds a query with the configured embeddings provider and ranks
every ready chunk in the org's whole library by cosine similarity -- there is
no document-filter argument and none should ever be added (AC-056): every
question searches the whole library, regardless of who uploaded what.
"""

from __future__ import annotations

import os
import uuid
from dataclasses import dataclass

from sqlalchemy import cast
from sqlalchemy.orm import Query, Session

from app.models import Chunk, Document
from app.providers.embeddings import EmbeddingsProvider, get_embeddings_provider

# A chunk below this cosine-similarity score is never returned, regardless of
# how few chunks clear it (AC-055: two relevant chunks come back as two, not
# padded out with irrelevant ones to hit a minimum count).
RELEVANCE_THRESHOLD = float(os.getenv("RETRIEVAL_RELEVANCE_THRESHOLD", "0.5"))

# The typical result-count band the architecture names (AC-054): under
# ordinary conditions, with enough relevant material in the library, this
# many chunks clear the threshold. MAX_RESULTS is enforced directly (the
# candidate pool pulled from the database is capped here); MIN_RESULTS is not
# padded to -- it documents the expected lower end of that band, not a floor
# this module fabricates results to reach.
MIN_RESULTS = int(os.getenv("RETRIEVAL_MIN_RESULTS", "5"))
MAX_RESULTS = int(os.getenv("RETRIEVAL_MAX_RESULTS", "8"))


def ready_chunks_query(db: Session, org_id: uuid.UUID) -> Query:
    """Base query for chunk retrieval: scoped to the org and restricted to
    chunks belonging to a document whose status is 'ready'."""
    return (
        db.query(Chunk)
        .join(Document, Chunk.document_id == Document.id)
        .filter(Document.org_id == org_id, Document.status == "ready")
    )


@dataclass(frozen=True)
class ScoredChunk:
    """A ready chunk plus its cosine-similarity score against the query.

    `chunk` carries its own location metadata (`document_id`, `ordinal`,
    `page_start`/`page_end`, `row_start`/`row_end`) so a caller building
    citations never needs a second query.
    """

    chunk: Chunk
    score: float


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    """Pure-Python cosine similarity: the fallback used when the database is
    not Postgres (no pgvector operator available), e.g. the SQLite JSON
    column used in local dev and tests."""
    dot = sum(x * y for x, y in zip(a, b, strict=False))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(y * y for y in b) ** 0.5
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (norm_a * norm_b)


def _search_postgresql(
    base_query: Query, query_embedding: list[float], limit: int
) -> list[ScoredChunk]:
    from pgvector.sqlalchemy import Vector as PGVector

    query_vector = cast(query_embedding, PGVector(len(query_embedding)))
    # pgvector's cosine-distance operator; similarity is 1 - distance. Built
    # via `.op(...)` rather than a comparator method, since `Chunk.embedding`
    # is typed as the dialect-switching `Vector` TypeDecorator (app/models.py)
    # and not `pgvector.sqlalchemy.Vector` directly.
    distance = Chunk.embedding.op("<=>")(query_vector)
    rows = (
        base_query.add_columns((1.0 - distance).label("score"))
        .order_by(distance.asc())
        .limit(limit)
        .all()
    )
    return [ScoredChunk(chunk=chunk, score=float(score)) for chunk, score in rows]


def _search_fallback(
    base_query: Query, query_embedding: list[float], limit: int
) -> list[ScoredChunk]:
    candidates = base_query.all()
    scored = [
        ScoredChunk(chunk=chunk, score=_cosine_similarity(query_embedding, chunk.embedding))
        for chunk in candidates
    ]
    scored.sort(key=lambda sc: sc.score, reverse=True)
    return scored[:limit]


async def search(
    db: Session,
    org_id: uuid.UUID,
    query: str,
    *,
    embeddings_provider: EmbeddingsProvider | None = None,
) -> list[ScoredChunk]:
    """Embed `query` with the configured embeddings provider and return the
    ready chunks from every ready document in the org's library -- regardless
    of uploader -- ordered by descending cosine similarity, limited to
    `MAX_RESULTS` and filtered to those scoring above `RELEVANCE_THRESHOLD`
    (AC-053, AC-054, AC-055). There is no document-filter parameter (AC-056).
    """
    provider = embeddings_provider or get_embeddings_provider()
    [query_embedding] = await provider.embed([query])

    base_query = ready_chunks_query(db, org_id).filter(Chunk.embedding.isnot(None))

    dialect_name = db.get_bind().dialect.name
    if dialect_name == "postgresql":
        scored = _search_postgresql(base_query, query_embedding, MAX_RESULTS)
    else:
        scored = _search_fallback(base_query, query_embedding, MAX_RESULTS)

    return [sc for sc in scored if sc.score > RELEVANCE_THRESHOLD]
