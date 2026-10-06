"""POST /documents, GET /documents, DELETE /documents/{id},
GET /documents/{id}/download."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.auth import RequireAuth
from app.database import get_db
from app.models import Document, User
from app.schemas import (
    DocumentListItem,
    DocumentListResponse,
    DocumentUploadResult,
    DownloadUrlResponse,
    OkResponse,
)
from app.storage import S3_BUCKET, get_s3_client

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
async def list_documents(
    claims: RequireAuth,
    db: Annotated[Session, Depends(get_db)],
    page: int = 1,
    page_size: int = 20,
) -> DocumentListResponse:
    """Every document in the caller's org, regardless of uploader -- no
    per-document permission field exists, so visibility is org-wide."""
    org_id = uuid.UUID(claims["org_id"])
    offset = max(page - 1, 0) * page_size

    rows = (
        db.query(Document, User.email)
        .join(User, Document.uploader_id == User.id)
        .filter(Document.org_id == org_id)
        .order_by(Document.created_at.desc())
        .offset(offset)
        .limit(page_size)
        .all()
    )

    items = [
        DocumentListItem(
            id=doc.id,
            filename=doc.filename,
            format=doc.format,
            size_bytes=doc.size_bytes,
            uploader=email,
            status=doc.status,
            created_at=doc.created_at,
        )
        for doc, email in rows
    ]
    return DocumentListResponse(items=items, next=None)


@router.delete("/documents/{id}", response_model=OkResponse)
async def delete_document(
    id: uuid.UUID,
    claims: RequireAuth,
    db: Annotated[Session, Depends(get_db)],
) -> OkResponse:
    """The uploader or an admin in the same org may delete; any other
    member in the org receives 403."""
    org_id = uuid.UUID(claims["org_id"])
    document = db.query(Document).filter(Document.id == id, Document.org_id == org_id).one_or_none()
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")

    if claims["role"] != "admin" and str(document.uploader_id) != claims["sub"]:
        raise HTTPException(status_code=403, detail="Not permitted to delete this document")

    try:
        get_s3_client().delete_object(Bucket=S3_BUCKET, Key=document.s3_key)
    except Exception:
        pass  # best effort; the DB row is the source of truth for listings

    db.delete(document)
    db.commit()
    return OkResponse()


@router.get("/documents/{id}/download", response_model=DownloadUrlResponse)
async def download_document(
    id: uuid.UUID,
    claims: RequireAuth,
    db: Annotated[Session, Depends(get_db)],
) -> DownloadUrlResponse:
    """Any member of the org may download any org document -- download is
    not ownership-restricted, only org-scoped."""
    org_id = uuid.UUID(claims["org_id"])
    document = db.query(Document).filter(Document.id == id, Document.org_id == org_id).one_or_none()
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")

    return DownloadUrlResponse(url=f"https://example-bucket.s3.amazonaws.com/{id}?placeholder=1")
