/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
/* eslint-disable @typescript-eslint/no-unused-vars */
import React from "react";

import * as UI from "@/lib/ui";
import { Icons } from "@/lib/icons";
import { brand } from "@/lib/brand";
import { useNavigate } from "@/lib/navigate";

const { Button, Input, Textarea, Label, Badge, Table, THead, TBody, TR, TH, TD } = UI;
const { Plus, Search, Check, X, ChevronRight, Menu, FileText, Package, Clock, Trash, Edit, Download, ArrowRight, AlertCircle, CheckCircle } = Icons;

const BORDER = "#E3DCCC";
const SURFACE = "#FFFFFF";
const SIDEBAR_BG = "#FBF9F4";
const RING =
  "focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#1B5240] focus-visible:ring-offset-[#FBF9F4]";

const REFUSAL =
  "I don't have information about that in the uploaded documents.";

const DOCS = {
  msa: { id: "doc_8f21", filename: "Acme MSA v4 (signed).pdf", format: "PDF" },
  sec: {
    id: "doc_44a0",
    filename: "Vendor Security Review 2026.pdf",
    format: "PDF",
  },
  sla: { id: "doc_91c7", filename: "Support SLA Matrix.csv", format: "CSV" },
  run: {
    id: "doc_2b55",
    filename: "Incident Response Runbook.md",
    format: "Markdown",
  },
  hb: {
    id: "doc_7e13",
    filename: "Employee Handbook 2026.docx",
    format: "DOCX",
  },
  gone: {
    id: "doc_0c90",
    filename: "Legacy Contracts 2019 (scanned).pdf",
    format: "PDF",
  },
};

const cite = (marker, doc, location_label, snapshot_text, deleted) => ({
  marker,
  document_id: doc.id,
  filename: doc.filename,
  format: doc.format,
  location_label,
  snapshot_text,
  deleted: !!deleted,
});

const ANSWER_RETENTION = {
  text:
    "Acme commits to three retention windows, all measured from the end of the subscription term.\n\n### Customer content\nProduction copies are deleted within **30 days** of termination unless an export is requested first [1].\n\n### Logs and telemetry\nOperational logs are kept for **13 months** on a rolling basis, then aggregated beyond recovery [1].\n\n### Backups\nEncrypted backups expire on their own schedule and are never rehydrated once a deletion request has been processed [2].\n\nThe uploaded documents do not state a retention period for support tickets, so that part of the question is not covered.",
  citations: [
    cite(
      1,
      DOCS.msa,
      "Pages 12-13",
      "9.4 Return and Deletion. Within thirty (30) days following expiry or termination of the Subscription Term, Acme shall delete all Customer Content held in production systems, save where Customer has requested an export under clause 9.3. Operational logs and telemetry derived from Customer Content are retained on a rolling thirteen (13) month basis and thereafter aggregated such that no individual record can be reconstructed."
    ),
    cite(
      2,
      DOCS.sec,
      "Page 7, section 4.2",
      "Encrypted backups are retained on the tiering schedule set out in Appendix B and expire automatically. Backups are not restored for the purpose of servicing a deletion request; deleted content is considered unrecoverable from the moment the production deletion job completes."
    ),
  ],
};

const ANSWER_BACKUPS = {
  text:
    "Backups follow a schedule of their own, separate from production deletion [1].\n\n| Backup tier | Frequency | Retention |\n| --- | --- | --- |\n| Hot snapshot | Every 4 hours | 7 days |\n| Daily full | Nightly 02:00 UTC | 35 days |\n| Archive | Weekly | 12 months |\n\nOnce a deletion request is processed, archives are **not** rehydrated and the twelve month archive simply ages out [2]. The uploaded documents do not say whether a customer can request earlier destruction of the archive tier.",
  citations: [
    cite(
      1,
      DOCS.sec,
      "Page 9, Appendix B",
      "Appendix B - Backup tiering. Hot snapshots are taken every four hours and retained for seven days. Daily full backups run at 02:00 UTC and are retained for thirty-five days. Weekly archive backups are written to cold storage and retained for twelve months, after which they are destroyed by lifecycle policy."
    ),
    cite(
      2,
      DOCS.msa,
      "Pages 13-14",
      "9.5 For the avoidance of doubt, Acme shall not be required to restore, index or search archived backup media in order to give effect to a deletion request, provided that such media expires in accordance with the published backup schedule."
    ),
  ],
};

const ANSWER_SLA = {
  text:
    "The Support SLA Matrix sets service credits by severity and elapsed time [1].\n\n| Severity | Response target | Credit after 4h | Credit after 12h |\n| --- | --- | --- | --- |\n| Priority 1 | 15 minutes | 10% | 25% |\n| Priority 2 | 1 hour | 5% | 10% |\n| Priority 3 | Next business day | None | None |\n\nCredits apply to the following term and must be claimed within **30 days** of the incident closing [2]. The uploaded documents do not cover credits for scheduled maintenance windows.",
  citations: [
    cite(
      1,
      DOCS.sla,
      "Rows 14-38",
      "severity,response_target,credit_4h,credit_12h,notes\nP1,15m,10%,25%,\"Total loss of service for all users\"\nP2,1h,5%,10%,\"Degraded service or loss for a subset of users\"\nP3,1 business day,0%,0%,\"Cosmetic or documentation issue\""
    ),
    cite(
      2,
      DOCS.msa,
      "Page 18, clause 12.2",
      "12.2 Service Credits are the Customer's sole and exclusive remedy for any failure to meet a Service Level. A claim must be submitted in writing within thirty (30) days of the closure of the relevant incident and will be applied against the following Subscription Term."
    ),
  ],
};

const ANSWER_INCIDENT = {
  text:
    "After-hours escalation runs through the on-call rota recorded in the runbook [1].\n\n1. The alert pages the primary on-call engineer.\n2. If it is unacknowledged for **10 minutes**, the secondary is paged.\n3. After 20 minutes it escalates to the duty manager [1].\n\nThe declaration command used in the incident channel is:\n\n```bash\n# open an incident and page the duty manager\nops incident declare --sev 1 --service checkout \\\n  --summary \"Checkout 5xx above 2%\" --page duty-manager\n```\n\nSeverity definitions are kept alongside the response targets rather than in the runbook itself [2].",
  citations: [
    cite(
      1,
      DOCS.run,
      "Section 3, lines 48-96",
      "## 3. Out of hours\nAlerts route to the primary on-call engineer through PagerDuty. An unacknowledged page escalates to the secondary after 10 minutes and to the duty manager after 20 minutes. The duty manager owns the decision to notify customers and may wake the service owner at any point."
    ),
    cite(
      2,
      DOCS.sla,
      "Rows 2-13",
      "severity,definition\nP1,\"Total loss of service, data loss risk, or security incident affecting all users\"\nP2,\"Degraded service, or total loss affecting a subset of users with no workaround\"\nP3,\"Issue with a documented workaround, cosmetic defect, or documentation error\""
    ),
  ],
};

const ANSWER_LEAVE = {
  text:
    "### Eligibility\nParental leave is open to employees with **26 weeks** of continuous service by the fifteenth week before the expected week of childbirth [1].\n\n- Full salary for the first 12 weeks\n- Statutory rate thereafter, to a maximum of 39 weeks\n- Written notice at least 8 weeks before the intended start date [1]\n\nThe handbook does not set out how parental leave interacts with an external secondment, so that part is not covered by the uploaded documents.",
  citations: [
    cite(
      1,
      DOCS.hb,
      "Pages 24-25",
      "6.1 Parental leave. Employees who have completed twenty-six weeks of continuous service by the fifteenth week before the expected week of childbirth are entitled to parental leave. The first twelve weeks are paid at full salary; the remainder is paid at the statutory rate for up to thirty-nine weeks in total. Notice must be given in writing no later than eight weeks before the intended start date."
    ),
  ],
};

const ANSWER_SECURITY = {
  text:
    "The security review lists four subprocessors in scope [1]:\n\n- **AWS (eu-west-1)** — hosting and object storage\n- **Datadog** — operational telemetry only\n- **Postmark** — transactional email\n- **Stripe** — billing records, no customer content\n\nCustomer content is encrypted with AES-256 at rest and TLS 1.2 or above in transit [2]. The most recent penetration test closed in March 2026 with two medium findings, both remediated [1].",
  citations: [
    cite(
      1,
      DOCS.sec,
      "Pages 4-6",
      "3.1 Subprocessors. Four subprocessors are engaged: Amazon Web Services (eu-west-1) for hosting and object storage; Datadog for operational telemetry; Postmark for transactional email; and Stripe for billing records. No customer content is transmitted to Stripe. 3.4 The 2026 penetration test, conducted by Cure53 in March, raised two medium findings, both closed by 11 April 2026."
    ),
    cite(
      2,
      DOCS.sec,
      "Page 11, section 5.1",
      "All customer content is encrypted at rest using AES-256 with keys managed in AWS KMS and rotated annually. Transport is TLS 1.2 or above; TLS 1.0 and 1.1 are rejected at the load balancer."
    ),
  ],
};

const ANSWER_BANK = [
  {
    keys: ["sla", "credit", "outage", "downtime", "uptime", "priority", "p1"],
    answer: ANSWER_SLA,
  },
  {
    keys: ["incident", "sev", "escalat", "page", "on-call", "oncall", "rota", "runbook"],
    answer: ANSWER_INCIDENT,
  },
  {
    keys: ["leave", "parental", "holiday", "handbook", "notice period", "salary"],
    answer: ANSWER_LEAVE,
  },
  {
    keys: ["subprocessor", "encrypt", "soc", "pen test", "security", "vendor", "tls"],
    answer: ANSWER_SECURITY,
  },
  {
    keys: ["backup", "archive", "snapshot"],
    answer: ANSWER_BACKUPS,
  },
  {
    keys: ["retention", "retain", "delete", "deletion", "export", "termination"],
    answer: ANSWER_RETENTION,
  },
];

const INITIAL_CONVERSATIONS = [
  {
    id: "conv_1",
    title: "Data retention periods in the MSA",
    date: "Today",
    messages: [
      {
        id: "m1",
        role: "user",
        content: "What data retention periods does the Acme MSA commit us to?",
        status: "complete",
        created_at: "09:12",
        citations: [],
      },
      {
        id: "m2",
        role: "assistant",
        content: ANSWER_RETENTION.text,
        status: "complete",
        created_at: "09:12",
        citations: ANSWER_RETENTION.citations,
      },
      {
        id: "m3",
        role: "user",
        content: "And what happens to the backups after that?",
        status: "complete",
        created_at: "09:15",
        citations: [],
      },
      {
        id: "m4",
        role: "assistant",
        content: ANSWER_BACKUPS.text,
        status: "complete",
        created_at: "09:15",
        citations: ANSWER_BACKUPS.citations,
      },
    ],
  },
  {
    id: "conv_2",
    title: "SLA credits for Priority 1 outages",
    date: "Today",
    messages: [
      {
        id: "m5",
        role: "user",
        content: "What credit do we get for a Priority 1 outage lasting over four hours?",
        status: "complete",
        created_at: "08:40",
        citations: [],
      },
      {
        id: "m6",
        role: "assistant",
        content: ANSWER_SLA.text,
        status: "complete",
        created_at: "08:40",
        citations: ANSWER_SLA.citations,
      },
      {
        id: "m7",
        role: "user",
        content: "Does the same credit apply to the sandbox environment?",
        status: "complete",
        created_at: "08:44",
        citations: [],
      },
      {
        id: "m8",
        role: "assistant",
        content: REFUSAL,
        status: "refusal",
        created_at: "08:44",
        citations: [],
      },
    ],
  },
  {
    id: "conv_3",
    title: "Incident escalation after hours",
    date: "Yesterday",
    messages: [
      {
        id: "m9",
        role: "user",
        content: "Who gets paged after hours for a Sev 1 on checkout?",
        status: "complete",
        created_at: "17:02",
        citations: [],
      },
      {
        id: "m10",
        role: "assistant",
        content:
          "After-hours escalation runs through the on-call rota recorded in the runbook [1].\n\n1. The alert pages the primary on-call engineer.\n2. If it is unacknowledged for **10 minutes**, the secondary is",
        status: "stopped",
        created_at: "17:02",
        citations: [ANSWER_INCIDENT.citations[0]],
      },
    ],
  },
  {
    id: "conv_4",
    title: "Parental leave eligibility",
    date: "3 Oct",
    messages: [
      {
        id: "m11",
        role: "user",
        content: "How long do you need to work here before parental leave applies?",
        status: "complete",
        created_at: "11:28",
        citations: [],
      },
      {
        id: "m12",
        role: "assistant",
        content: "",
        status: "error",
        created_at: "11:28",
        citations: [],
      },
    ],
  },
  {
    id: "conv_5",
    title: "Subprocessors in the security review",
    date: "2 Oct",
    messages: [
      {
        id: "m13",
        role: "user",
        content: "Which subprocessors are in scope, and how is content encrypted?",
        status: "complete",
        created_at: "14:51",
        citations: [],
      },
      {
        id: "m14",
        role: "assistant",
        content: ANSWER_SECURITY.text,
        status: "complete",
        created_at: "14:51",
        citations: ANSWER_SECURITY.citations,
      },
    ],
  },
  {
    id: "conv_6",
    title: "Old framework agreement wording",
    date: "30 Sep",
    messages: [
      {
        id: "m15",
        role: "user",
        content: "What did the 2019 framework agreement say about assignment?",
        status: "complete",
        created_at: "10:05",
        citations: [],
      },
      {
        id: "m16",
        role: "assistant",
        content:
          "The 2019 framework agreement allowed assignment only with prior written consent, not to be unreasonably withheld, and treated a change of control as an assignment [1].\n\nNothing in the uploaded documents sets out how that clause interacts with the current MSA.",
        status: "complete",
        created_at: "10:05",
        citations: [
          cite(
            1,
            DOCS.gone,
            "Page 6, clause 14",
            "14. Assignment. Neither party may assign this Agreement in whole or in part without the prior written consent of the other, such consent not to be unreasonably withheld or delayed. A change of control shall be deemed an assignment for the purposes of this clause.",
            true
          ),
        ],
      },
    ],
  },
];

const SUGGESTIONS = [
  "What credit applies to a Priority 1 outage over four hours?",
  "Who is paged after hours for a Sev 1?",
  "Which subprocessors are in scope for customer content?",
];

const findAnswer = (question) => {
  const q = question.toLowerCase();
  for (const entry of ANSWER_BANK) {
    if (entry.keys.some((k) => q.includes(k))) return entry.answer;
  }
  return null;
};

const highlightCode = (line, key) => {
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

const CodeBlock = (props) => {
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);
  const copy = () => {
    try {
      if (navigator.clipboard) navigator.clipboard.writeText(props.code);
    } catch (e) {
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
            <Icons.Check className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <Icons.FileText className="h-3.5 w-3.5" aria-hidden="true" />
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
  const [conversations, setConversations] = React.useState(INITIAL_CONVERSATIONS);
  const [activeId, setActiveId] = React.useState("conv_1");
  const [search, setSearch] = React.useState("");
  const [draft, setDraft] = React.useState("");
  const [renameFor, setRenameFor] = React.useState(null);
  const [renameValue, setRenameValue] = React.useState("");
  const [deleteFor, setDeleteFor] = React.useState(null);
  const [stream, setStream] = React.useState(null);
  const [source, setSource] = React.useState(null);
  const [copiedId, setCopiedId] = React.useState(null);
  const [downloadNote, setDownloadNote] = React.useState("");
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [announce, setAnnounce] = React.useState("");

  const idRef = React.useRef(200);
  const threadRef = React.useRef(null);
  const panelRef = React.useRef(null);
  const triggerRef = React.useRef(null);
  const composerRef = React.useRef(null);

  const nextId = () => {
    idRef.current += 1;
    return "m" + idRef.current;
  };

  const active = conversations.find((c) => c.id === activeId) || null;
  const messages = active ? active.messages : [];

  const filtered = conversations.filter((c) =>
    c.title.toLowerCase().includes(search.trim().toLowerCase())
  );

  const updateMessage = (convId, msgId, patch) => {
    setConversations((prev) =>
      prev.map((c) =>
        c.id !== convId
          ? c
          : {
              ...c,
              messages: c.messages.map((m) =>
                m.id === msgId ? { ...m, ...patch } : m
              ),
            }
      )
    );
  };

  // Streaming tick
  React.useEffect(() => {
    if (!stream) return undefined;
    if (stream.pos >= stream.full.length) {
      updateMessage(stream.convId, stream.msgId, {
        status: "complete",
        content: stream.full,
        citations: stream.citations,
      });
      setStream(null);
      setAnnounce("Answer complete with " + stream.citations.length + " sources.");
      return undefined;
    }
    const t = setTimeout(() => {
      const next = Math.min(stream.full.length, stream.pos + 7);
      updateMessage(stream.convId, stream.msgId, {
        content: stream.full.slice(0, next),
      });
      setStream((s) => (s ? { ...s, pos: next } : null));
    }, 16);
    return () => clearTimeout(t);
  }, [stream]);

  React.useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [activeId, messages.length, stream ? stream.pos : 0]);

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

  const startStream = (convId, msgId, answer) => {
    setStream({
      convId,
      msgId,
      full: answer.text,
      citations: answer.citations,
      pos: 0,
    });
    setAnnounce("Answer streaming.");
  };

  const handleSend = (text) => {
    const q = (text === undefined ? draft : text).trim();
    if (!q || stream) return;
    const answer = findAnswer(q);
    const userMsg = {
      id: nextId(),
      role: "user",
      content: q,
      status: "complete",
      created_at: "Just now",
      citations: [],
    };
    const assistantId = nextId();
    const assistantMsg = answer
      ? {
          id: assistantId,
          role: "assistant",
          content: "",
          status: "streaming",
          created_at: "Just now",
          citations: [],
        }
      : {
          id: assistantId,
          role: "assistant",
          content: REFUSAL,
          status: "refusal",
          created_at: "Just now",
          citations: [],
        };

    let convId = activeId;
    if (!active) {
      idRef.current += 1;
      convId = "conv_" + idRef.current;
      const title = q.length > 44 ? q.slice(0, 44).trim() + "…" : q;
      setConversations((prev) => [
        { id: convId, title, date: "Today", messages: [userMsg, assistantMsg] },
        ...prev,
      ]);
      setActiveId(convId);
    } else {
      setConversations((prev) => {
        const target = prev.find((c) => c.id === convId);
        const rest = prev.filter((c) => c.id !== convId);
        return [
          {
            ...target,
            date: "Today",
            messages: [...target.messages, userMsg, assistantMsg],
          },
          ...rest,
        ];
      });
    }
    setDraft("");
    if (answer) startStream(convId, assistantId, answer);
    else setAnnounce("No matching passages were found in the uploaded documents.");
  };

  const handleStop = () => {
    if (!stream) return;
    updateMessage(stream.convId, stream.msgId, { status: "stopped" });
    setStream(null);
    setAnnounce("Streaming stopped. The partial answer was kept.");
  };

  const regenerate = (msgId) => {
    if (!active || stream) return;
    const idx = active.messages.findIndex((m) => m.id === msgId);
    const question = active.messages[idx - 1];
    if (!question) return;
    const answer = findAnswer(question.content);
    if (!answer) {
      updateMessage(active.id, msgId, {
        content: REFUSAL,
        status: "refusal",
        citations: [],
      });
      setAnnounce("No matching passages were found in the uploaded documents.");
      return;
    }
    updateMessage(active.id, msgId, {
      content: "",
      status: "streaming",
      citations: [],
    });
    setSource(null);
    startStream(active.id, msgId, answer);
  };

  const copyAnswer = (msg) => {
    try {
      if (navigator.clipboard) navigator.clipboard.writeText(msg.content);
    } catch (e) {
      /* clipboard unavailable in sandbox */
    }
    setCopiedId(msg.id);
    setAnnounce("Answer copied to the clipboard.");
  };

  const openSource = (msgId, marker, el) => {
    triggerRef.current = el || null;
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

  const sourceMessage = source
    ? messages.find((m) => m.id === source.messageId)
    : null;
  const sourceList = sourceMessage ? sourceMessage.citations : [];
  const currentSource =
    sourceList.find((c) => c.marker === (source && source.marker)) || sourceList[0];

  const startNewChat = () => {
    setActiveId(null);
    setSource(null);
    setDraft("");
    setSidebarOpen(false);
    setAnnounce("New chat started.");
    if (composerRef.current) composerRef.current.focus();
  };

  const commitRename = (convId) => {
    const value = renameValue.trim();
    if (value) {
      setConversations((prev) =>
        prev.map((c) => (c.id === convId ? { ...c, title: value } : c))
      );
      setAnnounce("Conversation renamed to " + value + ".");
    }
    setRenameFor(null);
  };

  const confirmDelete = (convId) => {
    setConversations((prev) => prev.filter((c) => c.id !== convId));
    setDeleteFor(null);
    if (activeId === convId) {
      setActiveId(null);
      setSource(null);
    }
    setAnnounce("Conversation deleted.");
  };

  // ---- markdown rendering ----

  const renderInline = (text, citations, msgId, keyBase) => {
    const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[\d{1,2}\])/g);
    return parts.filter((p) => p !== "").map((part, i) => {
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
        const isOpen =
          source && source.messageId === msgId && source.marker === marker;
        return (
          <button
            key={key}
            type="button"
            onClick={(e) => openSource(msgId, marker, e.currentTarget)}
            aria-label={
              "Source " +
              marker +
              ": " +
              found.filename +
              ", " +
              found.location_label
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

  const renderMarkdown = (content, citations, msgId) => {
    const lines = content.split("\n");
    const blocks = [];
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
        const code = [];
        i += 1;
        while (i < lines.length && !lines[i].trim().startsWith("```")) {
          code.push(lines[i]);
          i += 1;
        }
        i += 1;
        blocks.push(
          <CodeBlock key={"c" + k++} lang={lang} code={code.join("\n")} />
        );
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
          </Tag>
        );
        i += 1;
        continue;
      }
      if (
        line.trim().startsWith("|") &&
        i + 1 < lines.length &&
        /^\|[\s:|-]+\|$/.test(lines[i + 1].trim())
      ) {
        const rows = [];
        while (i < lines.length && lines[i].trim().startsWith("|")) {
          rows.push(lines[i].trim());
          i += 1;
        }
        const cells = (row) =>
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
                      <TD key={ci}>
                        {renderInline(cell, citations, msgId, "td" + ri + ci)}
                      </TD>
                    ))}
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        );
        continue;
      }
      if (/^[-*]\s+/.test(line.trim())) {
        const items = [];
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
          </ul>
        );
        continue;
      }
      if (/^\d+\.\s+/.test(line.trim())) {
        const items = [];
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
          </ol>
        );
        continue;
      }
      const para = [];
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
        </p>
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

  const statusLabel = (msg) => {
    if (msg.status === "streaming")
      return { text: "Streaming", icon: Icons.Clock, color: "#6E675B" };
    if (msg.status === "stopped")
      return { text: "Stopped", icon: Icons.X, color: "#8A5312" };
    if (msg.status === "refusal")
      return { text: "Not in the documents", icon: Icons.AlertCircle, color: "#6E675B" };
    if (msg.status === "error")
      return { text: "Stream failed", icon: Icons.AlertCircle, color: "#9B3B2F" };
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
          <Icons.Plus className="mr-2 h-4 w-4" aria-hidden="true" />
          New chat
        </Button>
      </div>
      <div className="px-4 pb-3">
        <Label htmlFor="conv-search" className="sr-only">
          Search conversations
        </Label>
        <div className="relative">
          <Icons.Search
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
        {conversations.length === 0 ? (
          <p className="px-2 py-6 text-sm leading-6" style={{ color: "#6E675B" }}>
            No conversations yet. Start a new chat to ask your first question of
            the shared library.
          </p>
        ) : filtered.length === 0 ? (
          <p className="px-2 py-6 text-sm leading-6" style={{ color: "#6E675B" }}>
            No conversations match “{search.trim()}”.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {filtered.map((conv) => {
              const isActive = conv.id === activeId;
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
                      Delete “{conv.title}”? Its messages are removed. Documents in
                      the library are not affected.
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
                      onClick={() => {
                        setActiveId(conv.id);
                        setSource(null);
                        setSidebarOpen(false);
                      }}
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
                        {conv.title}
                      </span>
                      <span
                        className="mt-0.5 block text-[11px]"
                        style={{ color: "#8D8576" }}
                      >
                        {conv.date} · {conv.messages.length} messages
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRenameValue(conv.title);
                        setDeleteFor(null);
                        setRenameFor(conv.id);
                      }}
                      aria-label={'Rename conversation "' + conv.title + '"'}
                      className={
                        "rounded p-1.5 opacity-0 hover:bg-black/[0.06] focus:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 " +
                        RING
                      }
                      style={{ color: "#6E675B" }}
                    >
                      <Icons.Edit className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRenameFor(null);
                        setDeleteFor(conv.id);
                      }}
                      aria-label={'Delete conversation "' + conv.title + '"'}
                      className={
                        "rounded p-1.5 opacity-0 hover:bg-black/[0.06] focus:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 " +
                        RING
                      }
                      style={{ color: "#6E675B" }}
                    >
                      <Icons.Trash className="h-3.5 w-3.5" aria-hidden="true" />
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
          <Icons.Package className="h-4 w-4" aria-hidden="true" />
          Document library
          <Icons.ChevronRight
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
          <Icons.AlertCircle className="h-4 w-4" aria-hidden="true" />
          Help and limitations
          <Icons.ChevronRight
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
                <Icons.X className="h-4 w-4" aria-hidden="true" />
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
            <Icons.Menu className="h-5 w-5" aria-hidden="true" />
          </button>
          <div className="min-w-0 flex-1">
            <h1
              className="truncate text-[1.35rem] font-semibold tracking-tight"
              style={{ color: "#231F1A", fontFamily: brand.fontHeading }}
            >
              {active ? active.title : "New chat"}
            </h1>
            <p className="mt-1 text-[13px]" style={{ color: "#6E675B" }}>
              {active
                ? active.date +
                  " · " +
                  active.messages.length +
                  " messages · answers drawn only from the shared library"
                : "Answers are drawn only from documents uploaded to the shared library."}
            </p>
          </div>
          <Button
            variant="outline"
            onClick={startNewChat}
            className={"hidden shrink-0 sm:inline-flex " + RING}
          >
            <Icons.Plus className="mr-2 h-4 w-4" aria-hidden="true" />
            New chat
          </Button>
        </header>

        <div
          ref={threadRef}
          className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8"
          style={{ backgroundColor: brand.backgroundColor }}
        >
          <h2 className="sr-only">Conversation</h2>
          {!active || messages.length === 0 ? (
            <div className="mx-auto max-w-[44rem] pt-10">
              <div
                className="rounded-lg border bg-white p-8"
                style={{ borderColor: BORDER }}
              >
                <h3
                  className="text-base font-semibold"
                  style={{ color: "#231F1A", fontFamily: brand.fontHeading }}
                >
                  Ask a question of the shared library
                </h3>
                <p
                  className="mt-2 max-w-prose text-[15px] leading-7"
                  style={{ color: "#524C42" }}
                >
                  Every answer is built from passages retrieved out of the
                  documents your team has uploaded. If nothing relevant is found,
                  you will be told so rather than given a guess.
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
                        <Icons.Search
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
                          You · {msg.created_at}
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
                        <Icons.FileText className="h-3.5 w-3.5 text-white" />
                      </span>
                      <span
                        className="text-[11px] font-medium uppercase tracking-wider"
                        style={{ color: "#8D8576" }}
                      >
                        Assistant · {msg.created_at}
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
                          The answer stream was interrupted before any text
                          arrived. Nothing was saved for this turn.
                        </p>
                        <Button
                          variant="outline"
                          onClick={() => regenerate(msg.id)}
                          className={"mt-3 " + RING}
                        >
                          <Icons.ArrowRight className="mr-2 h-4 w-4" aria-hidden="true" />
                          Retry
                        </Button>
                      </div>
                    ) : msg.status === "refusal" ? (
                      <div
                        className="rounded-lg border bg-white px-4 py-3"
                        style={{ borderColor: BORDER }}
                      >
                        <p
                          className="text-[15px] leading-7"
                          style={{ color: "#3A3630" }}
                        >
                          {msg.content}
                        </p>
                        <p className="mt-2 text-[13px]" style={{ color: "#6E675B" }}>
                          No passage in the library scored above the relevance
                          threshold, so no source is cited.
                        </p>
                      </div>
                    ) : (
                      <div
                        className="text-[15px]"
                        style={{ color: "#2B2822", maxWidth: "42rem" }}
                      >
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
                            <span
                              className="font-semibold"
                              style={{ color: "#8A5312" }}
                            >
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
                            <Icons.CheckCircle className="h-3.5 w-3.5" aria-hidden="true" />
                          ) : (
                            <Icons.FileText className="h-3.5 w-3.5" aria-hidden="true" />
                          )}
                          {copiedId === msg.id ? "Copied" : "Copy answer"}
                        </button>
                        {msg.id === lastAssistantId ? (
                          <button
                            type="button"
                            onClick={() => regenerate(msg.id)}
                            disabled={!!stream}
                            className={
                              "inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] font-medium hover:bg-black/[0.05] disabled:opacity-40 " +
                              RING
                            }
                            style={{ color: "#524C42" }}
                          >
                            <Icons.ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
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
                Enter to send, Shift and Enter for a new line. Answers come only
                from the shared library.
              </p>
              {stream ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleStop}
                  className={"shrink-0 " + RING}
                >
                  <Icons.X className="mr-2 h-4 w-4" aria-hidden="true" />
                  Stop
                </Button>
              ) : (
                <Button
                  type="submit"
                  disabled={draft.trim() === ""}
                  className={"shrink-0 disabled:opacity-50 " + RING}
                  style={{ backgroundColor: brand.primaryColor, color: "#FFFFFF" }}
                >
                  <Icons.ArrowRight className="mr-2 h-4 w-4" aria-hidden="true" />
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
                <Icons.X className="h-4 w-4" aria-hidden="true" />
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
                      className={
                        "rounded-md border px-2.5 py-1 text-[12px] font-medium " + RING
                      }
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
                <Badge>{currentSource.format}</Badge>
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
                  <Icons.AlertCircle
                    className="mr-1.5 inline h-3.5 w-3.5 align-text-bottom"
                    aria-hidden="true"
                  />
                  This document has been removed from the library. The passage
                  below is the copy stored with the answer; the original file is
                  no longer available to download.
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
                Shown exactly as retrieved, chunk {currentSource.marker} of{" "}
                {sourceList.length} used for this answer.
              </p>
            </div>

            <div
              className="border-t px-4 py-3"
              style={{ borderColor: BORDER }}
            >
              <p aria-live="polite" className="sr-only">
                {downloadNote}
              </p>
              {downloadNote ? (
                <p className="mb-2 text-[12px]" style={{ color: "#1B5240" }}>
                  <Icons.CheckCircle
                    className="mr-1 inline h-3.5 w-3.5 align-text-bottom"
                    aria-hidden="true"
                  />
                  {downloadNote}
                </p>
              ) : null}
              <Button
                variant="outline"
                disabled={currentSource.deleted}
                onClick={() =>
                  setDownloadNote("Downloading " + currentSource.filename)
                }
                className={"w-full justify-center disabled:opacity-50 " + RING}
              >
                <Icons.Download className="mr-2 h-4 w-4" aria-hidden="true" />
                {currentSource.deleted
                  ? "Original unavailable"
                  : "Download original"}
              </Button>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
