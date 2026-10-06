"""Grounded answer generation: strict context-only answers with numbered
citations, and the fixed refusal when nothing in the library is relevant.

Retrieval goes through `retrieval.search`, which itself only ever surfaces
chunks from `retrieval.ready_chunks_query` (AC-023, AC-059) -- this module
never queries `Chunk` directly and never adds a document-filter argument
(AC-056). Generation goes through `app.providers.llm.get_llm_provider()`;
no vendor SDK is imported here.

`answer_question` is an async generator: it yields `AnswerToken` events as
the model streams, then exactly one trailing `AnswerCitations` event once
generation completes (or immediately, on the refusal path). This shape is
what an SSE caller streams out as it arrives and what it resolves into a
persisted assistant `Message` plus its `Citation` rows once exhausted.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.providers.llm import LLMProvider, get_llm_provider
from app.retrieval import ScoredChunk, search

# How many of the most recent conversation turns are handed to query
# rewriting (AC-075) -- never the full history, however long the
# conversation has grown. Small by default: a follow-up almost always
# refers back to only the last turn or two.
FOLLOWUP_CONTEXT_TURNS = int(os.getenv("FOLLOWUP_CONTEXT_TURNS", "6"))

# Returned verbatim (AC-057) whenever no chunk in the org's ready library
# clears `retrieval.RELEVANCE_THRESHOLD` for the question asked. A single
# module-level constant, reused everywhere a refusal is produced, rather
# than re-typed at each call site.
REFUSAL_ANSWER = "I don't have information about that in the uploaded documents."

_SYSTEM_PROMPT = (
    "You are a document question-answering assistant. You must answer using "
    "only the numbered context passages supplied below -- never your own "
    "general knowledge, and never anything not contained in those passages. "
    "Every factual claim in your answer must end with the numbered citation "
    "marker, like [1] or [2], of the context passage it is drawn from; if a "
    "claim draws on more than one passage, cite all of them, e.g. [1][3]. "
    "If the supplied context only partially covers the question, answer the "
    "part it covers with citations, then explicitly state that the "
    "remaining part is not covered by the uploaded documents. If the "
    "supplied context does not cover the question at all, say plainly that "
    "you do not know based on the uploaded documents -- do not guess and do "
    "not fall back on anything outside the supplied context."
)


@dataclass(frozen=True)
class ResolvedCitation:
    """A numbered citation marker resolved back to the chunk it refers to."""

    marker: int
    chunk_id: uuid.UUID
    document_id: uuid.UUID
    location_label: str | None
    snapshot_text: str


@dataclass(frozen=True)
class AnswerToken:
    """One piece of generated answer text, in stream order."""

    text: str


@dataclass(frozen=True)
class AnswerCitations:
    """The trailing, and only, event carrying resolved citations. Always the
    last event `answer_question` yields."""

    citations: list[ResolvedCitation]


def _location_label(scored: ScoredChunk) -> str | None:
    chunk = scored.chunk
    if chunk.page_start is not None:
        if chunk.page_end is not None and chunk.page_end != chunk.page_start:
            return f"p. {chunk.page_start}-{chunk.page_end}"
        return f"p. {chunk.page_start}"
    if chunk.row_start is not None:
        if chunk.row_end is not None and chunk.row_end != chunk.row_start:
            return f"rows {chunk.row_start}-{chunk.row_end}"
        return f"row {chunk.row_start}"
    return None


def _build_context(results: list[ScoredChunk]) -> str:
    """Numbers every retrieved chunk 1..n (AC-064); this numbering is both
    what the model is told to cite and what `_resolve_citations` maps back
    to a chunk. The only text ever placed in the context block is retrieved
    chunk text -- no general world knowledge is ever concatenated in here
    (AC-063)."""
    return "\n\n".join(
        f"[{index}] {scored.chunk.text}" for index, scored in enumerate(results, start=1)
    )


def _resolve_citations(results: list[ScoredChunk]) -> list[ResolvedCitation]:
    return [
        ResolvedCitation(
            marker=index,
            chunk_id=scored.chunk.id,
            document_id=scored.chunk.document_id,
            location_label=_location_label(scored),
            snapshot_text=scored.chunk.text,
        )
        for index, scored in enumerate(results, start=1)
    ]


async def _standalone_query(
    provider: LLMProvider, conversation_history: list[dict[str, str]], question: str
) -> str:
    """Rewrite a follow-up `question` into a standalone query for retrieval
    (AC-074), using at most the last `FOLLOWUP_CONTEXT_TURNS` turns of
    `conversation_history` -- never the full history (AC-075).

    A first message in a conversation has no prior turns, so it is never
    sent through rewriting and retrieval runs on exactly what was asked
    (AC-076). A rewrite-provider failure falls back to the original
    question rather than breaking the turn.
    """
    if not conversation_history:
        return question
    recent_history = conversation_history[-FOLLOWUP_CONTEXT_TURNS:]
    try:
        rewritten = await provider.rewrite_query(history=recent_history, question=question)
    except Exception:  # noqa: BLE001 -- a rewrite failure must never break the turn
        return question
    rewritten = (rewritten or "").strip()
    return rewritten or question


async def answer_question(
    db: Session,
    org_id: uuid.UUID,
    conversation_history: list[dict[str, str]],
    question: str,
) -> AsyncIterator[AnswerToken | AnswerCitations]:
    """Rewrite, retrieve, then either refuse or stream a grounded, cited
    answer.

    `question` is first rewritten into a standalone query for retrieval
    when there is prior conversation history (AC-074, AC-075, AC-076).
    Retrieval always goes through `retrieval.search`, so only chunks from
    ready documents in the org's library are ever considered (AC-059). When
    nothing clears `RELEVANCE_THRESHOLD`, this yields the fixed refusal and
    an empty citation list and returns *without ever calling the LLM
    provider to generate an answer* (AC-057, AC-058, AC-077).
    """
    provider = get_llm_provider()
    search_query = await _standalone_query(provider, conversation_history, question)
    results = await search(db, org_id, search_query)

    if not results:
        yield AnswerToken(REFUSAL_ANSWER)
        yield AnswerCitations([])
        return

    context = _build_context(results)
    messages = [*conversation_history, {"role": "user", "content": question}]

    stream = provider.stream_answer(system=_SYSTEM_PROMPT, messages=messages, context=context)
    async for token in stream:
        yield AnswerToken(token)

    yield AnswerCitations(_resolve_citations(results))


__all__ = [
    "REFUSAL_ANSWER",
    "FOLLOWUP_CONTEXT_TURNS",
    "AnswerToken",
    "AnswerCitations",
    "ResolvedCitation",
    "answer_question",
]
