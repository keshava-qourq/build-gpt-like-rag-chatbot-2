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


class DocumentListItem(BaseModel):
    id: uuid.UUID
    filename: str
    format: str
    size_bytes: int
    uploader: str
    status: str
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
    snapshot_text: str
    location_label: str | None = None


class MessageOut(BaseModel):
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
