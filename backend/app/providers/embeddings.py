"""Embeddings provider adapter.

The architecture names a provider interface for chunk and query embeddings,
default OpenAI text-embedding-3-small, swappable by config; the model name
and dimension it reports are recorded per vector on `chunks` (see
`app/models.py`), so a provider change is traceable per row rather than
silently mixing incompatible vectors.
"""

from __future__ import annotations

import os
from abc import ABC, abstractmethod

from app.models import EMBEDDING_DIM


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
    """Default provider. The actual API call is for the ingestion worker and
    the query-retrieval handler to implement."""

    def __init__(self, model: str | None = None, dim: int | None = None) -> None:
        self._model = model or os.getenv("EMBEDDINGS_MODEL", "text-embedding-3-small")
        self._dim = dim or int(os.getenv("EMBEDDINGS_DIM", str(EMBEDDING_DIM)))

    @property
    def model_name(self) -> str:
        return self._model

    @property
    def dimension(self) -> int:
        return self._dim

    async def embed(self, texts: list[str]) -> list[list[float]]:
        raise NotImplementedError(
            "Wire this to the OpenAI client when implementing ingestion or retrieval."
        )


def get_embeddings_provider() -> EmbeddingsProvider:
    return OpenAIEmbeddingsProvider()
