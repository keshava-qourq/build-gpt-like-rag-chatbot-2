"""Unit tests for `OpenAIEmbeddingsProvider`: batching, order, retries and
giving up (AC-043, AC-046)."""

from __future__ import annotations

import asyncio

import pytest

from app.providers import embeddings as embeddings_module
from app.providers.embeddings import EmbeddingProviderError, OpenAIEmbeddingsProvider


class _FakeResponseItem:
    def __init__(self, embedding: list[float]) -> None:
        self.embedding = embedding


class _FakeResponse:
    def __init__(self, embeddings: list[list[float]]) -> None:
        self.data = [_FakeResponseItem(e) for e in embeddings]


class _FakeEmbeddingsEndpoint:
    def __init__(self, handler) -> None:
        self._handler = handler
        self.calls: list[list[str]] = []

    async def create(self, model, input):  # noqa: A002 -- mirrors the OpenAI SDK signature
        self.calls.append(list(input))
        return self._handler(model, input)


class _FakeClient:
    def __init__(self, handler) -> None:
        self.embeddings = _FakeEmbeddingsEndpoint(handler)


@pytest.fixture(autouse=True)
def _no_real_sleep(monkeypatch):
    async def _instant_sleep(_seconds: float) -> None:
        return None

    monkeypatch.setattr(embeddings_module.asyncio, "sleep", _instant_sleep)


def test_embed_returns_vectors_in_order():
    def handler(model, input):
        return _FakeResponse([[float(i), 0.0] for i, _ in enumerate(input)])

    client = _FakeClient(handler)
    provider = OpenAIEmbeddingsProvider(model="text-embedding-3-small", dim=2, client=client)

    result = asyncio.run(provider.embed(["a", "b", "c"]))

    assert result == [[0.0, 0.0], [1.0, 0.0], [2.0, 0.0]]
    assert provider.model_name == "text-embedding-3-small"
    assert provider.dimension == 2


def test_embed_batches_large_inputs():
    captured_batches: list[int] = []

    def handler(model, input):
        captured_batches.append(len(input))
        return _FakeResponse([[1.0] for _ in input])

    client = _FakeClient(handler)
    provider = OpenAIEmbeddingsProvider(model="m", dim=1, client=client)
    texts = [f"text-{i}" for i in range(250)]

    result = asyncio.run(provider.embed(texts))

    assert len(result) == 250
    assert captured_batches == [100, 100, 50]


def test_embed_empty_input_makes_no_call():
    client = _FakeClient(lambda model, input: _FakeResponse([]))
    provider = OpenAIEmbeddingsProvider(model="m", dim=1, client=client)

    result = asyncio.run(provider.embed([]))

    assert result == []
    assert client.embeddings.calls == []


def test_embed_retries_then_succeeds():
    attempts = {"count": 0}

    def handler(model, input):
        attempts["count"] += 1
        if attempts["count"] < 2:
            raise RuntimeError("rate limited")
        return _FakeResponse([[9.0] for _ in input])

    client = _FakeClient(handler)
    provider = OpenAIEmbeddingsProvider(model="m", dim=1, client=client)

    result = asyncio.run(provider.embed(["only"]))

    assert result == [[9.0]]
    assert attempts["count"] == 2


def test_embed_exhausted_retries_raises_embedding_provider_error():
    def handler(model, input):
        raise RuntimeError("persistent rate limit")

    client = _FakeClient(handler)
    provider = OpenAIEmbeddingsProvider(model="m", dim=1, client=client)

    with pytest.raises(EmbeddingProviderError, match="embedding provider error"):
        asyncio.run(provider.embed(["only"]))

    assert len(client.embeddings.calls) == embeddings_module.MAX_EMBED_RETRIES
