import React from "react";

import * as UI from "@/lib/ui";
import { Icons } from "@/lib/icons";
import { brand } from "@/lib/brand";
import { useNavigate } from "@/lib/navigate";
import { listDocuments, uploadDocuments, type DocumentItem } from "@/lib/api";

const { Button, Input, Label, Table, THead, TBody, TR, TH, TD } = UI;

const CURRENT_USER = { id: "u-1", name: "Nadia Rahman", role: "member" as "member" | "admin" };

const MAX_BYTES = 50 * 1024 * 1024;

const ACCEPTED_FORMATS = ["pdf", "docx", "txt", "csv", "md"];

const FORMAT_LABELS: Record<string, string> = {
  pdf: "PDF",
  docx: "DOCX",
  txt: "TXT",
  csv: "CSV",
  md: "Markdown",
};

type StatusKey = "queued" | "processing" | "ready" | "failed";

const STATUS_META: Record<
  StatusKey,
  { label: string; fg: string; bg: string; icon: string; hint: string }
> = {
  queued: {
    label: "Queued",
    fg: "#5A544A",
    bg: "rgba(110, 103, 91, 0.14)",
    icon: "Clock",
    hint: "Waiting for a worker",
  },
  processing: {
    label: "Processing",
    fg: "#8A5312",
    bg: "rgba(193, 118, 26, 0.16)",
    icon: "Clock",
    hint: "Extracting, chunking and embedding",
  },
  ready: {
    label: "Ready",
    fg: "#1B5240",
    bg: "rgba(27, 82, 64, 0.12)",
    icon: "CheckCircle",
    hint: "Searchable by everyone in the workspace",
  },
  failed: {
    label: "Failed",
    fg: "#8C2F23",
    bg: "rgba(140, 47, 35, 0.12)",
    icon: "AlertCircle",
    hint: "Not retrieved and not cited",
  },
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const PAGE_SIZE = 8;

interface RejectedFile {
  name: string;
  reason: string;
}

interface ReplacePrompt {
  duplicates: { filename: string; existing_document_id: string }[];
  queuedCount: number;
}

export default function Screen() {
  const navigate = useNavigate();
  const [documents, setDocuments] = React.useState<DocumentItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(false);

  const [query, setQuery] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<"all" | StatusKey>("all");
  const [formatFilter, setFormatFilter] = React.useState("all");
  const [page, setPage] = React.useState(1);
  const [dragging, setDragging] = React.useState(false);
  const [rejections, setRejections] = React.useState<RejectedFile[]>([]);
  const [notice, setNotice] = React.useState("");
  const [deleteTarget, setDeleteTarget] = React.useState<DocumentItem | null>(null);
  const [replacePrompt, setReplacePrompt] = React.useState<ReplacePrompt | null>(null);

  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const confirmRef = React.useRef<HTMLButtonElement | null>(null);
  const returnFocusRef = React.useRef<HTMLElement | null>(null);
  const pendingFilesRef = React.useRef<Map<string, File>>(new Map());

  const dialogOpen = Boolean(deleteTarget) || Boolean(replacePrompt);

  const fetchAll = React.useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      let items: DocumentItem[] = [];
      let nextPage: number | null = 1;
      while (nextPage !== null) {
        const res = await listDocuments({ page: nextPage, page_size: 100 });
        items = items.concat(res.items);
        nextPage = res.next;
      }
      setDocuments(items);
    } catch {
      setLoadError("Could not load the document library. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  React.useEffect(() => {
    if (dialogOpen && confirmRef.current) confirmRef.current.focus();
  }, [dialogOpen]);

  const fmtSize = (bytes: number) => {
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + " MB";
    if (bytes >= 1024) return Math.round(bytes / 1024) + " KB";
    return bytes + " B";
  };

  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${hh}:${mm}`;
  };

  const counts = React.useMemo(() => {
    const base: Record<"all" | StatusKey, number> = {
      all: documents.length,
      queued: 0,
      processing: 0,
      ready: 0,
      failed: 0,
    };
    documents.forEach((d) => {
      base[d.status] += 1;
    });
    return base;
  }, [documents]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return documents.filter((d) => {
      if (statusFilter !== "all" && d.status !== statusFilter) return false;
      if (formatFilter !== "all" && d.format !== formatFilter) return false;
      if (!q) return true;
      return d.filename.toLowerCase().includes(q) || d.uploader.toLowerCase().includes(q);
    });
  }, [documents, query, statusFilter, formatFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * PAGE_SIZE;
  const visible = filtered.slice(start, start + PAGE_SIZE);

  const resetPaging = () => setPage(1);

  const handleFiles = async (fileList: FileList | null) => {
    const files = Array.from(fileList ?? []);
    if (!files.length) return;
    const rejected: RejectedFile[] = [];
    const accepted: File[] = [];

    files.forEach((file) => {
      const ext = (file.name.split(".").pop() || "").toLowerCase();
      if (!ACCEPTED_FORMATS.includes(ext)) {
        rejected.push({
          name: file.name,
          reason: "Unsupported format. The library accepts PDF, DOCX, TXT, CSV and Markdown only.",
        });
      } else if (file.size > MAX_BYTES) {
        rejected.push({
          name: file.name,
          reason: `${fmtSize(file.size)} is over the 50MB limit per file. Nothing was stored.`,
        });
      } else {
        accepted.push(file);
      }
    });

    setRejections(rejected);

    if (!accepted.length) {
      setNotice(rejected.length ? "Nothing was uploaded. See the rejected files below." : "");
      return;
    }

    setUploading(true);
    try {
      const results = await uploadDocuments(accepted);
      const fileMap = new Map(accepted.map((f) => [f.name, f]));
      const duplicates = results.filter((r) => r.status === "duplicate");
      const apiRejected = results.filter((r) => r.status === "rejected");
      const queuedCount = results.filter((r) => r.status === "queued").length;

      if (apiRejected.length) {
        setRejections((prev) => [
          ...prev,
          ...apiRejected.map((r) => ({
            name: r.filename,
            reason: r.error ?? "Rejected by the server.",
          })),
        ]);
      }

      if (duplicates.length) {
        pendingFilesRef.current = fileMap;
        returnFocusRef.current = document.activeElement as HTMLElement | null;
        setReplacePrompt({
          duplicates: duplicates.map((d) => ({
            filename: d.filename,
            existing_document_id: d.existing_document_id ?? "",
          })),
          queuedCount,
        });
      } else {
        pendingFilesRef.current = new Map();
        if (queuedCount) {
          setNotice(`${queuedCount} file${queuedCount === 1 ? "" : "s"} queued for processing.`);
        } else if (rejected.length || apiRejected.length) {
          setNotice("Nothing was uploaded. See the rejected files below.");
        }
      }

      if (queuedCount) {
        resetPaging();
        await fetchAll();
      }
    } catch {
      setNotice("Upload failed. Please check your connection and try again.");
    } finally {
      setUploading(false);
    }
  };

  const closeDialogs = () => {
    setDeleteTarget(null);
    setReplacePrompt(null);
    const el = returnFocusRef.current;
    if (el && typeof el.focus === "function") el.focus();
  };

  const confirmReplace = async () => {
    if (!replacePrompt) return;
    const { duplicates } = replacePrompt;
    const files: File[] = [];
    const ids: string[] = [];
    duplicates.forEach((d) => {
      const file = pendingFilesRef.current.get(d.filename);
      if (file) {
        files.push(file);
        ids.push(d.existing_document_id);
      }
    });
    closeDialogs();
    pendingFilesRef.current = new Map();
    if (!files.length) return;

    setUploading(true);
    try {
      await uploadDocuments(files, ids);
      setNotice(
        `${files.length} file${files.length === 1 ? "" : "s"} re-uploaded to replace the existing version. The list has been refreshed to show the new version queued.`,
      );
      resetPaging();
      await fetchAll();
    } catch {
      setNotice("The replacement upload failed. Please check your connection and try again.");
    } finally {
      setUploading(false);
    }
  };

  const skipReplace = () => {
    if (!replacePrompt) return;
    const { duplicates, queuedCount } = replacePrompt;
    const parts: string[] = [];
    if (queuedCount) {
      parts.push(`${queuedCount} file${queuedCount === 1 ? "" : "s"} queued for processing.`);
    }
    parts.push(
      `${duplicates.length} existing version${duplicates.length === 1 ? "" : "s"} ${
        duplicates.length === 1 ? "is" : "are"
      } still in place; nothing was uploaded for ${duplicates.length === 1 ? "it" : "them"}.`,
    );
    setNotice(parts.join(" "));
    pendingFilesRef.current = new Map();
    closeDialogs();
  };

  const confirmDelete = () => {
    const doc = deleteTarget;
    if (!doc) return;
    setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
    setNotice(
      `${doc.filename} deleted. Its chunks, embeddings and original file have been removed.`,
    );
    closeDialogs();
  };

  const canDelete = (doc: DocumentItem) =>
    doc.uploader === CURRENT_USER.name || CURRENT_USER.role === "admin";

  const requestDelete = (doc: DocumentItem, event: React.MouseEvent<HTMLButtonElement>) => {
    if (!canDelete(doc)) {
      setNotice(`Only ${doc.uploader} or a workspace admin can delete ${doc.filename}.`);
      return;
    }
    returnFocusRef.current = event.currentTarget;
    setDeleteTarget(doc);
  };

  const onDialogKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      closeDialogs();
    }
  };

  const focusRing =
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-emerald-800";

  const StatusTag = ({ status }: { status: StatusKey }) => {
    const meta = STATUS_META[status];
    const Icon = Icons[meta.icon];
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold"
        style={{ color: meta.fg, backgroundColor: meta.bg }}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {meta.label}
      </span>
    );
  };

  const filterButtons: { key: "all" | StatusKey; label: string }[] = [
    { key: "all", label: "All" },
    { key: "ready", label: "Ready" },
    { key: "processing", label: "Processing" },
    { key: "queued", label: "Queued" },
    { key: "failed", label: "Failed" },
  ];

  const dropzone = (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        handleFiles(e.dataTransfer.files);
      }}
      className="rounded-lg border-2 border-dashed p-6 transition-colors sm:p-8"
      style={{
        borderColor: dragging ? brand.primaryColor : "rgba(110,103,91,0.35)",
        backgroundColor: dragging ? "rgba(27,82,64,0.06)" : "#FFFFFF",
      }}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-md">
          <p
            className="text-base font-semibold"
            style={{ color: "#241F18", fontFamily: brand.fontHeading }}
          >
            Drag files here, or choose them below
          </p>
          <p className="mt-1.5 text-sm leading-relaxed" style={{ color: brand.neutralColor }}>
            PDF, DOCX, TXT, CSV and Markdown, up to 50MB each. Several files at a time is fine —
            each one is tracked separately.
          </p>
        </div>
        <div className="shrink-0">
          <Label
            htmlFor="library-file-input"
            className="mb-2 block text-sm font-medium"
            style={{ color: "#241F18" }}
          >
            Choose files to upload
          </Label>
          <input
            id="library-file-input"
            ref={fileInputRef}
            type="file"
            multiple
            disabled={uploading}
            accept=".pdf,.docx,.txt,.csv,.md"
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = "";
            }}
            className={
              "block w-full max-w-xs cursor-pointer rounded-md border bg-white text-sm file:mr-3 file:cursor-pointer file:rounded-l-md file:border-0 file:px-4 file:py-2.5 file:text-sm file:font-semibold file:text-white disabled:cursor-not-allowed disabled:opacity-60 " +
              focusRing
            }
            style={{
              borderColor: "rgba(110,103,91,0.35)",
              color: brand.neutralColor,
            }}
          />
        </div>
      </div>
    </div>
  );

  const Label2 = Label;

  return (
    <div
      className="min-h-full w-full"
      style={{ backgroundColor: brand.backgroundColor, fontFamily: brand.fontBody }}
    >
      <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        {/* Heading */}
        <header className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-2xl">
            <h1
              className="text-3xl font-semibold tracking-tight"
              style={{ color: "#241F18", fontFamily: brand.fontHeading }}
            >
              Document library
            </h1>
            <p className="mt-3 text-base leading-relaxed" style={{ color: brand.neutralColor }}>
              Everything the team has uploaded, shared across the workspace. The assistant answers
              only from documents marked ready — nothing else is retrieved or cited.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              onClick={() => navigate("help")}
              className={
                "inline-flex items-center gap-2 rounded-md border bg-transparent px-4 py-2.5 text-sm font-medium " +
                focusRing
              }
              style={{
                borderColor: "rgba(110,103,91,0.35)",
                color: "#241F18",
              }}
            >
              <Icons.FileText className="h-4 w-4" aria-hidden="true" />
              Limitations
            </Button>
            <Button
              type="button"
              disabled={uploading}
              onClick={() => fileInputRef.current && fileInputRef.current.click()}
              className={
                "inline-flex items-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60 " +
                focusRing
              }
              style={{ backgroundColor: brand.primaryColor }}
            >
              <Icons.Upload className="h-4 w-4" aria-hidden="true" />
              {uploading ? "Uploading…" : "Upload files"}
            </Button>
          </div>
        </header>

        {/* Live region for upload / delete feedback */}
        <div role="status" aria-live="polite" className="mt-6">
          {notice ? (
            <div
              className="flex items-start gap-3 rounded-md border px-4 py-3"
              style={{
                borderColor: "rgba(27,82,64,0.30)",
                backgroundColor: "rgba(27,82,64,0.07)",
              }}
            >
              <Icons.CheckCircle
                className="mt-0.5 h-4 w-4 shrink-0"
                aria-hidden="true"
                style={{ color: brand.primaryColor }}
              />
              <p className="text-sm leading-relaxed" style={{ color: "#214A3C" }}>
                {notice}
              </p>
              <button
                type="button"
                onClick={() => setNotice("")}
                aria-label="Dismiss this message"
                className={"ml-auto rounded p-1 " + focusRing}
                style={{ color: brand.neutralColor }}
              >
                <Icons.X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          ) : null}
        </div>

        {/* Upload */}
        <section aria-labelledby="upload-heading" className="mt-8">
          <h2
            id="upload-heading"
            className="text-lg font-semibold"
            style={{ color: "#241F18", fontFamily: brand.fontHeading }}
          >
            Add documents
          </h2>
          <div className="mt-4">{dropzone}</div>

          {rejections.length > 0 ? (
            <div
              className="mt-4 rounded-md border px-4 py-3"
              style={{
                borderColor: "rgba(140,47,35,0.35)",
                backgroundColor: "rgba(140,47,35,0.07)",
              }}
            >
              <div className="flex items-start gap-3">
                <Icons.AlertCircle
                  className="mt-0.5 h-4 w-4 shrink-0"
                  aria-hidden="true"
                  style={{ color: "#8C2F23" }}
                />
                <div className="flex-1">
                  <h3 className="text-sm font-semibold" style={{ color: "#8C2F23" }}>
                    {rejections.length} file{rejections.length === 1 ? "" : "s"} rejected before
                    upload
                  </h3>
                  <ul className="mt-2 space-y-1.5">
                    {rejections.map((r) => (
                      <li
                        key={r.name}
                        className="text-sm leading-relaxed"
                        style={{ color: "#6B3027" }}
                      >
                        <span className="font-medium">{r.name}</span> — {r.reason}
                      </li>
                    ))}
                  </ul>
                </div>
                <button
                  type="button"
                  onClick={() => setRejections([])}
                  aria-label="Dismiss rejected files"
                  className={"rounded p-1 " + focusRing}
                  style={{ color: "#8C2F23" }}
                >
                  <Icons.X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          ) : null}
        </section>

        {/* Library */}
        <section aria-labelledby="library-heading" className="mt-10">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2
              id="library-heading"
              className="text-lg font-semibold"
              style={{ color: "#241F18", fontFamily: brand.fontHeading }}
            >
              All documents
            </h2>
            <p className="text-sm" style={{ color: brand.neutralColor }}>
              Signed in as {CURRENT_USER.name} ({CURRENT_USER.role}). You can delete documents you
              uploaded; admins can delete any.
            </p>
          </div>

          {loading ? (
            <div
              className="mt-5 rounded-lg border bg-white px-6 py-14 text-center"
              style={{ borderColor: "rgba(110,103,91,0.25)" }}
            >
              <p className="text-sm" style={{ color: brand.neutralColor }}>
                Loading the document library…
              </p>
            </div>
          ) : loadError ? (
            <div
              className="mt-5 rounded-lg border bg-white px-6 py-14 text-center"
              style={{ borderColor: "rgba(140,47,35,0.35)" }}
            >
              <Icons.AlertCircle
                className="mx-auto h-8 w-8"
                aria-hidden="true"
                style={{ color: "#8C2F23" }}
              />
              <h3
                className="mt-4 text-base font-semibold"
                style={{ color: "#241F18", fontFamily: brand.fontHeading }}
              >
                Could not load the library
              </h3>
              <p
                className="mx-auto mt-2 max-w-md text-sm leading-relaxed"
                style={{ color: brand.neutralColor }}
              >
                {loadError}
              </p>
              <Button
                type="button"
                onClick={() => fetchAll()}
                className={
                  "mt-6 inline-flex items-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold text-white " +
                  focusRing
                }
                style={{ backgroundColor: brand.primaryColor }}
              >
                Try again
              </Button>
            </div>
          ) : documents.length === 0 ? (
            <div
              className="mt-5 rounded-lg border bg-white px-6 py-14 text-center"
              style={{ borderColor: "rgba(110,103,91,0.25)" }}
            >
              <Icons.Package
                className="mx-auto h-8 w-8"
                aria-hidden="true"
                style={{ color: brand.accentColor }}
              />
              <h3
                className="mt-4 text-base font-semibold"
                style={{ color: "#241F18", fontFamily: brand.fontHeading }}
              >
                The library is empty
              </h3>
              <p
                className="mx-auto mt-2 max-w-md text-sm leading-relaxed"
                style={{ color: brand.neutralColor }}
              >
                The assistant can only answer from documents uploaded here. Add a PDF, DOCX, TXT,
                CSV or Markdown file and it becomes searchable for the whole team once processing
                finishes.
              </p>
              <Button
                type="button"
                onClick={() => fileInputRef.current && fileInputRef.current.click()}
                className={
                  "mt-6 inline-flex items-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold text-white " +
                  focusRing
                }
                style={{ backgroundColor: brand.primaryColor }}
              >
                <Icons.Plus className="h-4 w-4" aria-hidden="true" />
                Upload the first document
              </Button>
            </div>
          ) : (
            <React.Fragment>
              {/* Toolbar */}
              <div className="mt-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
                  <div className="w-full sm:w-72">
                    <Label2
                      htmlFor="library-search"
                      className="mb-1.5 block text-sm font-medium"
                      style={{ color: "#241F18" }}
                    >
                      Search documents
                    </Label2>
                    <div className="relative">
                      <Icons.Search
                        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
                        aria-hidden="true"
                        style={{ color: brand.neutralColor }}
                      />
                      <Input
                        id="library-search"
                        type="search"
                        value={query}
                        onChange={(e) => {
                          setQuery(e.target.value);
                          resetPaging();
                        }}
                        placeholder="File name or uploader"
                        className={
                          "w-full rounded-md border bg-white py-2.5 pl-9 pr-3 text-sm " + focusRing
                        }
                        style={{
                          borderColor: "rgba(110,103,91,0.35)",
                          color: "#241F18",
                        }}
                      />
                    </div>
                  </div>

                  <div className="w-full sm:w-48">
                    <Label2
                      htmlFor="library-format"
                      className="mb-1.5 block text-sm font-medium"
                      style={{ color: "#241F18" }}
                    >
                      Format
                    </Label2>
                    <select
                      id="library-format"
                      value={formatFilter}
                      onChange={(e) => {
                        setFormatFilter(e.target.value);
                        resetPaging();
                      }}
                      className={
                        "w-full rounded-md border bg-white px-3 py-2.5 text-sm " + focusRing
                      }
                      style={{
                        borderColor: "rgba(110,103,91,0.35)",
                        color: "#241F18",
                      }}
                    >
                      <option value="all">All formats</option>
                      {ACCEPTED_FORMATS.map((f) => (
                        <option key={f} value={f}>
                          {FORMAT_LABELS[f]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <h3
                    className="mb-1.5 text-sm font-medium"
                    style={{ color: "#241F18" }}
                    id="status-filter-label"
                  >
                    Processing status
                  </h3>
                  <div
                    className="flex flex-wrap gap-2"
                    role="group"
                    aria-labelledby="status-filter-label"
                  >
                    {filterButtons.map((f) => {
                      const active = statusFilter === f.key;
                      return (
                        <button
                          key={f.key}
                          type="button"
                          aria-pressed={active}
                          onClick={() => {
                            setStatusFilter(f.key);
                            resetPaging();
                          }}
                          className={
                            "rounded-md border px-3 py-2 text-sm font-medium transition-colors " +
                            focusRing
                          }
                          style={{
                            borderColor: active ? brand.primaryColor : "rgba(110,103,91,0.30)",
                            backgroundColor: active ? brand.primaryColor : "#FFFFFF",
                            color: active ? "#FFFFFF" : "#241F18",
                          }}
                        >
                          {f.label}
                          <span
                            className="ml-1.5 tabular-nums"
                            style={{
                              color: active ? "rgba(255,255,255,0.78)" : brand.neutralColor,
                            }}
                          >
                            {counts[f.key]}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Table */}
              <div
                className="mt-5 overflow-hidden rounded-lg border bg-white"
                style={{ borderColor: "rgba(110,103,91,0.25)" }}
              >
                {filtered.length === 0 ? (
                  <div className="px-6 py-14 text-center">
                    <Icons.Search
                      className="mx-auto h-7 w-7"
                      aria-hidden="true"
                      style={{ color: brand.neutralColor }}
                    />
                    <h3
                      className="mt-4 text-base font-semibold"
                      style={{ color: "#241F18", fontFamily: brand.fontHeading }}
                    >
                      No documents match these filters
                    </h3>
                    <p
                      className="mx-auto mt-2 max-w-sm text-sm leading-relaxed"
                      style={{ color: brand.neutralColor }}
                    >
                      {documents.length} document
                      {documents.length === 1 ? " is" : "s are"} in the library. Try a different
                      search term, format or status.
                    </p>
                    <Button
                      type="button"
                      onClick={() => {
                        setQuery("");
                        setStatusFilter("all");
                        setFormatFilter("all");
                        resetPaging();
                      }}
                      className={
                        "mt-5 inline-flex items-center gap-2 rounded-md border bg-transparent px-4 py-2 text-sm font-medium " +
                        focusRing
                      }
                      style={{
                        borderColor: "rgba(110,103,91,0.35)",
                        color: "#241F18",
                      }}
                    >
                      <Icons.X className="h-4 w-4" aria-hidden="true" />
                      Clear filters
                    </Button>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table className="w-full min-w-[46rem] border-collapse text-left">
                      <caption className="sr-only">
                        Documents in the shared workspace library, newest first
                      </caption>
                      <THead>
                        <TR
                          style={{
                            backgroundColor: "rgba(110,103,91,0.07)",
                          }}
                        >
                          <TH
                            scope="col"
                            className="px-5 py-3 text-xs font-semibold uppercase tracking-wide"
                            style={{ color: brand.neutralColor }}
                          >
                            Document
                          </TH>
                          <TH
                            scope="col"
                            className="hidden px-5 py-3 text-xs font-semibold uppercase tracking-wide md:table-cell"
                            style={{ color: brand.neutralColor }}
                          >
                            Format
                          </TH>
                          <TH
                            scope="col"
                            className="hidden px-5 py-3 text-xs font-semibold uppercase tracking-wide sm:table-cell"
                            style={{ color: brand.neutralColor }}
                          >
                            Size
                          </TH>
                          <TH
                            scope="col"
                            className="hidden px-5 py-3 text-xs font-semibold uppercase tracking-wide lg:table-cell"
                            style={{ color: brand.neutralColor }}
                          >
                            Uploaded by
                          </TH>
                          <TH
                            scope="col"
                            className="px-5 py-3 text-xs font-semibold uppercase tracking-wide"
                            style={{ color: brand.neutralColor }}
                          >
                            Status
                          </TH>
                          <TH
                            scope="col"
                            className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide"
                            style={{ color: brand.neutralColor }}
                          >
                            Actions
                          </TH>
                        </TR>
                      </THead>
                      <TBody>
                        {visible.map((doc) => {
                          const meta = STATUS_META[doc.status];
                          return (
                            <TR
                              key={doc.id}
                              className="align-top hover:bg-stone-50"
                              style={{ borderTop: "1px solid rgba(110,103,91,0.18)" }}
                            >
                              <TH scope="row" className="px-5 py-4 text-left font-normal">
                                <span
                                  className="block text-sm font-semibold"
                                  style={{ color: "#241F18" }}
                                >
                                  {doc.filename}
                                </span>
                                <span
                                  className="mt-1 block text-xs"
                                  style={{ color: brand.neutralColor }}
                                >
                                  {fmtDate(doc.created_at)}
                                  {doc.supersedes_document_id
                                    ? " · supersedes an earlier version"
                                    : ""}
                                  <span className="lg:hidden"> · {doc.uploader}</span>
                                </span>
                                {doc.status === "failed" && doc.failure_reason ? (
                                  <span
                                    className="mt-2 block max-w-md text-xs leading-relaxed"
                                    style={{ color: "#8C2F23" }}
                                  >
                                    {doc.failure_reason}
                                    {doc.previous_version_retained !== null ? (
                                      <>
                                        {" "}
                                        {doc.previous_version_retained
                                          ? "The previous version is still in place and remains searchable."
                                          : "The previous version was not retained; nothing from it is searchable now."}
                                      </>
                                    ) : null}
                                  </span>
                                ) : null}
                                {doc.status !== "failed" ? (
                                  <span className="sr-only">{meta.hint}</span>
                                ) : null}
                              </TH>
                              <TD
                                className="hidden px-5 py-4 text-sm md:table-cell"
                                style={{ color: brand.neutralColor }}
                              >
                                {FORMAT_LABELS[doc.format] ?? doc.format}
                              </TD>
                              <TD
                                className="hidden whitespace-nowrap px-5 py-4 text-sm tabular-nums sm:table-cell"
                                style={{ color: brand.neutralColor }}
                              >
                                {fmtSize(doc.size_bytes)}
                              </TD>
                              <TD
                                className="hidden px-5 py-4 text-sm lg:table-cell"
                                style={{ color: brand.neutralColor }}
                              >
                                {doc.uploader}
                                {doc.uploader === CURRENT_USER.name ? (
                                  <span
                                    className="ml-1.5 text-xs"
                                    style={{ color: brand.accentColor }}
                                  >
                                    (you)
                                  </span>
                                ) : null}
                              </TD>
                              <TD className="px-5 py-4">
                                <StatusTag status={doc.status} />
                              </TD>
                              <TD className="px-5 py-4">
                                <div className="flex items-center justify-end gap-1.5">
                                  {doc.status === "ready" ? (
                                    <button
                                      type="button"
                                      onClick={() => navigate("chat")}
                                      className={
                                        "rounded-md border px-2.5 py-1.5 text-xs font-semibold " +
                                        focusRing
                                      }
                                      style={{
                                        borderColor: "rgba(27,82,64,0.35)",
                                        color: brand.primaryColor,
                                      }}
                                    >
                                      Ask in chat
                                      <span className="sr-only"> about {doc.filename}</span>
                                    </button>
                                  ) : null}
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setNotice(`Downloading the original file ${doc.filename}.`)
                                    }
                                    aria-label={`Download original file ${doc.filename}`}
                                    className={"rounded-md p-2 hover:bg-stone-100 " + focusRing}
                                    style={{ color: brand.neutralColor }}
                                  >
                                    <Icons.Download className="h-4 w-4" aria-hidden="true" />
                                  </button>
                                  <button
                                    type="button"
                                    aria-disabled={!canDelete(doc)}
                                    onClick={(e) => requestDelete(doc, e)}
                                    aria-label={
                                      canDelete(doc)
                                        ? `Delete ${doc.filename}`
                                        : `Delete ${doc.filename} (not available — only the uploader or an admin can delete this)`
                                    }
                                    className={"rounded-md p-2 hover:bg-stone-100 " + focusRing}
                                    style={{
                                      color: canDelete(doc) ? "#8C2F23" : "rgba(110,103,91,0.45)",
                                    }}
                                  >
                                    <Icons.Trash className="h-4 w-4" aria-hidden="true" />
                                  </button>
                                </div>
                              </TD>
                            </TR>
                          );
                        })}
                      </TBody>
                    </Table>
                  </div>
                )}
              </div>

              {/* Pagination */}
              {filtered.length > 0 ? (
                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm" style={{ color: brand.neutralColor }}>
                    Showing {start + 1}–{Math.min(start + PAGE_SIZE, filtered.length)} of{" "}
                    {filtered.length} document{filtered.length === 1 ? "" : "s"}
                    {filtered.length !== documents.length
                      ? ` (filtered from ${documents.length})`
                      : ""}
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPage(Math.max(1, safePage - 1))}
                      disabled={safePage === 1}
                      className={
                        "inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-40 " +
                        focusRing
                      }
                      style={{
                        borderColor: "rgba(110,103,91,0.35)",
                        color: "#241F18",
                      }}
                    >
                      <Icons.ChevronLeft className="h-4 w-4" aria-hidden="true" />
                      Previous
                    </button>
                    <span className="text-sm tabular-nums" style={{ color: brand.neutralColor }}>
                      Page {safePage} of {totalPages}
                    </span>
                    <button
                      type="button"
                      onClick={() => setPage(Math.min(totalPages, safePage + 1))}
                      disabled={safePage === totalPages}
                      className={
                        "inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-40 " +
                        focusRing
                      }
                      style={{
                        borderColor: "rgba(110,103,91,0.35)",
                        color: "#241F18",
                      }}
                    >
                      Next
                      <Icons.ChevronRight className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ) : null}
            </React.Fragment>
          )}
        </section>
      </div>

      {/* Replace-existing-version dialog */}
      {replacePrompt ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(28, 25, 20, 0.45)" }}
          onKeyDown={onDialogKeyDown}
          onClick={(e) => {
            if (e.target === e.currentTarget) skipReplace();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="replace-title"
            aria-describedby="replace-desc"
            className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl"
          >
            <h2
              id="replace-title"
              className="text-lg font-semibold"
              style={{ color: "#241F18", fontFamily: brand.fontHeading }}
            >
              A version already exists
            </h2>
            <p
              id="replace-desc"
              className="mt-3 text-sm leading-relaxed"
              style={{ color: brand.neutralColor }}
            >
              The library already holds{" "}
              {replacePrompt.duplicates.length === 1 ? "a document" : "documents"} with the same
              file name. Replacing supersedes the previous version: once the new file is processed,
              the old chunks and embeddings are removed and only the new content is retrievable.
            </p>
            <ul className="mt-4 space-y-2">
              {replacePrompt.duplicates.map((d) => (
                <li
                  key={d.filename}
                  className="rounded-md px-3 py-2 text-sm font-medium"
                  style={{
                    backgroundColor: "rgba(193,118,26,0.10)",
                    color: "#7A4A10",
                  }}
                >
                  {d.filename}
                </li>
              ))}
            </ul>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                onClick={skipReplace}
                className={
                  "rounded-md border bg-transparent px-4 py-2.5 text-sm font-medium " + focusRing
                }
                style={{ borderColor: "rgba(110,103,91,0.35)", color: "#241F18" }}
              >
                Keep existing version
              </Button>
              <Button
                type="button"
                ref={confirmRef}
                onClick={confirmReplace}
                disabled={uploading}
                className={
                  "rounded-md px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60 " +
                  focusRing
                }
                style={{ backgroundColor: brand.primaryColor }}
              >
                Replace and re-embed
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Delete confirmation dialog */}
      {deleteTarget ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(28, 25, 20, 0.45)" }}
          onKeyDown={onDialogKeyDown}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeDialogs();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-title"
            aria-describedby="delete-desc"
            className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl"
          >
            <h2
              id="delete-title"
              className="text-lg font-semibold"
              style={{ color: "#241F18", fontFamily: brand.fontHeading }}
            >
              Delete {deleteTarget.filename}?
            </h2>
            <p
              id="delete-desc"
              className="mt-3 text-sm leading-relaxed"
              style={{ color: brand.neutralColor }}
            >
              The document, its chunks and its embeddings are removed, and the original file is
              deleted from storage. Existing answers that cite it will report that the source is no
              longer available. This cannot be undone.
            </p>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                ref={confirmRef}
                onClick={closeDialogs}
                className={
                  "rounded-md border bg-transparent px-4 py-2.5 text-sm font-medium " + focusRing
                }
                style={{ borderColor: "rgba(110,103,91,0.35)", color: "#241F18" }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={confirmDelete}
                className={"rounded-md px-4 py-2.5 text-sm font-semibold text-white " + focusRing}
                style={{ backgroundColor: "#8C2F23" }}
              >
                Delete document
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
