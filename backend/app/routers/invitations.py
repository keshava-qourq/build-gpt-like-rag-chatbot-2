"""POST /invitations, POST /invitations/accept."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter

from app.schemas import (
    InvitationAcceptRequest,
    InvitationAcceptResponse,
    InvitationCreateRequest,
    InvitationOut,
    UserOut,
)

router = APIRouter(tags=["invitations"])

INVITATION_TTL_DAYS = 7


@router.post("/invitations", response_model=InvitationOut)
async def create_invitation(payload: InvitationCreateRequest) -> InvitationOut:
    """Stub: admin-only in the api_spec; the role check belongs with the
    handler that replaces this once auth is wired."""
    return InvitationOut(
        id=uuid.uuid4(),
        email=payload.email,
        role=payload.role,
        expires_at=datetime.now(timezone.utc) + timedelta(days=INVITATION_TTL_DAYS),
    )


@router.post("/invitations/accept", response_model=InvitationAcceptResponse)
async def accept_invitation(payload: InvitationAcceptRequest) -> InvitationAcceptResponse:
    return InvitationAcceptResponse(
        access_token="stub-token", user=UserOut(id=uuid.uuid4(), role="member")
    )
