"""Embeddings provider adapter.

The architecture names a provider interface for chunk and query embeddings,
default OpenAI text-embedding-3-small, swappable by config; the model name
and dimension it reports are recorded per vector on `chunks` (see
`app/models.py`), so a provider change is traceable per row rather than
silently mixing incompatible vectors.
"""

from __future__ import annotations

import asyncio
import os
from abc import ABC, abstractmethod

from app.models import EMBEDDING_DIM

# How many chunk texts go into a single provider API call. Keeps a large
# document's embedding request within the API's per-request item/size
# limits; results are concatenated back together in request order.
EMBEDDINGS_BATCH_SIZE = 100

# Bounds how many times a single batch is retried after the provider errors
# or rate-limits before `ingest_document` gives up on the whole document
# (AC-046) -- never unbounded, and never left half-embedded.
MAX_EMBED_RETRIES = 3
EMBED_RETRY_BASE_DELAY_SECONDS = float(os.getenv("EMBED_RETRY_BASE_DELAY_SECONDS", "0.5"))


class EmbeddingProviderError(Exception):
    """Raised with a human-readable reason once the configured embeddings
    provider has errored or rate-limited and the bounded retry budget is
    exhausted. `ingest_document` catches this and marks the document
    'failed' with the reason; because every chunk for a document is
    embedded before any `Chunk` row is written, this can never leave a
    partially embedded document 'ready' (AC-046)."""


class EmbeddingsProvider(ABC):
    @property
    @abstractmethod
    def model_name(self) -> str: ...

    @property
    @abstractmethod
    def dimension(self) -> int: ...

    @abstractmethod
    async def embed(self, texts: list[str]) -> list[list[float]]:
        """Embed a batch of chunk or query strings, in order."""


class OpenAIEmbeddingsProvider(EmbeddingsProvider):
    """Default provider. Embeds in fixed-size batches, in request order, and
    retries a batch a bounded number of times (exponential backoff) before
    raising `EmbeddingProviderError` -- the one condition `ingest_document`
    treats as "the document cannot be ready" rather than a worker crash."""

    def __init__(self, model: str | None = None, dim: int | None = None, client=None) -> None:
        self._model = model or os.getenv("EMBEDDINGS_MODEL", "text-embedding-3-small")
        self._dim = dim or int(os.getenv("EMBEDDINGS_DIM", str(EMBEDDING_DIM)))
        self._client = client

    @property
    def model_name(self) -> str:
        return self._model

    @property
    def dimension(self) -> int:
        return self._dim

    def _get_client(self):
        if self._client is None:
            from openai import AsyncOpenAI

            self._client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        return self._client

    async def embed(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        client = self._get_client()
        results: list[list[float]] = []
        for start in range(0, len(texts), EMBEDDINGS_BATCH_SIZE):
            batch = texts[start : start + EMBEDDINGS_BATCH_SIZE]
            results.extend(await self._embed_batch(client, batch))
        return results

    async def _embed_batch(self, client, batch: list[str]) -> list[list[float]]:
        last_exc: Exception | None = None
        for attempt in range(MAX_EMBED_RETRIES):
            try:
                response = await client.embeddings.create(model=self._model, input=batch)
                return [item.embedding for item in response.data]
            except Exception as exc:  # provider error or rate limit; retried below
                last_exc = exc
                if attempt < MAX_EMBED_RETRIES - 1:
                    await asyncio.sleep(EMBED_RETRY_BASE_DELAY_SECONDS * (2**attempt))
        raise EmbeddingProviderError(f"embedding provider error: {last_exc}") from last_exc


def get_embeddings_provider() -> EmbeddingsProvider:
    return OpenAIEmbeddingsProvider()
