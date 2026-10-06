"""POST /auth/login, POST /auth/logout."""

from __future__ import annotations

import uuid

from fastapi import APIRouter

from app.schemas import LoginRequest, LoginResponse, OkResponse, UserOut

router = APIRouter(tags=["auth"])


@router.post("/auth/login", response_model=LoginResponse)
async def login(payload: LoginRequest) -> LoginResponse:
    """Stub: a generic failure-or-success shape, no credential check yet."""
    return LoginResponse(access_token="stub-token", user=UserOut(id=uuid.uuid4(), role="member"))


@router.post("/auth/logout", response_model=OkResponse)
async def logout() -> OkResponse:
    """Stub: logout is client-side token discard; nothing server-side to do
    yet beyond acknowledging it."""
    return OkResponse()
