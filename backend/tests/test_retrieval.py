"""Tests for retrieval eligibility: only 'ready' documents' chunks are ever
returned (AC-023)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest

from app.database import SessionLocal
from app.models import Chunk, Document, Organization, User
from app.retrieval import ready_chunks_query


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def org(db):
    organization = Organization(id=uuid.uuid4(), name="Retrieval Org", created_at=datetime.now(UTC))
    db.add(organization)
    db.commit()
    return organization


@pytest.fixture
def user(db, org):
    u = User(
        id=uuid.uuid4(),
        org_id=org.id,
        email=f"{uuid.uuid4()}@example.com",
        password_hash="x",
        role="member",
        is_active=True,
        created_at=datetime.now(UTC),
    )
    db.add(u)
    db.commit()
    return u


def _make_document_with_chunk(db, org, user, status: str):
    document = Document(
        id=uuid.uuid4(),
        org_id=org.id,
        uploader_id=user.id,
        filename=f"{status}.txt",
        format="txt",
        size_bytes=10,
        s3_key=f"{status}-key",
        status=status,
        created_at=datetime.now(UTC),
    )
    db.add(document)
    db.commit()
    db.refresh(document)

    chunk = Chunk(
        org_id=org.id,
        document_id=document.id,
        ordinal=0,
        text=f"chunk for {status} document",
    )
    db.add(chunk)
    db.commit()
    return document, chunk


def test_only_ready_documents_chunks_are_retrieved(db, org, user):
    _, queued_chunk = _make_document_with_chunk(db, org, user, "queued")
    _, processing_chunk = _make_document_with_chunk(db, org, user, "processing")
    ready_doc, ready_chunk = _make_document_with_chunk(db, org, user, "ready")
    _, failed_chunk = _make_document_with_chunk(db, org, user, "failed")

    results = ready_chunks_query(db, org.id).all()
    result_ids = {c.id for c in results}

    assert ready_chunk.id in result_ids
    assert queued_chunk.id not in result_ids
    assert processing_chunk.id not in result_ids
    assert failed_chunk.id not in result_ids
    assert len(results) == 1


def test_ready_chunks_query_is_org_scoped(db, org, user):
    other_org = Organization(id=uuid.uuid4(), name="Other Org", created_at=datetime.now(UTC))
    db.add(other_org)
    db.commit()

    _, own_chunk = _make_document_with_chunk(db, org, user, "ready")

    other_user = User(
        id=uuid.uuid4(),
        org_id=other_org.id,
        email=f"{uuid.uuid4()}@example.com",
        password_hash="x",
        role="member",
        is_active=True,
        created_at=datetime.now(UTC),
    )
    db.add(other_user)
    db.commit()
    _, other_chunk = _make_document_with_chunk(db, other_org, other_user, "ready")

    results = ready_chunks_query(db, org.id).all()
    result_ids = {c.id for c in results}

    assert own_chunk.id in result_ids
    assert other_chunk.id not in result_ids
