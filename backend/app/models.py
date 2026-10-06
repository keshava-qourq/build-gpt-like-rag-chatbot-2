"""SQLAlchemy models for the entities the approved architecture declares.

`Base` is bound to the engine in `app.database`; `main.py` imports this module
before calling `create_all`, so every class defined here becomes a table.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import TypeDecorator

from app.database import Base

EMBEDDING_DIM = 1536


class Vector(TypeDecorator):
    """`vector(n)` on Postgres (via the pgvector extension), a JSON-encoded
    float array everywhere else.

    `app.database` defaults to SQLite so a fresh clone runs with no database
    server at all. pgvector has no SQLite equivalent, so this type compiles to
    the real `pgvector.sqlalchemy.Vector` only when the engine dialect is
    `postgresql`; elsewhere it stores the same floats as JSON text. Point
    `DATABASE_URL` at Postgres and the column becomes a real vector column
    with no model change.
    """

    impl = Text
    cache_ok = True

    def __init__(self, dim: int = EMBEDDING_DIM, *args, **kwargs) -> None:
        self.dim = dim
        super().__init__(*args, **kwargs)

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            from pgvector.sqlalchemy import Vector as PGVector

            return dialect.type_descriptor(PGVector(self.dim))
        return dialect.type_descriptor(Text())

    def process_bind_param(self, value, dialect):
        if value is None or dialect.name == "postgresql":
            return value
        return json.dumps(list(value))

    def process_result_value(self, value, dialect):
        if value is None or dialect.name == "postgresql":
            return value
        return json.loads(value)


def _uuid() -> uuid.UUID:
    return uuid.uuid4()


class Organization(Base):
    __tablename__ = "organizations"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    org_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"))
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20))
    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Invitation(Base):
    __tablename__ = "invitations"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    org_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"))
    email: Mapped[str] = mapped_column(String(320))
    role: Mapped[str] = mapped_column(String(20))
    token_hash: Mapped[str] = mapped_column(String(255))
    invited_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    org_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"))
    uploader_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    filename: Mapped[str] = mapped_column(String(512))
    format: Mapped[str] = mapped_column(String(20))
    size_bytes: Mapped[int] = mapped_column(Integer)
    s3_key: Mapped[str] = mapped_column(String(1024))
    status: Mapped[str] = mapped_column(String(20), default="queued")
    failure_reason: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    chunks: Mapped[list["Chunk"]] = relationship(
        back_populates="document", cascade="all, delete-orphan"
    )


class Chunk(Base):
    __tablename__ = "chunks"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    org_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"))
    document_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("documents.id"))
    ordinal: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text)
    page_start: Mapped[int | None] = mapped_column(Integer, nullable=True)
    page_end: Mapped[int | None] = mapped_column(Integer, nullable=True)
    row_start: Mapped[int | None] = mapped_column(Integer, nullable=True)
    row_end: Mapped[int | None] = mapped_column(Integer, nullable=True)
    embedding: Mapped[list[float] | None] = mapped_column(Vector(EMBEDDING_DIM), nullable=True)
    embedding_model: Mapped[str | None] = mapped_column(String(100), nullable=True)
    embedding_dim: Mapped[int | None] = mapped_column(Integer, nullable=True)

    document: Mapped[Document] = relationship(back_populates="chunks")


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    org_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    messages: Mapped[list["Message"]] = relationship(
        back_populates="conversation", cascade="all, delete-orphan"
    )


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    conversation_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("conversations.id"))
    role: Mapped[str] = mapped_column(String(20))
    content: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="complete")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    conversation: Mapped[Conversation] = relationship(back_populates="messages")
    citations: Mapped[list["Citation"]] = relationship(
        back_populates="message", cascade="all, delete-orphan"
    )


class Citation(Base):
    __tablename__ = "citations"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    message_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("messages.id"))
    chunk_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("chunks.id"), nullable=True)
    marker: Mapped[int] = mapped_column(Integer)
    document_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("documents.id"), nullable=True
    )
    snapshot_text: Mapped[str] = mapped_column(Text)
    location_label: Mapped[str | None] = mapped_column(String(100), nullable=True)

    message: Mapped[Message] = relationship(back_populates="citations")


__all__ = [
    "Base",
    "Organization",
    "User",
    "Invitation",
    "Document",
    "Chunk",
    "Conversation",
    "Message",
    "Citation",
    "Vector",
    "EMBEDDING_DIM",
]
