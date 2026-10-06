"""POST /auth/login, POST /auth/logout."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import create_access_token, hash_password, verify_password
from app.database import get_db
from app.models import User
from app.schemas import LoginRequest, LoginResponse, OkResponse, UserOut

router = APIRouter(tags=["auth"])

# One message for both "no such email" and "wrong password" so the response
# never discloses whether an account exists.
_GENERIC_AUTH_ERROR = "Incorrect email or password"

# A password hash that no real account could have, verified against on every
# login attempt for an unknown email. Without this, an unknown email skips
# the argon2 verify call entirely and a known email does not, and that
# difference in work is itself a timing side-channel that discloses account
# existence -- this makes the work identical either way.
_DUMMY_HASH = hash_password("not-a-real-password-used-only-for-timing-parity")


@router.post("/auth/login", response_model=LoginResponse)
async def login(payload: LoginRequest, db: Annotated[Session, Depends(get_db)]) -> LoginResponse:
    user = db.query(User).filter(User.email == payload.email).one_or_none()

    password_hash = user.password_hash if user is not None else _DUMMY_HASH
    password_ok = verify_password(payload.password, password_hash)

    if user is None or not password_ok or not user.is_active:
        raise HTTPException(status_code=401, detail=_GENERIC_AUTH_ERROR)

    token = create_access_token(user_id=user.id, org_id=user.org_id, role=user.role)
    return LoginResponse(access_token=token, user=UserOut(id=user.id, role=user.role))


@router.post("/auth/logout", response_model=OkResponse)
async def logout() -> OkResponse:
    """Tokens are stateless and carry no server-side session: there is
    nothing to invalidate here, and the contract is that the client simply
    discards the token it holds. Safe to call with or without one."""
    return OkResponse()
