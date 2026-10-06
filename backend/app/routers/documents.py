"""POST /documents, GET /documents, DELETE /documents/{id},
GET /documents/{id}/download."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.auth import RequireAuth
from app.database import get_db
from app.models import Document, User
from app.queue import celery_app
from app.schemas import (
    DocumentListItem,
    DocumentListResponse,
    DocumentUploadResult,
    DownloadUrlResponse,
    OkResponse,
)
from app.storage import S3_BUCKET, get_s3_client

router = APIRouter(tags=["documents"])

# 50MB per the api_spec; every file over this is rejected before any byte
# reaches S3 (AC-019).
MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024

# Exactly the five formats the architecture names for ingestion; anything
# else is rejected before upload (AC-018).
ALLOWED_FORMATS = {
    ".pdf": "pdf",
    ".docx": "docx",
    ".txt": "txt",
    ".csv": "csv",
    ".md": "md",
}

_UNSUPPORTED_TYPE_MESSAGE = "Only PDF, DOCX, TXT, CSV and Markdown files are supported"
_OVER_SIZE_MESSAGE = "File exceeds the 50MB per-file limit"

# Name of the Celery task the ingestion worker registers; the worker module
# itself belongs to another task, this is only the shared contract both
# sides agree on.
INGEST_TASK_NAME = "ingest_document"


def _extension(filename: str) -> str:
    idx = filename.rfind(".")
    if idx == -1:
        return ""
    return filename[idx:].lower()


@router.post("/documents", response_model=list[DocumentUploadResult])
async def upload_documents(
    claims: RequireAuth,
    db: Annotated[Session, Depends(get_db)],
    files: Annotated[list[UploadFile], File(...)],
) -> list[DocumentUploadResult]:
    """Each file is validated, stored and recorded independently: a rejection
    or storage failure on one file returns its own error entry and never
    aborts the others (AC-017). Type is checked before a single byte is read;
    size is checked before anything reaches S3 or the database (AC-018,
    AC-019)."""
    org_id = uuid.UUID(claims["org_id"])
    uploader_id = uuid.UUID(claims["sub"])

    results: list[DocumentUploadResult] = []

    for upload in files:
        filename = upload.filename or "upload"
        fmt = ALLOWED_FORMATS.get(_extension(filename))

        if fmt is None:
            results.append(
                DocumentUploadResult(
                    id=uuid.uuid4(),
                    filename=filename,
                    status="rejected",
                    error=_UNSUPPORTED_TYPE_MESSAGE,
                )
            )
            continue

        content = await upload.read()

        if len(content) > MAX_FILE_SIZE_BYTES:
            results.append(
                DocumentUploadResult(
                    id=uuid.uuid4(),
                    filename=filename,
                    status="rejected",
                    error=_OVER_SIZE_MESSAGE,
                )
            )
            continue

        document_id = uuid.uuid4()
        s3_key = f"{org_id}/{document_id}/{filename}"

        try:
            get_s3_client().put_object(Bucket=S3_BUCKET, Key=s3_key, Body=content)
        except Exception as exc:  # noqa: BLE001 -- surfaced per-file, not raised
            results.append(
                DocumentUploadResult(
                    id=uuid.uuid4(),
                    filename=filename,
                    status="rejected",
                    error=f"Upload failed: {exc}",
                )
            )
            continue

        document = Document(
            id=document_id,
            org_id=org_id,
            uploader_id=uploader_id,
            filename=filename,
            format=fmt,
            size_bytes=len(content),
            s3_key=s3_key,
            status="queued",
            created_at=datetime.now(UTC),
        )
        db.add(document)
        db.commit()
        db.refresh(document)

        celery_app.send_task(INGEST_TASK_NAME, args=[str(document.id)])

        results.append(
            DocumentUploadResult(id=document.id, filename=filename, status="queued")
        )

    return results


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

    base_query = db.query(Document).filter(Document.org_id == org_id)
    total = base_query.count()

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
            failure_reason=doc.failure_reason,
            created_at=doc.created_at,
        )
        for doc, email in rows
    ]

    has_next = offset + page_size < total
    next_cursor = str(page + 1) if has_next else None

    return DocumentListResponse(items=items, next=next_cursor)


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
