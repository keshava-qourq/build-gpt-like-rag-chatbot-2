"""Tests for BUIL654BFB-30-1: stable message ids on GET /conversations/{id},
the SSE `message` event carrying the persisted assistant message id, and
regenerate's replace-not-append semantics (AC-096, AC-097).

Placed alongside the router for the same reason as `test_conversations.py`:
this task's write scope does not include the top-level `tests/` directory.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

import app.generation as generation_module
import app.retrieval as retrieval_module
from app.auth import create_access_token
from app.database import SessionLocal
from app.main import app
from app.models import Chunk, Document, Message, Organization, User

client = TestClient(app)

QUERY_VECTOR = [1.0, 0.0, 0.0]


class _FakeEmbeddingsProvider:
    model_name = "fake-model"

    def __init__(self, vector):
        self._vector = vector

    @property
    def dimension(self):
        return len(self._vector)

    async def embed(self, texts):
        return [self._vector for _ in texts]


class _FakeStreamingLLMProvider:
    def __init__(self, tokens):
        self._tokens = tokens
        self.calls = []

    def stream_answer(self, *, system, messages, context):
        self.calls.append({"system": system, "messages": messages, "context": context})

        async def _gen():
            for token in self._tokens:
                yield token

        return _gen()

    async def generate_title(self, *, first_message, answer=None):
        return "Generated Title"


class _NoAnswerCallLLMProvider:
    """Fails the test if `stream_answer` is ever invoked -- used to prove
    AC-097's "no LLM answer call is made" on the refusal path."""

    def stream_answer(self, *, system, messages, context):
        raise AssertionError("stream_answer must not be called when retrieval finds nothing")

    async def generate_title(self, *, first_message, answer=None):
        return "unused"


@pytest.fixture(autouse=True)
def _patch_embeddings(monkeypatch):
    monkeypatch.setattr(
        retrieval_module, "get_embeddings_provider", lambda: _FakeEmbeddingsProvider(QUERY_VECTOR)
    )


@pytest.fixture()
def db_session() -> Session:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def org(db_session: Session) -> Organization:
    organization = Organization(id=uuid.uuid4(), name="Msg Id Org", created_at=datetime.now(UTC))
    db_session.add(organization)
    db_session.commit()
    return organization


def _make_user_and_headers(db_session: Session, org: Organization, role: str = "member"):
    user = User(
        id=uuid.uuid4(),
        org_id=org.id,
        email=f"{uuid.uuid4()}@example.com",
        password_hash="unused",
        role=role,
        is_active=True,
        created_at=datetime.now(UTC),
    )
    db_session.add(user)
    db_session.commit()
    token = create_access_token(user_id=user.id, org_id=org.id, role=user.role)
    return user, {"Authorization": f"Bearer {token}"}


@pytest.fixture()
def user_and_headers(db_session: Session, org: Organization):
    return _make_user_and_headers(db_session, org)


def _parse_sse(body: str) -> list[tuple[str, object]]:
    events = []
    for block in body.strip().split("\n\n"):
        if not block.strip():
            continue
        lines = block.splitlines()
        event_type = None
        data = None
        for line in lines:
            if line.startswith("event:"):
                event_type = line[len("event:") :].strip()
            elif line.startswith("data:"):
                data = json.loads(line[len("data:") :].strip())
        events.append((event_type, data))
    return events


def _add_ready_chunk(db_session: Session, user) -> Document:
    document = Document(
        id=uuid.uuid4(),
        org_id=user.org_id,
        uploader_id=user.id,
        filename="doc.txt",
        format="txt",
        size_bytes=10,
        s3_key=f"key-{uuid.uuid4()}",
        status="ready",
        created_at=datetime.now(UTC),
    )
    db_session.add(document)
    db_session.commit()
    db_session.add(
        Chunk(
            id=uuid.uuid4(),
            org_id=user.org_id,
            document_id=document.id,
            ordinal=0,
            text="Some ready content.",
            embedding=QUERY_VECTOR,
            embedding_model="fake-model",
            embedding_dim=3,
        )
    )
    db_session.commit()
    return document


# ---------------------------------------------------------------------------
# GET /conversations/{id} returns a stable `id` per message.
# ---------------------------------------------------------------------------


def test_get_conversation_messages_each_have_id_ordered_oldest_first(
    db_session: Session, user_and_headers, monkeypatch
) -> None:
    user, headers = user_and_headers
    create = client.post("/conversations", headers=headers)
    conv_id = uuid.UUID(create.json()["id"])
    _add_ready_chunk(db_session, user)

    monkeypatch.setattr(
        generation_module, "get_llm_provider", lambda: _FakeStreamingLLMProvider(["answer [1]."])
    )
    client.post(
        f"/conversations/{conv_id}/messages", headers=headers, json={"content": "question?"}
    )

    detail = client.get(f"/conversations/{conv_id}", headers=headers).json()
    assert len(detail["messages"]) == 2
    for message in detail["messages"]:
        assert uuid.UUID(message["id"])
        assert "role" in message
        assert "content" in message
        assert "citations" in message

    rows = (
        db_session.query(Message)
        .filter(Message.conversation_id == conv_id)
        .order_by(Message.created_at.asc())
        .all()
    )
    assert [m["id"] for m in detail["messages"]] == [str(r.id) for r in rows]


# ---------------------------------------------------------------------------
# SSE stream emits a `message` event carrying the persisted assistant id.
# ---------------------------------------------------------------------------


def test_post_message_sse_emits_persisted_assistant_message_id(
    db_session: Session, user_and_headers, monkeypatch
) -> None:
    user, headers = user_and_headers
    create = client.post("/conversations", headers=headers)
    conv_id = uuid.UUID(create.json()["id"])
    _add_ready_chunk(db_session, user)

    monkeypatch.setattr(
        generation_module, "get_llm_provider", lambda: _FakeStreamingLLMProvider(["answer [1]."])
    )
    response = client.post(
        f"/conversations/{conv_id}/messages", headers=headers, json={"content": "question?"}
    )
    events = _parse_sse(response.text)
    message_events = [e for e in events if e[0] == "message"]
    assert len(message_events) == 1
    message_id = message_events[0][1]["id"]

    assistant_message = (
        db_session.query(Message)
        .filter(Message.conversation_id == conv_id, Message.role == "assistant")
        .one()
    )
    assert message_id == str(assistant_message.id)

    detail = client.get(f"/conversations/{conv_id}", headers=headers).json()
    assert detail["messages"][-1]["id"] == message_id


# ---------------------------------------------------------------------------
# AC-096: regenerate re-runs retrieval+generation, streams tokens then a
# trailing citations event, and replaces the prior assistant turn.
# ---------------------------------------------------------------------------


def test_regenerate_emits_message_event_tokens_then_trailing_citations_and_replaces_turn(
    db_session: Session, user_and_headers, monkeypatch
) -> None:
    user, headers = user_and_headers
    create = client.post("/conversations", headers=headers)
    conv_id = uuid.UUID(create.json()["id"])
    _add_ready_chunk(db_session, user)

    monkeypatch.setattr(
        generation_module, "get_llm_provider", lambda: _FakeStreamingLLMProvider(["first [1]."])
    )
    client.post(
        f"/conversations/{conv_id}/messages", headers=headers, json={"content": "what is it?"}
    )
    original_assistant = (
        db_session.query(Message)
        .filter(Message.conversation_id == conv_id, Message.role == "assistant")
        .one()
    )
    original_id = original_assistant.id

    monkeypatch.setattr(
        generation_module, "get_llm_provider", lambda: _FakeStreamingLLMProvider(["second [1]."])
    )
    response = client.post(
        f"/conversations/{conv_id}/messages/{original_id}/regenerate", headers=headers
    )
    assert response.status_code == 200
    events = _parse_sse(response.text)
    assert events[0][0] == "message"
    assert events[-1][0] == "citations"
    token_text = "".join(e[1]["text"] for e in events if e[0] == "token")
    assert token_text == "second [1]."

    assistant_messages = (
        db_session.query(Message)
        .filter(Message.conversation_id == conv_id, Message.role == "assistant")
        .all()
    )
    assert len(assistant_messages) == 1
    assert assistant_messages[0].content == "second [1]."
    assert assistant_messages[0].id != original_id

    all_messages = (
        db_session.query(Message)
        .filter(Message.conversation_id == conv_id)
        .order_by(Message.created_at.asc())
        .all()
    )
    assert len(all_messages) == 2  # exactly one user turn, one assistant turn


# ---------------------------------------------------------------------------
# AC-097: regenerate with nothing above the relevance threshold returns the
# fixed refusal, empty citations, and never calls the LLM for an answer.
# ---------------------------------------------------------------------------


def test_regenerate_with_no_relevant_chunks_refuses_without_llm_call(
    db_session: Session, user_and_headers, monkeypatch
) -> None:
    user, headers = user_and_headers
    create = client.post("/conversations", headers=headers)
    conv_id = uuid.UUID(create.json()["id"])
    _add_ready_chunk(db_session, user)

    monkeypatch.setattr(
        generation_module, "get_llm_provider", lambda: _FakeStreamingLLMProvider(["first [1]."])
    )
    client.post(
        f"/conversations/{conv_id}/messages", headers=headers, json={"content": "what is it?"}
    )
    original_assistant = (
        db_session.query(Message)
        .filter(Message.conversation_id == conv_id, Message.role == "assistant")
        .one()
    )

    # Nothing clears the relevance threshold this time.
    monkeypatch.setattr(generation_module, "search", lambda db, org_id, query: _empty_search())
    monkeypatch.setattr(generation_module, "get_llm_provider", lambda: _NoAnswerCallLLMProvider())

    response = client.post(
        f"/conversations/{conv_id}/messages/{original_assistant.id}/regenerate", headers=headers
    )
    assert response.status_code == 200
    events = _parse_sse(response.text)
    token_text = "".join(e[1]["text"] for e in events if e[0] == "token")
    assert token_text == generation_module.REFUSAL_ANSWER
    citation_events = [e for e in events if e[0] == "citations"]
    assert len(citation_events) == 1
    assert citation_events[0][1] == []

    assistant_messages = (
        db_session.query(Message)
        .filter(Message.conversation_id == conv_id, Message.role == "assistant")
        .all()
    )
    assert len(assistant_messages) == 1
    assert assistant_messages[0].content == generation_module.REFUSAL_ANSWER
    assert assistant_messages[0].citations == []


async def _empty_search():
    return []


# ---------------------------------------------------------------------------
# Regenerating in another org or another user's conversation is 404, not 403.
# ---------------------------------------------------------------------------


def test_regenerate_cross_org_is_404_not_403(db_session: Session, monkeypatch) -> None:
    org_a = Organization(id=uuid.uuid4(), name="Org A", created_at=datetime.now(UTC))
    org_b = Organization(id=uuid.uuid4(), name="Org B", created_at=datetime.now(UTC))
    db_session.add_all([org_a, org_b])
    db_session.commit()

    user_a, headers_a = _make_user_and_headers(db_session, org_a)
    create = client.post("/conversations", headers=headers_a)
    conv_id = uuid.UUID(create.json()["id"])
    _add_ready_chunk(db_session, user_a)

    monkeypatch.setattr(
        generation_module, "get_llm_provider", lambda: _FakeStreamingLLMProvider(["answer [1]."])
    )
    client.post(
        f"/conversations/{conv_id}/messages", headers=headers_a, json={"content": "question?"}
    )
    assistant_message = (
        db_session.query(Message)
        .filter(Message.conversation_id == conv_id, Message.role == "assistant")
        .one()
    )

    _, headers_b = _make_user_and_headers(db_session, org_b, role="admin")
    response = client.post(
        f"/conversations/{conv_id}/messages/{assistant_message.id}/regenerate",
        headers=headers_b,
    )
    assert response.status_code == 404


def test_regenerate_another_users_conversation_in_same_org_is_404_not_403(
    db_session: Session, org: Organization, monkeypatch
) -> None:
    user_owner, headers_owner = _make_user_and_headers(db_session, org)
    create = client.post("/conversations", headers=headers_owner)
    conv_id = uuid.UUID(create.json()["id"])
    _add_ready_chunk(db_session, user_owner)

    monkeypatch.setattr(
        generation_module, "get_llm_provider", lambda: _FakeStreamingLLMProvider(["answer [1]."])
    )
    client.post(
        f"/conversations/{conv_id}/messages", headers=headers_owner, json={"content": "question?"}
    )
    assistant_message = (
        db_session.query(Message)
        .filter(Message.conversation_id == conv_id, Message.role == "assistant")
        .one()
    )

    _, headers_admin = _make_user_and_headers(db_session, org, role="admin")
    response = client.post(
        f"/conversations/{conv_id}/messages/{assistant_message.id}/regenerate",
        headers=headers_admin,
    )
    assert response.status_code == 404
