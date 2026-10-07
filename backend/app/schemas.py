"""Pydantic request/response models for the approved api_spec.

These mirror each endpoint's declared shape so the stub routers in
`app/routers/` return something correctly typed before a single handler holds
real logic -- hashing, token issuance, retrieval and persistence are for the
handler that replaces each stub.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class UserOut(BaseModel):
    id: uuid.UUID
    role: str


class LoginRequest(BaseModel):
    email: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    user: UserOut


class OkResponse(BaseModel):
    ok: bool = True


class InvitationCreateRequest(BaseModel):
    email: str
    role: str


class InvitationOut(BaseModel):
    id: uuid.UUID
    email: str
    role: str
    expires_at: datetime
    accept_url: str
    token: str


class InvitationAcceptRequest(BaseModel):
    token: str
    password: str


class InvitationAcceptResponse(BaseModel):
    access_token: str
    user: UserOut


class DocumentUploadResult(BaseModel):
    id: uuid.UUID
    filename: str
    status: str
    error: str | None = None
    # Populated only for status 'duplicate' (AC-031): the document already
    # on file under this filename, and a message telling the caller that
    # replacement must be confirmed via `replace_document_ids`.
    existing_document_id: uuid.UUID | None = None
    message: str | None = None
    # Populated only on a successful replacement upload (AC-032): the
    # document id this new version supersedes.
    replaces_document_id: uuid.UUID | None = None


class DocumentListItem(BaseModel):
    id: uuid.UUID
    filename: str
    format: str
    size_bytes: int
    uploader: str
    status: str
    failure_reason: str | None = None
    # The document this one replaces, if it was uploaded as a replacement,
    # and whether that prior version is still in the database -- true until
    # the worker retires it on successful ingestion, and left true forever
    # if ingestion instead failed (AC-033).
    supersedes_document_id: uuid.UUID | None = None
    previous_version_retained: bool = False
    created_at: datetime


class DocumentListResponse(BaseModel):
    items: list[DocumentListItem]
    next: str | None = None


class DownloadUrlResponse(BaseModel):
    url: str


class ConversationSummary(BaseModel):
    id: uuid.UUID
    title: str | None = None
    updated_at: datetime


class ConversationCreateResponse(BaseModel):
    id: uuid.UUID


class CitationOut(BaseModel):
    marker: int
    document_id: uuid.UUID | None = None
    filename: str | None = None
    format: str | None = None
    snapshot_text: str
    location_label: str | None = None
    deleted: bool = False


class MessageOut(BaseModel):
    id: uuid.UUID
    role: str
    content: str
    citations: list[CitationOut] = Field(default_factory=list)


class ConversationDetail(BaseModel):
    id: uuid.UUID
    title: str | None = None
    messages: list[MessageOut] = Field(default_factory=list)


class ConversationRenameRequest(BaseModel):
    title: str


class ConversationRenameResponse(BaseModel):
    id: uuid.UUID
    title: str


class MessageCreateRequest(BaseModel):
    content: str


class HealthResponse(BaseModel):
    db: str
    s3: str
