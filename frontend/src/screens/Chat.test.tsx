import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Screen from "@/screens/Chat";
import * as api from "@/lib/api";
import type { ChatStreamEvent, CitationItem } from "@/lib/api";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof api>("@/lib/api");
  return {
    ...actual,
    listConversations: vi.fn(),
    createConversation: vi.fn(),
    getConversation: vi.fn(),
    renameConversation: vi.fn(),
    deleteConversation: vi.fn(),
    streamAssistantMessage: vi.fn(),
    regenerateAssistantMessage: vi.fn(),
    getDocumentDownloadUrl: vi.fn(),
  };
});

const mocked = api as unknown as {
  listConversations: ReturnType<typeof vi.fn>;
  createConversation: ReturnType<typeof vi.fn>;
  getConversation: ReturnType<typeof vi.fn>;
  renameConversation: ReturnType<typeof vi.fn>;
  deleteConversation: ReturnType<typeof vi.fn>;
  streamAssistantMessage: ReturnType<typeof vi.fn>;
  regenerateAssistantMessage: ReturnType<typeof vi.fn>;
  getDocumentDownloadUrl: ReturnType<typeof vi.fn>;
};

function renderScreen() {
  return render(
    <MemoryRouter>
      <Screen />
    </MemoryRouter>,
  );
}

/** Captures the onEvent callback handed to a streamAssistantMessage call so
 * the test can drive tokens, citations and errors as if the server sent
 * them, then resolve or reject the outer promise exactly as the real
 * implementation would. */
function deferredStream() {
  let onEvent: (e: ChatStreamEvent) => void = () => {};
  let resolve: () => void = () => {};
  let reject: (e: unknown) => void = () => {};
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  mocked.streamAssistantMessage.mockImplementationOnce(
    (_id: string, _content: string, cb: (e: ChatStreamEvent) => void, signal: AbortSignal) => {
      onEvent = cb;
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      return promise;
    },
  );
  return {
    emit: (e: ChatStreamEvent) => act(() => onEvent(e)),
    resolve: () => act(() => resolve()),
  };
}

/** Same pattern as `deferredStream`, but for `regenerateAssistantMessage`, and
 * it captures the message id the call was made with so tests can assert the
 * endpoint was addressed with the server id rather than a client-local one. */
function deferredRegenerate() {
  let onEvent: (e: ChatStreamEvent) => void = () => {};
  let resolve: () => void = () => {};
  let reject: (e: unknown) => void = () => {};
  let calledWithId = "";
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  mocked.regenerateAssistantMessage.mockImplementationOnce(
    (_convId: string, messageId: string, cb: (e: ChatStreamEvent) => void, signal: AbortSignal) => {
      calledWithId = messageId;
      onEvent = cb;
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      return promise;
    },
  );
  return {
    emit: (e: ChatStreamEvent) => act(() => onEvent(e)),
    resolve: () => act(() => resolve()),
    calledWithId: () => calledWithId,
  };
}

const CITATION: CitationItem = {
  marker: 1,
  document_id: "doc-1",
  filename: "Acme MSA v4.pdf",
  format: "PDF",
  location_label: "Page 4",
  snapshot_text: "Retention is thirty days.",
};

beforeEach(() => {
  mocked.listConversations.mockReset();
  mocked.createConversation.mockReset();
  mocked.getConversation.mockReset();
  mocked.renameConversation.mockReset();
  mocked.deleteConversation.mockReset();
  mocked.streamAssistantMessage.mockReset();
  mocked.regenerateAssistantMessage.mockReset();
  mocked.getDocumentDownloadUrl.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Chat screen", () => {
  it("shows a loading state while conversations are fetched", async () => {
    let resolveList: (v: api.ConversationSummaryDTO[]) => void = () => {};
    mocked.listConversations.mockReturnValue(
      new Promise((res) => {
        resolveList = res;
      }),
    );
    renderScreen();
    expect(screen.getByText("Loading conversations…")).toBeInTheDocument();
    resolveList([]);
    await waitFor(() => expect(screen.queryByText("Loading conversations…")).toBeNull());
  });

  it("shows an empty state when there are no conversations", async () => {
    mocked.listConversations.mockResolvedValue([]);
    renderScreen();
    expect(await screen.findByText(/No conversations yet\. Start a new chat/i)).toBeInTheDocument();
  });

  it("shows an error state with retry when the conversation list fails to load", async () => {
    mocked.listConversations.mockRejectedValueOnce(new Error("network down"));
    renderScreen();
    expect(await screen.findByText(/Could not load your conversations/i)).toBeInTheDocument();
    mocked.listConversations.mockResolvedValueOnce([]);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() =>
      expect(screen.queryByText(/Could not load your conversations/i)).toBeNull(),
    );
  });

  it("loads conversation history with citations from GET endpoints (persisted after reload)", async () => {
    mocked.listConversations.mockResolvedValue([
      { id: "conv-1", title: "Retention periods", updated_at: new Date().toISOString() },
    ]);
    mocked.getConversation.mockResolvedValue({
      id: "conv-1",
      title: "Retention periods",
      messages: [
        { role: "user", content: "What is the retention period?", citations: [] },
        {
          role: "assistant",
          content: "Thirty days from termination [1].",
          citations: [CITATION],
        },
      ],
    });
    renderScreen();
    expect(await screen.findByText("What is the retention period?")).toBeInTheDocument();
    expect(await screen.findByText(/Thirty days from termination/)).toBeInTheDocument();
    const marker = await screen.findByRole("button", { name: /Source 1: Acme MSA v4\.pdf/i });
    await userEvent.click(marker);
    const panel = screen.getByRole("region", { name: "Cited source" });
    expect(within(panel).getByText("Acme MSA v4.pdf")).toBeInTheDocument();
    expect(within(panel).getByText("Page 4")).toBeInTheDocument();
    expect(within(panel).getByText("Retention is thirty days.")).toBeInTheDocument();
  });

  it("posts a question, renders the user turn immediately and streams tokens with no simulated typing", async () => {
    mocked.listConversations.mockResolvedValue([]);
    mocked.createConversation.mockResolvedValue({ id: "conv-new" });
    mocked.renameConversation.mockResolvedValue({ id: "conv-new", title: "Hello" });
    const stream = deferredStream();

    renderScreen();
    await screen.findByText(/No conversations yet/i);

    const textbox = screen.getByLabelText("Ask a question of the uploaded documents");
    await userEvent.type(textbox, "Hello there");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(screen.getAllByText("Hello there").length).toBeGreaterThanOrEqual(1),
    );
    expect(mocked.createConversation).toHaveBeenCalledTimes(1);
    expect(mocked.streamAssistantMessage).toHaveBeenCalledWith(
      "conv-new",
      "Hello there",
      expect.any(Function),
      expect.any(Object),
    );

    stream.emit({ type: "token", token: "Hi " });
    stream.emit({ type: "token", token: "there." });
    await screen.findByText("Hi there.");

    stream.emit({ type: "citations", citations: [CITATION] });
    stream.resolve();

    const sourceButton = await screen.findByRole("button", {
      name: /Acme MSA v4\.pdf/,
    });
    expect(sourceButton).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument());
  });

  it("stops the stream, marks the turn stopped, and leaves the composer usable", async () => {
    mocked.listConversations.mockResolvedValue([]);
    mocked.createConversation.mockResolvedValue({ id: "conv-new" });
    mocked.renameConversation.mockResolvedValue({ id: "conv-new", title: "Q" });
    const stream = deferredStream();

    renderScreen();
    await screen.findByText(/No conversations yet/i);

    const textbox = screen.getByLabelText("Ask a question of the uploaded documents");
    await userEvent.type(textbox, "Tell me about backups");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    stream.emit({ type: "token", token: "Backups run " });
    await screen.findByText("Backups run");

    await userEvent.click(screen.getByRole("button", { name: "Stop" }));

    expect(await screen.findByText("Stopped")).toBeInTheDocument();
    expect(screen.getByText("Backups run")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
    await userEvent.type(textbox, "Another question");
    expect(textbox).toHaveValue("Another question");
  });

  it("shows a visible error state with Retry on a failed stream, and retry re-issues the request", async () => {
    mocked.listConversations.mockResolvedValue([]);
    mocked.createConversation.mockResolvedValue({ id: "conv-new" });
    mocked.renameConversation.mockResolvedValue({ id: "conv-new", title: "Q" });
    const firstStream = deferredStream();

    renderScreen();
    await screen.findByText(/No conversations yet/i);

    const textbox = screen.getByLabelText("Ask a question of the uploaded documents");
    await userEvent.type(textbox, "What about SLAs?");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    firstStream.emit({ type: "error", message: "provider unavailable" });
    firstStream.resolve();

    expect(await screen.findByText("Stream failed")).toBeInTheDocument();
    const retryButton = screen.getByRole("button", { name: "Retry" });

    const secondStream = deferredStream();
    await userEvent.click(retryButton);
    expect(mocked.streamAssistantMessage).toHaveBeenCalledTimes(2);
    secondStream.emit({ type: "token", token: "SLAs apply." });
    secondStream.emit({ type: "citations", citations: [] });
    secondStream.resolve();
    await screen.findByText("SLAs apply.");
  });

  it("shows a non-leaking error state on a 404 and returns to a usable new-chat view", async () => {
    mocked.listConversations.mockResolvedValue([
      { id: "conv-ghost", title: "Someone else's chat", updated_at: new Date().toISOString() },
    ]);
    mocked.getConversation.mockRejectedValueOnce(
      new Error("GET /conversations/conv-ghost failed: 404"),
    );

    renderScreen();

    await waitFor(() => expect(screen.queryByText(/No conversations yet/i)).toBeInTheDocument());
    expect(screen.queryByText("Someone else's chat")).toBeNull();
    expect(screen.queryByText(/404/)).toBeNull();
    expect(screen.queryByText(/Someone else/)).toBeNull();
    expect(screen.getByLabelText("Ask a question of the uploaded documents")).toBeInTheDocument();
  });

  it("creates a conversation only on first send, never PATCHes a truncated title, and refreshes the list to pick up the server title", async () => {
    mocked.listConversations.mockResolvedValueOnce([]);
    mocked.createConversation.mockResolvedValue({ id: "conv-new" });
    mocked.listConversations.mockResolvedValueOnce([
      { id: "conv-new", title: "Server-generated title", updated_at: new Date().toISOString() },
    ]);
    const stream = deferredStream();

    renderScreen();
    await screen.findByText(/No conversations yet/i);
    expect(mocked.createConversation).not.toHaveBeenCalled();

    const textbox = screen.getByLabelText("Ask a question of the uploaded documents");
    await userEvent.type(textbox, "Hello there");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(mocked.createConversation).toHaveBeenCalledTimes(1));
    expect(mocked.renameConversation).not.toHaveBeenCalled();

    stream.emit({ type: "token", token: "Hi." });
    stream.emit({ type: "citations", citations: [] });
    stream.resolve();

    const sidebar = await screen.findByRole("complementary", { name: "Conversations" });
    expect(mocked.renameConversation).not.toHaveBeenCalled();
    await within(sidebar).findByText("Server-generated title");
  });

  it("renames and deletes conversations through the API instead of local state", async () => {
    mocked.listConversations.mockResolvedValue([
      { id: "conv-1", title: "Old title", updated_at: new Date().toISOString() },
    ]);
    mocked.getConversation.mockResolvedValue({ id: "conv-1", title: "Old title", messages: [] });
    mocked.renameConversation.mockResolvedValue({ id: "conv-1", title: "New title" });
    mocked.deleteConversation.mockResolvedValue(undefined);

    renderScreen();
    const sidebar = await screen.findByRole("complementary", { name: "Conversations" });
    await within(sidebar).findByText("Old title");

    await userEvent.click(
      within(sidebar).getByRole("button", { name: /Rename conversation "Old title"/ }),
    );
    const input = screen.getByLabelText("Conversation title");
    await userEvent.clear(input);
    await userEvent.type(input, "New title");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mocked.renameConversation).toHaveBeenCalledWith("conv-1", "New title"),
    );
    expect(await within(sidebar).findByText("New title")).toBeInTheDocument();

    await userEvent.click(
      within(sidebar).getByRole("button", { name: /Delete conversation "New title"/ }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(mocked.deleteConversation).toHaveBeenCalledWith("conv-1"));
    expect(within(sidebar).queryByText("New title")).toBeNull();
  });

  describe("copy", () => {
    beforeEach(() => {
      mocked.listConversations.mockResolvedValue([
        { id: "conv-1", title: "Retention periods", updated_at: new Date().toISOString() },
      ]);
      mocked.getConversation.mockResolvedValue({
        id: "conv-1",
        title: "Retention periods",
        messages: [
          { id: "msg-1", role: "user", content: "What is the retention period?", citations: [] },
          { id: "msg-2", role: "assistant", content: "Thirty days.", citations: [] },
        ],
      });
    });

    it("places the answer text on the clipboard and shows a confirmation that clears itself", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText },
        configurable: true,
      });
      renderScreen();
      await screen.findByText("Thirty days.");

      await userEvent.click(screen.getByRole("button", { name: "Copy answer" }));

      await waitFor(() => expect(writeText).toHaveBeenCalledWith("Thirty days."));
      expect(await screen.findByText("Copied")).toBeInTheDocument();

      await waitFor(() => expect(screen.queryByText("Copied")).toBeNull(), {
        timeout: 3000,
        interval: 100,
      });
    }, 8000);

    it("shows a non-blocking message instead of throwing when the clipboard API fails", async () => {
      const writeText = vi.fn().mockRejectedValue(new Error("denied"));
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText },
        configurable: true,
      });
      renderScreen();
      await screen.findByText("Thirty days.");

      await expect(
        userEvent.click(screen.getByRole("button", { name: "Copy answer" })),
      ).resolves.not.toThrow();

      expect(
        await screen.findByText("Could not copy the answer. Select and copy the text instead."),
      ).toBeInTheDocument();
      expect(screen.queryByText("Copied")).toBeNull();
    });
  });

  describe("regenerate", () => {
    function mockTwoTurnConversation() {
      mocked.listConversations.mockResolvedValue([
        { id: "conv-1", title: "Retention periods", updated_at: new Date().toISOString() },
      ]);
      mocked.getConversation.mockResolvedValue({
        id: "conv-1",
        title: "Retention periods",
        messages: [
          { id: "msg-1", role: "user", content: "What is the retention period?", citations: [] },
          { id: "msg-2", role: "assistant", content: "First answer.", citations: [] },
          { id: "msg-3", role: "user", content: "And for backups?", citations: [] },
          { id: "msg-4", role: "assistant", content: "Second answer.", citations: [CITATION] },
        ],
      });
    }

    it("offers regenerate only on the most recent assistant turn; earlier turns show copy only", async () => {
      mockTwoTurnConversation();
      renderScreen();
      await screen.findByText("Second answer.");

      expect(screen.getAllByRole("button", { name: "Copy answer" })).toHaveLength(2);
      expect(screen.getAllByRole("button", { name: "Regenerate" })).toHaveLength(1);
    });

    it("calls regenerate for the current assistant turn with its server message id, streams the new answer, and replaces it in place rather than appending a turn", async () => {
      mockTwoTurnConversation();
      const stream = deferredRegenerate();
      renderScreen();
      await screen.findByText("Second answer.");

      await userEvent.click(screen.getByRole("button", { name: "Regenerate" }));
      expect(mocked.regenerateAssistantMessage).toHaveBeenCalledWith(
        "conv-1",
        "msg-4",
        expect.any(Function),
        expect.any(Object),
      );
      expect(stream.calledWithId()).toBe("msg-4");

      stream.emit({ type: "token", token: "Updated answer." });
      await screen.findByText("Updated answer.");
      expect(screen.queryByText("Second answer.")).toBeNull();

      stream.emit({ type: "citations", citations: [CITATION] });
      stream.resolve();

      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Regenerate" })).toBeInTheDocument(),
      );
      // Still exactly one user/assistant pair per original turn -- no extra
      // user turn was appended by regenerating.
      expect(screen.getAllByText(/And for backups\?/)).toHaveLength(1);
    });

    it("renders the fixed not-in-documents reply from regenerate with no citation list and no error state", async () => {
      mockTwoTurnConversation();
      const stream = deferredRegenerate();
      renderScreen();
      await screen.findByText("Second answer.");

      await userEvent.click(screen.getByRole("button", { name: "Regenerate" }));
      stream.emit({ type: "token", token: "This is not in the uploaded documents." });
      stream.emit({ type: "citations", citations: [] });
      stream.resolve();

      await screen.findByText("This is not in the uploaded documents.");
      expect(screen.queryByText("Stream failed")).toBeNull();
      expect(screen.queryByText("Sources")).toBeNull();
    });

    it("disables regenerate while a stream is in flight, and Stop aborts the regenerate stream the same way as a normal turn", async () => {
      mockTwoTurnConversation();
      const stream = deferredRegenerate();
      renderScreen();
      await screen.findByText("Second answer.");

      await userEvent.click(screen.getByRole("button", { name: "Regenerate" }));
      stream.emit({ type: "token", token: "Partial" });
      await screen.findByText("Partial");

      // The regenerate control is withheld entirely while its own turn is streaming.
      expect(screen.queryByRole("button", { name: "Regenerate" })).toBeNull();

      await userEvent.click(screen.getByRole("button", { name: "Stop" }));
      expect(await screen.findByText("Stopped")).toBeInTheDocument();
      expect(screen.getByText("Partial")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Regenerate" })).toBeInTheDocument();
    });
  });

  describe("answer formatting (markdown)", () => {
    it("renders headings, bold text and ordered/unordered lists as formatted elements, not raw markdown characters", async () => {
      mocked.listConversations.mockResolvedValue([
        { id: "conv-1", title: "Formatting", updated_at: new Date().toISOString() },
      ]);
      mocked.getConversation.mockResolvedValue({
        id: "conv-1",
        title: "Formatting",
        messages: [
          { id: "msg-1", role: "user", content: "Summarize the policy", citations: [] },
          {
            id: "msg-2",
            role: "assistant",
            content:
              "## Summary\n\nThis is **important** text.\n\n- First point\n- Second point\n\n1. Step one\n2. Step two",
            citations: [],
          },
        ],
      });

      renderScreen();

      const heading = await screen.findByRole("heading", { name: "Summary" });
      expect(heading).toBeInTheDocument();
      expect(screen.queryByText(/##/)).toBeNull();

      const bold = screen.getByText("important");
      expect(bold.tagName).toBe("STRONG");
      expect(screen.queryByText(/\*\*important\*\*/)).toBeNull();

      expect(screen.getByText("First point").closest("ul")).not.toBeNull();
      expect(screen.getByText("Second point").closest("ul")).not.toBeNull();
      expect(screen.getByText("Step one").closest("ol")).not.toBeNull();
      expect(screen.getByText("Step two").closest("ol")).not.toBeNull();
    });

    it("renders a fenced code block as a monospaced block with its own copy action, separate from the answer-level copy", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText },
        configurable: true,
      });
      mocked.listConversations.mockResolvedValue([
        { id: "conv-1", title: "Code", updated_at: new Date().toISOString() },
      ]);
      mocked.getConversation.mockResolvedValue({
        id: "conv-1",
        title: "Code",
        messages: [
          { id: "msg-1", role: "user", content: "Show an example", citations: [] },
          {
            id: "msg-2",
            role: "assistant",
            content: 'Here:\n\n```python\nprint("hi")\n```\n\nThat works.',
            citations: [],
          },
        ],
      });

      renderScreen();
      await screen.findByText("That works.");

      const code = screen.getByText(
        (_, el) => el?.tagName === "CODE" && el.textContent!.includes('print("hi")'),
      );
      expect(code.closest("pre")).not.toBeNull();

      const copyButtons = screen.getAllByRole("button", { name: /Copy code/i });
      expect(copyButtons).toHaveLength(1);
      expect(screen.getByRole("button", { name: "Copy answer" })).toBeInTheDocument();

      await userEvent.click(copyButtons[0]);
      await waitFor(() => expect(writeText).toHaveBeenCalledWith('print("hi")'));
    });

    it("renders a markdown table with header cells inside a horizontally scrollable container", async () => {
      mocked.listConversations.mockResolvedValue([
        { id: "conv-1", title: "Table", updated_at: new Date().toISOString() },
      ]);
      mocked.getConversation.mockResolvedValue({
        id: "conv-1",
        title: "Table",
        messages: [
          { id: "msg-1", role: "user", content: "Compare plans", citations: [] },
          {
            id: "msg-2",
            role: "assistant",
            content: "| Plan | Price |\n| --- | --- |\n| Basic | $10 |\n| Pro | $20 |",
            citations: [],
          },
        ],
      });

      renderScreen();
      const headerCell = await screen.findByRole("columnheader", { name: "Plan" });
      expect(headerCell).toBeInTheDocument();
      const table = headerCell.closest("table");
      const scrollContainer = table?.parentElement;
      expect(scrollContainer?.className).toMatch(/overflow-x-auto/);
      expect(screen.getByRole("cell", { name: "$10" })).toBeInTheDocument();
    });

    it("escapes content that looks like HTML or a script and never executes it", async () => {
      mocked.listConversations.mockResolvedValue([
        { id: "conv-1", title: "Escaping", updated_at: new Date().toISOString() },
      ]);
      mocked.getConversation.mockResolvedValue({
        id: "conv-1",
        title: "Escaping",
        messages: [
          { id: "msg-1", role: "user", content: "Any risk?", citations: [] },
          {
            id: "msg-2",
            role: "assistant",
            content:
              '<img src=x onerror="window.__pwned=true" /> <script>window.__pwned=true</script>',
            citations: [],
          },
        ],
      });

      renderScreen();
      await screen.findByText(/<img src=x/);

      expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
      expect(document.querySelector("img[src='x']")).toBeNull();
      expect(document.querySelector("script")).toBeNull();
    });
  });

  describe("responsive layout", () => {
    it("shows the conversations toggle on narrow width and opens the sidebar as an overlay that closes on Escape with focus returned to the trigger", async () => {
      mocked.listConversations.mockResolvedValue([
        { id: "conv-1", title: "Retention periods", updated_at: new Date().toISOString() },
      ]);
      mocked.getConversation.mockResolvedValue({
        id: "conv-1",
        title: "Retention periods",
        messages: [],
      });

      renderScreen();
      await screen.findByRole("button", { name: "Open conversations list" });

      const toggle = screen.getByRole("button", { name: "Open conversations list" });
      await userEvent.click(toggle);

      const dialog = screen.getByRole("dialog", { name: "Conversations" });
      expect(dialog).toBeInTheDocument();
      await waitFor(() => expect(dialog).toHaveFocus());

      await userEvent.keyboard("{Escape}");
      await waitFor(() =>
        expect(screen.queryByRole("dialog", { name: "Conversations" })).toBeNull(),
      );
      expect(toggle).toHaveFocus();
    });

    it("does not render the source panel as a fixed tablet-width sliver outside the desktop breakpoint", async () => {
      mocked.listConversations.mockResolvedValue([
        { id: "conv-1", title: "Retention periods", updated_at: new Date().toISOString() },
      ]);
      mocked.getConversation.mockResolvedValue({
        id: "conv-1",
        title: "Retention periods",
        messages: [
          { role: "user", content: "What is the retention period?", citations: [] },
          { role: "assistant", content: "Thirty days [1].", citations: [CITATION] },
        ],
      });
      renderScreen();
      const marker = await screen.findByRole("button", { name: /Source 1: Acme MSA v4\.pdf/i });
      await userEvent.click(marker);
      const panel = screen.getByRole("region", { name: "Cited source" });
      expect(panel.className).not.toMatch(/sm:w-\[24rem\]/);
      expect(panel.className).toMatch(/w-full/);
    });
  });

  describe("inline citation markers (US-028)", () => {
    const CITATION_2: CitationItem = {
      marker: 2,
      document_id: "doc-2",
      filename: "Support SLA.pdf",
      format: "PDF",
      location_label: "Page 1",
      snapshot_text: "A receipt is required for a refund.",
    };

    // AC-103: each claim carries a numbered marker, and the numbering is
    // consecutive within the answer -- but only once the trailing citations
    // event arrives. Before that, the same literal "[1]"/"[2]" text in the
    // stream cannot yet be resolved to a source, so it is plain text, not a
    // clickable marker.
    it("renders markers [1] and [2] as clickable only once the trailing citations event arrives", async () => {
      mocked.listConversations.mockResolvedValue([]);
      mocked.createConversation.mockResolvedValue({ id: "conv-new" });
      mocked.renameConversation.mockResolvedValue({ id: "conv-new", title: "Q" });
      const stream = deferredStream();

      renderScreen();
      await screen.findByText(/No conversations yet/i);

      const textbox = screen.getByLabelText("Ask a question of the uploaded documents");
      await userEvent.type(textbox, "What is the refund policy?");
      await userEvent.click(screen.getByRole("button", { name: "Send" }));

      stream.emit({
        type: "token",
        token: "Refunds are available in 30 days [1], and a receipt is required [2].",
      });
      await screen.findByText(/Refunds are available in 30 days/);

      // Text is on screen, but neither marker is a clickable source yet --
      // the citations event has not arrived, so neither can be resolved.
      expect(screen.queryByRole("button", { name: /^1$/ })).toBeNull();
      expect(screen.queryByRole("button", { name: /^2$/ })).toBeNull();

      stream.emit({ type: "citations", citations: [CITATION, CITATION_2] });
      stream.resolve();

      const marker1 = await screen.findByRole("button", {
        name: /Source 1: Acme MSA v4\.pdf/i,
      });
      const marker2 = await screen.findByRole("button", {
        name: /Source 2: Support SLA\.pdf/i,
      });
      expect(marker1).toBeInTheDocument();
      expect(marker2).toBeInTheDocument();
    });

    // AC-104: two claims that draw on the same chunk both display marker
    // [1], and both resolve to the identical source when opened.
    it("renders two mentions of the same marker as two controls that both open the same source", async () => {
      mocked.listConversations.mockResolvedValue([
        { id: "conv-1", title: "Leave policy", updated_at: new Date().toISOString() },
      ]);
      mocked.getConversation.mockResolvedValue({
        id: "conv-1",
        title: "Leave policy",
        messages: [
          { id: "msg-1", role: "user", content: "How does leave accrual work?", citations: [] },
          {
            id: "msg-2",
            role: "assistant",
            content:
              "Leave accrues monthly [1]. Unused leave also carries over under the same policy [1].",
            citations: [CITATION],
          },
        ],
      });

      renderScreen();
      await screen.findByText(/Leave accrues monthly/);

      const markers = await screen.findAllByRole("button", {
        name: /Source 1: Acme MSA v4\.pdf/i,
      });
      expect(markers).toHaveLength(2);

      await userEvent.click(markers[1]);
      const panel = screen.getByRole("region", { name: "Cited source" });
      expect(within(panel).getByText("Acme MSA v4.pdf")).toBeInTheDocument();
      expect(within(panel).getByText("Retention is thirty days.")).toBeInTheDocument();

      await userEvent.click(markers[0]);
      const panelAfterFirst = screen.getByRole("region", { name: "Cited source" });
      expect(within(panelAfterFirst).getByText("Acme MSA v4.pdf")).toBeInTheDocument();
    });

    // AC-105: the fixed "not in the uploaded documents" reply carries no
    // citation markers at all.
    it("shows no citation markers on the fixed not-in-documents refusal", async () => {
      mocked.listConversations.mockResolvedValue([
        { id: "conv-1", title: "Sabbatical policy", updated_at: new Date().toISOString() },
      ]);
      mocked.getConversation.mockResolvedValue({
        id: "conv-1",
        title: "Sabbatical policy",
        messages: [
          {
            id: "msg-1",
            role: "user",
            content: "What does the handbook say about sabbaticals?",
            citations: [],
          },
          {
            id: "msg-2",
            role: "assistant",
            content: "I don't have information about that in the uploaded documents.",
            citations: [],
          },
        ],
      });

      renderScreen();
      await screen.findByText(/I don't have information about that/);

      expect(screen.queryByRole("button", { name: /^Source \d/ })).toBeNull();
      expect(screen.queryByText("Sources")).toBeNull();
    });

    // AC-106: a marker the model printed that does not correspond to any
    // retrieved chunk is not rendered as a clickable citation -- but the
    // rest of the answer, including that literal marker text, still shows.
    it("renders an unresolvable marker as plain text, not a clickable citation, while the rest of the answer still displays", async () => {
      mocked.listConversations.mockResolvedValue([
        { id: "conv-1", title: "Contract term", updated_at: new Date().toISOString() },
      ]);
      mocked.getConversation.mockResolvedValue({
        id: "conv-1",
        title: "Contract term",
        messages: [
          { id: "msg-1", role: "user", content: "What is the contract term?", citations: [] },
          {
            id: "msg-2",
            role: "assistant",
            // citations below only resolves marker 1 -- [2] was never part
            // of the retrieved context and has no matching citation entry.
            content: "The term is twelve months [1]. Renewal is automatic [2].",
            citations: [CITATION],
          },
        ],
      });

      renderScreen();
      await screen.findByText(/The term is twelve months/);

      // The full answer text, including the unresolvable "[2]", is shown.
      expect(screen.getByText(/Renewal is automatic/)).toBeInTheDocument();
      expect(screen.getByText(/\[2\]/)).toBeInTheDocument();

      // Marker 1 is a real, clickable citation; marker 2 is not.
      expect(
        screen.getByRole("button", { name: /Source 1: Acme MSA v4\.pdf/i }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Source 2:/i })).toBeNull();

      // The unresolvable "[2]" is not itself a button of any kind.
      const danglingMarker = screen.getByText("[2]");
      expect(danglingMarker.closest("button")).toBeNull();
    });
  });

  describe("citation panel: navigation, scroll, focus (AC-107..110)", () => {
    const CITATION_2: CitationItem = {
      marker: 2,
      document_id: "doc-2",
      filename: "Support SLA.pdf",
      format: "PDF",
      location_label: "Page 1",
      snapshot_text: "A receipt is required for a refund.",
    };

    function mockConversationWithTwoSources() {
      mocked.listConversations.mockResolvedValue([
        { id: "conv-1", title: "Refunds", updated_at: new Date().toISOString() },
      ]);
      mocked.getConversation.mockResolvedValue({
        id: "conv-1",
        title: "Refunds",
        messages: [
          { id: "msg-1", role: "user", content: "What is the refund policy?", citations: [] },
          {
            id: "msg-2",
            role: "assistant",
            content: "Refunds take 30 days [1], and a receipt is required [2].",
            citations: [CITATION, CITATION_2],
          },
        ],
      });
    }

    it("lets the user move between several sources on one answer without closing the panel (AC-108)", async () => {
      mockConversationWithTwoSources();
      renderScreen();
      await screen.findByText(/Refunds take 30 days/);

      const marker1 = await screen.findByRole("button", { name: /Source 1: Acme MSA v4\.pdf/i });
      await userEvent.click(marker1);
      let panel = screen.getByRole("region", { name: "Cited source" });
      expect(within(panel).getByText("Acme MSA v4.pdf")).toBeInTheDocument();

      await userEvent.click(within(panel).getByRole("button", { name: "Source 2" }));
      panel = screen.getByRole("region", { name: "Cited source" });
      expect(within(panel).getByText("Support SLA.pdf")).toBeInTheDocument();
      expect(within(panel).getByText("A receipt is required for a refund.")).toBeInTheDocument();

      await userEvent.click(within(panel).getByRole("button", { name: "Source 1" }));
      panel = screen.getByRole("region", { name: "Cited source" });
      expect(within(panel).getByText("Acme MSA v4.pdf")).toBeInTheDocument();
    });

    it("returns focus to the marker and leaves conversation scroll position unchanged on close, without re-triggering autoscroll (AC-109)", async () => {
      mockConversationWithTwoSources();
      renderScreen();
      await screen.findByText(/Refunds take 30 days/);

      const thread = screen.getByText("Conversation", { selector: "h2" }).parentElement!;
      Object.defineProperty(thread, "scrollHeight", { value: 2000, configurable: true });
      thread.scrollTop = 450;

      const marker1 = await screen.findByRole("button", { name: /Source 1: Acme MSA v4\.pdf/i });
      await userEvent.click(marker1);
      expect(thread.scrollTop).toBe(450);

      const panel = screen.getByRole("region", { name: "Cited source" });
      await userEvent.click(within(panel).getByRole("button", { name: "Close source panel" }));

      expect(screen.queryByRole("region", { name: "Cited source" })).toBeNull();
      expect(thread.scrollTop).toBe(450);
      expect(marker1).toHaveFocus();
    });

    it("shows the same document name, location and chunk text from GET /conversations/{id} citations on reopen (AC-110)", async () => {
      mockConversationWithTwoSources();
      renderScreen();
      await screen.findByText(/Refunds take 30 days/);

      const marker2 = await screen.findByRole("button", { name: /Source 2: Support SLA\.pdf/i });
      await userEvent.click(marker2);
      const panel = screen.getByRole("region", { name: "Cited source" });
      expect(within(panel).getByText("Support SLA.pdf")).toBeInTheDocument();
      expect(within(panel).getByText("Page 1")).toBeInTheDocument();
      expect(within(panel).getByText("A receipt is required for a refund.")).toBeInTheDocument();
    });
  });

  describe("citation panel: download original (AC-111, AC-113)", () => {
    function mockSingleCitationConversation(citation: CitationItem) {
      mocked.listConversations.mockResolvedValue([
        { id: "conv-1", title: "Retention periods", updated_at: new Date().toISOString() },
      ]);
      mocked.getConversation.mockResolvedValue({
        id: "conv-1",
        title: "Retention periods",
        messages: [
          { id: "msg-1", role: "user", content: "What is the retention period?", citations: [] },
          {
            id: "msg-2",
            role: "assistant",
            content: "Thirty days [1].",
            citations: [citation],
          },
        ],
      });
    }

    it("fetches the presigned URL and navigates to it so the browser saves the original file (AC-111)", async () => {
      mockSingleCitationConversation(CITATION);
      mocked.getDocumentDownloadUrl.mockResolvedValue({
        url: "https://example-bucket.s3.amazonaws.com/doc-1?sig=abc",
      });
      const clickSpy = vi
        .spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(() => {});

      renderScreen();
      const marker = await screen.findByRole("button", { name: /Source 1: Acme MSA v4\.pdf/i });
      await userEvent.click(marker);

      await userEvent.click(screen.getByRole("button", { name: "Download original" }));

      await waitFor(() => expect(mocked.getDocumentDownloadUrl).toHaveBeenCalledWith("doc-1"));
      await waitFor(() => expect(clickSpy).toHaveBeenCalled());
      await waitFor(() =>
        expect(
          screen.getAllByText(/Download started for Acme MSA v4\.pdf/).length,
        ).toBeGreaterThan(0),
      );

      clickSpy.mockRestore();
    });

    it("shows an unavailable message and disables download when the citation's deleted flag is true (AC-113)", async () => {
      mockSingleCitationConversation({ ...CITATION, deleted: true });
      renderScreen();
      const marker = await screen.findByRole("button", { name: /Source 1: Acme MSA v4\.pdf/i });
      await userEvent.click(marker);

      const panel = screen.getByRole("region", { name: "Cited source" });
      expect(within(panel).getByText(/no longer available to download/i)).toBeInTheDocument();
      expect(
        within(panel).getByRole("button", { name: "Original unavailable" }),
      ).toBeDisabled();
    });

    it("shows an in-panel unavailable message and disables download on a 410 response (AC-113)", async () => {
      mockSingleCitationConversation(CITATION);
      mocked.getDocumentDownloadUrl.mockRejectedValue(
        new Error("GET /documents/doc-1/download failed: 410"),
      );

      renderScreen();
      const marker = await screen.findByRole("button", { name: /Source 1: Acme MSA v4\.pdf/i });
      await userEvent.click(marker);

      await userEvent.click(screen.getByRole("button", { name: "Download original" }));

      const panel = screen.getByRole("region", { name: "Cited source" });
      await waitFor(() =>
        expect(
          within(panel).getAllByText(/removed from the library and cannot be downloaded/i).length,
        ).toBeGreaterThan(0),
      );
      expect(
        within(panel).getByRole("button", { name: "Original unavailable" }),
      ).toBeDisabled();
    });

    it("shows an in-panel error, never a silent no-op, on an unauthorised or failed download", async () => {
      mockSingleCitationConversation(CITATION);
      mocked.getDocumentDownloadUrl.mockRejectedValue(
        new Error("GET /documents/doc-1/download failed: 403"),
      );

      renderScreen();
      const marker = await screen.findByRole("button", { name: /Source 1: Acme MSA v4\.pdf/i });
      await userEvent.click(marker);

      await userEvent.click(screen.getByRole("button", { name: "Download original" }));

      const panel = screen.getByRole("region", { name: "Cited source" });
      await waitFor(() =>
        expect(
          within(panel).getAllByText(/not authorised to download this file/i).length,
        ).toBeGreaterThan(0),
      );
      expect(screen.getByRole("button", { name: "Download original" })).toBeInTheDocument();
    });
  });
});
