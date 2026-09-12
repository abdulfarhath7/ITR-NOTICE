/** DTOs, mirroring the Rust side one for one (docs/08). Dates are ISO
 *  strings; nothing here carries a secret. */

export interface Settings {
  proxy_url: string;
  firm_token: string;
  remember_password: boolean;
  last_user_id: string;
}

export interface ClientSummary {
  id: string;
  name: string;
  client_code: string | null;
  pan_masked: string;
  gstin: string | null;
  entity_type: string;
  client_group: string | null;
  source: "portal" | "eri";
  portal_login_ref: string | null;
  tags: string | null;
  open_count: number;
  overdue_count: number;
  last_sync_at: string | null;
  last_sync_status: string | null;
  year_count: number;
}

export interface YearContext {
  id: string;
  client_id: string;
  assessment_year: string | null;
  financial_year: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClientDetail {
  id: string;
  client_code: string | null;
  name: string;
  pan: string;
  pan_masked: string;
  gstin: string | null;
  entity_type: string;
  client_group: string | null;
  phone_cc: string;
  phone: string | null;
  email: string | null;
  portal_login_ref: string | null;
  source: "portal" | "eri";
  client_file_no: string | null;
  tags: string | null;
  created_at: string;
  updated_at: string;
  years: YearContext[];
  has_credential: boolean;
  login_ref_effective: string;
}

export interface ClientInput {
  name: string;
  pan: string;
  gstin?: string | null;
  client_code?: string | null;
  entity_type?: string | null;
  client_group?: string | null;
  phone_cc?: string | null;
  phone?: string | null;
  email?: string | null;
  portal_login_ref?: string | null;
  source?: string | null;
  client_file_no?: string | null;
  tags?: string | null;
}

export interface Derived { pan: string; state_code: string; state_name: string | null }

export interface ImportRow {
  line: number;
  client: ClientInput & { id: string; pan: string; entity_type: string; source: string };
  pan_masked: string;
  derived_from_gstin: boolean;
}
export interface RowError { line: number; name: string | null; reason: string }
export interface ImportPreview { ok: ImportRow[]; errors: RowError[]; written: number }

export type Module = "proceedings" | "demands" | "returns" | "forms";

export interface WorkItemFilter {
  client_ids?: string[] | null;
  assessment_year?: string | null;
  module?: Module | null;
  status?: string | null;
  search?: string | null;
}

export interface WorkItemRow {
  module: Module;
  id: string;
  client_id: string;
  client_name: string;
  client_code: string | null;
  pan_masked: string;
  year_context_id: string;
  assessment_year: string | null;
  title: string;
  type_label: string;
  reference: string | null;
  section: string | null;
  section_2025: string | null;
  section_1961: string | null;
  due_date: string | null;
  manual_due_date: string | null;
  suggested_due_date: string | null;
  limitation_date: string | null;
  status: string;
  source_panel: string | null;
  verified_flag: number;
  gap_flags: string[];
  document_count: number;
  open_communications: number;
  last_seen_at: string;
}

export interface Document {
  id: string;
  parent_type: string;
  parent_id: string;
  doc_kind: string;
  filename: string | null;
  file_hash: string | null;
  source_url: string | null;
  fetched_at: string | null;
  page_count: number | null;
  byte_size: number | null;
  state: "stored" | "pending" | "failed";
  storage_path: string | null;
  verified_flag: number;
  created_at: string;
  updated_at: string;
}

export interface CommunicationView {
  id: string;
  proceeding_id: string;
  communication_type_id: string;
  reference_id: string;
  din: string | null;
  section_2025: string | null;
  section_1961: string | null;
  description: string | null;
  issued_on: string | null;
  served_on: string | null;
  response_due_date: string | null;
  ao_viewed_on: string | null;
  status: string;
  direction: "inbound";
  verified_flag: number;
  gap_flags: string | null;
  row_hash: string;
  first_seen_at: string;
  last_seen_at: string;
  type_label: string;
  documents: Document[];
  has_draft: boolean;
  gaps: string[];
}

export interface ResponseRow {
  id: string;
  proceeding_id: string;
  in_reply_to: string | null;
  response_mode: "full" | "partial";
  filed_on: string | null;
  filed_by: string | null;
  remarks: string | null;
  transaction_id: string | null;
  verified_flag: number;
  gap_flags: string | null;
}

export interface AdjournmentRow {
  id: string;
  proceeding_id: string;
  sought_date: string | null;
  reason: string | null;
  outcome: string | null;
  filed_on: string | null;
}

export interface ProceedingDetail {
  id: string;
  year_context_id: string;
  proceeding_type_id: string;
  display_name: string | null;
  assessee_name: string | null;
  section_2025: string | null;
  section_1961: string | null;
  din_reference: string | null;
  authority: string | null;
  initiated_on: string | null;
  due_date: string | null;
  manual_due_date: string | null;
  suggested_due_date: string | null;
  limitation_date: string | null;
  hearing_date: string | null;
  status: string;
  portal_status: string | null;
  closure_date: string | null;
  closure_order: string | null;
  source_panel: string;
  created_mode: "auto" | "manual";
  appeal_number: string | null;
  order_appealed_against: string | null;
  verified_flag: number;
  gap_flags: string | null;
  first_seen_at: string;
  last_seen_at: string;
  client_id: string;
  client_name: string;
  client_code: string | null;
  pan_masked: string;
  assessment_year: string | null;
  financial_year: string | null;
  type_label: string;
  type_category: string | null;
  section: string | null;
  gaps: string[];
  communications: CommunicationView[];
  responses: ResponseRow[];
  adjournments: AdjournmentRow[];
  documents: Document[];
}

export interface TypeEntry {
  id: string;
  registry_name: string;
  code: string;
  label: string;
  category: string | null;
  statute: string | null;
  sort_order: number;
  active: number;
}

export interface Draft {
  ref_id: string;
  generated_at: string | null;
  summary: string;
  checklist: string[];
  draft_text: string;
}

export interface DueDateAnswer { due_date: string | null; basis: string | null }

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
  | { ev: "viewport"; img: string }
  | { ev: "sync_done"; stats: Record<string, unknown> }
  | { ev: "error"; kind?: string; msg: string }
  | { ev: "exited" };
