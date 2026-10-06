"""DELETE /users/{id}."""

from __future__ import annotations

import uuid

from fastapi import APIRouter

from app.schemas import OkResponse

router = APIRouter(tags=["users"])


@router.delete("/users/{id}", response_model=OkResponse)
async def delete_user(id: uuid.UUID) -> OkResponse:
    """Stub: admin-only; removes access, not the user's documents, per the
    api_spec. The role check and the actual deactivation are for the handler
    that replaces this stub."""
    return OkResponse()
