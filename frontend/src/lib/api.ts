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

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
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
