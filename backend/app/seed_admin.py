"""Initial admin account, created once on first startup from env vars.

Run as a one-shot step before `uvicorn` starts serving (see the `backend`
service's `command` in `backend/docker-compose.yml`): `python -m
app.seed_admin && uvicorn app.main:app ...`. Importing `app.main` below runs
its existing startup side effects -- `Base.metadata.create_all` (schema,
including the pgvector column and its ivfflat index on Postgres) and
single-org provisioning -- both already idempotent, so this module only adds
one more idempotent step: create the admin user named by `ADMIN_EMAIL` /
`ADMIN_PASSWORD` if no user with that email exists yet. A restart where the
account already exists is a no-op (AC-115); this module never changes
`app/main.py` itself, which stays the read-only seam everything else here
reuses.
"""

from __future__ import annotations

import os
from datetime import UTC, datetime

from app.auth import hash_password
from app.database import SessionLocal
from app.models import Organization, User


def seed_admin() -> None:
    import app.main  # noqa: F401 -- side effect: schema creation + org provisioning

    admin_email = os.getenv("ADMIN_EMAIL")
    admin_password = os.getenv("ADMIN_PASSWORD")

    if not admin_email or not admin_password:
        print("ADMIN_EMAIL/ADMIN_PASSWORD not set; skipping initial admin seed.")
        return

    with SessionLocal() as session:
        existing = session.query(User).filter(User.email == admin_email).first()
        if existing is not None:
            print(f"Admin user {admin_email!r} already exists; skipping.")
            return

        org = session.query(Organization).first()
        if org is None:
            print("No organization provisioned yet; cannot seed admin user.")
            return

        session.add(
            User(
                org_id=org.id,
                email=admin_email,
                password_hash=hash_password(admin_password),
                role="admin",
                is_active=True,
                created_at=datetime.now(UTC),
            )
        )
        session.commit()
        print(f"Created initial admin user {admin_email!r}.")


if __name__ == "__main__":
    seed_admin()


__all__ = ["seed_admin"]
