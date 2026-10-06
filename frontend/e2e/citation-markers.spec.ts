import { test } from "@playwright/test";

/**
 * US-028 -- See numbered citations inline in the answer.
 *
 * AC-103..AC-106 describe what a person sees once a real grounded answer has
 * come back from the model: numbered markers in the rendered text, two
 * claims on the same chunk sharing one marker, no markers on the fixed
 * refusal, and an unresolvable marker degrading to plain text rather than a
 * broken link.
 *
 * Every one of those paths -- uploaded-document ingestion, the embedding of
 * the user's question for retrieval, and the grounded answer itself -- goes
 * through the real OpenAI-backed embeddings and LLM providers
 * (`app/providers/embeddings.py`, `app/providers/llm.py`); there is no
 * fake/in-memory provider registered for either one. That is true even of
 * the *refusal* path: `app.retrieval.search` embeds the user's question
 * before it ever checks whether any chunk exists to compare it against, so
 * even "ask a question of an empty library" makes a real network call to
 * OpenAI. Driving this end to end -- through the browser, or through
 * Playwright's `request` API against the live endpoints -- requires a
 * reachable OpenAI endpoint and a funded `OPENAI_API_KEY`, neither of which
 * this run has. Faking the assertion by stubbing the provider is not
 * available either: the webServer in `playwright.config.ts` boots the real
 * `uvicorn` process from `backend/`, not a test harness that could have a
 * fake provider injected into it.
 *
 * These are left as named, skipped specs -- one per acceptance criterion --
 * rather than silently omitted, so the gap is visible and this suite is the
 * first thing to extend once a real (or sandboxed/mocked-at-the-HTTP-layer)
 * OpenAI credential is available to the e2e environment, or once the
 * provider registry gains a deterministic test double selectable by env var.
 *
 * Backend-contract coverage for the same four criteria that does NOT depend
 * on a live model call -- driving `/conversations/{id}/messages` with a
 * monkeypatched LLM/embeddings provider and asserting on the SSE citations
 * event -- lives in `backend/tests/test_citation_markers.py`.
 */

test.describe("US-028: numbered citation markers inline in the answer", () => {
  test.skip("AC-103: a real grounded answer carries consecutively numbered markers like [1] once the trailing citations event arrives -- requires a live LLM/embeddings provider, unavailable in this environment", async () => {});

  test.skip("AC-104: two claims drawn from the same uploaded chunk both display the same marker and open the same source -- requires a live LLM/embeddings provider, unavailable in this environment", async () => {});

  test.skip("AC-105: a question with no match in the uploaded library renders the fixed refusal with no citation markers -- requires a live embeddings provider to embed the question even on the refusal path, unavailable in this environment", async () => {});

  test.skip("AC-106: a marker the model emits with no corresponding retrieved chunk is not rendered as a clickable citation, and the rest of the answer still displays -- requires a live LLM/embeddings provider, unavailable in this environment", async () => {});
});
