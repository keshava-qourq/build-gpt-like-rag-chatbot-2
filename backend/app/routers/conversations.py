"""GET/POST /conversations, GET/PATCH/DELETE /conversations/{id},
POST /conversations/{id}/messages, POST
/conversations/{id}/messages/{message_id}/regenerate."""

from __future__ import annotations

import uuid
from collections.abc import Iterator

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.schemas import (
    ConversationCreateResponse,
    ConversationDetail,
    ConversationRenameRequest,
    ConversationRenameResponse,
    ConversationSummary,
    MessageCreateRequest,
    OkResponse,
)

router = APIRouter(tags=["conversations"])


@router.get("/conversations", response_model=list[ConversationSummary])
async def list_conversations() -> list[ConversationSummary]:
    """Stub: scoped to the signed-in user once auth is wired; empty for now."""
    return []


@router.post("/conversations", response_model=ConversationCreateResponse)
async def create_conversation() -> ConversationCreateResponse:
    return ConversationCreateResponse(id=uuid.uuid4())


@router.get("/conversations/{id}", response_model=ConversationDetail)
async def get_conversation(id: uuid.UUID) -> ConversationDetail:
    """Stub: ownership check (refused if not owner, admins included) is for
    the handler that replaces this stub."""
    return ConversationDetail(id=id, title=None, messages=[])


@router.patch("/conversations/{id}", response_model=ConversationRenameResponse)
async def rename_conversation(
    id: uuid.UUID, payload: ConversationRenameRequest
) -> ConversationRenameResponse:
    return ConversationRenameResponse(id=id, title=payload.title)


@router.delete("/conversations/{id}", response_model=OkResponse)
async def delete_conversation(id: uuid.UUID) -> OkResponse:
    return OkResponse()


def _placeholder_sse_events() -> Iterator[bytes]:
    """A trivially valid SSE stream: no tokens, an empty citations list.

    Real streaming -- query rewriting, retrieval, grounded generation, the
    fixed refusal when nothing clears the threshold -- is for the handler
    that replaces this stub.
    """
    yield b"event: citations\ndata: []\n\n"


@router.post("/conversations/{id}/messages")
async def post_message(id: uuid.UUID, payload: MessageCreateRequest) -> StreamingResponse:
    return StreamingResponse(_placeholder_sse_events(), media_type="text/event-stream")


@router.post("/conversations/{id}/messages/{message_id}/regenerate")
async def regenerate_message(id: uuid.UUID, message_id: uuid.UUID) -> StreamingResponse:
    return StreamingResponse(_placeholder_sse_events(), media_type="text/event-stream")
