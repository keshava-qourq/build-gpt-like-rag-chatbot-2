import { expect, test, type Page } from "@playwright/test";

/**
 * US-028 -- inline numbered citation rendering, AC-103..AC-106.
 *
 * Chat.tsx reads an assistant turn through `streamAssistantMessage`, which
 * wraps `fetch` + a hand-rolled SSE reader (`readSSE` in lib/api.ts), not
 * `EventSource`. Driving that reader through Playwright's `page.route`
 * (which can only hand back one static body) gives no way to observe what
 * the component rendered *between* two SSE events -- which is exactly what
 * AC-103's "markers appear only after the text has streamed" claims. So
 * each test here overrides `window.fetch` for the `.../messages` endpoint
 * with a real, incrementally-enqueued `ReadableStream`, replaying the given
 * SSE chunks with a real delay between them. That lets the mid-stream state
 * (text visible, citations event not yet received) be asserted directly.
 *
 * `GET /conversations` and `GET /conversations/:id` are stubbed with
 * `page.route`, as in copy-regenerate.spec.ts -- those endpoints are not
 * part of what this story changed.
 *
 * New file so it does not collide with BUIL654BFB-31-2's edits to
 * Chat.test.tsx or with the existing skipped live-provider specs in
 * citation-markers.spec.ts.
 */

const CONV_ID = "conv-citations-1";

function sseChunks(tokens: string[], citations: unknown[]): string[] {
  const tokenChunks = tokens.map((t) => `event: token\ndata: ${JSON.stringify(t)}\n\n`);
  const citationsChunk = `event: citations\ndata: ${JSON.stringify(citations)}\n\n`;
  return [...tokenChunks, citationsChunk];
}

async function mockConversationShell(page: Page) {
  await page.route("**/conversations", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { id: CONV_ID, title: "Citations test", updated_at: new Date().toISOString() },
      ]),
    });
  });
  await page.route(`**/conversations/${CONV_ID}`, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: CONV_ID, title: "Citations test", messages: [] }),
    });
  });
}

/**
 * Overrides window.fetch for exactly the streaming endpoint, replaying
 * `chunks` on a real ReadableStream with `delayMs` between each one so a
 * test can observe state mid-stream rather than only the settled DOM. Every
 * other request (the GET routes above included) falls through to the
 * original fetch untouched.
 */
async function stubStreamingResponse(page: Page, chunks: string[], delayMs: number) {
  await page.addInitScript(
    ({ chunks, delayMs }) => {
      const originalFetch = window.fetch.bind(window);
      window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : ((input as Request).url ?? String(input));
        if (!url.includes("/messages")) return originalFetch(input, init);
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            let i = 0;
            const pump = () => {
              if (i >= chunks.length) {
                controller.close();
                return;
              }
              controller.enqueue(encoder.encode(chunks[i]));
              i += 1;
              setTimeout(pump, delayMs);
            };
            pump();
          },
        });
        return Promise.resolve(
          new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
        );
      }) as typeof window.fetch;
    },
    { chunks, delayMs },
  );
}

async function askQuestion(page: Page, question: string) {
  await page.goto("/chat");
  // Confirms the seeded conversation has become active (messages === [])
  // before the composer is driven, so Send cannot race createConversation.
  await expect(
    page.getByRole("heading", { name: "Ask a question of the shared library" }),
  ).toBeVisible();
  const box = page.getByRole("textbox", { name: "Ask a question of the uploaded documents" });
  await box.fill(question);
  await page.getByRole("button", { name: "Send" }).click();
}

test.describe("US-028 inline numbered citations", () => {
  test("AC-103: markers are consecutively numbered inline controls that only appear once the citations event arrives", async ({
    page,
  }) => {
    await mockConversationShell(page);
    await stubStreamingResponse(
      page,
      sseChunks(
        ["First fact. [1] ", "Second fact. [2]"],
        [
          {
            marker: 1,
            document_id: "doc-1",
            filename: "policy.pdf",
            location_label: "p. 1",
            snapshot_text: "...",
          },
          {
            marker: 2,
            document_id: "doc-2",
            filename: "runbook.pdf",
            location_label: "p. 4",
            snapshot_text: "...",
          },
        ],
      ),
      // Every chunk, including the final citations one, is 300ms apart --
      // long enough that the full text is on screen well before the
      // citations event can have fired.
      300,
    );

    await askQuestion(page, "What are the two facts?");

    await expect(page.getByText("First fact. [1] Second fact. [2]")).toBeVisible();
    // Text is fully rendered, but the citations event has not arrived yet:
    // the markers are still plain, unclickable text, not controls.
    await expect(page.getByRole("button", { name: /^Source \d+:/ })).toHaveCount(0);

    const marker1 = page.getByRole("button", { name: /^Source 1: policy\.pdf/ });
    const marker2 = page.getByRole("button", { name: /^Source 2: runbook\.pdf/ });
    await expect(marker1).toBeVisible();
    await expect(marker2).toBeVisible();

    const order = await page.evaluate(() =>
      Array.from(document.querySelectorAll("button[aria-label^='Source ']")).map((b) =>
        b.textContent?.trim(),
      ),
    );
    expect(order).toEqual(["1", "2"]);
  });

  test("AC-104: two markers sharing a number open the same source with the same filename and location", async ({
    page,
  }) => {
    await mockConversationShell(page);
    await stubStreamingResponse(
      page,
      sseChunks(
        ["Alpha claim. [1] ", "Beta claim, same source. [1]"],
        [
          {
            marker: 1,
            document_id: "doc-1",
            filename: "sla-policy.pdf",
            location_label: "p. 3",
            snapshot_text: "Credits apply after four hours.",
          },
        ],
      ),
      0,
    );

    await askQuestion(page, "What does the SLA say twice?");
    await expect(page.getByText("Alpha claim. [1] Beta claim, same source. [1]")).toBeVisible();

    const markers = page.getByRole("button", { name: /^Source 1: sla-policy\.pdf/ });
    await expect(markers).toHaveCount(2);

    await markers.first().click();
    await expect(page.getByRole("heading", { name: "sla-policy.pdf" })).toBeVisible();
    await expect(page.getByText("p. 3")).toBeVisible();
    await page.getByRole("button", { name: "Close source panel" }).first().click();

    await markers.last().click();
    await expect(page.getByRole("heading", { name: "sla-policy.pdf" })).toBeVisible();
    await expect(page.getByText("p. 3")).toBeVisible();
  });

  test("AC-105: the fixed not-in-the-uploaded-documents reply renders with no markers and no source list", async ({
    page,
  }) => {
    await mockConversationShell(page);
    const NOT_FOUND = "This isn't in the uploaded documents.";
    await stubStreamingResponse(page, sseChunks([NOT_FOUND], []), 0);

    await askQuestion(page, "What is the warranty on hardware we never bought?");

    await expect(page.getByText(NOT_FOUND)).toBeVisible();
    await expect(page.getByRole("button", { name: /^Source \d+:/ })).toHaveCount(0);
    await expect(page.getByText("Sources")).toHaveCount(0);
  });

  test("AC-106: an unmatched [9] marker renders as plain, unclickable text and the rest of the answer still renders", async ({
    page,
  }) => {
    await mockConversationShell(page);
    await stubStreamingResponse(
      page,
      sseChunks(
        ["Known fact. [9] ", "Known tail."],
        [
          {
            marker: 1,
            document_id: "doc-1",
            filename: "policy.pdf",
            location_label: "p. 1",
            snapshot_text: "...",
          },
        ],
      ),
      0,
    );

    await askQuestion(page, "Say something with a bad marker.");

    await expect(page.getByText("Known fact. [9] Known tail.")).toBeVisible();
    // Rest of the answer still renders either side of the bad marker.
    await expect(page.getByText(/Known fact\./)).toBeVisible();
    await expect(page.getByText(/Known tail\./)).toBeVisible();

    await expect(page.getByRole("button", { name: /9/ })).toHaveCount(0);

    const literalMarker = page.locator("span", { hasText: "[9]" }).last();
    await expect(literalMarker).toBeVisible();
    await expect(literalMarker).not.toHaveAttribute("role", "button");
    expect(await literalMarker.getAttribute("tabindex")).toBeNull();
  });
});
