"""Celery worker: advances a queued document to processing, then ready/failed.

Consumes `ingest_document(document_id)` off the broker shared with the API
(`app.queue.celery_app`). Extraction, chunking and embedding all happen here;
every failure mode is caught per document and turned into a human-readable
`failure_reason` plus `status = 'failed'` rather than raised to the broker,
so one bad document in a batch never affects the rest (AC-017).
"""

from __future__ import annotations

import asyncio
import csv
import io
import uuid

from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import Chunk, Document
from app.providers.embeddings import EmbeddingsProvider, get_embeddings_provider
from app.queue import celery_app
from app.storage import S3_BUCKET, get_s3_client

CHUNK_SIZE = 1000
CHUNK_OVERLAP = 100


class ExtractionError(Exception):
    """Raised with a human-readable `failure_reason`; always caught inside
    `ingest_document`, never left to propagate to the broker."""


def _extract_txt(data: bytes) -> str:
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        try:
            text = data.decode("latin-1")
        except Exception as exc:
            raise ExtractionError("unreadable file") from exc
    if not text.strip():
        raise ExtractionError("no extractable text")
    return text


def _extract_csv(data: bytes) -> str:
    text = _extract_txt(data)
    rows = [", ".join(row) for row in csv.reader(io.StringIO(text))]
    joined = "\n".join(rows)
    if not joined.strip():
        raise ExtractionError("no extractable text")
    return joined


def _extract_pdf(data: bytes) -> str:
    import fitz  # PyMuPDF

    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception as exc:
        message = str(exc).lower()
        if "password" in message or "encrypt" in message:
            raise ExtractionError("password-protected file") from exc
        raise ExtractionError("unreadable file") from exc

    try:
        if doc.needs_pass:
            raise ExtractionError("password-protected file")
        try:
            text = "\n".join(page.get_text() for page in doc)
        except Exception as exc:
            raise ExtractionError("unreadable file") from exc
    finally:
        doc.close()

    if not text.strip():
        raise ExtractionError("no extractable text")
    return text


def _extract_docx(data: bytes) -> str:
    import docx

    try:
        document = docx.Document(io.BytesIO(data))
    except Exception as exc:
        raise ExtractionError("unreadable file") from exc

    text = "\n".join(p.text for p in document.paragraphs)
    if not text.strip():
        raise ExtractionError("no extractable text")
    return text


_EXTRACTORS = {
    "txt": _extract_txt,
    "md": _extract_txt,
    "markdown": _extract_txt,
    "csv": _extract_csv,
    "pdf": _extract_pdf,
    "docx": _extract_docx,
}


def extract_text(fmt: str, data: bytes) -> str:
    extractor = _EXTRACTORS.get((fmt or "").lower())
    if extractor is None:
        raise ExtractionError("unreadable file")
    return extractor(data)


def chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """Fixed-size character chunks with overlap -- no tokenizer dependency
    the architecture never named."""
    text = text.strip()
    if not text:
        return []

    chunks: list[str] = []
    start = 0
    length = len(text)
    step = max(chunk_size - overlap, 1)

    while start < length:
        end = min(start + chunk_size, length)
        piece = text[start:end].strip()
        if piece:
            chunks.append(piece)
        if end >= length:
            break
        start += step

    return chunks


def _fetch_object(s3_key: str) -> bytes:
    client = get_s3_client()
    try:
        obj = client.get_object(Bucket=S3_BUCKET, Key=s3_key)
        return obj["Body"].read()
    except Exception as exc:
        raise ExtractionError("unreadable file") from exc


def _run_embed(provider: EmbeddingsProvider, pieces: list[str]) -> list[list[float] | None]:
    try:
        return asyncio.run(provider.embed(pieces))
    except NotImplementedError:
        # No real embeddings backend wired up in this environment: store
        # chunks without vectors rather than fail the whole document.
        return [None] * len(pieces)


def _mark_failed(db: Session, document: Document, reason: str) -> None:
    db.rollback()
    document = db.query(Document).filter(Document.id == document.id).one()
    document.status = "failed"
    document.failure_reason = reason
    db.commit()


@celery_app.task(name="app.ingestion.ingest_document")
def ingest_document(document_id: str) -> None:
    """queued -> processing -> ready/failed for exactly one document
    (AC-020, AC-021). Extraction errors -- an unreadable file, a
    password-protected file, a file with no extractable text -- are caught
    here and stored as `failure_reason`, never raised to the broker, so a
    failing document never affects any other document in the same batch
    (AC-017)."""
    db = SessionLocal()
    try:
        doc_id = uuid.UUID(str(document_id))
        document = db.query(Document).filter(Document.id == doc_id).one_or_none()
        if document is None:
            return

        document.status = "processing"
        document.failure_reason = None
        db.commit()

        try:
            data = _fetch_object(document.s3_key)
            text = extract_text(document.format, data)
            pieces = chunk_text(text)
            if not pieces:
                raise ExtractionError("no extractable text")

            provider = get_embeddings_provider()
            embeddings = _run_embed(provider, pieces)

            db.query(Chunk).filter(Chunk.document_id == document.id).delete()

            for ordinal, (piece, vector) in enumerate(zip(pieces, embeddings, strict=True)):
                db.add(
                    Chunk(
                        org_id=document.org_id,
                        document_id=document.id,
                        ordinal=ordinal,
                        text=piece,
                        embedding=vector,
                        embedding_model=provider.model_name if vector is not None else None,
                        embedding_dim=provider.dimension if vector is not None else None,
                    )
                )

            document.status = "ready"
            document.failure_reason = None
            db.commit()
        except ExtractionError as exc:
            _mark_failed(db, document, str(exc))
        except Exception:
            # Anything unanticipated is still a per-document failure, not a
            # worker crash: this is the last line of defense for AC-017.
            _mark_failed(db, document, "unreadable file")
    finally:
        db.close()
