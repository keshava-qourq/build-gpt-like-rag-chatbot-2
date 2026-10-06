"""Generation provider adapter.

The architecture names a provider interface for answer generation and title
generation, default OpenAI GPT-4o-class, swappable by config. Handlers code
against `LLMProvider`; `get_llm_provider()` is the one place that decides
which implementation that is.
"""

from __future__ import annotations

import os
from abc import ABC, abstractmethod
from collections.abc import AsyncIterator


class LLMProvider(ABC):
    """Adapter for grounded-answer streaming and conversation-title generation."""

    @abstractmethod
    def stream_answer(
        self, *, system: str, messages: list[dict[str, str]], context: str
    ) -> AsyncIterator[str]:
        """Yield answer tokens as they are generated, grounded in `context`."""

    @abstractmethod
    async def generate_title(self, *, first_message: str) -> str:
        """Generate a short conversation title from its first message."""


class OpenAILLMProvider(LLMProvider):
    """Default provider. Reading the model name from config now so the seam
    is in the right place; the actual API call is for the handler that
    replaces the message/regenerate route stubs to implement."""

    def __init__(self, model: str | None = None) -> None:
        self.model = model or os.getenv("LLM_MODEL", "gpt-4o")

    async def stream_answer(
        self, *, system: str, messages: list[dict[str, str]], context: str
    ) -> AsyncIterator[str]:
        raise NotImplementedError(
            "Wire this to the OpenAI client when implementing grounded generation."
        )
        yield ""  # pragma: no cover -- keeps this declared as an async generator

    async def generate_title(self, *, first_message: str) -> str:
        raise NotImplementedError(
            "Wire this to the OpenAI client when implementing title generation."
        )


def get_llm_provider() -> LLMProvider:
    return OpenAILLMProvider()
