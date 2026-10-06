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
});
