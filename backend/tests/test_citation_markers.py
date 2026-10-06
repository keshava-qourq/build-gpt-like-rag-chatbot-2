"""US-028: numbered citation markers inline in the answer.

Exercises the integration between `app.generation` (marker assignment,
refusal) and the `/conversations/{id}/messages` SSE contract the frontend
renders against -- not the private resolution function in isolation, which
is already covered by `app/test_generation.py`. These tests drive the same
endpoint a browser would call and assert on the citations event a client
actually receives.

AC-103: consecutive numbering within one answer.
AC-104: two claims drawing on the same chunk resolve to the same marker and
the same source, never a duplicate citation row.
AC-105: the fixed refusal carries no citation markers at all.
AC-106: a marker the model emits that does not correspond to any retrieved
chunk is simply absent from the resolved citations list -- never fabricated
-- while the rest of the answer text, including that literal marker
substring, is still delivered.
"""

from __future__ import annotations

import json
import re
import uuid
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

import app.generation as generation_module
import app.retrieval as retrieval_module
from app.auth import create_access_token
from app.database import SessionLocal
from app.generation import REFUSAL_ANSWER
from app.main import app
from app.models import Chunk, Citation, Conversation, Document, Message, Organization, User

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
    """Yields a fixed token stream; records the call so a test can confirm
    the context it was grounded in if it needs to."""

    def __init__(self, tokens):
        self._tokens = tokens

    def stream_answer(self, *, system, messages, context):
        async def _gen():
            for token in self._tokens:
                yield token

        return _gen()

    async def generate_title(self, *, first_message, answer=None):
        return "Generated Title"


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
    organization = Organization(id=uuid.uuid4(), name="Citation Org", created_at=datetime.now(UTC))
    db_session.add(organization)
    db_session.commit()
    yield organization

    # This module shares the on-disk sqlite database with the rest of the
    # suite (see `test_embeddings_config.py`'s `db` fixture for the same
    # concern): a chunk left behind here with its test-only
    # embedding_model/dim would fail the startup embeddings-consistency
    # check for every test module collected afterwards. Clean up everything
    # this org's tests wrote.
    org_id = organization.id
    conversation_ids = [
        row.id
        for row in db_session.query(Conversation.id).filter(Conversation.org_id == org_id).all()
    ]
    if conversation_ids:
        message_ids = [
            row.id
            for row in db_session.query(Message.id)
            .filter(Message.conversation_id.in_(conversation_ids))
            .all()
        ]
        if message_ids:
            db_session.query(Citation).filter(Citation.message_id.in_(message_ids)).delete(
                synchronize_session=False
            )
            db_session.query(Message).filter(Message.id.in_(message_ids)).delete(
                synchronize_session=False
            )
        db_session.query(Conversation).filter(Conversation.id.in_(conversation_ids)).delete(
            synchronize_session=False
        )
    db_session.query(Chunk).filter(Chunk.org_id == org_id).delete(synchronize_session=False)
    db_session.query(Document).filter(Document.org_id == org_id).delete(synchronize_session=False)
    db_session.query(User).filter(User.org_id == org_id).delete(synchronize_session=False)
    db_session.query(Organization).filter(Organization.id == org_id).delete(
        synchronize_session=False
    )
    db_session.commit()


@pytest.fixture()
def user_and_headers(db_session: Session, org: Organization):
    user = User(
        id=uuid.uuid4(),
        org_id=org.id,
        email=f"{uuid.uuid4()}@example.com",
        password_hash="unused",
        role="member",
        is_active=True,
        created_at=datetime.now(UTC),
    )
    db_session.add(user)
    db_session.commit()
    token = create_access_token(user_id=user.id, org_id=org.id, role=user.role)
    return user, {"Authorization": f"Bearer {token}"}


def _ready_document(db_session: Session, user: User, *, filename: str) -> Document:
    document = Document(
        id=uuid.uuid4(),
        org_id=user.org_id,
        uploader_id=user.id,
        filename=filename,
        format="txt",
        size_bytes=10,
        s3_key=f"key-{uuid.uuid4()}",
        status="ready",
        created_at=datetime.now(UTC),
    )
    db_session.add(document)
    db_session.commit()
    return document


def _add_chunk(db_session: Session, user: User, document: Document, *, ordinal: int, text: str):
    chunk = Chunk(
        id=uuid.uuid4(),
        org_id=user.org_id,
        document_id=document.id,
        ordinal=ordinal,
        text=text,
        embedding=QUERY_VECTOR,
        embedding_model="fake-model",
        embedding_dim=3,
    )
    db_session.add(chunk)
    db_session.commit()
    return chunk


def _parse_sse(body: str) -> list[tuple[str, object]]:
    events = []
    for block in body.strip().split("\n\n"):
        if not block.strip():
            continue
        event_type = None
        data = None
        for line in block.splitlines():
            if line.startswith("event:"):
                event_type = line[len("event:") :].strip()
            elif line.startswith("data:"):
                data = json.loads(line[len("data:") :].strip())
        events.append((event_type, data))
    return events


def _ask(headers: dict, conv_id: str, question: str):
    response = client.post(
        f"/conversations/{conv_id}/messages", headers=headers, json={"content": question}
    )
    assert response.status_code == 200
    return _parse_sse(response.text)


# ---------------------------------------------------------------------------
# AC-103: consecutive numbering within one answer.
# ---------------------------------------------------------------------------


def test_citations_are_numbered_consecutively_from_one(
    db_session: Session, user_and_headers, monkeypatch
) -> None:
    user, headers = user_and_headers
    conv_id = client.post("/conversations", headers=headers).json()["id"]

    document = _ready_document(db_session, user, filename="policy.txt")
    _add_chunk(db_session, user, document, ordinal=0, text="Refunds are available in 30 days.")
    _add_chunk(db_session, user, document, ordinal=1, text="A receipt is required for a refund.")

    fake_provider = _FakeStreamingLLMProvider(
        ["Refunds are available in 30 days [1], and a receipt is required [2]."]
    )
    monkeypatch.setattr(generation_module, "get_llm_provider", lambda: fake_provider)

    events = _ask(headers, conv_id, "what is the refund policy?")

    citations_event = events[-1]
    assert citations_event[0] == "citations"
    markers = sorted(c["marker"] for c in citations_event[1])
    # Consecutive, starting at 1, with no gaps -- not merely "two numbers".
    assert markers == list(range(1, len(markers) + 1))
    assert markers == [1, 2]


# ---------------------------------------------------------------------------
# AC-104: two claims drawing on the same chunk use the same marker and
# resolve to the same source -- never a duplicate citation row.
# ---------------------------------------------------------------------------


def test_two_claims_on_the_same_chunk_share_one_marker_and_one_source(
    db_session: Session, user_and_headers, monkeypatch
) -> None:
    user, headers = user_and_headers
    conv_id = client.post("/conversations", headers=headers).json()["id"]

    document = _ready_document(db_session, user, filename="handbook.txt")
    _add_chunk(db_session, user, document, ordinal=0, text="Leave accrues monthly.")

    # The model draws two separate claims from the single retrieved chunk
    # and cites it twice in the generated text.
    fake_provider = _FakeStreamingLLMProvider(
        ["Leave accrues monthly [1]. Unused leave also carries over under the same policy [1]."]
    )
    monkeypatch.setattr(generation_module, "get_llm_provider", lambda: fake_provider)

    events = _ask(headers, conv_id, "how does leave accrual work?")

    token_text = "".join(e[1]["text"] for e in events if e[0] == "token")
    assert token_text.count("[1]") == 2

    citations_event = events[-1]
    assert citations_event[0] == "citations"
    # Exactly one citation row for marker 1 -- the two mentions resolve to
    # the same source, not two separate (and possibly divergent) rows.
    assert len(citations_event[1]) == 1
    assert citations_event[1][0]["marker"] == 1
    assert citations_event[1][0]["document_id"] == str(document.id)


# ---------------------------------------------------------------------------
# AC-105: the fixed refusal carries no citation markers.
# ---------------------------------------------------------------------------


def test_refusal_reply_carries_no_citation_markers(
    user_and_headers, monkeypatch
) -> None:
    _, headers = user_and_headers
    conv_id = client.post("/conversations", headers=headers).json()["id"]

    # Nothing uploaded at all: retrieval finds no chunks, so the refusal
    # path is taken and the provider's `stream_answer` -- the call that
    # would actually generate an answer -- is never invoked. (The provider
    # object itself is still constructed and used for conversation-title
    # generation on the first turn, which is unrelated to AC-105.)
    class _ForbidAnswerLLMProvider:
        def stream_answer(self, *, system, messages, context):
            raise AssertionError("stream_answer must not be called on the refusal path")

        async def generate_title(self, *, first_message, answer=None):
            return "Sabbatical policy"

    monkeypatch.setattr(generation_module, "get_llm_provider", lambda: _ForbidAnswerLLMProvider())

    events = _ask(headers, conv_id, "what does the handbook say about sabbaticals?")

    token_text = "".join(e[1]["text"] for e in events if e[0] == "token")
    assert token_text == REFUSAL_ANSWER
    assert not re.search(r"\[\d+\]", token_text)

    citations_event = events[-1]
    assert citations_event[0] == "citations"
    assert citations_event[1] == []


# ---------------------------------------------------------------------------
# AC-106: a marker the model emits that matches no retrieved chunk is never
# fabricated into the citations list, and the answer -- including that
# literal unresolvable marker text -- is still delivered in full.
# ---------------------------------------------------------------------------


def test_unresolvable_marker_is_never_added_to_citations_and_answer_still_displays(
    db_session: Session, user_and_headers, monkeypatch
) -> None:
    user, headers = user_and_headers
    conv_id = client.post("/conversations", headers=headers).json()["id"]

    # Only one chunk is ever retrieved, so only marker 1 can ever resolve.
    document = _ready_document(db_session, user, filename="contract.txt")
    _add_chunk(db_session, user, document, ordinal=0, text="The term is twelve months.")

    # The model hallucinates a second marker, [2], that was never part of the
    # retrieved context handed to it.
    fake_provider = _FakeStreamingLLMProvider(
        ["The term is twelve months [1]. Renewal is automatic [2]."]
    )
    monkeypatch.setattr(generation_module, "get_llm_provider", lambda: fake_provider)

    events = _ask(headers, conv_id, "what is the contract term?")

    token_text = "".join(e[1]["text"] for e in events if e[0] == "token")
    # The full answer, including the unresolvable "[2]" substring, still
    # reaches the client -- a bad marker never truncates or hides the answer.
    assert token_text == "The term is twelve months [1]. Renewal is automatic [2]."

    citations_event = events[-1]
    assert citations_event[0] == "citations"
    markers = [c["marker"] for c in citations_event[1]]
    # Marker 2 was never resolved from a retrieved chunk, so it is simply
    # absent -- never fabricated as a citation entry just because the model
    # printed it.
    assert markers == [1]
    assert 2 not in markers
