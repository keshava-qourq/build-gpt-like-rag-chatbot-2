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
  };
});

const mocked = api as unknown as {
  listConversations: ReturnType<typeof vi.fn>;
  createConversation: ReturnType<typeof vi.fn>;
  getConversation: ReturnType<typeof vi.fn>;
  renameConversation: ReturnType<typeof vi.fn>;
  deleteConversation: ReturnType<typeof vi.fn>;
  streamAssistantMessage: ReturnType<typeof vi.fn>;
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
    expect(
      await screen.findByText(/No conversations yet\. Start a new chat/i),
    ).toBeInTheDocument();
  });

  it("shows an error state with retry when the conversation list fails to load", async () => {
    mocked.listConversations.mockRejectedValueOnce(new Error("network down"));
    renderScreen();
    expect(
      await screen.findByText(/Could not load your conversations/i),
    ).toBeInTheDocument();
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

    await waitFor(() => expect(screen.getAllByText("Hello there").length).toBeGreaterThan(1));
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
});
