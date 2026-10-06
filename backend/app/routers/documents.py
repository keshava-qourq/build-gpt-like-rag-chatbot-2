"""POST /documents, GET /documents, DELETE /documents/{id},
GET /documents/{id}/download."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, File, UploadFile

from app.schemas import (
    DocumentListResponse,
    DocumentUploadResult,
    DownloadUrlResponse,
    OkResponse,
)

router = APIRouter(tags=["documents"])


@router.post("/documents", response_model=list[DocumentUploadResult])
async def upload_documents(
    files: Annotated[list[UploadFile], File(...)],
) -> list[DocumentUploadResult]:
    """Stub: every accepted file reported queued; type/size validation and the
    S3 upload + ingestion-queue handoff are for the handler that replaces
    this stub."""
    return [
        DocumentUploadResult(id=uuid.uuid4(), filename=f.filename or "upload", status="queued")
        for f in files
    ]


@router.get("/documents", response_model=DocumentListResponse)
async def list_documents(page: int = 1, page_size: int = 20) -> DocumentListResponse:
    return DocumentListResponse(items=[], next=None)


@router.delete("/documents/{id}", response_model=OkResponse)
async def delete_document(id: uuid.UUID) -> OkResponse:
    """Stub: ownership-or-admin check and the cascade over chunks/embeddings
    and the S3 original are for the handler that replaces this stub."""
    return OkResponse()


@router.get("/documents/{id}/download", response_model=DownloadUrlResponse)
async def download_document(id: uuid.UUID) -> DownloadUrlResponse:
    """Stub: a placeholder URL shape; the real pre-signed URL (and the 410
    for a deleted document) are for the handler that replaces this stub."""
    return DownloadUrlResponse(url=f"https://example-bucket.s3.amazonaws.com/{id}?placeholder=1")
