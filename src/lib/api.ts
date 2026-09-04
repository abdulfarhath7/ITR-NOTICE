/** The one typed client for the sidecar API (docs/03-api-contract.md).
 *
 * Every call goes through `request()`, which attaches the shared token and the
 * loopback base URL. No component may call `fetch` on its own.
 */
import { backend } from "@/lib/runtime";

/* ------------------------------------------------------------------ types */

/** 1 = a reply is filed on the portal, 0 = not filed, null = the portal never
 *  said. Three answers, not two - see app/report.py. */
export type Responded = 1 | 0 | null;

/** SQLite hands booleans back as 0/1; the UI never widens them silently. */
export type SqlBool = 0 | 1;

export type DueDateSource = "portal" | "claude" | null;

/** One row of `GET /api/notices` (app/db.py::list_notices). */
export type Notice = {
  id: number;
  proceeding_id: number | null;
  ref_id: string;
  notice_us: string | null;
  doc_ref_id: string | null;
  description: string | null;
  issued_on: string | null;
  served_on: string | null;
  due_date: string | null;
  due_date_source: DueDateSource;
  due_date_basis: string | null;
  ao_viewed_on: string | null;
  responded: Responded;
  downloaded_at: string | null;
  first_seen: string | null;
  has_pdf: SqlBool;
  has_draft: SqlBool;
  proceeding_name: string | null;
  pan: string | null;
  assessment_year: string | null;
  status: string | null;
};

/** A row of the `runs` table, as returned by `last_run`. */
export type Run = {
  id: number;
  started: string | null;
  finished: string | null;
  status: string | null;
  message: string | null;
  notices_new: number | null;
  pdfs_saved: number | null;
  skipped_cached: number | null;
};

export type SyncState =
  | "credentials_required"
  | "idle"
  | "running"
  | "otp_required"
  | "failed";

export type NoticesResponse = {
  state: SyncState;
  notices: Notice[];
  last_run: Run | null;
};

/** The bucket keys app/report.py counts. `to_respond` is a total of the five
 *  outstanding ones, not a bucket a notice can sit in. */
export type BucketKey =
  | "to_respond"
  | "overdue"
  | "due_3"
  | "due_10"
  | "on_track"
  | "no_due_date"
  | "responded"
  | "closed";

export type Bucket = { key: BucketKey; label: string; count: number };

/** One line of the report - both the attention list and the full register. */
export type ReportItem = {
  ref_id: string | null;
  description: string | null;
  proceeding_name: string | null;
  notice_us: string | null;
  pan: string | null;
  assessment_year: string | null;
  issued_on: string | null;
  due_date: string | null;
  due_date_source: DueDateSource;
  days_left: number | null;
  bucket: Exclude<BucketKey, "to_respond">;
  responded: Responded;
  status: string | null;
  open: boolean;
  has_pdf: boolean;
  has_draft: boolean;
  has_due_date: boolean;
};

export type Summary = {
  title: string;
  caution: string;
  generated_on: string;
  run: {
    notices_scanned: number;
    finished: string | null;
    status: string | null;
    new_this_run: number;
    pdfs_saved: number;
    skipped_cached: number;
  };
  buckets: Bucket[];
  attention: ReportItem[];
  register: ReportItem[];
};

export type SpeedMode = "slow" | "fast" | "extreme";
export type SpeedResponse = { mode: SpeedMode; delay_ms: number };

export type AskClaudeResponse = {
  ref_id: string;
  due_date: string | null;
  basis: string | null;
  source: string | null;
  cached: boolean;
};

export type Draft = {
  ref_id: string;
  summary: string;
  checklist: string[];
  draft_text: string;
  generated_at: string;
  cached: boolean;
};

export type SaveDraftTextResponse = {
  ref_id: string;
  draft_text: string;
  generated_at: string;
  saved: boolean;
};

export type StartSyncResponse =
  | { started: true; limit: number | null }
  | { state: "credentials_required" };

export type StoreCredentialsResponse = {
  stored: true;
  started: true;
  limit: number | null;
};

/* ------------------------------------------------------------- transport */

/** A non-2xx answer from the sidecar. The backend always shapes its errors as
 *  `{"error": "..."}`, so that message is what a toast shows. */
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export const TOKEN_HEADER = "X-App-Token";

type RequestOptions = {
  method?: "GET" | "POST" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  signal?: AbortSignal;
};

async function resolve(path: string, query?: RequestOptions["query"]): Promise<string> {
  const { baseUrl } = await backend();
  const url = new URL(path, baseUrl);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function send(path: string, options: RequestOptions = {}): Promise<Response> {
  const { token } = await backend();
  const headers: Record<string, string> = {};
  if (token) headers[TOKEN_HEADER] = token;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  const init: RequestInit = {
    method: options.method ?? "GET",
    headers,
    // The sidecar's password cookie is still honoured when APP_PASSWORD is set.
    credentials: "include",
  };
  if (options.body !== undefined) init.body = JSON.stringify(options.body);
  if (options.signal) init.signal = options.signal;

  return fetch(await resolve(path, options.query), init);
}

async function json<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await send(path, options);
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(response.status, detail?.error ?? `Request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

/** PDFs come back as bytes. The viewer needs an object URL rather than a plain
 *  href, because the token cannot ride on an <iframe src>. */
async function blob(path: string, options: RequestOptions = {}): Promise<Blob> {
  const response = await send(path, options);
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(response.status, detail?.error ?? `Request failed (${response.status})`);
  }
  return response.blob();
}

/* ------------------------------------------------------------- endpoints */

const enc = encodeURIComponent;

export const api = {
  /** Readiness probe the shell also polls before showing the window. */
  health: () => json<{ ok: boolean }>("/health"),

  login: (password: string) => json<{ ok: boolean }>("/login", { method: "POST", body: { password } }),
  logout: () => json<{ ok: boolean }>("/logout", { method: "POST" }),

  startSync: (limit: number | null) =>
    json<StartSyncResponse>("/api/sync", { method: "POST", body: { limit } }),

  storeCredentials: (userId: string, password: string, limit: number | null) =>
    json<StoreCredentialsResponse>("/api/credentials", {
      method: "POST",
      body: { user_id: userId, password, limit },
    }),

  forgetCredentials: () => json<{ cleared: boolean }>("/api/credentials", { method: "DELETE" }),

  readSpeed: () => json<SpeedResponse>("/api/speed"),
  writeSpeed: (mode: SpeedMode) => json<SpeedResponse>("/api/speed", { method: "POST", body: { mode } }),

  submitOtp: (code: string) => json<{ ok: boolean }>("/api/otp", { method: "POST", body: { code } }),

  notices: (signal?: AbortSignal) => json<NoticesResponse>("/api/notices", { signal }),
  summary: (signal?: AbortSignal) => json<Summary>("/api/summary", { signal }),

  noticePdf: (refId: string) => blob(`/api/notices/${enc(refId)}/pdf`, { query: { inline: 1 } }),
  draftPdf: (refId: string) => blob(`/api/notices/${enc(refId)}/draft.pdf`, { query: { inline: 1 } }),
  exportXlsx: () => blob("/api/export.xlsx"),

  askClaude: (refId: string) =>
    json<AskClaudeResponse>(`/api/notices/${enc(refId)}/ask-claude`, { method: "POST" }),

  draft: (refId: string, regenerate = false) =>
    json<Draft>(`/api/notices/${enc(refId)}/draft`, {
      method: "POST",
      query: { regenerate: regenerate ? 1 : 0 },
    }),

  saveDraftText: (refId: string, text: string) =>
    json<SaveDraftTextResponse>(`/api/notices/${enc(refId)}/draft/text`, {
      method: "POST",
      body: { draft_text: text },
    }),
};

export const XLSX_MEDIA =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
