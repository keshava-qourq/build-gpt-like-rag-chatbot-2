"""POST /invitations, POST /invitations/accept."""

from __future__ import annotations

import hashlib
import os
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import RequireAuth, create_access_token, hash_password
from app.database import get_db
from app.models import Invitation, User
from app.schemas import (
    InvitationAcceptRequest,
    InvitationAcceptResponse,
    InvitationCreateRequest,
    InvitationOut,
    UserOut,
)

router = APIRouter(tags=["invitations"])

INVITATION_TTL_DAYS = 7

# Minimum password length accepted at invitation acceptance. Configurable via
# MIN_PASSWORD_LENGTH; defaults to 8 characters when unset.
MIN_PASSWORD_LENGTH = int(os.getenv("MIN_PASSWORD_LENGTH", "8"))

# Exactly two roles exist across the whole system; no handler accepts a
# third value for `role`.
VALID_ROLES = {"member", "admin"}

# Base URL the acceptance link points at. In development this is the Vite
# dev server; a real deployment overrides it with FRONTEND_URL.
_FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173").rstrip("/")


def _hash_token(token: str) -> str:
    """Tokens are high-entropy, single-use and never reused across accounts,
    so a fast deterministic hash (unlike password hashing) is sufficient and
    lets lookup-by-hash happen as a plain indexed query."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


@router.post("/invitations", response_model=InvitationOut)
async def create_invitation(
    payload: InvitationCreateRequest,
    claims: RequireAuth,
    db: Annotated[Session, Depends(get_db)],
) -> InvitationOut:
    if claims["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin role required")

    if payload.role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail="role must be 'member' or 'admin'")

    org_id = uuid.UUID(claims["org_id"])
    invited_by = uuid.UUID(claims["sub"])

    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(UTC) + timedelta(days=INVITATION_TTL_DAYS)

    invitation = Invitation(
        org_id=org_id,
        email=payload.email,
        role=payload.role,
        token_hash=_hash_token(token),
        invited_by=invited_by,
        expires_at=expires_at,
    )
    db.add(invitation)
    db.commit()
    db.refresh(invitation)

    accept_url = f"{_FRONTEND_URL}/accept-invitation?token={token}"

    return InvitationOut(
        id=invitation.id,
        email=invitation.email,
        role=invitation.role,
        expires_at=invitation.expires_at,
        accept_url=accept_url,
        token=token,
    )


@router.post("/invitations/accept", response_model=InvitationAcceptResponse)
async def accept_invitation(
    payload: InvitationAcceptRequest,
    db: Annotated[Session, Depends(get_db)],
) -> InvitationAcceptResponse:
    if len(payload.password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"Password must be at least {MIN_PASSWORD_LENGTH} characters",
        )

    token_hash = _hash_token(payload.token)
    invitation = db.query(Invitation).filter(Invitation.token_hash == token_hash).one_or_none()

    if invitation is None:
        raise HTTPException(status_code=400, detail="Invalid invitation token")
    if invitation.accepted_at is not None:
        raise HTTPException(status_code=400, detail="Invitation already accepted")
    if invitation.expires_at < datetime.now(UTC):
        raise HTTPException(status_code=410, detail="Invitation expired")

    existing = db.query(User).filter(User.email == invitation.email).one_or_none()
    if existing is not None:
        raise HTTPException(status_code=400, detail="An account for this email already exists")

    user = User(
        org_id=invitation.org_id,
        email=invitation.email,
        password_hash=hash_password(payload.password),
        role=invitation.role,
        is_active=True,
        created_at=datetime.now(UTC),
    )
    db.add(user)
    invitation.accepted_at = datetime.now(UTC)
    db.commit()
    db.refresh(user)

    token = create_access_token(user_id=user.id, org_id=user.org_id, role=user.role)
    return InvitationAcceptResponse(access_token=token, user=UserOut(id=user.id, role=user.role))
