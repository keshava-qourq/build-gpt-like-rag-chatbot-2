"""Tests for the embeddings provider registry (AC-065, AC-066) and the
startup embedding model/dimension consistency check (AC-067)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest

from app.database import SessionLocal
from app.models import Chunk, Document, Organization, User
from app.providers import embeddings as embeddings_module
from app.providers.embeddings import (
    EmbeddingsConfigurationError,
    EmbeddingsProvider,
    OpenAIEmbeddingsProvider,
    get_embeddings_provider,
    verify_embeddings_configuration,
)


def test_default_provider_is_openai_text_embedding_3_small():
    provider = get_embeddings_provider()

    assert isinstance(provider, OpenAIEmbeddingsProvider)
    assert provider.model_name == "text-embedding-3-small"


def test_registry_lookup_selects_configured_provider(monkeypatch):
    class _FakeEmbeddingsProvider(EmbeddingsProvider):
        @property
        def model_name(self) -> str:
            return "fake-model"

        @property
        def dimension(self) -> int:
            return 7

        async def embed(self, texts):
            return [[0.0] * 7 for _ in texts]

    monkeypatch.setitem(embeddings_module.PROVIDER_REGISTRY, "fake", _FakeEmbeddingsProvider)
    monkeypatch.setenv("EMBEDDINGS_PROVIDER", "fake")

    provider = get_embeddings_provider()

    assert isinstance(provider, _FakeEmbeddingsProvider)


def test_unknown_provider_raises(monkeypatch):
    monkeypatch.setenv("EMBEDDINGS_PROVIDER", "does-not-exist")

    with pytest.raises(ValueError):
        get_embeddings_provider()


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        # This module shares the on-disk sqlite database with the rest of the
        # suite, and `app.main` re-runs the startup consistency check on every
        # import -- so a chunk left behind with an intentionally mismatched
        # embedding_model/dim would fail collection for every test module
        # imported afterwards. Clean up everything this file writes.
        session.query(Chunk).delete()
        session.query(Document).delete()
        session.query(User).delete()
        session.query(Organization).delete()
        session.commit()
        session.close()


@pytest.fixture
def org_and_user(db):
    org = Organization(id=uuid.uuid4(), name="Config Org", created_at=datetime.now(UTC))
    db.add(org)
    db.commit()
    user = User(
        id=uuid.uuid4(),
        org_id=org.id,
        email=f"{uuid.uuid4()}@example.com",
        password_hash="x",
        role="member",
        is_active=True,
        created_at=datetime.now(UTC),
    )
    db.add(user)
    db.commit()
    return org, user


def _make_chunk_with_embedding(db, org, user, *, model: str, dim: int):
    document = Document(
        id=uuid.uuid4(),
        org_id=org.id,
        uploader_id=user.id,
        filename="doc.txt",
        format="txt",
        size_bytes=10,
        s3_key="key",
        status="ready",
        created_at=datetime.now(UTC),
    )
    db.add(document)
    db.commit()
    db.refresh(document)

    chunk = Chunk(
        org_id=org.id,
        document_id=document.id,
        ordinal=0,
        text="hello",
        embedding_model=model,
        embedding_dim=dim,
    )
    db.add(chunk)
    db.commit()
    return chunk


def test_verify_embeddings_configuration_noop_on_empty_database(db):
    provider = OpenAIEmbeddingsProvider(model="text-embedding-3-small", dim=1536)

    verify_embeddings_configuration(db, provider)  # must not raise


def test_verify_embeddings_configuration_passes_when_matching(db, org_and_user):
    org, user = org_and_user
    _make_chunk_with_embedding(db, org, user, model="text-embedding-3-small", dim=1536)
    provider = OpenAIEmbeddingsProvider(model="text-embedding-3-small", dim=1536)

    verify_embeddings_configuration(db, provider)  # must not raise


def test_verify_embeddings_configuration_raises_on_mismatch(db, org_and_user):
    org, user = org_and_user
    _make_chunk_with_embedding(db, org, user, model="text-embedding-3-small", dim=1536)
    provider = OpenAIEmbeddingsProvider(model="text-embedding-3-large", dim=3072)

    with pytest.raises(EmbeddingsConfigurationError) as exc_info:
        verify_embeddings_configuration(db, provider)

    message = str(exc_info.value)
    assert "text-embedding-3-small" in message
    assert "text-embedding-3-large" in message
    assert "re-index" in message.lower()
