export interface NoticeRow {
  ref_id: string;
  communication_id: string;
  proceeding_id: string;
  client_id: string;
  notice_us: string | null;
  description: string | null;
  issued_on: string | null;
  served_on: string | null;
  /** Portal-stated only. Never an AI date. */
  due_date: string | null;
  /** AI-suggested; rendered as a suggestion, never styled as confirmed. */
  suggested_due_date: string | null;
  manual_due_date: string | null;
  due_date_source: string | null;
  due_date_basis: string | null;
  responded: number | null;
  has_pdf: boolean;
  has_draft: boolean;
  proceeding_name: string | null;
  pan: string | null;
  client_name: string;
  assessee_name: string | null;
  assessment_year: string | null;
  /** The proceeding's status: open | adjournment_sought | response_submitted | closed | unknown */
  status: string | null;
  communication_status: string;
  gap_flags: string | null;
  verified_flag: number;
}

export interface Draft {
  ref_id: string;
  generated_at: string | null;
  summary: string;
  checklist: string[];
  draft_text: string;
}

export interface Settings {
  proxy_url: string;
  firm_token: string;
  remember_password: boolean;
  last_user_id: string;
}

export interface DueDateAnswer {
  due_date: string | null;
  basis: string | null;
}

/** Everything the sidecar says, re-emitted by Rust on the `scraper` channel. */
export type ScraperEvent =
  | { ev: "ready" }
  | { ev: "log"; msg: string }
  | { ev: "stderr"; msg: string }
  | { ev: "progress"; kind: string; [k: string]: unknown }
  | { ev: "login_phase"; phase: string }
  | { ev: "otp_required" }
  | { ev: "login_ok" }
  | { ev: "notice"; ref_id: string }
  /** base64 JPEG of what the browser is looking at. Withheld for the whole of
   *  login and the OTP wait - see `_viewport_loop` in the sidecar. */
  | { ev: "viewport"; img: string }
  | { ev: "sync_done"; stats: Record<string, unknown> }
  | { ev: "error"; kind?: string; msg: string }
  | { ev: "exited" };
