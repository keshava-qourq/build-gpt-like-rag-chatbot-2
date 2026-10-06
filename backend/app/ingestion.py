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
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import Chunk, Document
from app.providers.embeddings import EmbeddingsProvider, get_embeddings_provider
from app.queue import celery_app
from app.storage import S3_BUCKET, get_s3_client

CHUNK_SIZE = 1000
CHUNK_OVERLAP = 100

# Bounds how many times a document stuck in 'processing' (a worker killed or
# restarted mid-document, redelivering the same task) is retried before it is
# given up on and marked failed -- so a document can never remain in
# 'processing' indefinitely (AC-049).
MAX_INGEST_RETRIES = 3
INGEST_RETRY_DELAY_SECONDS = 5


class ExtractionError(Exception):
    """Raised with a human-readable `failure_reason`; always caught inside
    `ingest_document`, never left to propagate to the broker."""


@dataclass
class Passage:
    """One unit of extracted text plus its optional provenance.

    `page` is set for PDF pages; `row_start`/`row_end` for CSV rows.
    DOCX, TXT and Markdown extraction carries no page/row provenance, so
    both stay `None` and the resulting `Chunk` rows simply have no
    page/row columns populated.
    """

    text: str
    page: int | None = None
    row_start: int | None = None
    row_end: int | None = None


def _decode(data: bytes) -> str:
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        try:
            return data.decode("latin-1")
        except Exception as exc:
            raise ExtractionError("unreadable file") from exc


def _extract_txt_passages(data: bytes) -> list[Passage]:
    # No language-specific tuning (tokenizer, stopword list, encoding
    # heuristics, etc.) is applied anywhere in this module: UTF-8 (falling
    # back to Latin-1) decodes any Unicode script, the chunker below is a
    # plain character splitter, and retrieval ranks purely on embedding
    # similarity. A non-English document therefore extracts, chunks and
    # indexes exactly like an English one and takes no separate failure
    # path -- but retrieval quality for non-English content is simply not
    # guaranteed (AC-038).
    text = _decode(data)
    if not text.strip():
        raise ExtractionError("no extractable text")
    return [Passage(text=text)]


def _extract_csv_passages(data: bytes) -> list[Passage]:
    text = _decode(data)
    rows = list(csv.reader(io.StringIO(text)))
    passages = [
        Passage(text=", ".join(row), row_start=i + 1, row_end=i + 1)
        for i, row in enumerate(rows)
        if any(cell.strip() for cell in row)
    ]
    if not passages:
        raise ExtractionError("no extractable text")
    return passages


def _extract_pdf_passages(data: bytes) -> list[Passage]:
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
            passages: list[Passage] = []
            for page_number, page in enumerate(doc, start=1):
                page_text = page.get_text()
                if page_text.strip():
                    passages.append(Passage(text=page_text, page=page_number))
        except ExtractionError:
            raise
        except Exception as exc:
            raise ExtractionError("unreadable file") from exc
    finally:
        doc.close()

    if not passages:
        raise ExtractionError("no extractable text")
    return passages


def _extract_docx_passages(data: bytes) -> list[Passage]:
    import docx
    from docx.oxml.ns import qn
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    try:
        document = docx.Document(io.BytesIO(data))
    except Exception as exc:
        raise ExtractionError("unreadable file") from exc

    # Walk the body's XML children in document order rather than
    # `document.paragraphs`/`document.tables` separately: that keeps
    # paragraphs and tables interleaved the way the author wrote them, so a
    # table is never silently dropped or reordered to the end (AC-035).
    parts: list[str] = []
    for child in document.element.body.iterchildren():
        if child.tag == qn("w:p"):
            paragraph = Paragraph(child, document)
            if paragraph.text.strip():
                parts.append(paragraph.text)
        elif child.tag == qn("w:tbl"):
            table = Table(child, document)
            for row in table.rows:
                cells_text = " | ".join(cell.text.strip() for cell in row.cells)
                if cells_text.strip():
                    parts.append(cells_text)

    text = "\n".join(parts)
    if not text.strip():
        raise ExtractionError("no extractable text")
    return [Passage(text=text)]


_PASSAGE_EXTRACTORS = {
    "txt": _extract_txt_passages,
    "md": _extract_txt_passages,
    "markdown": _extract_txt_passages,
    "csv": _extract_csv_passages,
    "pdf": _extract_pdf_passages,
    "docx": _extract_docx_passages,
}


def extract_passages(fmt: str, data: bytes) -> list[Passage]:
    """Format-aware extraction that preserves per-page (PDF) and per-row
    (CSV) provenance; DOCX, TXT and Markdown passages carry no page/row
    info. `ingest_document` chunks each passage independently so a chunk
    never spans two pages or a non-contiguous row range."""
    extractor = _PASSAGE_EXTRACTORS.get((fmt or "").lower())
    if extractor is None:
        raise ExtractionError("unreadable file")
    return extractor(data)


def extract_text(fmt: str, data: bytes) -> str:
    """Flat-text view over `extract_passages` kept for existing callers and
    tests that only need the concatenated document text. `ingest_document`
    itself uses `extract_passages` directly so that per-chunk page/row
    provenance survives onto `Chunk` rows."""
    passages = extract_passages(fmt, data)
    return "\n".join(p.text for p in passages)


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


def chunk_passages(
    passages: list[Passage], chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP
) -> list[dict]:
    """Chunk each passage independently and carry its provenance onto every
    resulting chunk. Because chunking never crosses a passage boundary, a
    chunk can never merge text from two different PDF pages or a
    non-contiguous CSV row range (AC-034, AC-036)."""
    records: list[dict] = []
    for passage in passages:
        for piece in chunk_text(passage.text, chunk_size=chunk_size, overlap=overlap):
            records.append(
                {
                    "text": piece,
                    "page_start": passage.page,
                    "page_end": passage.page,
                    "row_start": passage.row_start,
                    "row_end": passage.row_end,
                }
            )
    return records


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


@celery_app.task(
    bind=True,
    name="app.ingestion.ingest_document",
    acks_late=True,
    reject_on_worker_lost=True,
    max_retries=MAX_INGEST_RETRIES,
    default_retry_delay=INGEST_RETRY_DELAY_SECONDS,
)
def ingest_document(self, document_id: str) -> None:
    """queued -> processing -> ready/failed for exactly one document
    (AC-020, AC-021). Extraction errors -- an unreadable file, a
    password-protected file, a file with no extractable text -- are caught
    here and stored as `failure_reason`, never raised to the broker, so a
    failing document never affects any other document in the same batch
    (AC-017).

    `acks_late` + `reject_on_worker_lost` mean a worker killed or restarted
    mid-document redelivers this same task rather than silently dropping
    it. A redelivery is recognised here by the document already being in
    'processing' (a normal run always finishes to ready/failed before the
    message would be acked) and is retried a bounded number of times; once
    exhausted the document is marked failed rather than left stuck in
    'processing' forever (AC-049).
    """
    db = SessionLocal()
    try:
        doc_id = uuid.UUID(str(document_id))
        document = db.query(Document).filter(Document.id == doc_id).one_or_none()
        if document is None:
            return

        if document.status == "processing":
            if self.request.retries >= MAX_INGEST_RETRIES:
                _mark_failed(
                    db, document, "worker crashed mid-document: max retries exceeded"
                )
                return
            raise self.retry(countdown=INGEST_RETRY_DELAY_SECONDS, max_retries=MAX_INGEST_RETRIES)

        document.status = "processing"
        document.failure_reason = None
        db.commit()

        try:
            data = _fetch_object(document.s3_key)
            passages = extract_passages(document.format, data)
            chunk_records = chunk_passages(passages)
            if not chunk_records:
                raise ExtractionError("no extractable text")

            provider = get_embeddings_provider()
            embeddings = _run_embed(provider, [record["text"] for record in chunk_records])

            db.query(Chunk).filter(Chunk.document_id == document.id).delete()

            for ordinal, (record, vector) in enumerate(
                zip(chunk_records, embeddings, strict=True)
            ):
                db.add(
                    Chunk(
                        org_id=document.org_id,
                        document_id=document.id,
                        ordinal=ordinal,
                        text=record["text"],
                        page_start=record["page_start"],
                        page_end=record["page_end"],
                        row_start=record["row_start"],
                        row_end=record["row_end"],
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
