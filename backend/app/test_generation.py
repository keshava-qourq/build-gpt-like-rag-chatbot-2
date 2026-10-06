"""Tests for `app.generation.answer_question`: the refusal short-circuit
(AC-057, AC-058, AC-059), the assembled grounded prompt and context block
(AC-061, AC-062, AC-063), and citation resolution (AC-064).

Placed alongside `app/generation.py` for the same reason as
`app/test_retrieval_search.py`: this task's write scope does not include the
top-level `tests/` directory.
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime

import pytest

import app.generation as generation
from app.database import SessionLocal
from app.generation import REFUSAL_ANSWER, AnswerCitations, AnswerToken, answer_question
from app.models import Chunk, Document, Organization, User


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def org(db):
    organization = Organization(id=uuid.uuid4(), name="Gen Org", created_at=datetime.now(UTC))
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


def _make_document(db, org, uploader, *, status="ready", filename="doc.txt"):
    document = Document(
        id=uuid.uuid4(),
        org_id=org.id,
        uploader_id=uploader.id,
        filename=filename,
        format="txt",
        size_bytes=10,
        s3_key=f"{uuid.uuid4()}-key",
        status=status,
        created_at=datetime.now(UTC),
    )
    db.add(document)
    db.commit()
    db.refresh(document)
    return document


def _add_chunk(db, org, document, *, ordinal, text, embedding, page_start=None, page_end=None):
    chunk = Chunk(
        org_id=org.id,
        document_id=document.id,
        ordinal=ordinal,
        text=text,
        embedding=embedding,
        embedding_model="fake-model",
        embedding_dim=len(embedding),
        page_start=page_start,
        page_end=page_end,
    )
    db.add(chunk)
    db.commit()
    db.refresh(chunk)
    return chunk


class _FakeEmbeddingsProvider:
    model_name = "fake-model"

    def __init__(self, query_embedding):
        self._query_embedding = query_embedding

    @property
    def dimension(self):
        return len(self._query_embedding)

    async def embed(self, texts):
        return [self._query_embedding for _ in texts]


QUERY_VECTOR = [1.0, 0.0, 0.0]


class _RaisingLLMProvider:
    """Injected in refusal-path tests: any call is a test failure."""

    def stream_answer(self, *, system, messages, context):
        raise AssertionError("LLM provider must never be called on the refusal path")

    async def generate_title(self, *, first_message):
        raise AssertionError("LLM provider must never be called on the refusal path")


class _FakeStreamingLLMProvider:
    """Captures the system prompt and context it was called with, and yields
    a fixed token stream."""

    def __init__(self, tokens):
        self._tokens = tokens
        self.calls = []

    def stream_answer(self, *, system, messages, context):
        self.calls.append({"system": system, "messages": messages, "context": context})

        async def _gen():
            for token in self._tokens:
                yield token

        return _gen()

    async def generate_title(self, *, first_message):
        return "title"


def _collect(db, org_id, question, *, embeddings_provider=None, conversation_history=None):
    async def _run():
        events = []
        # `answer_question` always goes through `retrieval.search`, which
        # defaults to the real embeddings provider unless one is monkeypatched
        # at module import; patch `app.retrieval.get_embeddings_provider` so
        # no network call is ever attempted.
        async for event in answer_question(
            db, org_id, conversation_history or [], question
        ):
            events.append(event)
        return events

    return asyncio.run(_run())


@pytest.fixture(autouse=True)
def _patch_embeddings(monkeypatch):
    import app.retrieval as retrieval_module

    monkeypatch.setattr(
        retrieval_module,
        "get_embeddings_provider",
        lambda: _FakeEmbeddingsProvider(QUERY_VECTOR),
    )


# ---------------------------------------------------------------------------
# AC-057, AC-058: refusal on empty/irrelevant library; LLM never called.
# ---------------------------------------------------------------------------


def test_empty_library_returns_fixed_refusal_without_calling_provider(db, org, monkeypatch):
    monkeypatch.setattr(generation, "get_llm_provider", lambda: _RaisingLLMProvider())

    events = _collect(db, org.id, "what does the handbook say about leave?")

    assert events == [AnswerToken(REFUSAL_ANSWER), AnswerCitations([])]


def test_no_chunk_above_threshold_returns_fixed_refusal_without_calling_provider(
    db, org, user, monkeypatch
):
    monkeypatch.setattr(generation, "get_llm_provider", lambda: _RaisingLLMProvider())
    document = _make_document(db, org, user)
    # Orthogonal to the query vector: well under RELEVANCE_THRESHOLD.
    _add_chunk(db, org, document, ordinal=0, text="unrelated content", embedding=[0.0, 1.0, 0.0])

    events = _collect(db, org.id, "what does the handbook say about leave?")

    assert events == [AnswerToken(REFUSAL_ANSWER), AnswerCitations([])]


# ---------------------------------------------------------------------------
# AC-059: queued/processing/failed-only library refuses, never falls back to
# general knowledge; `ready_chunks_query` is the only chunk source.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("status", ["queued", "processing", "failed"])
def test_library_with_only_non_ready_documents_refuses(db, org, user, monkeypatch, status):
    monkeypatch.setattr(generation, "get_llm_provider", lambda: _RaisingLLMProvider())
    document = _make_document(db, org, user, status=status)
    _add_chunk(
        db, org, document, ordinal=0,
        text="Paris is the capital of France.",
        embedding=[1.0, 0.0, 0.0],
    )

    events = _collect(db, org.id, "what is the capital of France?")

    assert events == [AnswerToken(REFUSAL_ANSWER), AnswerCitations([])]


# ---------------------------------------------------------------------------
# AC-060: the refusal is a normal two-event stream a caller can persist as an
# assistant turn, and this module does not special-case a second call.
# ---------------------------------------------------------------------------


def test_refusal_can_be_followed_by_a_second_question_in_same_conversation(db, org, monkeypatch):
    monkeypatch.setattr(generation, "get_llm_provider", lambda: _RaisingLLMProvider())

    first = _collect(db, org.id, "first question")
    assert first == [AnswerToken(REFUSAL_ANSWER), AnswerCitations([])]

    second = _collect(
        db,
        org.id,
        "second question",
        conversation_history=[{"role": "assistant", "content": REFUSAL_ANSWER}],
    )
    assert second == [AnswerToken(REFUSAL_ANSWER), AnswerCitations([])]


# ---------------------------------------------------------------------------
# AC-061, AC-062, AC-063, AC-064: grounded answer path.
# ---------------------------------------------------------------------------


def test_grounded_answer_streams_tokens_and_resolves_citations(db, org, user, monkeypatch):
    document = _make_document(db, org, user)
    chunk_1 = _add_chunk(
        db, org, document, ordinal=0, text="The refund window is 30 days.",
        embedding=[1.0, 0.0, 0.0], page_start=2, page_end=2,
    )
    chunk_2 = _add_chunk(
        db, org, document, ordinal=1, text="Refunds require a receipt.",
        embedding=[0.99, 0.01, 0.0], page_start=3, page_end=3,
    )

    fake_provider = _FakeStreamingLLMProvider(["The refund window is 30 days", " [1]."])
    monkeypatch.setattr(generation, "get_llm_provider", lambda: fake_provider)

    events = _collect(db, org.id, "what is the refund policy?")

    *token_events, citations_event = events
    assert all(isinstance(e, AnswerToken) for e in token_events)
    assert "".join(e.text for e in token_events) == "The refund window is 30 days [1]."
    assert isinstance(citations_event, AnswerCitations)

    markers = {c.marker for c in citations_event.citations}
    assert markers == {1, 2}
    by_marker = {c.marker: c for c in citations_event.citations}
    assert by_marker[1].chunk_id == chunk_1.id
    assert by_marker[1].document_id == document.id
    assert by_marker[1].location_label == "p. 2"
    assert by_marker[1].snapshot_text == "The refund window is 30 days."
    assert by_marker[2].chunk_id == chunk_2.id
    assert by_marker[2].location_label == "p. 3"

    # Exactly one provider call, carrying the numbered context block and the
    # context-only / citation / partial-coverage / don't-know instructions.
    assert len(fake_provider.calls) == 1
    call = fake_provider.calls[0]
    assert "[1] The refund window is 30 days." in call["context"]
    assert "[2] Refunds require a receipt." in call["context"]
    assert "only the numbered context" in call["system"]
    assert "citation marker" in call["system"]
    assert "does not cover the question" in call["system"] or "not covered" in call["system"]


def test_context_block_contains_no_general_knowledge_fallback(db, org, user, monkeypatch):
    """The context block is built exclusively from retrieved chunk text --
    a well-known general-knowledge fact never appears in it unless it was
    itself the retrieved chunk text (AC-063)."""
    document = _make_document(db, org, user)
    _add_chunk(
        db, org, document, ordinal=0, text="Our company was founded in 2019.",
        embedding=[1.0, 0.0, 0.0],
    )
    fake_provider = _FakeStreamingLLMProvider(["Founded in 2019 [1]."])
    monkeypatch.setattr(generation, "get_llm_provider", lambda: fake_provider)

    _collect(db, org.id, "when was the company founded?")

    context = fake_provider.calls[0]["context"]
    assert "Paris is the capital of France" not in context
    assert context.strip() == "[1] Our company was founded in 2019."


def test_system_prompt_instructs_partial_coverage_handling():
    assert "partially covers" in generation._SYSTEM_PROMPT
    assert "not covered by the uploaded documents" in generation._SYSTEM_PROMPT
