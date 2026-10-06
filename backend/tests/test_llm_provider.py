"""Tests for the generation provider adapter: default selection, registry
lookup by env, and the OpenAI adapter's streaming/title generation against an
injected fake client (AC-065, AC-066, and the stream_answer/generate_title
implementation requirement)."""

from __future__ import annotations

import asyncio

from app.providers import llm as llm_module
from app.providers.llm import LLMProvider, OpenAILLMProvider, get_llm_provider


def test_default_provider_is_openai_gpt4o_class():
    provider = get_llm_provider()

    assert isinstance(provider, OpenAILLMProvider)
    assert provider.model == "gpt-4o"


def test_registry_lookup_selects_configured_provider(monkeypatch):
    class _FakeLLMProvider(LLMProvider):
        async def stream_answer(self, *, system, messages, context):
            yield "fake"

        async def generate_title(self, *, first_message):
            return "fake title"

        async def rewrite_query(self, *, history, question):
            return question

    monkeypatch.setitem(llm_module.PROVIDER_REGISTRY, "fake", _FakeLLMProvider)
    monkeypatch.setenv("LLM_PROVIDER", "fake")

    provider = get_llm_provider()

    assert isinstance(provider, _FakeLLMProvider)


def test_unknown_provider_raises(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "does-not-exist")

    try:
        get_llm_provider()
        raised = False
    except ValueError:
        raised = True

    assert raised


class _FakeDelta:
    def __init__(self, content):
        self.content = content


class _FakeChoice:
    def __init__(self, content):
        self.delta = _FakeDelta(content)


class _FakeChunk:
    def __init__(self, content):
        self.choices = [_FakeChoice(content)]


class _FakeStream:
    def __init__(self, tokens):
        self._tokens = tokens

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for token in self._tokens:
            yield _FakeChunk(token)


class _FakeCompletions:
    def __init__(self, stream_tokens=None, title_text="Generated Title"):
        self._stream_tokens = stream_tokens or []
        self._title_text = title_text
        self.calls: list[dict] = []

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        if kwargs.get("stream"):
            return _FakeStream(self._stream_tokens)

        class _Message:
            def __init__(self, content):
                self.content = content

        class _Choice:
            def __init__(self, content):
                self.message = _Message(content)

        class _Response:
            def __init__(self, content):
                self.choices = [_Choice(content)]

        return _Response(self._title_text)


class _FakeChat:
    def __init__(self, completions):
        self.completions = completions


class _FakeOpenAIClient:
    def __init__(self, stream_tokens=None, title_text="Generated Title"):
        self.chat = _FakeChat(_FakeCompletions(stream_tokens, title_text))


def test_stream_answer_yields_tokens_from_injected_client():
    client = _FakeOpenAIClient(stream_tokens=["Hel", "lo"])
    provider = OpenAILLMProvider(model="gpt-4o", client=client)

    async def _collect():
        return [tok async for tok in provider.stream_answer(system="s", messages=[], context="c")]

    tokens = asyncio.run(_collect())

    assert tokens == ["Hel", "lo"]
    call = client.chat.completions.calls[0]
    assert call["model"] == "gpt-4o"
    assert call["stream"] is True
    assert call["messages"][0]["role"] == "system"
    assert "c" in call["messages"][0]["content"]


def test_generate_title_returns_stripped_text_from_injected_client():
    client = _FakeOpenAIClient(title_text="  A Short Title  ")
    provider = OpenAILLMProvider(model="gpt-4o", client=client)

    title = asyncio.run(provider.generate_title(first_message="What is the refund policy?"))

    assert title == "A Short Title"
    call = client.chat.completions.calls[0]
    assert call["model"] == "gpt-4o"
    assert "stream" not in call


def test_rewrite_query_returns_stripped_standalone_query_from_injected_client():
    client = _FakeOpenAIClient(title_text="  When does the NDA expire?  ")
    provider = OpenAILLMProvider(model="gpt-4o", client=client)
    history = [
        {"role": "user", "content": "Tell me about the NDA"},
        {"role": "assistant", "content": "The NDA is a non-disclosure agreement."},
    ]

    rewritten = asyncio.run(
        provider.rewrite_query(history=history, question="when does it expire?")
    )

    assert rewritten == "When does the NDA expire?"
    call = client.chat.completions.calls[0]
    assert call["model"] == "gpt-4o"
    assert "stream" not in call
    assert call["messages"][0]["role"] == "system"
    assert call["messages"][1:3] == history
    assert call["messages"][-1] == {"role": "user", "content": "when does it expire?"}
