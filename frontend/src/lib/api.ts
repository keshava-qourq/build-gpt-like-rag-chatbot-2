/// <reference types="vite/client" />
// Without the reference above, `import.meta.env` is not typed and `tsc --noEmit` fails --
// which `vite build` does not catch, because it tree-shakes this module out when no screen
// imports it yet.
//
// Where the generated API lives.
//
// Set at build time: the platform bakes the deployed API URL into the frontend build. The
// fallback is the local backend so a bare `npm run dev` still points somewhere real.
//
// The generated screens do NOT use this yet -- they render seeded sample data, exactly as
// they were approved. This is the seam to replace that with real calls, one screen at a
// time.
export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

/**
 * Every request the frontend makes carries whatever bearer token sign-in
 * stored, if any. Reading it lazily (rather than caching it in a module
 * variable) means a sign-in or sign-out in another tab is picked up on the
 * next request without a reload.
 */
function authHeaders(): Record<string, string> {
  if (typeof localStorage === "undefined") return {};
  const token = localStorage.getItem("auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...authHeaders(), ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    throw new Error(`${init?.method ?? "GET"} ${path} failed: ${response.status}`);
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

/**
 * Multipart upload. Deliberately does not set a Content-Type header -- the
 * browser needs to set its own multipart boundary, which `apiFetch`'s fixed
 * `application/json` header would otherwise clobber.
 */
export async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: { ...authHeaders() },
    body: formData,
  });
  if (!response.ok) {
    throw new Error(`POST ${path} failed: ${response.status}`);
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

export type DocumentStatus = "queued" | "processing" | "ready" | "failed";

export interface DocumentItem {
  id: string;
  filename: string;
  format: string;
  size_bytes: number;
  uploader: string;
  status: DocumentStatus;
  failure_reason: string | null;
  supersedes_document_id: string | null;
  previous_version_retained: boolean | null;
  created_at: string;
}

export interface DocumentsListResponse {
  items: DocumentItem[];
  next: number | null;
}

export type UploadResultStatus = "queued" | "rejected" | "duplicate";

export interface UploadResultItem {
  id: string;
  filename: string;
  status: UploadResultStatus;
  error?: string;
  existing_document_id?: string;
  replaces_document_id?: string;
}

export async function listDocuments(params: {
  page?: number;
  page_size?: number;
}): Promise<DocumentsListResponse> {
  const qs = new URLSearchParams();
  if (params.page !== undefined) qs.set("page", String(params.page));
  if (params.page_size !== undefined) qs.set("page_size", String(params.page_size));
  const query = qs.toString();
  return apiFetch<DocumentsListResponse>(`/documents${query ? `?${query}` : ""}`);
}

export async function uploadDocuments(
  files: File[],
  replaceDocumentIds?: string[],
): Promise<UploadResultItem[]> {
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));
  (replaceDocumentIds ?? []).forEach((id) => formData.append("replace_document_ids", id));
  return apiUpload<UploadResultItem[]>("/documents", formData);
}

// ---- Conversations / chat ----

export interface ConversationSummaryDTO {
  id: string;
  title: string | null;
  updated_at: string;
}

export interface ConversationCreateResult {
  id: string;
}

export interface CitationItem {
  marker: number;
  document_id: string | null;
  filename: string;
  format?: string;
  location_label: string | null;
  snapshot_text: string;
  deleted?: boolean;
}

export interface ConversationMessageDTO {
  id?: string;
  role: "user" | "assistant";
  content: string;
  citations: CitationItem[];
}

export interface ConversationDetailDTO {
  id: string;
  title: string | null;
  messages: ConversationMessageDTO[];
}

export async function listConversations(): Promise<ConversationSummaryDTO[]> {
  return apiFetch<ConversationSummaryDTO[]>("/conversations");
}

export async function createConversation(): Promise<ConversationCreateResult> {
  return apiFetch<ConversationCreateResult>("/conversations", { method: "POST" });
}

export async function getConversation(id: string): Promise<ConversationDetailDTO> {
  return apiFetch<ConversationDetailDTO>(`/conversations/${id}`);
}

export async function renameConversation(
  id: string,
  title: string,
): Promise<{ id: string; title: string }> {
  return apiFetch<{ id: string; title: string }>(`/conversations/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
}

export async function deleteConversation(id: string): Promise<void> {
  return apiFetch<void>(`/conversations/${id}`, { method: "DELETE" });
}

export interface DownloadUrlResponse {
  url: string;
}

/**
 * Resolves a presigned download URL for a document's original file. A 410
 * means the original was removed from storage; the caller is expected to
 * detect that status from the thrown error's message (`apiFetch` embeds the
 * status code) rather than this function special-casing it, mirroring how
 * 404 is detected elsewhere in this module.
 */
export async function getDocumentDownloadUrl(documentId: string): Promise<DownloadUrlResponse> {
  return apiFetch<DownloadUrlResponse>(`/documents/${documentId}/download`);
}

export type ChatStreamEvent =
  | { type: "token"; token: string }
  | { type: "citations"; citations: CitationItem[] }
  | { type: "error"; message: string };

/**
 * Streams an assistant answer with `fetch` + `ReadableStream`, not
 * `EventSource` -- EventSource cannot send a POST body or an Authorization
 * header, both of which this endpoint requires. `signal` is wired to an
 * `AbortController` so Stop can cut the connection from the caller.
 */
/**
 * Shared SSE body reader for both a fresh turn and a regenerate. Kept as one
 * function so the two request kinds cannot drift into two different parsers
 * -- only the request that produces `response` differs between them.
 */
async function readSSE(
  response: Response,
  onEvent: (event: ChatStreamEvent) => void,
): Promise<void> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const handleRawEvent = (raw: string) => {
    let eventName = "message";
    let data = "";
    for (const line of raw.split("\n")) {
      if (line.startsWith("event:")) eventName = line.slice(6).trim();
      else if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    if (!data) return;
    if (eventName === "token") {
      try {
        const parsed = JSON.parse(data);
        const token = typeof parsed === "string" ? parsed : (parsed.token ?? "");
        onEvent({ type: "token", token });
      } catch {
        onEvent({ type: "token", token: data });
      }
      return;
    }
    if (eventName === "citations") {
      try {
        const parsed = JSON.parse(data) as CitationItem[];
        onEvent({ type: "citations", citations: Array.isArray(parsed) ? parsed : [] });
      } catch {
        onEvent({ type: "error", message: "The source list could not be read." });
      }
      return;
    }
    if (eventName === "error") {
      let message = "The answer stream was interrupted.";
      try {
        const parsed = JSON.parse(data);
        message = parsed.message ?? message;
      } catch {
        if (data) message = data;
      }
      onEvent({ type: "error", message });
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx = buffer.indexOf("\n\n");
    while (idx !== -1) {
      handleRawEvent(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 2);
      idx = buffer.indexOf("\n\n");
    }
  }
  if (buffer.trim()) handleRawEvent(buffer);
}

export async function streamAssistantMessage(
  conversationId: string,
  content: string,
  onEvent: (event: ChatStreamEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ content }),
    signal,
  });

  if (!response.ok || !response.body) {
    onEvent({ type: "error", message: `The request failed with status ${response.status}.` });
    return;
  }

  await readSSE(response, onEvent);
}

/**
 * Regenerates one assistant turn in place. Takes the server message id of
 * the assistant message being replaced (carried on client state from
 * `GET /conversations/{id}`), not a locally-generated id -- the backend
 * needs it to know which turn to redo.
 */
export async function regenerateAssistantMessage(
  conversationId: string,
  messageId: string,
  onEvent: (event: ChatStreamEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(
    `${API_BASE_URL}/conversations/${conversationId}/messages/${messageId}/regenerate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      signal,
    },
  );

  if (!response.ok || !response.body) {
    onEvent({ type: "error", message: `The request failed with status ${response.status}.` });
    return;
  }

  await readSSE(response, onEvent);
}
