import React from "react";

import * as UI from "@/lib/ui";
import { Icons } from "@/lib/icons";
import { brand } from "@/lib/brand";
import { useNavigate } from "@/lib/navigate";
import {
  listConversations,
  createConversation,
  getConversation,
  renameConversation,
  deleteConversation,
  streamAssistantMessage,
  type ConversationSummaryDTO,
  type CitationItem,
} from "@/lib/api";

const { Button, Input, Textarea, Label, Badge, Table, THead, TBody, TR, TH, TD } = UI;
const {
  Plus,
  Search,
  Check,
  X,
  ChevronRight,
  Menu,
  FileText,
  Package,
  Clock,
  Trash,
  Edit,
  Download,
  ArrowRight,
  AlertCircle,
  CheckCircle,
} = Icons;

const BORDER = "#E3DCCC";
const SURFACE = "#FFFFFF";
const SIDEBAR_BG = "#FBF9F4";
const RING =
  "focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#1B5240] focus-visible:ring-offset-[#FBF9F4]";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const SUGGESTIONS = [
  "What credit applies to a Priority 1 outage over four hours?",
  "Who is paged after hours for a Sev 1?",
  "Which subprocessors are in scope for customer content?",
];

type MessageStatus = "complete" | "streaming" | "stopped" | "error";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: MessageStatus;
  created_at: string | null;
  citations: CitationItem[];
}

interface SourceRef {
  messageId: string;
  marker: number;
}

const formatDate = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
};

const highlightCode = (line: string, key: number) => {
  const parts = line.split(/("[^"]*"|'[^']*'|#.*$)/g).filter((p) => p !== "");
  return (
    <span key={key}>
      {parts.map((p, i) => {
        if (p.startsWith("#"))
          return (
            <span key={i} style={{ color: "#8A8275" }}>
              {p}
            </span>
          );
        if (p.startsWith('"') || p.startsWith("'"))
          return (
            <span key={i} style={{ color: "#C1761A" }}>
              {p}
            </span>
          );
        return <span key={i}>{p}</span>;
      })}
      {"\n"}
    </span>
  );
};

const CodeBlock = (props: { lang?: string; code: string }) => {
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    if (!copied) return undefined;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);
  const copy = () => {
    try {
      if (navigator.clipboard) navigator.clipboard.writeText(props.code);
    } catch {
      /* clipboard unavailable in sandbox */
    }
    setCopied(true);
  };
  return (
    <div
      className="my-4 overflow-hidden rounded-md border"
      style={{ borderColor: BORDER, backgroundColor: "#FCFAF5" }}
    >
      <div
        className="flex items-center justify-between border-b px-3 py-1.5"
        style={{ borderColor: BORDER }}
      >
        <span className="font-mono text-xs" style={{ color: "#6E675B" }}>
          {props.lang || "code"}
        </span>
        <button
          type="button"
          onClick={copy}
          className={
            "inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium hover:bg-black/5 " +
            RING
          }
          style={{ color: "#1B5240" }}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <FileText className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {copied ? "Copied" : "Copy code"}
        </button>
      </div>
      <pre className="overflow-x-auto px-3 py-3 text-[13px] leading-6">
        <code className="font-mono">
          {props.code.split("\n").map((l, i) => highlightCode(l, i))}
        </code>
      </pre>
    </div>
  );
};

export default function Screen() {
  const navigate = useNavigate();
  const [conversations, setConversations] = React.useState<ConversationSummaryDTO[]>([]);
  const [conversationsLoading, setConversationsLoading] = React.useState(true);
  const [conversationsError, setConversationsError] = React.useState<string | null>(null);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = React.useState(false);
  const [messagesError, setMessagesError] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");
  const [draft, setDraft] = React.useState("");
  const [renameFor, setRenameFor] = React.useState<string | null>(null);
  const [renameValue, setRenameValue] = React.useState("");
  const [deleteFor, setDeleteFor] = React.useState<string | null>(null);
  const [streamingMsgId, setStreamingMsgId] = React.useState<string | null>(null);
  const [source, setSource] = React.useState<SourceRef | null>(null);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);
  const [downloadNote, setDownloadNote] = React.useState("");
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [announce, setAnnounce] = React.useState("");

  const idRef = React.useRef(0);
  const threadRef = React.useRef<HTMLDivElement | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const triggerRef = React.useRef<HTMLElement | null>(null);
  const composerRef = React.useRef<HTMLTextAreaElement | null>(null);
  const streamControllerRef = React.useRef<AbortController | null>(null);
  const pendingTitleRef = React.useRef<Set<string>>(new Set());

  const nextId = () => {
    idRef.current += 1;
    return "local-" + idRef.current;
  };

  const updateMessage = (id: string, patch: Partial<ChatMessage>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  };

  const sortedConversations = [...conversations].sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
  );

  const filtered = sortedConversations.filter((c) =>
    (c.title ?? "Untitled conversation").toLowerCase().includes(search.trim().toLowerCase()),
  );

  const active = conversations.find((c) => c.id === activeId) || null;

  const selectConversation = React.useCallback(async (id: string) => {
    setActiveId(id);
    setSource(null);
    setSidebarOpen(false);
    setMessagesError(null);
    setMessagesLoading(true);
    try {
      const detail = await getConversation(id);
      setMessages(
        detail.messages.map((m, i) => ({
          id: "loaded-" + id + "-" + i,
          role: m.role,
          content: m.content,
          status: "complete",
          created_at: null,
          citations: m.citations ?? [],
        })),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      setMessages([]);
      if (/\b404\b/.test(message)) {
        // The conversation is gone or never belonged to this user. Do not
        // describe why -- just drop it from the list and return to a usable
        // new-chat view rather than leaking ownership details.
        setMessagesError(null);
        setConversations((prev) => prev.filter((c) => c.id !== id));
        setActiveId(null);
        setAnnounce("This conversation is no longer available.");
      } else {
        setMessagesError("Could not load this conversation. Check your connection and try again.");
      }
    } finally {
      setMessagesLoading(false);
    }
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      setConversationsLoading(true);
      setConversationsError(null);
      try {
        const list = await listConversations();
        if (cancelled) return;
        setConversations(list);
        if (list.length > 0) selectConversation(list[0].id);
      } catch {
        if (!cancelled)
          setConversationsError(
            "Could not load your conversations. Check your connection and try again.",
          );
      } finally {
        if (!cancelled) setConversationsLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [selectConversation]);

  React.useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [activeId, messages]);

  React.useEffect(() => {
    if (!copiedId) return undefined;
    const t = setTimeout(() => setCopiedId(null), 2000);
    return () => clearTimeout(t);
  }, [copiedId]);

  React.useEffect(() => {
    if (!downloadNote) return undefined;
    const t = setTimeout(() => setDownloadNote(""), 3500);
    return () => clearTimeout(t);
  }, [downloadNote]);

  React.useEffect(() => {
    return () => {
      if (streamControllerRef.current) streamControllerRef.current.abort();
    };
  }, []);

  const runStream = React.useCallback(
    async (convId: string, assistantMsgId: string, questionText: string) => {
      const controller = new AbortController();
      streamControllerRef.current = controller;
      setStreamingMsgId(assistantMsgId);
      updateMessage(assistantMsgId, { status: "streaming", content: "", citations: [] });
      let accumulated = "";
      let hadError = false;
      try {
        await streamAssistantMessage(
          convId,
          questionText,
          (event) => {
            if (event.type === "token") {
              accumulated += event.token;
              updateMessage(assistantMsgId, { content: accumulated });
            } else if (event.type === "citations") {
              updateMessage(assistantMsgId, { citations: event.citations, status: "complete" });
              setAnnounce(
                "Answer complete with " +
                  event.citations.length +
                  (event.citations.length === 1 ? " source." : " sources."),
              );
            } else if (event.type === "error") {
              hadError = true;
              updateMessage(assistantMsgId, { status: "error" });
              setAnnounce("The answer stream failed. " + event.message);
            }
          },
          controller.signal,
        );
        if (!hadError && pendingTitleRef.current.has(convId)) {
          // The first answer for this conversation completed. The server
          // generates the title from the exchange, so refresh the list now
          // to replace the placeholder with it rather than ever PATCHing a
          // client-truncated title ourselves.
          pendingTitleRef.current.delete(convId);
          listConversations()
            .then((list) => setConversations(list))
            .catch(() => {
              /* title refresh is best-effort; the placeholder stays */
            });
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          updateMessage(assistantMsgId, { status: "stopped" });
          setAnnounce("Streaming stopped. The partial answer was kept.");
        } else {
          updateMessage(assistantMsgId, { status: "error" });
          setAnnounce("The answer stream was interrupted. Check your connection and try again.");
        }
      } finally {
        streamControllerRef.current = null;
        setStreamingMsgId((current) => (current === assistantMsgId ? null : current));
      }
    },
    [],
  );

  const handleSend = async (text?: string) => {
    const q = (text === undefined ? draft : text).trim();
    if (!q || streamingMsgId) return;
    setDraft("");

    const userMsg: ChatMessage = {
      id: nextId(),
      role: "user",
      content: q,
      status: "complete",
      created_at: "Just now",
      citations: [],
    };
    const assistantId = nextId();
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      status: "streaming",
      created_at: "Just now",
      citations: [],
    };

    let convId = activeId;
    if (!convId) {
      try {
        const created = await createConversation();
        convId = created.id;
      } catch {
        setAnnounce("Could not start a new conversation. Check your connection and try again.");
        setDraft(q);
        return;
      }
      pendingTitleRef.current.add(convId);
      setConversations((prev) => [
        { id: convId as string, title: null, updated_at: new Date().toISOString() },
        ...prev,
      ]);
      setActiveId(convId);
      setMessages([userMsg, assistantMsg]);
    } else {
      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setConversations((prev) => {
        const target = prev.find((c) => c.id === convId);
        if (!target) return prev;
        const rest = prev.filter((c) => c.id !== convId);
        return [{ ...target, updated_at: new Date().toISOString() }, ...rest];
      });
    }

    runStream(convId, assistantId, q);
  };

  const handleStop = () => {
    if (streamControllerRef.current) streamControllerRef.current.abort();
  };

  const retry = (msgId: string) => {
    if (!activeId || streamingMsgId) return;
    const idx = messages.findIndex((m) => m.id === msgId);
    const question = idx > 0 ? messages[idx - 1] : null;
    if (!question) return;
    setSource(null);
    runStream(activeId, msgId, question.content);
  };

  const copyAnswer = (msg: ChatMessage) => {
    try {
      if (navigator.clipboard) navigator.clipboard.writeText(msg.content);
    } catch {
      /* clipboard unavailable in sandbox */
    }
    setCopiedId(msg.id);
    setAnnounce("Answer copied to the clipboard.");
  };

  const openSource = (msgId: string, marker: number, el: HTMLElement | null) => {
    triggerRef.current = el;
    setSource({ messageId: msgId, marker });
    setDownloadNote("");
  };

  const closeSource = () => {
    setSource(null);
    const el = triggerRef.current;
    if (el && document.contains(el)) el.focus();
  };

  React.useEffect(() => {
    if (source && panelRef.current) panelRef.current.focus();
  }, [source ? source.messageId + ":" + source.marker : null]);

  const sourceMessage = source ? messages.find((m) => m.id === source.messageId) : null;
  const sourceList = sourceMessage ? sourceMessage.citations : [];
  const currentSource =
    sourceList.find((c) => c.marker === (source && source.marker)) || sourceList[0];

  const startNewChat = () => {
    setActiveId(null);
    setMessages([]);
    setMessagesError(null);
    setSource(null);
    setDraft("");
    setSidebarOpen(false);
    setAnnounce("New chat started.");
    if (composerRef.current) composerRef.current.focus();
  };

  const commitRename = async (convId: string) => {
    const value = renameValue.trim();
    setRenameFor(null);
    if (!value) return;
    try {
      await renameConversation(convId, value);
      setConversations((prev) => prev.map((c) => (c.id === convId ? { ...c, title: value } : c)));
      setAnnounce("Conversation renamed to " + value + ".");
    } catch {
      setAnnounce("Could not rename the conversation. Check your connection and try again.");
    }
  };

  const confirmDelete = async (convId: string) => {
    try {
      await deleteConversation(convId);
      setConversations((prev) => prev.filter((c) => c.id !== convId));
      setDeleteFor(null);
      if (activeId === convId) {
        setActiveId(null);
        setMessages([]);
        setMessagesError(null);
        setSource(null);
      }
      setAnnounce("Conversation deleted.");
    } catch {
      setDeleteFor(null);
      setAnnounce("Could not delete the conversation. Check your connection and try again.");
    }
  };

  // ---- markdown rendering ----

  const renderInline = (
    text: string,
    citations: CitationItem[],
    msgId: string,
    keyBase: string,
  ) => {
    const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[\d{1,2}\])/g);
    return parts
      .filter((p) => p !== "")
      .map((part, i) => {
        const key = keyBase + "-" + i;
        if (/^\*\*[^*]+\*\*$/.test(part))
          return (
            <strong key={key} className="font-semibold">
              {part.slice(2, -2)}
            </strong>
          );
        if (/^`[^`]+`$/.test(part))
          return (
            <code
              key={key}
              className="rounded px-1 py-0.5 font-mono text-[0.86em]"
              style={{ backgroundColor: "#F1EDE2", color: "#3A3630" }}
            >
              {part.slice(1, -1)}
            </code>
          );
        const m = /^\[(\d{1,2})\]$/.exec(part);
        if (m) {
          const marker = parseInt(m[1], 10);
          const found = (citations || []).find((c) => c.marker === marker);
          if (!found) return <span key={key}>{part}</span>;
          const isOpen = source && source.messageId === msgId && source.marker === marker;
          return (
            <button
              key={key}
              type="button"
              onClick={(e) => openSource(msgId, marker, e.currentTarget)}
              aria-label={
                "Source " + marker + ": " + found.filename + ", " + (found.location_label ?? "")
              }
              className={
                "mx-0.5 inline-flex h-[1.15rem] min-w-[1.15rem] translate-y-[-1px] items-center justify-center rounded border px-1 align-baseline text-[11px] font-semibold leading-none hover:bg-[#C1761A] hover:text-white " +
                RING
              }
              style={{
                borderColor: "#C1761A",
                color: isOpen ? "#FFFFFF" : "#8A5312",
                backgroundColor: isOpen ? "#C1761A" : "#FAF1E4",
              }}
            >
              {marker}
            </button>
          );
        }
        return <span key={key}>{part}</span>;
      });
  };

  const renderMarkdown = (content: string, citations: CitationItem[], msgId: string) => {
    const lines = content.split("\n");
    const blocks: React.ReactNode[] = [];
    let i = 0;
    let k = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (line.trim() === "") {
        i += 1;
        continue;
      }
      if (line.trim().startsWith("```")) {
        const lang = line.trim().slice(3).trim();
        const code: string[] = [];
        i += 1;
        while (i < lines.length && !lines[i].trim().startsWith("```")) {
          code.push(lines[i]);
          i += 1;
        }
        i += 1;
        blocks.push(<CodeBlock key={"c" + k++} lang={lang} code={code.join("\n")} />);
        continue;
      }
      const h = /^(#{1,4})\s+(.*)$/.exec(line);
      if (h) {
        const level = h[1].length;
        const Tag = level <= 2 ? "h3" : "h4";
        blocks.push(
          <Tag
            key={"h" + k++}
            className="mb-2 mt-5 text-[0.95rem] font-semibold tracking-tight first:mt-0"
            style={{ color: "#2B2822", fontFamily: brand.fontHeading }}
          >
            {renderInline(h[2], citations, msgId, "h" + k)}
          </Tag>,
        );
        i += 1;
        continue;
      }
      if (
        line.trim().startsWith("|") &&
        i + 1 < lines.length &&
        /^\|[\s:|-]+\|$/.test(lines[i + 1].trim())
      ) {
        const rows: string[] = [];
        while (i < lines.length && lines[i].trim().startsWith("|")) {
          rows.push(lines[i].trim());
          i += 1;
        }
        const cells = (row: string) =>
          row
            .slice(1, row.endsWith("|") ? -1 : undefined)
            .split("|")
            .map((c) => c.trim());
        const header = cells(rows[0]);
        const body = rows.slice(2).map(cells);
        blocks.push(
          <div key={"t" + k++} className="my-4 overflow-x-auto">
            <Table>
              <THead>
                <TR>
                  {header.map((cell, ci) => (
                    <TH key={ci}>{cell}</TH>
                  ))}
                </TR>
              </THead>
              <TBody>
                {body.map((row, ri) => (
                  <TR key={ri}>
                    {row.map((cell, ci) => (
                      <TD key={ci}>{renderInline(cell, citations, msgId, "td" + ri + ci)}</TD>
                    ))}
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>,
        );
        continue;
      }
      if (/^[-*]\s+/.test(line.trim())) {
        const items: string[] = [];
        while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
          items.push(lines[i].trim().replace(/^[-*]\s+/, ""));
          i += 1;
        }
        blocks.push(
          <ul key={"u" + k++} className="my-3 space-y-1.5 pl-5">
            {items.map((it, ii) => (
              <li key={ii} className="list-disc pl-1 marker:text-[#A79C88]">
                {renderInline(it, citations, msgId, "li" + k + ii)}
              </li>
            ))}
          </ul>,
        );
        continue;
      }
      if (/^\d+\.\s+/.test(line.trim())) {
        const items: string[] = [];
        while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
          items.push(lines[i].trim().replace(/^\d+\.\s+/, ""));
          i += 1;
        }
        blocks.push(
          <ol key={"o" + k++} className="my-3 space-y-1.5 pl-5">
            {items.map((it, ii) => (
              <li key={ii} className="list-decimal pl-1 marker:text-[#A79C88]">
                {renderInline(it, citations, msgId, "ol" + k + ii)}
              </li>
            ))}
          </ol>,
        );
        continue;
      }
      const para: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim() !== "" &&
        !lines[i].trim().startsWith("```") &&
        !lines[i].trim().startsWith("|") &&
        !/^(#{1,4})\s/.test(lines[i]) &&
        !/^[-*]\s+/.test(lines[i].trim()) &&
        !/^\d+\.\s+/.test(lines[i].trim())
      ) {
        para.push(lines[i]);
        i += 1;
      }
      blocks.push(
        <p key={"p" + k++} className="my-3 leading-7 first:mt-0">
          {renderInline(para.join(" "), citations, msgId, "p" + k)}
        </p>,
      );
    }
    return blocks;
  };

  const lastAssistantId = (() => {
    for (let n = messages.length - 1; n >= 0; n -= 1) {
      if (messages[n].role === "assistant") return messages[n].id;
    }
    return null;
  })();

  const statusLabel = (msg: ChatMessage) => {
    if (msg.status === "streaming") return { text: "Streaming", icon: Clock, color: "#6E675B" };
    if (msg.status === "stopped") return { text: "Stopped", icon: X, color: "#8A5312" };
    if (msg.status === "error")
      return { text: "Stream failed", icon: AlertCircle, color: "#9B3B2F" };
    return null;
  };

  const sidebarBody = (
    <div className="flex h-full flex-col">
      <div className="px-4 pb-3 pt-4">
        <Button
          onClick={startNewChat}
          className={"w-full justify-center " + RING}
          style={{ backgroundColor: brand.primaryColor, color: "#FFFFFF" }}
        >
          <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
          New chat
        </Button>
      </div>
      <div className="px-4 pb-3">
        <Label htmlFor="conv-search" className="sr-only">
          Search conversations
        </Label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2"
            style={{ color: "#8D8576" }}
            aria-hidden="true"
          />
          <Input
            id="conv-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search conversations"
            className={"pl-8 " + RING}
          />
        </div>
      </div>
      <h2
        className="px-4 pb-2 text-[11px] font-semibold uppercase tracking-wider"
        style={{ color: "#8D8576", fontFamily: brand.fontHeading }}
      >
        Your conversations
      </h2>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {conversationsLoading ? (
          <p className="px-2 py-6 text-sm leading-6" style={{ color: "#6E675B" }}>
            Loading conversations…
          </p>
        ) : conversationsError ? (
          <div className="px-2 py-6">
            <p className="text-sm leading-6" style={{ color: "#9B3B2F" }}>
              {conversationsError}
            </p>
            <Button
              variant="outline"
              onClick={() => {
                setConversationsError(null);
                listConversations()
                  .then((list) => {
                    setConversations(list);
                    if (list.length > 0 && !activeId) selectConversation(list[0].id);
                  })
                  .catch(() =>
                    setConversationsError(
                      "Could not load your conversations. Check your connection and try again.",
                    ),
                  );
              }}
              className={"mt-2 h-8 px-3 text-xs " + RING}
            >
              Try again
            </Button>
          </div>
        ) : conversations.length === 0 ? (
          <p className="px-2 py-6 text-sm leading-6" style={{ color: "#6E675B" }}>
            No conversations yet. Start a new chat to ask your first question of the shared library.
          </p>
        ) : filtered.length === 0 ? (
          <p className="px-2 py-6 text-sm leading-6" style={{ color: "#6E675B" }}>
            No conversations match “{search.trim()}”.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {filtered.map((conv) => {
              const isActive = conv.id === activeId;
              const title = conv.title ?? "Untitled conversation";
              if (renameFor === conv.id) {
                return (
                  <li key={conv.id} className="rounded-md bg-white p-2 shadow-sm">
                    <Label
                      htmlFor={"rename-" + conv.id}
                      className="mb-1 block text-xs font-medium"
                      style={{ color: "#6E675B" }}
                    >
                      Conversation title
                    </Label>
                    <Input
                      id={"rename-" + conv.id}
                      value={renameValue}
                      autoFocus
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitRename(conv.id);
                        }
                        if (e.key === "Escape") setRenameFor(null);
                      }}
                      className={RING}
                    />
                    <div className="mt-2 flex gap-2">
                      <Button
                        onClick={() => commitRename(conv.id)}
                        className={"h-8 px-3 text-xs " + RING}
                        style={{ backgroundColor: brand.primaryColor, color: "#fff" }}
                      >
                        Save
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => setRenameFor(null)}
                        className={"h-8 px-3 text-xs " + RING}
                      >
                        Cancel
                      </Button>
                    </div>
                  </li>
                );
              }
              if (deleteFor === conv.id) {
                return (
                  <li key={conv.id} className="rounded-md bg-white p-3 shadow-sm">
                    <p className="text-xs leading-5" style={{ color: "#3A3630" }}>
                      Delete “{title}”? Its messages are removed. Documents in the library are not
                      affected.
                    </p>
                    <div className="mt-2 flex gap-2">
                      <Button
                        onClick={() => confirmDelete(conv.id)}
                        className={"h-8 px-3 text-xs " + RING}
                        style={{ backgroundColor: "#9B3B2F", color: "#fff" }}
                      >
                        Delete
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => setDeleteFor(null)}
                        className={"h-8 px-3 text-xs " + RING}
                      >
                        Cancel
                      </Button>
                    </div>
                  </li>
                );
              }
              return (
                <li key={conv.id} className="group relative">
                  <div
                    className="flex items-center gap-1 rounded-md pr-1"
                    style={{
                      backgroundColor: isActive ? "#EDE8DB" : "transparent",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => selectConversation(conv.id)}
                      aria-current={isActive ? "true" : undefined}
                      className={
                        "min-w-0 flex-1 rounded-md px-2.5 py-2 text-left hover:bg-black/[0.04] " +
                        RING
                      }
                    >
                      <span
                        className="block truncate text-[13px] font-medium"
                        style={{ color: isActive ? "#1B5240" : "#3A3630" }}
                      >
                        {title}
                      </span>
                      <span className="mt-0.5 block text-[11px]" style={{ color: "#8D8576" }}>
                        {formatDate(conv.updated_at)}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRenameValue(title);
                        setDeleteFor(null);
                        setRenameFor(conv.id);
                      }}
                      aria-label={'Rename conversation "' + title + '"'}
                      className={
                        "rounded p-1.5 opacity-0 hover:bg-black/[0.06] focus:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 " +
                        RING
                      }
                      style={{ color: "#6E675B" }}
                    >
                      <Edit className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRenameFor(null);
                        setDeleteFor(conv.id);
                      }}
                      aria-label={'Delete conversation "' + title + '"'}
                      className={
                        "rounded p-1.5 opacity-0 hover:bg-black/[0.06] focus:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 " +
                        RING
                      }
                      style={{ color: "#6E675B" }}
                    >
                      <Trash className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="border-t px-4 py-3" style={{ borderColor: BORDER }}>
        <button
          type="button"
          onClick={() => navigate("library")}
          className={
            "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[13px] hover:bg-black/[0.04] " +
            RING
          }
          style={{ color: "#3A3630" }}
        >
          <Package className="h-4 w-4" aria-hidden="true" />
          Document library
          <ChevronRight
            className="ml-auto h-4 w-4"
            style={{ color: "#8D8576" }}
            aria-hidden="true"
          />
        </button>
        <button
          type="button"
          onClick={() => navigate("help")}
          className={
            "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[13px] hover:bg-black/[0.04] " +
            RING
          }
          style={{ color: "#3A3630" }}
        >
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          Help and limitations
          <ChevronRight
            className="ml-auto h-4 w-4"
            style={{ color: "#8D8576" }}
            aria-hidden="true"
          />
        </button>
      </div>
    </div>
  );

  return (
    <div
      className="relative flex h-[80vh] min-h-[600px] overflow-hidden rounded-lg border"
      style={{
        borderColor: BORDER,
        backgroundColor: SURFACE,
        fontFamily: brand.fontBody,
      }}
    >
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>

      {/* Sidebar, desktop */}
      <aside
        aria-label="Conversations"
        className="hidden w-72 shrink-0 border-r lg:block"
        style={{ borderColor: BORDER, backgroundColor: SIDEBAR_BG }}
      >
        {sidebarBody}
      </aside>

      {/* Sidebar, narrow screens */}
      {sidebarOpen ? (
        <div className="absolute inset-0 z-30 lg:hidden">
          <button
            type="button"
            aria-label="Close conversations list"
            onClick={() => setSidebarOpen(false)}
            className="absolute inset-0 bg-black/30"
          />
          <div
            role="dialog"
            aria-label="Conversations"
            onKeyDown={(e) => {
              if (e.key === "Escape") setSidebarOpen(false);
            }}
            className="absolute inset-y-0 left-0 w-[19rem] border-r shadow-xl"
            style={{ borderColor: BORDER, backgroundColor: SIDEBAR_BG }}
          >
            <div className="flex justify-end p-2">
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                aria-label="Close conversations list"
                className={"rounded p-1.5 hover:bg-black/[0.06] " + RING}
                style={{ color: "#3A3630" }}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="h-[calc(100%-2.75rem)]">{sidebarBody}</div>
          </div>
        </div>
      ) : null}

      {/* Thread */}
      <main className="flex min-w-0 flex-1 flex-col">
        <header
          className="flex items-start gap-3 border-b px-5 py-4 sm:px-8"
          style={{ borderColor: BORDER }}
        >
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open conversations list"
            className={"mt-0.5 rounded p-1.5 hover:bg-black/[0.06] lg:hidden " + RING}
            style={{ color: "#3A3630" }}
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
          <div className="min-w-0 flex-1">
            <h1
              className="truncate text-[1.35rem] font-semibold tracking-tight"
              style={{ color: "#231F1A", fontFamily: brand.fontHeading }}
            >
              {activeId
                ? active
                  ? (active.title ?? "Untitled conversation")
                  : "Untitled conversation"
                : "New chat"}
            </h1>
            <p className="mt-1 text-[13px]" style={{ color: "#6E675B" }}>
              {activeId
                ? (active ? formatDate(active.updated_at) + " · " : "") +
                  messages.length +
                  " messages · answers drawn only from the shared library"
                : "Answers are drawn only from documents uploaded to the shared library."}
            </p>
          </div>
          <Button
            variant="outline"
            onClick={startNewChat}
            className={"hidden shrink-0 sm:inline-flex " + RING}
          >
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
            New chat
          </Button>
        </header>

        <div
          ref={threadRef}
          className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8"
          style={{ backgroundColor: brand.backgroundColor }}
        >
          <h2 className="sr-only">Conversation</h2>
          {messagesLoading ? (
            <div className="mx-auto max-w-[44rem] pt-10 text-center">
              <p className="text-[15px]" style={{ color: "#6E675B" }}>
                Loading conversation…
              </p>
            </div>
          ) : messagesError ? (
            <div className="mx-auto max-w-[44rem] pt-10">
              <div className="rounded-lg border bg-white p-8" style={{ borderColor: "#E0C4BE" }}>
                <p className="text-[15px] leading-7" style={{ color: "#3A3630" }}>
                  {messagesError}
                </p>
                <Button
                  variant="outline"
                  onClick={() => activeId && selectConversation(activeId)}
                  className={"mt-3 " + RING}
                >
                  <ArrowRight className="mr-2 h-4 w-4" aria-hidden="true" />
                  Try again
                </Button>
              </div>
            </div>
          ) : !activeId || messages.length === 0 ? (
            <div className="mx-auto max-w-[44rem] pt-10">
              <div className="rounded-lg border bg-white p-8" style={{ borderColor: BORDER }}>
                <h3
                  className="text-base font-semibold"
                  style={{ color: "#231F1A", fontFamily: brand.fontHeading }}
                >
                  Ask a question of the shared library
                </h3>
                <p className="mt-2 max-w-prose text-[15px] leading-7" style={{ color: "#524C42" }}>
                  Every answer is built from passages retrieved out of the documents your team has
                  uploaded. If nothing relevant is found, you will be told so rather than given a
                  guess.
                </p>
                <ul className="mt-5 space-y-2">
                  {SUGGESTIONS.map((s) => (
                    <li key={s}>
                      <button
                        type="button"
                        onClick={() => handleSend(s)}
                        className={
                          "flex w-full items-center gap-2 rounded-md border px-3 py-2.5 text-left text-[14px] hover:bg-[#F7F4ED] " +
                          RING
                        }
                        style={{ borderColor: BORDER, color: "#3A3630" }}
                      >
                        <Search
                          className="h-4 w-4 shrink-0"
                          style={{ color: "#8D8576" }}
                          aria-hidden="true"
                        />
                        {s}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <ol className="mx-auto max-w-[44rem] space-y-8">
              {messages.map((msg) => {
                const st = statusLabel(msg);
                if (msg.role === "user") {
                  return (
                    <li key={msg.id} className="flex justify-end">
                      <div className="max-w-[90%]">
                        <p
                          className="mb-1 text-right text-[11px] font-medium uppercase tracking-wider"
                          style={{ color: "#8D8576" }}
                        >
                          You{msg.created_at ? " · " + msg.created_at : ""}
                        </p>
                        <div
                          className="rounded-lg px-4 py-3 text-[15px] leading-7"
                          style={{ backgroundColor: "#EDE8DB", color: "#2B2822" }}
                        >
                          {msg.content}
                        </div>
                      </div>
                    </li>
                  );
                }
                return (
                  <li key={msg.id}>
                    <div className="mb-2 flex items-center gap-2">
                      <span
                        className="inline-flex h-6 w-6 items-center justify-center rounded"
                        style={{ backgroundColor: brand.primaryColor }}
                        aria-hidden="true"
                      >
                        <FileText className="h-3.5 w-3.5 text-white" />
                      </span>
                      <span
                        className="text-[11px] font-medium uppercase tracking-wider"
                        style={{ color: "#8D8576" }}
                      >
                        Assistant{msg.created_at ? " · " + msg.created_at : ""}
                      </span>
                      {st ? (
                        <span
                          className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium"
                          style={{
                            borderColor: BORDER,
                            color: st.color,
                            backgroundColor: "#FFFFFF",
                          }}
                        >
                          <st.icon className="h-3 w-3" aria-hidden="true" />
                          {st.text}
                        </span>
                      ) : null}
                    </div>

                    {msg.status === "error" ? (
                      <div
                        className="rounded-lg border bg-white p-4"
                        style={{ borderColor: "#E0C4BE" }}
                      >
                        <p className="text-[15px] leading-7" style={{ color: "#3A3630" }}>
                          {msg.content
                            ? "The answer stream was interrupted. The partial text above was kept."
                            : "The answer stream was interrupted before any text arrived. Nothing was saved for this turn."}
                        </p>
                        <Button
                          variant="outline"
                          onClick={() => retry(msg.id)}
                          className={"mt-3 " + RING}
                        >
                          <ArrowRight className="mr-2 h-4 w-4" aria-hidden="true" />
                          Retry
                        </Button>
                      </div>
                    ) : (
                      <div className="text-[15px]" style={{ color: "#2B2822", maxWidth: "42rem" }}>
                        {renderMarkdown(msg.content, msg.citations, msg.id)}
                        {msg.status === "streaming" ? (
                          <span
                            className="ml-0.5 inline-block h-[1.05em] w-[2px] animate-pulse align-text-bottom"
                            style={{ backgroundColor: brand.accentColor }}
                            aria-hidden="true"
                          />
                        ) : null}
                      </div>
                    )}

                    {msg.citations && msg.citations.length > 0 && msg.status !== "streaming" ? (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span className="text-[12px]" style={{ color: "#8D8576" }}>
                          Sources
                        </span>
                        {msg.citations.map((c) => (
                          <button
                            key={c.marker}
                            type="button"
                            onClick={(e) => openSource(msg.id, c.marker, e.currentTarget)}
                            className={
                              "inline-flex max-w-[18rem] items-center gap-1.5 rounded-md border bg-white px-2 py-1 text-[12px] hover:bg-[#FAF1E4] " +
                              RING
                            }
                            style={{ borderColor: BORDER, color: "#3A3630" }}
                          >
                            <span className="font-semibold" style={{ color: "#8A5312" }}>
                              [{c.marker}]
                            </span>
                            <span className="truncate">{c.filename}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}

                    {msg.status === "complete" || msg.status === "stopped" ? (
                      <div className="mt-3 flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => copyAnswer(msg)}
                          className={
                            "inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] font-medium hover:bg-black/[0.05] " +
                            RING
                          }
                          style={{ color: "#524C42" }}
                        >
                          {copiedId === msg.id ? (
                            <CheckCircle className="h-3.5 w-3.5" aria-hidden="true" />
                          ) : (
                            <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                          )}
                          {copiedId === msg.id ? "Copied" : "Copy answer"}
                        </button>
                        {msg.id === lastAssistantId ? (
                          <button
                            type="button"
                            onClick={() => retry(msg.id)}
                            disabled={!!streamingMsgId}
                            className={
                              "inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] font-medium hover:bg-black/[0.05] disabled:opacity-40 " +
                              RING
                            }
                            style={{ color: "#524C42" }}
                          >
                            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                            Regenerate
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        <div
          className="border-t px-5 py-4 sm:px-8"
          style={{ borderColor: BORDER, backgroundColor: SURFACE }}
        >
          <form
            className="mx-auto max-w-[44rem]"
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
          >
            <Label htmlFor="question" className="sr-only">
              Ask a question of the uploaded documents
            </Label>
            <Textarea
              id="question"
              ref={composerRef}
              rows={2}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Ask a question of the uploaded documents"
              className={"resize-none " + RING}
              aria-describedby="composer-hint"
            />
            <div className="mt-2 flex items-center justify-between gap-3">
              <p id="composer-hint" className="text-[12px]" style={{ color: "#8D8576" }}>
                Enter to send, Shift and Enter for a new line. Answers come only from the shared
                library.
              </p>
              {streamingMsgId ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleStop}
                  className={"shrink-0 " + RING}
                >
                  <X className="mr-2 h-4 w-4" aria-hidden="true" />
                  Stop
                </Button>
              ) : (
                <Button
                  type="submit"
                  disabled={draft.trim() === ""}
                  className={"shrink-0 disabled:opacity-50 " + RING}
                  style={{ backgroundColor: brand.primaryColor, color: "#FFFFFF" }}
                >
                  <ArrowRight className="mr-2 h-4 w-4" aria-hidden="true" />
                  Send
                </Button>
              )}
            </div>
          </form>
        </div>
      </main>

      {/* Source panel */}
      {source && currentSource ? (
        <div className="absolute inset-0 z-20 lg:static lg:inset-auto lg:z-auto lg:flex lg:w-[24rem] lg:shrink-0">
          <button
            type="button"
            aria-label="Close source panel"
            onClick={closeSource}
            className="absolute inset-0 bg-black/30 lg:hidden"
          />
          <aside
            ref={panelRef}
            tabIndex={-1}
            role="region"
            aria-label="Cited source"
            onKeyDown={(e) => {
              if (e.key === "Escape") closeSource();
            }}
            className="absolute inset-y-0 right-0 flex w-full flex-col border-l shadow-xl outline-none sm:w-[24rem] lg:static lg:w-full lg:shadow-none"
            style={{ borderColor: BORDER, backgroundColor: SIDEBAR_BG }}
          >
            <div
              className="flex items-center justify-between border-b px-4 py-3"
              style={{ borderColor: BORDER }}
            >
              <h2
                className="text-sm font-semibold"
                style={{ color: "#231F1A", fontFamily: brand.fontHeading }}
              >
                Source [{currentSource.marker}]
              </h2>
              <button
                type="button"
                onClick={closeSource}
                aria-label="Close source panel"
                className={"rounded p-1.5 hover:bg-black/[0.06] " + RING}
                style={{ color: "#3A3630" }}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            {sourceList.length > 1 ? (
              <div
                className="flex flex-wrap gap-1.5 border-b px-4 py-3"
                style={{ borderColor: BORDER }}
              >
                <span className="sr-only" id="source-switch-label">
                  Sources used by this answer
                </span>
                {sourceList.map((c) => {
                  const selected = c.marker === currentSource.marker;
                  return (
                    <button
                      key={c.marker}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setSource({ messageId: source.messageId, marker: c.marker })}
                      className={"rounded-md border px-2.5 py-1 text-[12px] font-medium " + RING}
                      style={{
                        borderColor: selected ? brand.primaryColor : BORDER,
                        backgroundColor: selected ? brand.primaryColor : "#FFFFFF",
                        color: selected ? "#FFFFFF" : "#3A3630",
                      }}
                    >
                      Source {c.marker}
                    </button>
                  );
                })}
              </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              <h3
                className="text-[15px] font-semibold leading-6"
                style={{ color: "#231F1A", fontFamily: brand.fontHeading }}
              >
                {currentSource.filename}
              </h3>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {currentSource.format ? <Badge>{currentSource.format}</Badge> : null}
                <span className="text-[13px]" style={{ color: "#6E675B" }}>
                  {currentSource.location_label}
                </span>
              </div>

              {currentSource.deleted ? (
                <p
                  className="mt-4 rounded-md border px-3 py-2.5 text-[13px] leading-6"
                  style={{
                    borderColor: "#E0C4BE",
                    backgroundColor: "#FBF2F0",
                    color: "#7A3227",
                  }}
                >
                  <AlertCircle
                    className="mr-1.5 inline h-3.5 w-3.5 align-text-bottom"
                    aria-hidden="true"
                  />
                  This document has been removed from the library. The passage below is the copy
                  stored with the answer; the original file is no longer available to download.
                </p>
              ) : null}

              <h4
                className="mt-5 text-[11px] font-semibold uppercase tracking-wider"
                style={{ color: "#8D8576" }}
              >
                Retrieved passage
              </h4>
              <blockquote
                className="mt-2 whitespace-pre-wrap rounded-md border bg-white px-3 py-3 font-mono text-[12.5px] leading-6"
                style={{ borderColor: BORDER, color: "#3A3630" }}
              >
                {currentSource.snapshot_text}
              </blockquote>

              <p className="mt-3 text-[12px] leading-5" style={{ color: "#8D8576" }}>
                Shown exactly as retrieved, chunk {currentSource.marker} of {sourceList.length} used
                for this answer.
              </p>
            </div>

            <div className="border-t px-4 py-3" style={{ borderColor: BORDER }}>
              <p aria-live="polite" className="sr-only">
                {downloadNote}
              </p>
              {downloadNote ? (
                <p className="mb-2 text-[12px]" style={{ color: "#1B5240" }}>
                  <CheckCircle
                    className="mr-1 inline h-3.5 w-3.5 align-text-bottom"
                    aria-hidden="true"
                  />
                  {downloadNote}
                </p>
              ) : null}
              <Button
                variant="outline"
                disabled={currentSource.deleted}
                onClick={() => setDownloadNote("Downloading " + currentSource.filename)}
                className={"w-full justify-center disabled:opacity-50 " + RING}
              >
                <Download className="mr-2 h-4 w-4" aria-hidden="true" />
                {currentSource.deleted ? "Original unavailable" : "Download original"}
              </Button>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
