/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
/* eslint-disable @typescript-eslint/no-unused-vars */
import React from "react";

import * as UI from "@/lib/ui";
import { Icons } from "@/lib/icons";
import { brand } from "@/lib/brand";
import { useNavigate } from "@/lib/navigate";

const { Button, Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, Input, Label, Select, Table, THead, TBody, TR, TH, TD, Separator } = UI;
const { Search, Check, X, ChevronRight, ChevronDown, Users, Settings, Home, FileText, Package, Clock, Download, Upload, ArrowLeft, ArrowRight, AlertCircle, CheckCircle, MoreHorizontal } = Icons;

const SURFACE = "#FFFDF8";
const BORDER = "#E4DED1";
const INK = "#241F18";
const MUTED = "#6E675B";

const TONES = {
  neutral: { fg: "#453F36", bg: "#EDE8DC" },
  accent: { fg: "#8A5312", bg: "#F6E7D3" },
  primary: { fg: "#1B5240", bg: "#DEEAE4" },
  danger: { fg: "#8C2F1A", bg: "#F6E1DB" },
};

const STATUSES = [
  {
    id: "queued",
    label: "Queued",
    tone: "neutral",
    icon: Icons.Clock,
    meaning:
      "The file is stored and waiting its turn. Nothing has been read out of it yet.",
    action:
      "Wait. Files are picked up in the order they arrive, usually within a minute.",
    retrievable: false,
  },
  {
    id: "processing",
    label: "Processing",
    tone: "accent",
    icon: Icons.Settings,
    meaning:
      "Text is being extracted, split into passages and embedded for search.",
    action:
      "Wait. A 50MB PDF can take a few minutes. The status updates on its own.",
    retrievable: false,
  },
  {
    id: "ready",
    label: "Ready",
    tone: "primary",
    icon: Icons.CheckCircle,
    meaning:
      "Every passage is indexed. The document can now be quoted and cited in answers.",
    action: "Ask a question about it in chat.",
    retrievable: true,
  },
  {
    id: "failed",
    label: "Failed",
    tone: "danger",
    icon: Icons.AlertCircle,
    meaning:
      "Nothing usable came out of the file. The library shows the reason next to the row.",
    action:
      "Read the reason, fix the file if you can, and upload it again. The original stays downloadable.",
    retrievable: false,
  },
];

const FORMATS = [
  {
    format: "PDF",
    ext: ".pdf",
    reads: "The text of every page, with the page number kept for citation",
    note: "Scanned or image-only PDFs are not read. There is no OCR in this release.",
  },
  {
    format: "Word",
    ext: ".docx",
    reads: "Paragraph and table text, in document order",
    note: "The older .doc format is not supported. Save as .docx first.",
  },
  {
    format: "Plain text",
    ext: ".txt",
    reads: "The whole file as written",
    note: "No limits beyond the 50MB file size.",
  },
  {
    format: "Markdown",
    ext: ".md",
    reads: "Headings, lists and fenced code blocks, structure preserved",
    note: "Rendered back as formatted Markdown inside answers.",
  },
  {
    format: "CSV",
    ext: ".csv",
    reads: "The header row and the data rows, with the row range kept",
    note: "Citations point at a row range, for example rows 120 to 148.",
  },
];

const FAILURE_REASONS = [
  {
    reason: "No text could be extracted",
    detail:
      "Almost always a scanned or photographed document. Reading Room does not run OCR, so there is nothing to index.",
  },
  {
    reason: "Password-protected file",
    detail:
      "Remove the password, then upload again. The protected original stays available to download or delete.",
  },
  {
    reason: "Unreadable or corrupt file",
    detail:
      "The file did not open as a valid document of its type. Re-export it from the source application.",
  },
  {
    reason: "Embedding provider unavailable",
    detail:
      "The embedding step was retried and still could not finish. Nothing partial is left behind, so uploading again is safe.",
  },
];

const CANNOT = [
  {
    text: "Answer from general knowledge",
    why: "If nothing in the library clears the relevance threshold you get the fixed reply, \"I don't have information about that in the uploaded documents.\" No model is called at all, so there is no invented answer to catch.",
  },
  {
    text: "Read scanned or image-only PDFs",
    why: "There is no OCR in this release. Those files are marked Failed with a reason rather than quietly indexed as empty.",
  },
  {
    text: "Show you a colleague's chats",
    why: "Documents are shared with the whole workspace. Conversations are private to the person who had them, admins included.",
  },
  {
    text: "Limit a conversation to chosen documents",
    why: "Every question searches the entire library of Ready documents. If you want something excluded from answers, delete it.",
  },
  {
    text: "Guarantee quality on non-English documents",
    why: "Other languages are still extracted and indexed, but no language-specific retrieval tuning has been done.",
  },
  {
    text: "Pull files from Drive, SharePoint or email",
    why: "Documents arrive by manual upload only. Drag and drop, or pick several files at once.",
  },
  {
    text: "Charge anybody for anything",
    why: "There is no pricing, plan, invoice or payment anywhere in the product.",
  },
];

const ROLE_MATRIX = [
  { capability: "Upload documents to the shared library", member: true, admin: true },
  { capability: "Ask questions and open citations", member: true, admin: true },
  { capability: "Download any original file", member: true, admin: true },
  { capability: "Delete a document you uploaded yourself", member: true, admin: true },
  { capability: "Delete a document uploaded by someone else", member: false, admin: true },
  { capability: "Invite a colleague by email address", member: false, admin: true },
  { capability: "Remove a member from the workspace", member: false, admin: true },
  { capability: "Read another person's conversations", member: false, admin: false },
];

const FAQ = [
  {
    id: "faq-missing",
    q: "Why does it say it has nothing, when I know we uploaded that document?",
    a: "Three things to check, in order. First, the document status is Ready and not Queued, Processing or Failed. Second, the wording: retrieval matches meaning, but a question using words that appear nowhere in the file may fall below the relevance threshold. Third, whether the document was replaced or deleted by a colleague since you last looked.",
  },
  {
    id: "faq-private",
    q: "Can a colleague or an admin read my conversations?",
    a: "No. Conversations are private to the person who had them, and requesting one by its identifier is refused for everyone else. Uploaded documents are the shared part, chats are not.",
  },
  {
    id: "faq-delete",
    q: "Who is allowed to delete a document?",
    a: "The person who uploaded it, and any admin. For everyone else the delete action is not shown, and a direct API call is refused. Deleting removes the passages and embeddings as well as the original file, so the content stops appearing in answers straight away.",
  },
  {
    id: "faq-duplicate",
    q: "What happens if I upload the same file name twice?",
    a: "You are told a version already exists and asked to confirm replacement. On confirming, the new file is processed and the previous version's passages and embeddings are removed once it succeeds, so answers never draw on both versions at once.",
  },
  {
    id: "faq-gone",
    q: "A citation says the source is no longer available. What happened?",
    a: "The document was deleted from the library after that answer was written. The answer text and the quoted passage are kept with the message, but the original file cannot be downloaded any more.",
  },
  {
    id: "faq-stop",
    q: "Can I stop an answer while it is still being written?",
    a: "Yes. Choose Stop while the text is streaming. The partial answer stays in the thread marked as stopped, and you can ask something else or regenerate it.",
  },
];

const SECTIONS = [
  {
    id: "start",
    title: "Getting started",
    icon: Icons.Home,
    lead: "What this assistant is for, and the first five minutes of using it.",
    articles: [
      {
        id: "start-what",
        title: "What the assistant answers from",
        blocks: [
          {
            t: "p",
            text: "Reading Room answers questions using only the documents your team has uploaded. It does not draw on anything the model learned elsewhere. If an answer is not in the library, you are told so plainly instead of being given a confident guess.",
          },
          {
            t: "p",
            text: "The document library is shared: everything anyone uploads is searchable by every member as soon as it reaches Ready. Your conversations are private to you.",
          },
          {
            t: "note",
            text: "Every factual sentence in an answer carries a numbered marker such as [2]. If a sentence has no marker, treat it with the same suspicion you would treat an unsourced claim in a report.",
          },
        ],
      },
      {
        id: "start-first",
        title: "Your first five minutes",
        blocks: [
          {
            t: "ol",
            items: [
              "Open the document library and drop in two or three files you actually work from.",
              "Wait for each one to move from Queued through Processing to Ready.",
              "Open a new chat and ask a question whose answer you already know, so you can judge the quality of the citations.",
              "Click a numbered marker in the answer and read the quoted passage in the source panel beside it.",
            ],
          },
        ],
      },
    ],
  },
  {
    id: "upload",
    title: "Uploading documents",
    icon: Icons.Upload,
    lead: "Supported formats, the size limit, replacing a file and removing one.",
    articles: [
      {
        id: "upload-formats",
        title: "Supported formats and limits",
        blocks: [
          {
            t: "p",
            text: "Five formats are accepted. Anything else, including .pptx, .xlsx and images, is refused before the upload starts, so nothing part-formed is left in the library.",
          },
          { t: "formats" },
          {
            t: "p",
            text: "The practical limit is 50MB per file. Larger files are refused with a message naming the limit. Select as many files as you like at once: each becomes its own document with its own status, and one failure does not stop the rest.",
          },
        ],
      },
      {
        id: "upload-replace",
        title: "Replacing a document with a newer version",
        blocks: [
          {
            t: "p",
            text: "Upload a file whose name already exists in the library and you are asked to confirm that you want to replace the version that is there. Confirming processes the new file; when it reaches Ready the old passages and embeddings are removed, so answers come from the current version only.",
          },
          {
            t: "p",
            text: "If the replacement fails extraction, the row shows Failed with a reason and tells you whether the previous version is still in place.",
          },
        ],
      },
      {
        id: "upload-delete",
        title: "Removing a document",
        blocks: [
          {
            t: "p",
            text: "You can delete anything you uploaded. Admins can delete anything at all. Deleting removes the document, its passages, its embeddings and the original file from storage, and the content stops being retrievable immediately.",
          },
          {
            t: "p",
            text: "Answers already in your history keep their text and their quoted passages, but a citation pointing at a deleted document will say the original is no longer available.",
          },
        ],
      },
    ],
  },
  {
    id: "statuses",
    title: "The four statuses",
    icon: Icons.Clock,
    lead: "Every document sits in exactly one of four states. Only one of them is searchable.",
    articles: [
      {
        id: "statuses-table",
        title: "What each status means",
        blocks: [
          { t: "statuses" },
          {
            t: "p",
            text: "Statuses update by themselves while you watch the library. You never need to sign out and back in to see a document advance.",
          },
        ],
      },
      {
        id: "statuses-failed",
        title: "Why a document failed",
        blocks: [
          {
            t: "p",
            text: "A failed document shows a plain reason beside its name. These are the four you are most likely to meet.",
          },
          { t: "reasons" },
        ],
      },
    ],
  },
  {
    id: "citations",
    title: "Checking citations",
    icon: Icons.FileText,
    lead: "How to verify an answer against the passage it was actually built from.",
    articles: [
      {
        id: "cite-markers",
        title: "Reading the numbered markers",
        blocks: [
          {
            t: "p",
            text: "Markers arrive once the answer has finished streaming, and they become clickable at that moment. Numbering runs consecutively within a single answer, and two claims drawn from the same passage share the same number.",
          },
          {
            t: "p",
            text: "The fixed \"not in the uploaded documents\" reply never carries markers, because nothing was retrieved to support it.",
          },
        ],
      },
      {
        id: "cite-panel",
        title: "Using the source panel",
        blocks: [
          {
            t: "ol",
            items: [
              "Click any numbered marker. The source panel opens beside the answer rather than covering it.",
              "Read the document name, the page number or row range, and the passage exactly as it was retrieved.",
              "Step between every source used by that answer without closing the panel.",
              "Close the panel with Escape or the close button; the conversation stays where you left it.",
            ],
          },
          {
            t: "note",
            text: "On a narrow screen the panel opens as a full-width sheet over the thread instead of a sliver beside it.",
          },
        ],
      },
      {
        id: "cite-download",
        title: "Downloading the original file",
        blocks: [
          {
            t: "p",
            text: "The source panel offers the original upload with its own file name and type, so you can read the surrounding pages for yourself. Download links are never public: a request from outside the workspace is refused.",
          },
        ],
      },
    ],
  },
  {
    id: "limits",
    title: "What it will not do",
    icon: Icons.AlertCircle,
    lead: "Deliberate limits. Knowing these is what makes the answers you do get trustworthy.",
    articles: [
      {
        id: "limits-list",
        title: "Deliberate limitations",
        blocks: [{ t: "cannot" }],
      },
    ],
  },
  {
    id: "faq",
    title: "Common questions",
    icon: Icons.MoreHorizontal,
    lead: "The six questions new members ask in their first week.",
    articles: [
      { id: "faq-list", title: "Common questions", blocks: [{ t: "faq" }] },
    ],
  },
  {
    id: "admin",
    title: "For admins",
    icon: Icons.Users,
    admin: true,
    lead: "Inviting people, removing them, and what an admin can do that a member cannot.",
    articles: [
      {
        id: "admin-invite",
        title: "Inviting a colleague",
        blocks: [
          {
            t: "p",
            text: "There is no open sign-up. People reach the workspace by invitation only, which is why the shared library stays trustworthy.",
          },
          {
            t: "ol",
            items: [
              "Open Members and choose Invite member.",
              "Enter the email address and pick the role, member or admin.",
              "They receive a single-use link and set their own password, which is only ever stored as a hash.",
              "The link stops working once it has been used or once it expires.",
            ],
          },
        ],
      },
      {
        id: "admin-remove",
        title: "Removing a member",
        blocks: [
          {
            t: "p",
            text: "Removing a member ends their sessions immediately. Documents they uploaded stay in the shared library, so answers your team depends on do not quietly disappear when somebody leaves.",
          },
        ],
      },
      {
        id: "admin-roles",
        title: "What each role can do",
        blocks: [
          {
            t: "p",
            text: "There are exactly two roles. There is no per-document or per-folder sharing to configure.",
          },
          { t: "roles" },
        ],
      },
    ],
  },
];

function blockText(b) {
  switch (b.t) {
    case "p":
    case "note":
      return b.text;
    case "ol":
    case "ul":
      return b.items.join(" ");
    case "formats":
      return FORMATS.map((f) => `${f.format} ${f.ext} ${f.reads} ${f.note}`).join(" ");
    case "statuses":
      return STATUSES.map((s) => `${s.label} ${s.meaning} ${s.action}`).join(" ");
    case "reasons":
      return FAILURE_REASONS.map((r) => `${r.reason} ${r.detail}`).join(" ");
    case "cannot":
      return CANNOT.map((c) => `${c.text} ${c.why}`).join(" ");
    case "roles":
      return ROLE_MATRIX.map((r) => r.capability).join(" ");
    default:
      return "";
  }
}

const INDEX = [];
SECTIONS.forEach((section) => {
  section.articles.forEach((article) => {
    if (article.blocks.some((b) => b.t === "faq")) return;
    INDEX.push({
      key: section.id + "/" + article.id,
      sectionId: section.id,
      sectionTitle: section.title,
      admin: !!section.admin,
      title: article.title,
      text: [article.title, ...article.blocks.map(blockText)].join(" "),
    });
  });
});
FAQ.forEach((f) => {
  INDEX.push({
    key: "faq/" + f.id,
    sectionId: "faq",
    sectionTitle: "Common questions",
    admin: false,
    faqId: f.id,
    title: f.q,
    text: f.q + " " + f.a,
  });
});

function makeSnippet(text, q) {
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return text.slice(0, 140) + (text.length > 140 ? "..." : "");
  const start = Math.max(0, i - 60);
  const end = Math.min(text.length, i + q.length + 90);
  return (start > 0 ? "..." : "") + text.slice(start, end).trim() + (end < text.length ? "..." : "");
}

export default function Screen() {
  const navigate = useNavigate();
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState("start");
  const [showAdmin, setShowAdmin] = React.useState(false);
  const [openFaq, setOpenFaq] = React.useState(null);
  const panelRef = React.useRef(null);
  const tabRefs = React.useRef({});

  const visibleSections = SECTIONS.filter((s) => !s.admin || showAdmin);

  React.useEffect(() => {
    if (!visibleSections.some((s) => s.id === active)) setActive("start");
  }, [showAdmin]);

  const q = query.trim().toLowerCase();
  const searching = q.length > 0;
  const results = searching
    ? INDEX.filter((e) => (!e.admin || showAdmin) && e.text.toLowerCase().includes(q))
    : [];
  const hiddenAdminMatches = searching
    ? INDEX.filter((e) => e.admin && !showAdmin && e.text.toLowerCase().includes(q)).length
    : 0;

  const section = visibleSections.find((s) => s.id === active) || visibleSections[0];
  const ring = { ["--tw-ring-color"]: brand.primaryColor };

  function openResult(entry) {
    setActive(entry.sectionId);
    setQuery("");
    if (entry.faqId) setOpenFaq(entry.faqId);
    window.requestAnimationFrame(() => {
      if (panelRef.current) panelRef.current.focus();
    });
  }

  function onTabKeyDown(e) {
    const ids = visibleSections.map((s) => s.id);
    const i = ids.indexOf(active);
    let next = null;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") next = ids[(i + 1) % ids.length];
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") next = ids[(i - 1 + ids.length) % ids.length];
    else if (e.key === "Home") next = ids[0];
    else if (e.key === "End") next = ids[ids.length - 1];
    if (next) {
      e.preventDefault();
      setActive(next);
      const el = tabRefs.current[next];
      if (el) el.focus();
    }
  }

  const StatusTag = ({ s, small }) => {
    const Icon = s.icon;
    const tone = TONES[s.tone];
    return (
      <span
        className={
          "inline-flex items-center gap-1.5 whitespace-nowrap font-medium " +
          (small ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm")
        }
        style={{ backgroundColor: tone.bg, color: tone.fg, borderRadius: brand.radius }}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {s.label}
      </span>
    );
  };

  function renderBlock(b, k) {
    switch (b.t) {
      case "p":
        return (
          <p key={k} className="text-[15px] leading-7" style={{ color: INK }}>
            {b.text}
          </p>
        );
      case "note":
        return (
          <p
            key={k}
            className="border-l-2 py-1 pl-4 text-[15px] leading-7"
            style={{ borderColor: brand.accentColor, color: MUTED }}
          >
            {b.text}
          </p>
        );
      case "ol":
        return (
          <ol key={k} className="ml-5 list-decimal space-y-2 text-[15px] leading-7" style={{ color: INK }}>
            {b.items.map((it, i) => (
              <li key={i} className="pl-1">
                {it}
              </li>
            ))}
          </ol>
        );
      case "ul":
        return (
          <ul key={k} className="ml-5 list-disc space-y-2 text-[15px] leading-7" style={{ color: INK }}>
            {b.items.map((it, i) => (
              <li key={i} className="pl-1">
                {it}
              </li>
            ))}
          </ul>
        );
      case "formats":
        return (
          <div key={k} className="overflow-x-auto">
            <Table>
              <THead>
                <TR>
                  <TH scope="col">Format</TH>
                  <TH scope="col">Extension</TH>
                  <TH scope="col">What gets read</TH>
                  <TH scope="col">Worth knowing</TH>
                </TR>
              </THead>
              <TBody>
                {FORMATS.map((f) => (
                  <TR key={f.ext}>
                    <TH scope="row" className="whitespace-nowrap font-medium">
                      {f.format}
                    </TH>
                    <TD>
                      <code className="text-[13px]" style={{ color: MUTED }}>
                        {f.ext}
                      </code>
                    </TD>
                    <TD className="text-[14px]">{f.reads}</TD>
                    <TD className="text-[14px]" style={{ color: MUTED }}>
                      {f.note}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        );
      case "statuses":
        return (
          <div key={k} className="overflow-x-auto">
            <Table>
              <THead>
                <TR>
                  <TH scope="col">Status</TH>
                  <TH scope="col">What it means</TH>
                  <TH scope="col">What to do</TH>
                  <TH scope="col">Used in answers</TH>
                </TR>
              </THead>
              <TBody>
                {STATUSES.map((s) => (
                  <TR key={s.id}>
                    <TH scope="row">
                      <StatusTag s={s} />
                    </TH>
                    <TD className="text-[14px]">{s.meaning}</TD>
                    <TD className="text-[14px]" style={{ color: MUTED }}>
                      {s.action}
                    </TD>
                    <TD className="text-[14px] whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5">
                        {s.retrievable ? (
                          <Icons.Check className="h-4 w-4" aria-hidden="true" style={{ color: brand.primaryColor }} />
                        ) : (
                          <Icons.X className="h-4 w-4" aria-hidden="true" style={{ color: MUTED }} />
                        )}
                        {s.retrievable ? "Yes" : "No"}
                      </span>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        );
      case "reasons":
        return (
          <dl key={k} className="space-y-5">
            {FAILURE_REASONS.map((r) => (
              <div key={r.reason}>
                <dt className="text-[15px] font-semibold" style={{ color: INK }}>
                  {r.reason}
                </dt>
                <dd className="mt-1 text-[15px] leading-7" style={{ color: MUTED }}>
                  {r.detail}
                </dd>
              </div>
            ))}
          </dl>
        );
      case "cannot":
        return (
          <ul key={k} className="space-y-6">
            {CANNOT.map((c) => (
              <li key={c.text} className="flex gap-3">
                <span
                  className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center"
                  style={{ backgroundColor: TONES.danger.bg, borderRadius: brand.radius }}
                >
                  <Icons.X className="h-3.5 w-3.5" aria-hidden="true" style={{ color: TONES.danger.fg }} />
                </span>
                <div>
                  <p className="text-[15px] font-semibold" style={{ color: INK }}>
                    {c.text}
                  </p>
                  <p className="mt-1 text-[15px] leading-7" style={{ color: MUTED }}>
                    {c.why}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        );
      case "roles":
        return (
          <div key={k} className="overflow-x-auto">
            <Table>
              <THead>
                <TR>
                  <TH scope="col">Capability</TH>
                  <TH scope="col">Member</TH>
                  <TH scope="col">Admin</TH>
                </TR>
              </THead>
              <TBody>
                {ROLE_MATRIX.map((r) => (
                  <TR key={r.capability}>
                    <TH scope="row" className="font-normal">
                      {r.capability}
                    </TH>
                    {[r.member, r.admin].map((v, i) => (
                      <TD key={i} className="whitespace-nowrap text-[14px]">
                        <span className="inline-flex items-center gap-1.5">
                          {v ? (
                            <Icons.Check className="h-4 w-4" aria-hidden="true" style={{ color: brand.primaryColor }} />
                          ) : (
                            <Icons.X className="h-4 w-4" aria-hidden="true" style={{ color: MUTED }} />
                          )}
                          {v ? "Yes" : "No"}
                        </span>
                      </TD>
                    ))}
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        );
      case "faq":
        return (
          <ul key={k} className="divide-y" style={{ borderColor: BORDER }}>
            {FAQ.map((f) => {
              const isOpen = openFaq === f.id;
              return (
                <li key={f.id} className="py-1">
                  <h4>
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      aria-controls={"panel-" + f.id}
                      id={"q-" + f.id}
                      onClick={() => setOpenFaq(isOpen ? null : f.id)}
                      className="flex w-full items-start gap-3 py-3 text-left text-[15px] font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                      style={{ ...ring, color: INK, borderRadius: brand.radius }}
                    >
                      {isOpen ? (
                        <Icons.ChevronDown className="mt-1 h-4 w-4 shrink-0" aria-hidden="true" style={{ color: brand.accentColor }} />
                      ) : (
                        <Icons.ChevronRight className="mt-1 h-4 w-4 shrink-0" aria-hidden="true" style={{ color: MUTED }} />
                      )}
                      <span>{f.q}</span>
                    </button>
                  </h4>
                  {isOpen && (
                    <div id={"panel-" + f.id} role="region" aria-labelledby={"q-" + f.id} className="pb-4 pl-7 pr-2">
                      <p className="text-[15px] leading-7" style={{ color: MUTED }}>
                        {f.a}
                      </p>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        );
      default:
        return null;
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10" style={{ fontFamily: brand.fontBody }}>
      <header className="max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: brand.accentColor }}>
          Reading Room
        </p>
        <h1
          className="mt-3 text-4xl font-semibold tracking-tight"
          style={{ fontFamily: brand.fontHeading, color: brand.primaryColor }}
        >
          Help and limitations
        </h1>
        <p className="mt-4 text-[17px] leading-8" style={{ color: MUTED }}>
          How to add documents, what the four processing statuses mean, how to check a citation against
          its source, and the things this assistant will not do on purpose.
        </p>
        <p className="mt-3 text-sm" style={{ color: MUTED }}>
          Last reviewed 2 October 2026 for workspace members and admins.
        </p>
      </header>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Button
          onClick={() => navigate("chat")}
          style={{ backgroundColor: brand.primaryColor, color: "#FFFDF8", borderRadius: brand.radius }}
        >
          <span className="inline-flex items-center gap-2">
            <Icons.ArrowRight className="h-4 w-4" aria-hidden="true" />
            Open chat
          </span>
        </Button>
        <button
          type="button"
          onClick={() => navigate("library")}
          className="inline-flex items-center gap-2 border px-4 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          style={{ ...ring, borderColor: BORDER, backgroundColor: SURFACE, color: INK, borderRadius: brand.radius }}
        >
          <Icons.Package className="h-4 w-4" aria-hidden="true" />
          Document library
        </button>
        <button
          type="button"
          onClick={() => navigate("members")}
          className="inline-flex items-center gap-2 border px-4 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          style={{ ...ring, borderColor: BORDER, backgroundColor: SURFACE, color: INK, borderRadius: brand.radius }}
        >
          <Icons.Users className="h-4 w-4" aria-hidden="true" />
          Members
        </button>
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-8 lg:self-start">
          <div className="mb-6">
            <Label htmlFor="help-search">Search help</Label>
            <div className="relative mt-2">
              <Icons.Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
                aria-hidden="true"
                style={{ color: MUTED }}
              />
              <Input
                id="help-search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="statuses, scanned PDF, citations"
                className="pl-9"
              />
            </div>
          </div>

          <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: MUTED }}>
            Contents
          </h2>
          <div
            role="tablist"
            aria-label="Help sections"
            aria-orientation="vertical"
            onKeyDown={onTabKeyDown}
            className="mt-3 flex flex-col gap-1"
          >
            {visibleSections.map((s) => {
              const Icon = s.icon;
              const selected = s.id === section.id && !searching;
              return (
                <button
                  key={s.id}
                  id={"tab-" + s.id}
                  ref={(el) => (tabRefs.current[s.id] = el)}
                  role="tab"
                  type="button"
                  aria-selected={selected}
                  aria-controls={"tabpanel-" + s.id}
                  tabIndex={s.id === section.id ? 0 : -1}
                  onClick={() => {
                    setActive(s.id);
                    setQuery("");
                  }}
                  className="flex items-center gap-2.5 px-3 py-2 text-left text-[15px] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                  style={{
                    ...ring,
                    borderRadius: brand.radius,
                    backgroundColor: selected ? TONES.primary.bg : "transparent",
                    color: selected ? brand.primaryColor : INK,
                    fontWeight: selected ? 600 : 400,
                  }}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" style={{ color: selected ? brand.primaryColor : MUTED }} />
                  <span>{s.title}</span>
                  {s.admin && (
                    <span
                      className="ml-auto px-1.5 py-0.5 text-[11px] font-medium"
                      style={{ backgroundColor: TONES.accent.bg, color: TONES.accent.fg, borderRadius: brand.radius }}
                    >
                      Admin
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <Separator className="my-5" />

          <div className="flex items-start gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={showAdmin}
              aria-labelledby="admin-toggle-label"
              onClick={() => setShowAdmin((v) => !v)}
              className="mt-0.5 inline-flex h-6 w-11 shrink-0 items-center border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
              style={{
                ...ring,
                borderRadius: "9999px",
                borderColor: showAdmin ? brand.primaryColor : BORDER,
                backgroundColor: showAdmin ? brand.primaryColor : "#E8E3D8",
              }}
            >
              <span
                className="h-4 w-4 rounded-full bg-white transition-transform"
                style={{ transform: showAdmin ? "translateX(1.6rem)" : "translateX(0.25rem)" }}
              />
            </button>
            <label id="admin-toggle-label" htmlFor="" className="text-[14px] leading-6" style={{ color: MUTED }}>
              <span className="block font-medium" style={{ color: INK }}>
                Show admin topics
              </span>
              Inviting and removing people, and deleting other people's uploads.
            </label>
          </div>
        </div>

        <div>
          <div aria-live="polite" className="sr-only">
            {searching ? results.length + " results for " + query : ""}
          </div>

          {searching ? (
            <section aria-label="Search results">
              <h2 className="text-2xl font-semibold tracking-tight" style={{ fontFamily: brand.fontHeading, color: INK }}>
                {results.length} {results.length === 1 ? "result" : "results"} for "{query.trim()}"
              </h2>

              {results.length > 0 ? (
                <ul className="mt-6 space-y-3">
                  {results.map((r) => (
                    <li key={r.key}>
                      <button
                        type="button"
                        onClick={() => openResult(r)}
                        className="w-full border p-5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                        style={{ ...ring, borderColor: BORDER, backgroundColor: SURFACE, borderRadius: brand.radius }}
                      >
                        <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: brand.accentColor }}>
                          {r.sectionTitle}
                        </span>
                        <span className="mt-1.5 block text-[16px] font-semibold" style={{ color: INK }}>
                          {r.title}
                        </span>
                        <span className="mt-1.5 block text-[14px] leading-6" style={{ color: MUTED }}>
                          {makeSnippet(r.text, q)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div
                  className="mt-6 border px-6 py-14 text-center"
                  style={{ borderColor: BORDER, backgroundColor: SURFACE, borderRadius: brand.radius }}
                >
                  <Icons.Search className="mx-auto h-6 w-6" aria-hidden="true" style={{ color: MUTED }} />
                  <h3 className="mt-4 text-[17px] font-semibold" style={{ color: INK }}>
                    Nothing in the help matches that
                  </h3>
                  <p className="mx-auto mt-2 max-w-md text-[15px] leading-7" style={{ color: MUTED }}>
                    {hiddenAdminMatches > 0
                      ? hiddenAdminMatches +
                        " admin topic" +
                        (hiddenAdminMatches === 1 ? "" : "s") +
                        " match your search but are hidden. Turn on admin topics to read them."
                      : "Try a word from the document itself, such as scanned, replace, citation or threshold."}
                  </p>
                  <div className="mt-6 flex justify-center gap-3">
                    {hiddenAdminMatches > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowAdmin(true)}
                        className="border px-4 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                        style={{ ...ring, borderColor: BORDER, color: INK, borderRadius: brand.radius }}
                      >
                        Show admin topics
                      </button>
                    )}
                    <Button
                      onClick={() => setQuery("")}
                      style={{ backgroundColor: brand.primaryColor, color: "#FFFDF8", borderRadius: brand.radius }}
                    >
                      Clear search
                    </Button>
                  </div>
                </div>
              )}
            </section>
          ) : (
            <section
              id={"tabpanel-" + section.id}
              role="tabpanel"
              aria-labelledby={"tab-" + section.id}
              tabIndex={-1}
              ref={panelRef}
              className="focus:outline-none"
            >
              <h2
                className="text-2xl font-semibold tracking-tight"
                style={{ fontFamily: brand.fontHeading, color: INK }}
              >
                {section.title}
              </h2>
              <p className="mt-3 max-w-[68ch] text-[16px] leading-8" style={{ color: MUTED }}>
                {section.lead}
              </p>

              <div className="mt-8 space-y-8">
                {section.articles.map((a) => (
                  <article
                    key={a.id}
                    className="border p-7"
                    style={{ borderColor: BORDER, backgroundColor: SURFACE, borderRadius: brand.radius }}
                  >
                    <h3
                      className="text-[19px] font-semibold tracking-tight"
                      style={{ fontFamily: brand.fontHeading, color: brand.primaryColor }}
                    >
                      {a.title}
                    </h3>
                    <div className="mt-4 max-w-[68ch] space-y-5">
                      {a.blocks.map((b, i) => renderBlock(b, a.id + "-" + i))}
                    </div>
                  </article>
                ))}
              </div>

              {section.id === "statuses" && (
                <p className="mt-6 text-[14px] leading-7" style={{ color: MUTED }}>
                  Statuses are shown against every row in the{" "}
                  <button
                    type="button"
                    onClick={() => navigate("library")}
                    className="font-medium underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                    style={{ ...ring, color: brand.primaryColor, borderRadius: brand.radius }}
                  >
                    document library
                  </button>
                  .
                </p>
              )}

              <Card className="mt-10">
                <CardHeader>
                  <CardTitle>Still stuck?</CardTitle>
                  <CardDescription>
                    Most questions are answered faster by looking at the thing itself than by reading about it.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-3 text-[15px] leading-7" style={{ color: MUTED }}>
                    <li>
                      A document is not being quoted: check its status is{" "}
                      <StatusTag s={STATUSES[2]} small /> in the library.
                    </li>
                    <li>An answer looks wrong: open its numbered marker and read the quoted passage.</li>
                    <li>Someone cannot sign in: an admin can re-invite them from Members.</li>
                  </ul>
                </CardContent>
                <CardFooter>
                  <div className="flex flex-wrap gap-3">
                    <Button
                      onClick={() => navigate("library")}
                      style={{ backgroundColor: brand.primaryColor, color: "#FFFDF8", borderRadius: brand.radius }}
                    >
                      Go to document library
                    </Button>
                    <button
                      type="button"
                      onClick={() => navigate("chat")}
                      className="border px-4 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                      style={{ ...ring, borderColor: BORDER, color: INK, borderRadius: brand.radius }}
                    >
                      Start a new chat
                    </button>
                  </div>
                </CardFooter>
              </Card>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
