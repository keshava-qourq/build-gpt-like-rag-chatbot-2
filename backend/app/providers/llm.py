"""Generation provider adapter.

The architecture names a provider interface for answer generation and title
generation, default OpenAI GPT-4o-class, swappable by config. Handlers code
against `LLMProvider`; `get_llm_provider()` is the one place that decides
which implementation that is, selecting from `PROVIDER_REGISTRY` by
`LLM_PROVIDER` (default "openai") so a retrieval, citation or chat module
never imports a vendor SDK directly -- it imports this module instead.
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
    """Default provider. Model name and API key come from config
    (`LLM_MODEL`, `OPENAI_API_KEY`); the client is lazily constructed from
    `OPENAI_API_KEY` unless one is injected via the constructor, so tests
    never make a network call."""

    def __init__(self, model: str | None = None, client=None) -> None:
        self.model = model or os.getenv("LLM_MODEL", "gpt-4o")
        self._client = client

    def _get_client(self):
        if self._client is None:
            from openai import AsyncOpenAI

            self._client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        return self._client

    async def stream_answer(
        self, *, system: str, messages: list[dict[str, str]], context: str
    ) -> AsyncIterator[str]:
        client = self._get_client()
        grounded_system = f"{system}\n\nContext:\n{context}"
        full_messages = [{"role": "system", "content": grounded_system}, *messages]
        stream = await client.chat.completions.create(
            model=self.model, messages=full_messages, stream=True
        )
        async for event in stream:
            delta = event.choices[0].delta.content
            if delta:
                yield delta

    async def generate_title(self, *, first_message: str) -> str:
        client = self._get_client()
        response = await client.chat.completions.create(
            model=self.model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Generate a short, concise title (at most 6 words) for a "
                        "conversation based on its first message. Respond with only "
                        "the title, no quotation marks."
                    ),
                },
                {"role": "user", "content": first_message},
            ],
        )
        return response.choices[0].message.content.strip()


# Keyed by `LLM_PROVIDER` (default "openai"); `get_llm_provider()` looks up
# the adapter class here rather than branching inline, so adding a new
# provider is a registry entry, not a change to every call site.
PROVIDER_REGISTRY: dict[str, type[LLMProvider]] = {
    "openai": OpenAILLMProvider,
}


def get_llm_provider() -> LLMProvider:
    provider_name = os.getenv("LLM_PROVIDER", "openai").strip().lower()
    try:
        provider_cls = PROVIDER_REGISTRY[provider_name]
    except KeyError as exc:
        raise ValueError(
            f"Unknown LLM_PROVIDER '{provider_name}'; known providers: {sorted(PROVIDER_REGISTRY)}"
        ) from exc
    return provider_cls()
