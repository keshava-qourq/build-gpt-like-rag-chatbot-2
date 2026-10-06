"""Retrieval eligibility: only 'ready' documents are ever searched or cited.

Queued, processing and failed documents must never surface in retrieval or
citations (AC-023). Any handler that retrieves chunks for a query builds on
`ready_chunks_query` rather than querying `Chunk` directly, so the
`status == 'ready'` filter lives in exactly one place.
"""

from __future__ import annotations

import uuid

from sqlalchemy.orm import Query, Session

from app.models import Chunk, Document


def ready_chunks_query(db: Session, org_id: uuid.UUID) -> Query:
    """Base query for chunk retrieval: scoped to the org and restricted to
    chunks belonging to a document whose status is 'ready'."""
    return (
        db.query(Chunk)
        .join(Document, Chunk.document_id == Document.id)
        .filter(Document.org_id == org_id, Document.status == "ready")
    )
