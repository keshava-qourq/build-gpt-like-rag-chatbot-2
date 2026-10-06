"""GET/POST /conversations, GET/PATCH/DELETE /conversations/{id},
POST /conversations/{id}/messages, POST
/conversations/{id}/messages/{message_id}/regenerate.

Streaming goes through `app.generation.answer_question`: this module never
re-implements prompt assembly, refusal or citation resolution, only turns
that async-generator contract into SSE frames and persists what it yields
(AC-069..AC-072).
"""

from __future__ import annotations

import json
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.auth import RequireAuth
from app.database import get_db
from app.generation import AnswerCitations, AnswerToken, ResolvedCitation, answer_question
from app.models import Citation, Conversation, Document, Message
from app.providers.llm import get_llm_provider
from app.schemas import (
    CitationOut,
    ConversationCreateResponse,
    ConversationDetail,
    ConversationRenameRequest,
    ConversationRenameResponse,
    ConversationSummary,
    MessageCreateRequest,
    MessageOut,
    OkResponse,
)

router = APIRouter(tags=["conversations"])


def _get_owned_conversation(
    db: Session, conversation_id: uuid.UUID, org_id: uuid.UUID, user_id: uuid.UUID
) -> Conversation:
    """Tenant- and owner-scoped lookup used by every /conversations/{id}
    route: a conversation belonging to another org or another user in the
    same org (admins included) is indistinguishable from one that does not
    exist -- a plain 404, never a 403 that would leak its existence."""
    conversation = (
        db.query(Conversation)
        .filter(
            Conversation.id == conversation_id,
            Conversation.org_id == org_id,
            Conversation.user_id == user_id,
        )
        .one_or_none()
    )
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation


def _history_before(
    db: Session, conversation_id: uuid.UUID, *, before: datetime
) -> list[dict[str, str]]:
    rows = (
        db.query(Message)
        .filter(Message.conversation_id == conversation_id, Message.created_at < before)
        .order_by(Message.created_at.asc())
        .all()
    )
    return [{"role": m.role, "content": m.content} for m in rows]


def _sse(event: str, data) -> bytes:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n".encode()


def _citation_event_payload(db: Session, citations: list[ResolvedCitation]) -> list[dict]:
    document_ids = {c.document_id for c in citations if c.document_id is not None}
    filenames: dict[uuid.UUID, str] = {}
    if document_ids:
        filenames = {
            row.id: row.filename
            for row in db.query(Document.id, Document.filename)
            .filter(Document.id.in_(document_ids))
            .all()
        }
    return [
        {
            "marker": c.marker,
            "document_id": str(c.document_id) if c.document_id else None,
            "filename": filenames.get(c.document_id) if c.document_id else None,
            "location_label": c.location_label,
            "snapshot_text": c.snapshot_text,
        }
        for c in citations
    ]


_FALLBACK_TITLE_MAX_LENGTH = 60


def _fallback_title(question: str) -> str:
    """Truncated form of the first question, used whenever title generation
    raises or returns empty (AC-086) -- the conversation must never be left
    without a usable title just because the provider failed."""
    trimmed = " ".join(question.split())
    if len(trimmed) <= _FALLBACK_TITLE_MAX_LENGTH:
        return trimmed
    return trimmed[: _FALLBACK_TITLE_MAX_LENGTH - 3].rstrip() + "..."


async def _generate_title(*, question: str, answer: str) -> str:
    """Best-effort title from the first question and its completed answer
    (AC-084). A provider failure or an empty result never breaks the turn:
    a truncated form of the question is persisted instead (AC-086)."""
    title: str | None = None
    try:
        provider = get_llm_provider()
        title = await provider.generate_title(first_message=question, answer=answer or None)
    except Exception:  # noqa: BLE001 -- title generation is best-effort
        title = None
    title = (title or "").strip()
    return title or _fallback_title(question)


async def _persist_assistant_turn(
    db: Session,
    conversation: Conversation,
    content: str,
    status: str,
    citations: list[ResolvedCitation],
    *,
    question: str | None = None,
    is_first_message: bool = False,
) -> None:
    now = datetime.now(UTC)
    message = Message(
        id=uuid.uuid4(),
        conversation_id=conversation.id,
        role="assistant",
        content=content,
        status=status,
        created_at=now,
    )
    db.add(message)
    db.flush()

    if status == "complete":
        for citation in citations:
            db.add(
                Citation(
                    id=uuid.uuid4(),
                    message_id=message.id,
                    chunk_id=citation.chunk_id,
                    marker=citation.marker,
                    document_id=citation.document_id,
                    snapshot_text=citation.snapshot_text,
                    location_label=citation.location_label,
                )
            )

    # AC-084/AC-085: generated once, from the first exchange, after the
    # assistant turn it is titling has been built -- never regenerated on a
    # later turn; only PATCH /conversations/{id} changes it after this.
    if is_first_message and conversation.title is None and question is not None:
        conversation.title = await _generate_title(question=question, answer=content)

    conversation.updated_at = now
    db.commit()


async def _stream_turn(
    db: Session,
    conversation: Conversation,
    org_id: uuid.UUID,
    history: list[dict[str, str]],
    question: str,
    is_disconnected: Callable[[], Awaitable[bool]],
    *,
    is_first_message: bool = False,
) -> AsyncIterator[bytes]:
    text_parts: list[str] = []
    citations: list[ResolvedCitation] = []
    status = "complete"

    agen = answer_question(db, org_id, history, question)
    try:
        while True:
            if await is_disconnected():
                # AC-071: stop consuming the generator -- generation is
                # cancelled, not merely ignored -- and persist the partial
                # turn as 'stopped'.
                status = "stopped"
                await agen.aclose()
                break
            try:
                event = await agen.__anext__()
            except StopAsyncIteration:
                break

            if isinstance(event, AnswerToken):
                text_parts.append(event.text)
                yield _sse("token", {"text": event.text})
            elif isinstance(event, AnswerCitations):
                citations = event.citations
                yield _sse("citations", _citation_event_payload(db, citations))
    except Exception as exc:  # noqa: BLE001 -- surfaced as a terminal SSE event, never raised
        status = "error"
        reason = str(exc) or "Generation failed"
        yield _sse("error", {"reason": reason})
    finally:
        await _persist_assistant_turn(
            db,
            conversation,
            "".join(text_parts),
            status,
            citations,
            question=question,
            is_first_message=is_first_message,
        )


@router.get("/conversations", response_model=list[ConversationSummary])
async def list_conversations(
    claims: RequireAuth, db: Annotated[Session, Depends(get_db)]
) -> list[ConversationSummary]:
    org_id = uuid.UUID(claims["org_id"])
    user_id = uuid.UUID(claims["sub"])
    rows = (
        db.query(Conversation)
        .filter(Conversation.org_id == org_id, Conversation.user_id == user_id)
        .order_by(Conversation.updated_at.desc())
        .all()
    )
    return [ConversationSummary(id=c.id, title=c.title, updated_at=c.updated_at) for c in rows]


@router.post("/conversations", response_model=ConversationCreateResponse)
async def create_conversation(
    claims: RequireAuth, db: Annotated[Session, Depends(get_db)]
) -> ConversationCreateResponse:
    org_id = uuid.UUID(claims["org_id"])
    user_id = uuid.UUID(claims["sub"])
    now = datetime.now(UTC)
    conversation = Conversation(
        id=uuid.uuid4(),
        org_id=org_id,
        user_id=user_id,
        title=None,
        created_at=now,
        updated_at=now,
    )
    db.add(conversation)
    db.commit()
    db.refresh(conversation)
    return ConversationCreateResponse(id=conversation.id)


@router.get("/conversations/{id}", response_model=ConversationDetail)
async def get_conversation(
    id: uuid.UUID, claims: RequireAuth, db: Annotated[Session, Depends(get_db)]
) -> ConversationDetail:
    org_id = uuid.UUID(claims["org_id"])
    user_id = uuid.UUID(claims["sub"])
    conversation = _get_owned_conversation(db, id, org_id, user_id)

    messages = (
        db.query(Message)
        .filter(Message.conversation_id == conversation.id)
        .order_by(Message.created_at.asc())
        .all()
    )
    message_outs = [
        MessageOut(
            role=m.role,
            content=m.content,
            citations=[
                CitationOut(
                    marker=c.marker,
                    document_id=c.document_id,
                    snapshot_text=c.snapshot_text,
                    location_label=c.location_label,
                )
                for c in sorted(m.citations, key=lambda c: c.marker)
            ],
        )
        for m in messages
    ]
    return ConversationDetail(id=conversation.id, title=conversation.title, messages=message_outs)


@router.patch("/conversations/{id}", response_model=ConversationRenameResponse)
async def rename_conversation(
    id: uuid.UUID,
    payload: ConversationRenameRequest,
    claims: RequireAuth,
    db: Annotated[Session, Depends(get_db)],
) -> ConversationRenameResponse:
    org_id = uuid.UUID(claims["org_id"])
    user_id = uuid.UUID(claims["sub"])
    conversation = _get_owned_conversation(db, id, org_id, user_id)
    conversation.title = payload.title
    conversation.updated_at = datetime.now(UTC)
    db.commit()
    return ConversationRenameResponse(id=conversation.id, title=conversation.title)


@router.delete("/conversations/{id}", response_model=OkResponse)
async def delete_conversation(
    id: uuid.UUID, claims: RequireAuth, db: Annotated[Session, Depends(get_db)]
) -> OkResponse:
    org_id = uuid.UUID(claims["org_id"])
    user_id = uuid.UUID(claims["sub"])
    conversation = _get_owned_conversation(db, id, org_id, user_id)
    db.delete(conversation)
    db.commit()
    return OkResponse()


@router.post("/conversations/{id}/messages")
async def post_message(
    id: uuid.UUID,
    payload: MessageCreateRequest,
    request: Request,
    claims: RequireAuth,
    db: Annotated[Session, Depends(get_db)],
) -> StreamingResponse:
    org_id = uuid.UUID(claims["org_id"])
    user_id = uuid.UUID(claims["sub"])
    conversation = _get_owned_conversation(db, id, org_id, user_id)

    is_first_message = (
        db.query(Message.id).filter(Message.conversation_id == conversation.id).first() is None
    )

    now = datetime.now(UTC)
    user_message = Message(
        id=uuid.uuid4(),
        conversation_id=conversation.id,
        role="user",
        content=payload.content,
        status="complete",
        created_at=now,
    )
    db.add(user_message)
    conversation.updated_at = now
    db.commit()
    db.refresh(user_message)

    history = _history_before(db, conversation.id, before=user_message.created_at)

    return StreamingResponse(
        _stream_turn(
            db,
            conversation,
            org_id,
            history,
            payload.content,
            request.is_disconnected,
            is_first_message=is_first_message,
        ),
        media_type="text/event-stream",
    )


@router.post("/conversations/{id}/messages/{message_id}/regenerate")
async def regenerate_message(
    id: uuid.UUID,
    message_id: uuid.UUID,
    request: Request,
    claims: RequireAuth,
    db: Annotated[Session, Depends(get_db)],
) -> StreamingResponse:
    org_id = uuid.UUID(claims["org_id"])
    user_id = uuid.UUID(claims["sub"])
    conversation = _get_owned_conversation(db, id, org_id, user_id)

    target = (
        db.query(Message)
        .filter(Message.id == message_id, Message.conversation_id == conversation.id)
        .one_or_none()
    )
    if target is None:
        raise HTTPException(status_code=404, detail="Message not found")

    if target.role == "assistant":
        user_turn = (
            db.query(Message)
            .filter(
                Message.conversation_id == conversation.id,
                Message.role == "user",
                Message.created_at <= target.created_at,
            )
            .order_by(Message.created_at.desc())
            .first()
        )
    else:
        user_turn = target

    if user_turn is None:
        raise HTTPException(status_code=404, detail="No preceding user turn to regenerate")

    history = _history_before(db, conversation.id, before=user_turn.created_at)

    if target.role == "assistant":
        db.delete(target)
        db.commit()

    return StreamingResponse(
        _stream_turn(db, conversation, org_id, history, user_turn.content, request.is_disconnected),
        media_type="text/event-stream",
    )
