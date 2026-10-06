"""JWT issuance/verification and password hashing.

The architecture names JWT auth (python-jose) and argon2 password hashing
(passlib[argon2]) as the api component's auth mechanism; every tenant- and
owner-scoped endpoint in the api_spec depends on these primitives, so they
live here once rather than being re-implemented per router.

`get_current_user` is a seam, not a guard: it decodes a bearer token if one is
present and otherwise returns `None`. Routers that must actually require a
session, an admin role, or org/owner scoping wire that check when their real
handler replaces its stub -- rejecting requests is request-handling logic,
which belongs with the endpoint that owns the rule it enforces.
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import Depends, Header
from jose import JWTError, jwt
from passlib.context import CryptContext

JWT_SECRET = os.getenv("JWT_SECRET", "dev-secret-change-me")
JWT_ALGORITHM = "HS256"
JWT_EXPIRES_MINUTES = int(os.getenv("JWT_EXPIRES_MINUTES", "1440"))

_pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")


def hash_password(password: str) -> str:
    return _pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return _pwd_context.verify(password, password_hash)


def create_access_token(user_id: uuid.UUID, org_id: uuid.UUID, role: str) -> str:
    """Issue a JWT carrying the claims every tenant-scoped route needs:
    the user id (`sub`), their org (`org_id`) and their role."""
    payload = {
        "sub": str(user_id),
        "org_id": str(org_id),
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=JWT_EXPIRES_MINUTES),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except JWTError:
        return None


def get_current_claims(
    authorization: Annotated[str | None, Header()] = None,
) -> dict | None:
    """Decode the `Authorization: Bearer <token>` header, if present.

    Returns `None` on a missing or invalid token rather than raising, so a
    stub route can be called without one; a handler that requires a session
    checks for `None` itself and raises 401.
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    return decode_access_token(authorization.split(" ", 1)[1])


CurrentClaims = Annotated[dict | None, Depends(get_current_claims)]
