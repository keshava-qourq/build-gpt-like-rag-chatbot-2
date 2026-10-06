"""DELETE /users/{id}."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import RequireAuth
from app.database import get_db
from app.models import User
from app.schemas import OkResponse

router = APIRouter(tags=["users"])


@router.delete("/users/{id}", response_model=OkResponse)
async def delete_user(
    id: uuid.UUID,
    claims: RequireAuth,
    db: Annotated[Session, Depends(get_db)],
) -> OkResponse:
    """Admin-only. Deactivates the user (`is_active = False`) rather than
    deleting the row, so their existing documents keep a valid uploader_id
    and their token stops authenticating immediately."""
    if claims["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin role required")

    org_id = uuid.UUID(claims["org_id"])
    user = db.query(User).filter(User.id == id, User.org_id == org_id).one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    user.is_active = False
    db.commit()
    return OkResponse()
