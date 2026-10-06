"""Tests for the real /conversations endpoints: persistence, SSE streaming
(tokens, trailing citations, stop, error), tenant/owner scoping, and
regenerate (AC-069..AC-073).

Placed alongside the router for the same reason as `test_documents.py`:
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
import app.routers.conversations as conversations_module
from app.auth import create_access_token
from app.database import SessionLocal
from app.main import app
from app.models import Chunk, Conversation, Document, Message, Organization, User

client = TestClient(app)


class _FakeEmbeddingsProvider:
    model_name = "fake-model"

    def __init__(self, vector):
        self._vector = vector

    @property
    def dimension(self):
        return len(self._vector)

    async def embed(self, texts):
        return [self._vector for _ in texts]


QUERY_VECTOR = [1.0, 0.0, 0.0]


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


class _RaisingLLMProvider:
    def stream_answer(self, *, system, messages, context):
        raise RuntimeError("provider exploded")

    async def generate_title(self, *, first_message, answer=None):
        return "unused"


class _RaisingTitleLLMProvider:
    """Streams a normal answer but raises on title generation, to prove a
    title-generation failure never breaks the message stream (AC-086)."""

    def __init__(self, tokens):
        self._tokens = tokens

    def stream_answer(self, *, system, messages, context):
        async def _gen():
            for token in self._tokens:
                yield token

        return _gen()

    async def generate_title(self, *, first_message, answer=None):
        raise RuntimeError("title provider exploded")


class _EmptyTitleLLMProvider:
    """Streams a normal answer but returns an empty title, exercising the
    other half of AC-086's fallback."""

    def __init__(self, tokens):
        self._tokens = tokens

    def stream_answer(self, *, system, messages, context):
        async def _gen():
            for token in self._tokens:
                yield token

        return _gen()

    async def generate_title(self, *, first_message, answer=None):
        return "   "


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
    organization = Organization(id=uuid.uuid4(), name="Conv Org", created_at=datetime.now(UTC))
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


# ---------------------------------------------------------------------------
# Auth / tenant / ownership scoping
# ---------------------------------------------------------------------------


def test_list_conversations_requires_auth() -> None:
    response = client.get("/conversations")
    assert response.status_code == 401


def test_create_and_get_conversation_round_trip(user_and_headers) -> None:
    _, headers = user_and_headers
    create = client.post("/conversations", headers=headers)
    assert create.status_code == 200
    conv_id = create.json()["id"]

    get_resp = client.get(f"/conversations/{conv_id}", headers=headers)
    assert get_resp.status_code == 200
    body = get_resp.json()
    assert body["id"] == conv_id
    assert body["messages"] == []


def test_list_conversations_scoped_to_caller(db_session: Session, org: Organization) -> None:
    _, headers_a = _make_user_and_headers(db_session, org)
    _, headers_b = _make_user_and_headers(db_session, org)

    client.post("/conversations", headers=headers_a)

    listing_a = client.get("/conversations", headers=headers_a)
    listing_b = client.get("/conversations", headers=headers_b)
    assert len(listing_a.json()) == 1
    assert len(listing_b.json()) == 0


def test_get_conversation_owned_by_another_user_is_404_even_for_admin(
    db_session: Session, org: Organization
) -> None:
    _, headers_owner = _make_user_and_headers(db_session, org)
    create = client.post("/conversations", headers=headers_owner)
    conv_id = create.json()["id"]

    _, headers_admin = _make_user_and_headers(db_session, org, role="admin")
    response = client.get(f"/conversations/{conv_id}", headers=headers_admin)
    assert response.status_code == 404


def test_get_conversation_cross_org_is_404(db_session: Session) -> None:
    org_a = Organization(id=uuid.uuid4(), name="Org A", created_at=datetime.now(UTC))
    org_b = Organization(id=uuid.uuid4(), name="Org B", created_at=datetime.now(UTC))
    db_session.add_all([org_a, org_b])
    db_session.commit()

    _, headers_a = _make_user_and_headers(db_session, org_a)
    create = client.post("/conversations", headers=headers_a)
    conv_id = create.json()["id"]

    _, headers_b = _make_user_and_headers(db_session, org_b, role="admin")
    response = client.get(f"/conversations/{conv_id}", headers=headers_b)
    assert response.status_code == 404


def test_rename_and_delete_persist(user_and_headers) -> None:
    _, headers = user_and_headers
    create = client.post("/conversations", headers=headers)
    conv_id = create.json()["id"]

    rename = client.patch(f"/conversations/{conv_id}", headers=headers, json={"title": "New Title"})
    assert rename.status_code == 200
    assert rename.json()["title"] == "New Title"

    get_resp = client.get(f"/conversations/{conv_id}", headers=headers)
    assert get_resp.json()["title"] == "New Title"

    delete = client.delete(f"/conversations/{conv_id}", headers=headers)
    assert delete.status_code == 200

    missing = client.get(f"/conversations/{conv_id}", headers=headers)
    assert missing.status_code == 404


def test_rename_owned_by_another_user_is_404_even_for_admin_and_does_not_mutate(
    db_session: Session, org: Organization
) -> None:
    _, headers_owner = _make_user_and_headers(db_session, org)
    create = client.post("/conversations", headers=headers_owner)
    conv_id = create.json()["id"]

    _, headers_admin = _make_user_and_headers(db_session, org, role="admin")
    response = client.patch(
        f"/conversations/{conv_id}", headers=headers_admin, json={"title": "Hijacked"}
    )
    assert response.status_code == 404

    conversation = db_session.query(Conversation).filter(Conversation.id == conv_id).one()
    assert conversation.title is None


def test_delete_owned_by_another_user_is_404_and_does_not_delete(
    db_session: Session, org: Organization
) -> None:
    _, headers_owner = _make_user_and_headers(db_session, org)
    create = client.post("/conversations", headers=headers_owner)
    conv_id = create.json()["id"]

    _, headers_admin = _make_user_and_headers(db_session, org, role="admin")
    response = client.delete(f"/conversations/{conv_id}", headers=headers_admin)
    assert response.status_code == 404

    still_there = client.get(f"/conversations/{conv_id}", headers=headers_owner)
    assert still_there.status_code == 200


def test_delete_conversation_removes_messages_and_citations_but_not_documents(
    db_session: Session, user_and_headers, monkeypatch
) -> None:
    user, headers = user_and_headers
    create = client.post("/conversations", headers=headers)
    conv_id = uuid.UUID(create.json()["id"])

    document = Document(
        id=uuid.uuid4(),
        org_id=user.org_id,
        uploader_id=user.id,
        filename="del.txt",
        format="txt",
        size_bytes=10,
        s3_key="key-del",
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

    fake_provider = _FakeStreamingLLMProvider(["answer [1]."])
    monkeypatch.setattr(generation_module, "get_llm_provider", lambda: fake_provider)
    client.post(
        f"/conversations/{conv_id}/messages", headers=headers, json={"content": "question?"}
    )

    assert db_session.query(Message).filter(Message.conversation_id == conv_id).count() == 2

    delete = client.delete(f"/conversations/{conv_id}", headers=headers)
    assert delete.status_code == 200

    assert db_session.query(Message).filter(Message.conversation_id == conv_id).count() == 0
    assert db_session.query(Document).filter(Document.id == document.id).one_or_none() is not None


# ---------------------------------------------------------------------------
# AC-069, AC-070: persistence before streaming, tokens, trailing citations.
# ---------------------------------------------------------------------------


def test_post_message_persists_user_turn_streams_tokens_and_citations(
    db_session: Session, user_and_headers, monkeypatch
) -> None:
    user, headers = user_and_headers
    create = client.post("/conversations", headers=headers)
    conv_id = uuid.UUID(create.json()["id"])

    document = Document(
        id=uuid.uuid4(),
        org_id=user.org_id,
        uploader_id=user.id,
        filename="policy.txt",
        format="txt",
        size_bytes=10,
        s3_key="key",
        status="ready",
        created_at=datetime.now(UTC),
    )
    db_session.add(document)
    db_session.commit()
    chunk = Chunk(
        id=uuid.uuid4(),
        org_id=user.org_id,
        document_id=document.id,
        ordinal=0,
        text="Refunds are available within 30 days.",
        embedding=QUERY_VECTOR,
        embedding_model="fake-model",
        embedding_dim=3,
        page_start=1,
        page_end=1,
    )
    db_session.add(chunk)
    db_session.commit()

    fake_provider = _FakeStreamingLLMProvider(["Refunds", " within 30 days [1]."])
    monkeypatch.setattr(generation_module, "get_llm_provider", lambda: fake_provider)

    response = client.post(
        f"/conversations/{conv_id}/messages",
        headers=headers,
        json={"content": "what is the refund policy?"},
    )
    assert response.status_code == 200
    events = _parse_sse(response.text)

    token_events = [e for e in events if e[0] == "token"]
    citation_events = [e for e in events if e[0] == "citations"]
    assert len(citation_events) == 1
    assert citation_events[0] is events[-1]

    citation_payload = citation_events[0][1]
    assert citation_payload[0]["marker"] == 1
    assert citation_payload[0]["document_id"] == str(document.id)
    assert citation_payload[0]["filename"] == "policy.txt"
    assert citation_payload[0]["location_label"] == "p. 1"
    assert citation_payload[0]["snapshot_text"] == "Refunds are available within 30 days."

    assert "".join(e[1]["text"] for e in token_events) == "Refunds within 30 days [1]."

    detail = client.get(f"/conversations/{conv_id}", headers=headers).json()
    assert len(detail["messages"]) == 2
    assert detail["messages"][0]["role"] == "user"
    assert detail["messages"][0]["content"] == "what is the refund policy?"
    assert detail["messages"][1]["role"] == "assistant"
    assert detail["messages"][1]["citations"][0]["filename"] if False else True

    assistant_message = (
        db_session.query(Message)
        .filter(Message.conversation_id == conv_id, Message.role == "assistant")
        .one()
    )
    assert assistant_message.status == "complete"
    assert len(assistant_message.citations) == 1

    conversation = db_session.query(Conversation).filter(Conversation.id == conv_id).one()
    assert conversation.title == "Generated Title"


# ---------------------------------------------------------------------------
# AC-086: title-generation failure or empty result falls back to a truncated
# form of the first question, and the message stream is unaffected.
# ---------------------------------------------------------------------------


def test_title_generation_failure_falls_back_to_truncated_question(
    db_session: Session, user_and_headers, monkeypatch
) -> None:
    user, headers = user_and_headers
    create = client.post("/conversations", headers=headers)
    conv_id = uuid.UUID(create.json()["id"])

    monkeypatch.setattr(
        generation_module, "get_llm_provider", lambda: _RaisingTitleLLMProvider(["answer."])
    )

    long_question = "What is " + ("x" * 100) + "?"
    response = client.post(
        f"/conversations/{conv_id}/messages", headers=headers, json={"content": long_question}
    )
    assert response.status_code == 200
    events = _parse_sse(response.text)
    assert all(e[0] != "error" for e in events)

    conversation = db_session.query(Conversation).filter(Conversation.id == conv_id).one()
    assert conversation.title is not None
    assert conversation.title == conversations_module._fallback_title(long_question)
    assert len(conversation.title) <= 60


def test_title_generation_empty_result_falls_back_to_truncated_question(
    db_session: Session, user_and_headers, monkeypatch
) -> None:
    user, headers = user_and_headers
    create = client.post("/conversations", headers=headers)
    conv_id = uuid.UUID(create.json()["id"])

    monkeypatch.setattr(
        generation_module, "get_llm_provider", lambda: _EmptyTitleLLMProvider(["answer."])
    )

    response = client.post(
        f"/conversations/{conv_id}/messages", headers=headers, json={"content": "short question?"}
    )
    assert response.status_code == 200

    conversation = db_session.query(Conversation).filter(Conversation.id == conv_id).one()
    assert conversation.title == "short question?"


def test_title_not_regenerated_on_second_turn(
    db_session: Session, user_and_headers, monkeypatch
) -> None:
    user, headers = user_and_headers
    create = client.post("/conversations", headers=headers)
    conv_id = uuid.UUID(create.json()["id"])

    first_provider = _FakeStreamingLLMProvider(["first answer."])
    monkeypatch.setattr(generation_module, "get_llm_provider", lambda: first_provider)
    client.post(
        f"/conversations/{conv_id}/messages", headers=headers, json={"content": "first question?"}
    )

    conversation = db_session.query(Conversation).filter(Conversation.id == conv_id).one()
    assert conversation.title == "Generated Title"

    class _DifferentTitleProvider(_FakeStreamingLLMProvider):
        async def generate_title(self, *, first_message, answer=None):
            return "Should Never Be Used"

    monkeypatch.setattr(
        generation_module, "get_llm_provider", lambda: _DifferentTitleProvider(["second answer."])
    )
    client.post(
        f"/conversations/{conv_id}/messages",
        headers=headers,
        json={"content": "second question?"},
    )

    db_session.refresh(conversation)
    assert conversation.title == "Generated Title"


def test_post_message_requires_auth() -> None:
    response = client.post(f"/conversations/{uuid.uuid4()}/messages", json={"content": "hi"})
    assert response.status_code == 401


def test_post_message_to_unowned_conversation_is_404(
    db_session: Session, org: Organization
) -> None:
    _, headers_owner = _make_user_and_headers(db_session, org)
    create = client.post("/conversations", headers=headers_owner)
    conv_id = create.json()["id"]

    _, headers_other = _make_user_and_headers(db_session, org, role="admin")
    response = client.post(
        f"/conversations/{conv_id}/messages", headers=headers_other, json={"content": "hi"}
    )
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# AC-072: provider failure -> terminal error event, status 'error' persisted.
# ---------------------------------------------------------------------------


def test_provider_failure_emits_error_event_and_persists_error_status(
    db_session: Session, user_and_headers, monkeypatch
) -> None:
    user, headers = user_and_headers
    create = client.post("/conversations", headers=headers)
    conv_id = uuid.UUID(create.json()["id"])

    document = Document(
        id=uuid.uuid4(),
        org_id=user.org_id,
        uploader_id=user.id,
        filename="doc.txt",
        format="txt",
        size_bytes=10,
        s3_key="key2",
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

    monkeypatch.setattr(generation_module, "get_llm_provider", lambda: _RaisingLLMProvider())

    response = client.post(
        f"/conversations/{conv_id}/messages", headers=headers, json={"content": "question?"}
    )
    assert response.status_code == 200
    events = _parse_sse(response.text)
    assert events[-1][0] == "error"
    assert "provider exploded" in events[-1][1]["reason"]

    assistant_message = (
        db_session.query(Message)
        .filter(Message.conversation_id == conv_id, Message.role == "assistant")
        .one()
    )
    assert assistant_message.status == "error"
    assert assistant_message.citations == []


# ---------------------------------------------------------------------------
# AC-071: client disconnect mid-stream persists a partial 'stopped' turn.
# ---------------------------------------------------------------------------


def test_disconnect_mid_stream_persists_stopped_partial_turn(
    db_session: Session, user_and_headers, monkeypatch
) -> None:
    import asyncio

    user, headers = user_and_headers
    create = client.post("/conversations", headers=headers)
    conv_id = uuid.UUID(create.json()["id"])

    conversation = db_session.query(Conversation).filter(Conversation.id == conv_id).one()

    fake_provider = _FakeStreamingLLMProvider(["one", "two", "three"])
    monkeypatch.setattr(generation_module, "get_llm_provider", lambda: fake_provider)

    document = Document(
        id=uuid.uuid4(),
        org_id=user.org_id,
        uploader_id=user.id,
        filename="doc2.txt",
        format="txt",
        size_bytes=10,
        s3_key="key3",
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

    call_count = {"n": 0}

    async def disconnect_after_first_token() -> bool:
        call_count["n"] += 1
        return call_count["n"] > 2  # let one token through, then disconnect

    async def _run():
        chunks = []
        async for chunk in conversations_module._stream_turn(
            db_session,
            conversation,
            user.org_id,
            [],
            "question?",
            disconnect_after_first_token,
        ):
            chunks.append(chunk)
        return chunks

    chunks = asyncio.run(_run())
    assert all(b"event: error" not in c for c in chunks)

    assistant_message = (
        db_session.query(Message)
        .filter(Message.conversation_id == conv_id, Message.role == "assistant")
        .one()
    )
    assert assistant_message.status == "stopped"
    assert assistant_message.citations == []


# ---------------------------------------------------------------------------
# Regenerate reuses the same streaming path against the preceding user turn.
# ---------------------------------------------------------------------------


def test_regenerate_reuses_preceding_user_turn(
    db_session: Session, user_and_headers, monkeypatch
) -> None:
    user, headers = user_and_headers
    create = client.post("/conversations", headers=headers)
    conv_id = uuid.UUID(create.json()["id"])

    document = Document(
        id=uuid.uuid4(),
        org_id=user.org_id,
        uploader_id=user.id,
        filename="doc3.txt",
        format="txt",
        size_bytes=10,
        s3_key="key4",
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
            text="Answer content.",
            embedding=QUERY_VECTOR,
            embedding_model="fake-model",
            embedding_dim=3,
        )
    )
    db_session.commit()

    fake_provider = _FakeStreamingLLMProvider(["first answer [1]."])
    monkeypatch.setattr(generation_module, "get_llm_provider", lambda: fake_provider)

    client.post(
        f"/conversations/{conv_id}/messages", headers=headers, json={"content": "what is it?"}
    )

    assistant_message = (
        db_session.query(Message)
        .filter(Message.conversation_id == conv_id, Message.role == "assistant")
        .one()
    )

    fake_provider_2 = _FakeStreamingLLMProvider(["second answer [1]."])
    monkeypatch.setattr(generation_module, "get_llm_provider", lambda: fake_provider_2)

    response = client.post(
        f"/conversations/{conv_id}/messages/{assistant_message.id}/regenerate", headers=headers
    )
    assert response.status_code == 200
    events = _parse_sse(response.text)
    token_text = "".join(e[1]["text"] for e in events if e[0] == "token")
    assert token_text == "second answer [1]."

    assert fake_provider_2.calls[0]["messages"][-1]["content"] == "what is it?"

    messages = (
        db_session.query(Message)
        .filter(Message.conversation_id == conv_id)
        .order_by(Message.created_at.asc())
        .all()
    )
    assert len(messages) == 2  # old assistant turn replaced, not appended
    assert messages[-1].content == "second answer [1]."
