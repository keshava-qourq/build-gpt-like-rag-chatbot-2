"""POST /documents, GET /documents, DELETE /documents/{id},
GET /documents/{id}/download."""

from __future__ import annotations

import os
import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth import RequireAuth
from app.database import get_db
from app.deletions import DeletedDocument
from app.models import Chunk, Citation, Document, User
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

# Presigned download URLs are short-lived by design (AC-111): a leaked or
# cached URL stops working on its own rather than granting indefinite
# access. Configurable so an operator can tighten or loosen it without a
# code change; defaults to 5 minutes.
DOWNLOAD_URL_EXPIRES_SECONDS = int(os.getenv("DOWNLOAD_URL_EXPIRES_SECONDS", "300"))

# Original content type served via `ResponseContentType` on the presigned
# URL, keyed by the same format string stored on `Document.format`.
_CONTENT_TYPES = {
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "txt": "text/plain",
    "csv": "text/csv",
    "md": "text/markdown",
}


def _content_type_for(fmt: str) -> str:
    return _CONTENT_TYPES.get((fmt or "").lower(), "application/octet-stream")


_UNSUPPORTED_TYPE_MESSAGE = "Only PDF, DOCX, TXT, CSV and Markdown files are supported"
_OVER_SIZE_MESSAGE = "File exceeds the 50MB per-file limit"
_DUPLICATE_MESSAGE = (
    "A version of this file already exists; confirm replacement to upload a new version."
)

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
    replace_document_ids: Annotated[list[uuid.UUID] | None, Form()] = None,
) -> list[DocumentUploadResult]:
    """Each file is validated, stored and recorded independently: a rejection
    or storage failure on one file returns its own error entry and never
    aborts the others (AC-017). Type is checked before a single byte is read;
    size is checked before anything reaches S3 or the database (AC-018,
    AC-019).

    A filename that already exists in the org (case-insensitive) is a
    duplicate unless its document id is named in `replace_document_ids`:
    replacement is opt-in, confirmed per document, never inferred (AC-031).
    A confirmed replacement stores the new file and queues it with
    `supersedes_document_id` set; the prior version is retired by the
    worker only once the replacement reaches 'ready' (AC-032), never here.
    """
    org_id = uuid.UUID(claims["org_id"])
    uploader_id = uuid.UUID(claims["sub"])
    confirmed_replace_ids = set(replace_document_ids or [])

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

        existing = (
            db.query(Document)
            .filter(Document.org_id == org_id, func.lower(Document.filename) == filename.lower())
            .order_by(Document.created_at.desc())
            .first()
        )

        if existing is not None and existing.id not in confirmed_replace_ids:
            results.append(
                DocumentUploadResult(
                    id=existing.id,
                    filename=filename,
                    status="duplicate",
                    existing_document_id=existing.id,
                    message=_DUPLICATE_MESSAGE,
                )
            )
            continue

        supersedes_id = existing.id if existing is not None else None

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
            supersedes_document_id=supersedes_id,
            created_at=datetime.now(UTC),
        )
        db.add(document)
        db.commit()
        db.refresh(document)

        celery_app.send_task(INGEST_TASK_NAME, args=[str(document.id)])

        results.append(
            DocumentUploadResult(
                id=document.id,
                filename=filename,
                status="queued",
                replaces_document_id=supersedes_id,
            )
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

    supersedes_ids = {doc.supersedes_document_id for doc, _ in rows if doc.supersedes_document_id}
    still_present_ids: set[uuid.UUID] = set()
    if supersedes_ids:
        still_present_ids = {
            row.id for row in db.query(Document.id).filter(Document.id.in_(supersedes_ids)).all()
        }

    items = [
        DocumentListItem(
            id=doc.id,
            filename=doc.filename,
            format=doc.format,
            size_bytes=doc.size_bytes,
            uploader=email,
            status=doc.status,
            failure_reason=doc.failure_reason,
            supersedes_document_id=doc.supersedes_document_id,
            previous_version_retained=doc.supersedes_document_id in still_present_ids
            if doc.supersedes_document_id is not None
            else False,
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
    member in the org receives 403 (an admin may delete any org document,
    AC-030). Deletion is real, not a flag: the row, its chunks and their
    embeddings and the original S3 object are all removed, and a storage
    failure aborts the delete rather than silently passing (AC-027).
    Citations that reference this document or its chunks survive with
    those references nulled, and a tombstone is recorded so a later
    download or citation resolution can say so explicitly (AC-028,
    AC-029)."""
    org_id = uuid.UUID(claims["org_id"])
    document = db.query(Document).filter(Document.id == id, Document.org_id == org_id).one_or_none()
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")

    if claims["role"] != "admin" and str(document.uploader_id) != claims["sub"]:
        raise HTTPException(status_code=403, detail="Not permitted to delete this document")

    try:
        get_s3_client().delete_object(Bucket=S3_BUCKET, Key=document.s3_key)
    except Exception as exc:
        raise HTTPException(
            status_code=502, detail=f"Failed to delete source document: {exc}"
        ) from exc

    chunk_ids = [
        row.id for row in db.query(Chunk.id).filter(Chunk.document_id == document.id).all()
    ]
    if chunk_ids:
        db.query(Citation).filter(Citation.chunk_id.in_(chunk_ids)).update(
            {Citation.chunk_id: None, Citation.document_id: None}, synchronize_session=False
        )
    db.query(Citation).filter(Citation.document_id == document.id).update(
        {Citation.document_id: None}, synchronize_session=False
    )

    db.add(DeletedDocument(id=document.id, org_id=org_id, deleted_at=datetime.now(UTC)))
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
        deleted = (
            db.query(DeletedDocument)
            .filter(DeletedDocument.id == id, DeletedDocument.org_id == org_id)
            .one_or_none()
        )
        if deleted is not None:
            raise HTTPException(status_code=410, detail="source document no longer available")
        raise HTTPException(status_code=404, detail="Document not found")

    url = get_s3_client().generate_presigned_url(
        "get_object",
        Params={
            "Bucket": S3_BUCKET,
            "Key": document.s3_key,
            "ResponseContentDisposition": f'attachment; filename="{document.filename}"',
            "ResponseContentType": _content_type_for(document.format),
        },
        ExpiresIn=DOWNLOAD_URL_EXPIRES_SECONDS,
    )
    return DownloadUrlResponse(url=url)
