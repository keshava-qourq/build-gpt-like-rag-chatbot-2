"""Tombstone for a hard-deleted document.

The story requires real removal of the document row, its chunks and its S3
object -- no soft-delete flag on `Document` itself (see `app/models.py`,
read-only to this task). But a citation created before deletion still needs
to resolve to an explicit "no longer available" response rather than an
indistinguishable 404, and `GET /documents/{id}/download` needs to tell a
deleted document apart from one that never existed or belongs to another
org. This one small, append-only table is that record: one row per deleted
document, org-scoped, written in the same transaction as the delete.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class DeletedDocument(Base):
    __tablename__ = "deleted_documents"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    org_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"))
    deleted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


__all__ = ["DeletedDocument"]
