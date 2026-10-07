"""Unit tests for app.seed_admin: creates the admin user once, then no-ops."""

from __future__ import annotations

from app.database import SessionLocal
from app.models import User
from app.seed_admin import seed_admin


def _cleanup(email: str) -> None:
    with SessionLocal() as session:
        session.query(User).filter(User.email == email).delete()
        session.commit()


def test_seed_admin_creates_user_from_env(monkeypatch):
    email = "seed-admin-test@example.com"
    monkeypatch.setenv("ADMIN_EMAIL", email)
    monkeypatch.setenv("ADMIN_PASSWORD", "correct-horse-battery-staple")
    _cleanup(email)
    try:
        seed_admin()

        with SessionLocal() as session:
            user = session.query(User).filter(User.email == email).first()
            assert user is not None
            assert user.role == "admin"
            assert user.is_active is True
    finally:
        _cleanup(email)


def test_seed_admin_is_idempotent(monkeypatch):
    email = "seed-admin-idempotent@example.com"
    monkeypatch.setenv("ADMIN_EMAIL", email)
    monkeypatch.setenv("ADMIN_PASSWORD", "correct-horse-battery-staple")
    _cleanup(email)
    try:
        seed_admin()
        seed_admin()  # second run (simulating a restart) must not duplicate or error

        with SessionLocal() as session:
            matches = session.query(User).filter(User.email == email).all()
            assert len(matches) == 1
    finally:
        _cleanup(email)


def test_seed_admin_skips_without_env(monkeypatch):
    monkeypatch.delenv("ADMIN_EMAIL", raising=False)
    monkeypatch.delenv("ADMIN_PASSWORD", raising=False)
    # Must not raise when the vars are unset (e.g. a developer who hasn't
    # configured an admin account yet).
    seed_admin()
