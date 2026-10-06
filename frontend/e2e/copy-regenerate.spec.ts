import { expect, test, type Page } from "@playwright/test";

// US-026: Copy or regenerate an answer.
//
// The app's sign-in screen is a local-only prototype (see SignIn.tsx) and
// never calls the real auth API or stores a token, and Chat.tsx has no route
// guard -- navigating straight to /chat renders the chat screen. So these
// tests exercise the delivered Chat.tsx behavior (copyAnswer, retry,
// lastAssistantId gating) by intercepting the conversation endpoints at the
// network boundary rather than depending on seeded backend data.

const CONV_ID = "conv-1";

function sse(tokens: string[], citations: unknown[]) {
  const tokenEvents = tokens.map((t) => `event: token\ndata: ${JSON.stringify(t)}\n\n`).join("");
  const citationEvent = `event: citations\ndata: ${JSON.stringify(citations)}\n\n`;
  return tokenEvents + citationEvent;
}

const OLDER_CITATIONS = [
  {
    marker: 1,
    document_id: "doc-1",
    filename: "sla-policy.pdf",
    location_label: "p. 2",
    snapshot_text: "Credits apply after four hours of continuous Priority 1 outage.",
  },
];

const LATEST_CITATIONS = [
  {
    marker: 1,
    document_id: "doc-2",
    filename: "oncall-runbook.pdf",
    location_label: "p. 5",
    snapshot_text: "Sev 1 incidents page the on-call engineer after hours.",
  },
];

const REGENERATED_CITATIONS = [
  {
    marker: 1,
    document_id: "doc-3",
    filename: "oncall-runbook-v2.pdf",
    location_label: "p. 6",
    snapshot_text: "Sev 1 incidents page the on-call engineer and the duty manager after hours.",
  },
];

async function mockConversation(
  page: Page,
  messages: { role: "user" | "assistant"; content: string; citations: unknown[] }[],
) {
  await page.route("**/conversations", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { id: CONV_ID, title: "Outage SLA questions", updated_at: new Date().toISOString() },
      ]),
    });
  });

  await page.route(`**/conversations/${CONV_ID}`, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: CONV_ID, title: "Outage SLA questions", messages }),
    });
  });
}

async function stubClipboard(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __copiedText: string | null }).__copiedText = null;
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: (text: string) => {
          (window as unknown as { __copiedText: string | null }).__copiedText = text;
          return Promise.resolve();
        },
      },
      configurable: true,
    });
  });
}

test.describe("US-026 copy or regenerate an answer", () => {
  test("AC-095: copy places the answer on the clipboard and shows a confirmation", async ({
    page,
  }) => {
    await stubClipboard(page);
    await mockConversation(page, [
      { role: "user", content: "What about outages after hours?", citations: [] },
      {
        role: "assistant",
        content: "Sev 1 pages the on-call engineer. [1]",
        citations: LATEST_CITATIONS,
      },
    ]);
    await page.goto("/chat");

    const copyButton = page.getByRole("button", { name: "Copy answer" }).last();
    await copyButton.click();

    await expect(page.getByRole("button", { name: "Copied" }).last()).toBeVisible();
    const copied = await page.evaluate(
      () => (window as unknown as { __copiedText: string | null }).__copiedText,
    );
    expect(copied).toBe("Sev 1 pages the on-call engineer. [1]");
  });

  test("AC-096: regenerate re-runs the question and replaces the latest turn with new citations", async ({
    page,
  }) => {
    await mockConversation(page, [
      { role: "user", content: "What about outages after hours?", citations: [] },
      {
        role: "assistant",
        content: "Sev 1 pages the on-call engineer. [1]",
        citations: LATEST_CITATIONS,
      },
    ]);

    let requestBody = "";
    await page.route(`**/conversations/${CONV_ID}/messages`, async (route) => {
      requestBody = route.request().postData() ?? "";
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: sse(
          ["Sev 1 pages the on-call engineer and the duty manager. ", "[1]"],
          REGENERATED_CITATIONS,
        ),
      });
    });

    await page.goto("/chat");
    await expect(page.getByText("Sev 1 pages the on-call engineer. [1]")).toBeVisible();

    await page.getByRole("button", { name: "Regenerate" }).click();

    await expect(
      page.getByText("Sev 1 pages the on-call engineer and the duty manager. [1]"),
    ).toBeVisible();
    await expect(page.getByText("Sev 1 pages the on-call engineer. [1]")).toHaveCount(0);
    await expect(page.getByText("oncall-runbook-v2.pdf")).toBeVisible();
    expect(JSON.parse(requestBody).content).toBe("What about outages after hours?");

    // The regenerated answer is still the latest turn, so it still offers Regenerate.
    await expect(page.getByRole("button", { name: "Regenerate" })).toBeVisible();
  });

  test("AC-097: regenerating a no-match question returns the fixed reply again", async ({
    page,
  }) => {
    const NOT_FOUND_TEXT = "This isn't in the uploaded documents.";
    await mockConversation(page, [
      { role: "user", content: "What is the warranty on hardware we never bought?", citations: [] },
      { role: "assistant", content: NOT_FOUND_TEXT, citations: [] },
    ]);

    await page.route(`**/conversations/${CONV_ID}/messages`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: sse([NOT_FOUND_TEXT], []),
      });
    });

    await page.goto("/chat");
    await expect(page.getByText(NOT_FOUND_TEXT)).toBeVisible();

    await page.getByRole("button", { name: "Regenerate" }).click();

    await expect(page.getByText(NOT_FOUND_TEXT)).toBeVisible();
    await expect(page.getByText("Sources")).toHaveCount(0);
  });

  test("AC-098: regenerate is not offered on an earlier assistant turn", async ({ page }) => {
    await mockConversation(page, [
      {
        role: "user",
        content: "What credit applies to a Priority 1 outage over four hours?",
        citations: [],
      },
      {
        role: "assistant",
        content: "Credits apply after four hours. [1]",
        citations: OLDER_CITATIONS,
      },
      { role: "user", content: "What about outages after hours?", citations: [] },
      {
        role: "assistant",
        content: "Sev 1 pages the on-call engineer. [1]",
        citations: LATEST_CITATIONS,
      },
    ]);
    await page.goto("/chat");

    await expect(page.getByRole("button", { name: "Regenerate" })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Copy answer" })).toHaveCount(2);

    const olderTurn = page.locator("li", { hasText: "Credits apply after four hours." });
    await expect(olderTurn.getByRole("button", { name: "Regenerate" })).toHaveCount(0);
    await expect(olderTurn.getByRole("button", { name: "Copy answer" })).toHaveCount(1);
  });
});
