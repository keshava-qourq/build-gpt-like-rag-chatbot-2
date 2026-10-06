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
        async for event in answer_question(db, org_id, conversation_history or [], question):
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
        db,
        org,
        document,
        ordinal=0,
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
        db,
        org,
        document,
        ordinal=0,
        text="The refund window is 30 days.",
        embedding=[1.0, 0.0, 0.0],
        page_start=2,
        page_end=2,
    )
    chunk_2 = _add_chunk(
        db,
        org,
        document,
        ordinal=1,
        text="Refunds require a receipt.",
        embedding=[0.99, 0.01, 0.0],
        page_start=3,
        page_end=3,
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
        db,
        org,
        document,
        ordinal=0,
        text="Our company was founded in 2019.",
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


# ---------------------------------------------------------------------------
# AC-074..AC-077, rewrite failure fallback: follow-up query rewriting.
# ---------------------------------------------------------------------------


class _KeyedFakeEmbeddingsProvider:
    """Maps known text to a fixed vector so a test can tell the rewritten
    query's embedding apart from the original pronoun question's."""

    model_name = "fake-model"

    def __init__(self, mapping, default):
        self._mapping = mapping
        self._default = default

    @property
    def dimension(self):
        return len(self._default)

    async def embed(self, texts):
        return [self._mapping.get(text, self._default) for text in texts]


class _FakeRewritingLLMProvider:
    """Records every `rewrite_query` and `stream_answer` call; used to
    assert both what was rewritten and that the answer-generation call
    never happens on a refusal path."""

    def __init__(self, rewritten=None, rewrite_error=None, tokens=None, forbid_stream=False):
        self._rewritten = rewritten
        self._rewrite_error = rewrite_error
        self._tokens = tokens or ["ok"]
        self._forbid_stream = forbid_stream
        self.rewrite_calls: list[dict] = []
        self.stream_calls: list[dict] = []

    async def rewrite_query(self, *, history, question):
        self.rewrite_calls.append({"history": history, "question": question})
        if self._rewrite_error is not None:
            raise self._rewrite_error
        return self._rewritten if self._rewritten is not None else question

    def stream_answer(self, *, system, messages, context):
        if self._forbid_stream:
            raise AssertionError("stream_answer must never be called on the refusal path")
        self.stream_calls.append({"system": system, "messages": messages, "context": context})

        async def _gen():
            for token in self._tokens:
                yield token

        return _gen()

    async def generate_title(self, *, first_message):
        return "title"


ORIGINAL_QUESTION_VECTOR = [0.0, 0.0, 1.0]
REWRITTEN_QUERY_VECTOR = [1.0, 0.0, 0.0]


def test_followup_question_is_rewritten_and_retrieval_matches_the_referenced_policy(
    db, org, user, monkeypatch
):
    document = _make_document(db, org, user)
    _add_chunk(
        db,
        org,
        document,
        ordinal=0,
        text="The NDA expires after 2 years.",
        embedding=REWRITTEN_QUERY_VECTOR,
    )

    history = [
        {"role": "user", "content": "Tell me about the NDA"},
        {"role": "assistant", "content": "The NDA is a non-disclosure agreement."},
    ]
    question = "when does it expire?"
    rewritten_query = "When does the NDA expire?"

    import app.retrieval as retrieval_module

    monkeypatch.setattr(
        retrieval_module,
        "get_embeddings_provider",
        lambda: _KeyedFakeEmbeddingsProvider(
            {rewritten_query: REWRITTEN_QUERY_VECTOR, question: ORIGINAL_QUESTION_VECTOR},
            default=ORIGINAL_QUESTION_VECTOR,
        ),
    )
    fake_provider = _FakeRewritingLLMProvider(rewritten=rewritten_query)
    monkeypatch.setattr(generation, "get_llm_provider", lambda: fake_provider)

    events = _collect(db, org.id, question, conversation_history=history)

    assert fake_provider.rewrite_calls == [{"history": history, "question": question}]
    citations_event = events[-1]
    assert isinstance(citations_event, AnswerCitations)
    assert len(citations_event.citations) == 1
    assert citations_event.citations[0].document_id == document.id


def test_only_configured_recent_turns_are_passed_to_rewriting(db, org, monkeypatch):
    long_history = [
        {"role": "user" if i % 2 == 0 else "assistant", "content": f"turn {i}"} for i in range(50)
    ]
    fake_provider = _FakeRewritingLLMProvider()
    monkeypatch.setattr(generation, "get_llm_provider", lambda: fake_provider)

    _collect(db, org.id, "a follow-up question", conversation_history=long_history)

    assert len(fake_provider.rewrite_calls) == 1
    seen_history = fake_provider.rewrite_calls[0]["history"]
    assert len(seen_history) == generation.FOLLOWUP_CONTEXT_TURNS
    assert seen_history == long_history[-generation.FOLLOWUP_CONTEXT_TURNS :]


def test_first_message_with_no_history_is_never_rewritten(db, org, user, monkeypatch):
    document = _make_document(db, org, user)
    _add_chunk(
        db, org, document, ordinal=0, text="Paris is the capital of France.", embedding=QUERY_VECTOR
    )

    class _ForbidRewriteProvider(_FakeRewritingLLMProvider):
        async def rewrite_query(self, *, history, question):
            raise AssertionError("rewrite must never be called with no prior history")

    fake_provider = _ForbidRewriteProvider()
    monkeypatch.setattr(generation, "get_llm_provider", lambda: fake_provider)

    events = _collect(db, org.id, "what is the capital of France?", conversation_history=[])

    citations_event = events[-1]
    assert isinstance(citations_event, AnswerCitations)
    assert len(citations_event.citations) == 1


def test_refusal_on_rewritten_query_never_calls_provider_for_the_answer(db, org, monkeypatch):
    history = [{"role": "user", "content": "earlier turn"}]
    fake_provider = _FakeRewritingLLMProvider(
        rewritten="a standalone query matching nothing", forbid_stream=True
    )
    monkeypatch.setattr(generation, "get_llm_provider", lambda: fake_provider)

    events = _collect(db, org.id, "what about it?", conversation_history=history)

    assert events == [AnswerToken(REFUSAL_ANSWER), AnswerCitations([])]
    assert fake_provider.stream_calls == []


def test_rewrite_provider_failure_falls_back_to_original_question(db, org, user, monkeypatch):
    document = _make_document(db, org, user)
    _add_chunk(
        db, org, document, ordinal=0, text="Paris is the capital of France.", embedding=QUERY_VECTOR
    )
    history = [{"role": "user", "content": "earlier turn"}]
    fake_provider = _FakeRewritingLLMProvider(rewrite_error=RuntimeError("provider down"))
    monkeypatch.setattr(generation, "get_llm_provider", lambda: fake_provider)

    events = _collect(db, org.id, "what is the capital of France?", conversation_history=history)

    citations_event = events[-1]
    assert isinstance(citations_event, AnswerCitations)
    assert len(citations_event.citations) == 1
    assert fake_provider.stream_calls, "the turn must still complete via stream_answer"
