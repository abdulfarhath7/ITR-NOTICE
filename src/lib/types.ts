/** DTOs, mirroring the Rust side one for one (docs/08). Dates are ISO
 *  strings; nothing here carries a secret. */

export interface Settings {
  proxy_url: string;
  firm_token: string;
  remember_password: boolean;
  last_user_id: string;
  /** Text size in percent: 85, 92, 100, 112 or 125 (docs/16 §2.4). */
  ui_scale: number;
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
  /** docs/17 §6.4 */
  history_depth: HistoryDepth;
  history_note: string | null;
  cadence_tier: CadenceTier;
  cadence_pinned: boolean;
  sync_enabled: boolean;
}

export type HistoryDepth = "recent" | "partial" | "full";
export type CadenceTier = "nightly" | "weekly";

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
  /** 0 keeps the client out of whole-book sweeps (docs/16 §7). */
  sync_enabled?: number | null;
  note?: string | null;
  last_sync_at: string | null;
  /** docs/17 §2.4, §2.5, §6.2 (migration 0022). */
  history_depth?: HistoryDepth | null;
  history_fetched_at?: string | null;
  history_note?: string | null;
  cadence_tier?: CadenceTier | null;
  cadence_pinned?: number | null;
  last_swept_at?: string | null;
  sync_pause_reason?: string | null;
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
  /** Add-client only (docs/17 §4). */
  fetch_history_tonight?: boolean;
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
  /** Latest inbound communication's date (proceedings) or the item's own
   *  raised/filed date; null when none is stated. Never guessed. */
  issued_on: string | null;
  assignee: string | null;
  has_note: boolean;
  /** First 120 characters of the note (Q38). */
  note_preview: string | null;
  /** Drafts on this item not yet marked reviewed. */
  drafts_to_review: number;
  /** Demands: current outstanding, else the demand amount. */
  amount: number | null;
  /** Documents indexed but not fetched yet (docs/17 §6.4). */
  pending_documents: number;
  /** docs/18 §3: proceedings only; false / null elsewhere. */
  is_assessment: boolean;
  /** Latest inbound communication's `ao_viewed_on`. */
  ao_viewed_on: string | null;
  ao_viewed_first_seen_at: string | null;
  /** A reply to the latest inbound communication is on record. */
  response_filed: boolean;
  /** The Rust `NOT_VIEWED_BY_AO_WHERE` predicate for this row (Q53). */
  not_viewed_by_ao: boolean;
}

/** Owner and note a person authored for one item (docs/16 §2.2). */
export interface WorkItemMeta {
  id: string;
  module: Module;
  item_id: string;
  assignee: string | null;
  note: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
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
  /** When this device first saw `ao_viewed_on` set (docs/18 §3.1). */
  ao_viewed_first_seen_at?: string | null;
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
  /** docs/18 §3.2 (Q50): Viewed by AO and Limitation apply only when true. */
  is_assessment: boolean;
  section: string | null;
  gaps: string[];
  communications: CommunicationView[];
  responses: ResponseRow[];
  adjournments: AdjournmentRow[];
  documents: Document[];
  /** docs/18 §3.4, oldest first. */
  events: ProceedingEvent[];
}

/** One immutable change record (docs/18 §3.4, migration 0023). */
export interface ProceedingEvent {
  id: string;
  proceeding_id: string;
  communication_id: string | null;
  kind: "ao_viewed" | "limitation_changed";
  /** JSON: ao_viewed {ao_viewed_on, first_seen_at}; limitation_changed {from, to, source} */
  payload: string;
  at: string;
}

export interface ItemContext {
  client_id: string;
  client_name: string;
  client_code: string | null;
  pan_masked: string;
  assessment_year: string | null;
  financial_year: string | null;
}

export interface DemandResponseView {
  id: string;
  demand_id: string;
  stance: string | null;
  reason_code_id: string | null;
  reason_label: string | null;
  disputed_amount: number | null;
  filed_on: string | null;
  transaction_id: string | null;
  verified_flag: number;
  gap_flags: string | null;
  documents: Document[];
}

export interface PaymentRow {
  id: string;
  year_context_id: string;
  demand_response_id: string | null;
  proceeding_id: string | null;
  purpose: string;
  cin: string | null;
  bsr_code: string | null;
  paid_on: string | null;
  amount: number | null;
  verified_flag: number;
  gap_flags: string | null;
}

export interface DemandDetail extends ItemContext {
  id: string;
  year_context_id: string;
  demand_reference_number: string | null;
  demand_amount: number | null;
  current_outstanding: number | null;
  section_or_demand_type: string | null;
  raised_on: string | null;
  uploaded_by: string | null;
  rectification_rights: string | null;
  status: string;
  portal_status: string | null;
  proceeding_id: string | null;
  verified_flag: number;
  gap_flags: string | null;
  first_seen_at: string;
  last_seen_at: string;
  gaps: string[];
  responses: DemandResponseView[];
  payments: PaymentRow[];
  documents: Document[];
}

export interface ReturnDetail extends ItemContext {
  id: string;
  year_context_id: string;
  acknowledgement_number: string;
  return_type: string | null;
  filing_type: string | null;
  filed_on: string | null;
  verification_status: string | null;
  processing_status: string | null;
  status: string;
  supersedes_id: string | null;
  supersedes_ack: string | null;
  superseded_by_ack: string | null;
  /** The whole chain, oldest first: original, revised, updated. */
  chain: { id: string; acknowledgement_number: string; filing_type: string | null; filed_on: string | null; verification_status: string | null }[];
  verified_flag: number;
  gaps: string[];
  first_seen_at: string;
  last_seen_at: string;
  documents: Document[];
}

export interface FiledFormDetail extends ItemContext {
  id: string;
  year_context_id: string;
  form_type_id: string;
  acknowledgement_number: string;
  form_label: string | null;
  filed_on: string | null;
  filing_type: string | null;
  portal_status: string | null;
  status: string;
  filed_by: string | null;
  verified_flag: number;
  gaps: string[];
  type_label: string;
  type_category: string | null;
  first_seen_at: string;
  last_seen_at: string;
  documents: Document[];
}

export type Cadence = "daily" | "weekly" | "monthly" | "manual";
export interface Cadences { proceedings: Cadence; demands: Cadence; returns: Cadence; forms: Cadence }

export interface TypeEntry {
  id: string;
  registry_name: string;
  code: string;
  label: string;
  category: string | null;
  statute: string | null;
  sort_order: number;
  active: number;
  /** docs/18 §3.2 (Q50) */
  is_assessment: number;
}

export interface Draft {
  ref_id: string;
  generated_at: string | null;
  summary: string;
  checklist: string[];
  draft_text: string;
  reviewed_at: string | null;
}

export interface DueDateAnswer { due_date: string | null; basis: string | null }

export type Scope =
  | { kind: "all" }
  | { kind: "module"; module: Module }
  | { kind: "client"; client_id: string }
  /** A hand-picked set; paused or dormant clients in it are swept too. */
  | { kind: "clients"; client_ids: string[] };

export interface Challenge { kind: "otp" | "captcha" | string; image_b64: string | null }

export interface IngestionCounts {
  cards: number; notices: number; fetched: number; skipped: number; changed: number; panels_done: number;
  /** Headers recorded with documents left pending (docs/17 §2.3). */
  indexed: number;
}

export type RunScope = "sweep" | "deep" | "item";

export interface IngestionState {
  running: boolean;
  paused: boolean;
  sweep_id: string | null;
  scope: RunScope | null;
  job_id: string | null;
  current_login_ref_masked: string | null;
  current_client_id: string | null;
  current_client_name: string | null;
  queue_position: number;
  queue_total: number;
  module: string | null;
  panel: string | null;
  panel_total: number;
  phase: string | null;
  awaiting_operator: Challenge | null;
  counts: IngestionCounts;
  last_error: string | null;
  finished_at: string | null;
  resumable_sweep_id: string | null;
  last_run_at: string | null;
}

export interface IngestionJob {
  id: string;
  sweep_id: string;
  login_ref: string;
  client_id: string | null;
  module: Module;
  position: number;
  status: string;
  attempts: number;
  next_attempt_at: string | null;
  cursor: string | null;
  last_error: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export type UpdateGroup = "new_notice" | "due_changed" | "response_filed" | "closed" | "demand_changed" | "sync_failed"
  | "history_fetched";

/** One change since the previous sync (docs/16 §4). */
export interface UpdateEntry {
  group: UpdateGroup;
  at: string;
  client_id: string | null;
  client_name: string | null;
  pan_masked: string | null;
  assessment_year: string | null;
  module: Module | null;
  item_id: string | null;
  reference: string | null;
  section: string | null;
  section_1961: string | null;
  due_date: string | null;
  old_value: string | null;
  new_value: string | null;
  filed_on: string | null;
  reason: string | null;
  status: string | null;
  run_status: string | null;
  /** Documents of the item not fetched yet (docs/17 §6.4). history_fetched: new_value is the item count, reason the note. */
  pending_documents: number;
}

export interface UpdatesReport { since: string | null; entries: UpdateEntry[] }

/** The Attention screen's sync line (docs/16 §1.1). */
export interface SyncLine {
  last_run_at: string | null;
  window_start: string | null;
  clients: number;
  failed: number;
}

export interface IngestionRun {
  id: string;
  run_at: string;
  device_id: string;
  client_id: string | null;
  module: Module;
  panel_swept: string | null;
  records_found: number;
  gaps: string | null;
  operator: string | null;
  status: string;
  notes: string | null;
  scope: RunScope;
}

/** What the runner and the sidecar say, on the `ingestion` channel. */
export type IngestionEvent = (
  | { ev: "state" }
  | { ev: "log"; level: "info" | "warn" | "error"; msg: string }
  | { ev: "progress"; data: Record<string, unknown> }
  | { ev: "viewport"; img: string }
  | { ev: "challenge"; kind: string }
  | { ev: "summary"; summary: SweepSummary | null }
) & { scope?: RunScope };

export interface DeviceInfo {
  device_id: string;
  public_key: string;
  cursor: Record<string, number>;
  own_entries: number;
  entries_by_device: Record<string, number>;
  last_snapshot_at: string | null;
  snapshot_due: boolean;
}

export interface BundleManifest {
  format: number;
  product: string;
  schema_version: number;
  device_id: string;
  created_at: string;
  cursor: Record<string, number>;
  counts: Record<string, number>;
  includes_documents: boolean;
  includes_credentials: boolean;
  signer_public_key: string;
}

export interface ExportSummary { path: string; rows: number; ledger_entries: number; documents: number; credentials: number; bytes: number }
export interface ImportSummary {
  device_id: string; created_at: string; signature_ok: boolean; rows_written: number; rows_kept_local: number;
  ledger_applied: number; documents_added: number; documents_already_held: number; credentials_written: number; errors: string[];
}

export interface RelayConfig { url: string; firm_id: string; firm_name: string | null; device_id: string }
export interface FirmCreated { config: RelayConfig; recovery_code: string }

export interface RosterDevice {
  id: string; name: string; permission: "admin" | "member"; role: "collector" | "normal";
  ram_mb: number | null; enrolled_at: string; last_seen: string | null; removed_at: string | null; head: number;
}
export interface Roster {
  firm: { id: string; name: string; admin_device_id: string | null };
  devices: RosterDevice[];
  lease: { device_id: string; expires_at: string; issued_at: string } | null;
  nominee_id: string | null;
  you: { device_id: string; permission: "admin" | "member" };
}

export interface SyncState {
  configured: boolean;
  firm_id: string | null;
  firm_name: string | null;
  device_id: string;
  permission: string | null;
  cursor: Record<string, number>;
  heads: Record<string, number>;
  behind_by_device: Record<string, number>;
  behind_total: number;
  unpublished: number;
  unpublished_sweep_waiting: boolean;
  collector_device_id: string | null;
  collector_last_seen: string | null;
  collector_silent: boolean;
  last_sync_at: string | null;
  last_error: string | null;
  status: "up_to_date" | "behind" | "unreachable" | "not_configured";
}

export interface SyncResult {
  pushed: number; pulled: number; applied: number; snapshot_published: boolean; sweep_waiting_for_lease: boolean; errors: string[];
}

export type ExportScope =
  | { kind: "view"; items: [string, string][]; label?: string | null }
  | { kind: "all" }
  | { kind: "client"; client_id: string };
export interface ExportReport { path: string; proceedings: number; demands: number; returns: number; forms: number; unverified_fields: number }

export interface DataDirInfo { path: string; archive_bytes: number }
export interface SetupState { done: boolean; relay_configured: boolean; permission: string | null; client_count: number; removed: boolean }

/** The scheduler settings KV (docs/17 §6.5); `get_sweep_schedule` returns the same object. */
export interface SweepSchedule {
  enabled: boolean;
  /** HH:MM IST; replaces the Build 1 `time`. */
  run_window_start: string;
  run_window_end: string;
  days: number[];
  scope: "due" | "all";
  lookback_days: number;
  /** null = never dormant */
  dormant_after_days: number | null;
  dormant_cadence: "weekly" | "fortnightly";
  /** ISO weekday 1 = Monday … 7 = Sunday */
  dormant_weekday: number;
  client_timeout_min: number;
  docs_policy: "index" | "download";
  /** 0 = off */
  warm_cache_days: number;
  auto_item_fetch: boolean;
}
export type SweepSettings = SweepSchedule;

/** docs/17 §2.8 */
export interface SweepSummary {
  swept: number;
  skipped_unchanged: number;
  failed: number;
  parked: number;
  deep_done: number;
  warm_cached: number;
  duration_s: number;
  window_closed: boolean;
}

export interface SummaryCard {
  sweep_id: string;
  started_at: string;
  finished_at: string | null;
  summary: SweepSummary | null;
}

export type DeepDepth = "all" | "years" | "since";
export type DocsPolicy = "index" | "download";

export interface DeepFetchRequest {
  id: string;
  client_id: string;
  client_name: string | null;
  depth: DeepDepth;
  depth_value: string | null;
  modules: Module[];
  docs_policy: DocsPolicy;
  mode: "tonight" | "now";
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  requested_by: string | null;
  requested_at: string;
  started_at: string | null;
  finished_at: string | null;
  /** JSON {module, panel, done, total} */
  progress: string | null;
  last_error: string | null;
}

export interface DeepFetchResult { request: DeepFetchRequest; status: "started" | "queued"; sweep_id: string | null }
export interface ItemFetchResult { status: "started" | "queued" | "busy"; sweep_id: string | null }

export interface RunCard {
  sweep_id: string;
  kind: RunScope;
  scheduled: boolean;
  started_at: string;
  done: number;
  total: number;
  swept: number;
  skipped: number;
  failed: number;
}

export type SyncRowStatus = "running" | "awaiting" | "done" | "skipped" | "failed" | "parked" | "incomplete"
  | "queued" | "dormant" | "paused" | "idle";

/** One row of the Sync screen's queue table (docs/17 §6.1). */
export interface SyncRow {
  client_id: string;
  client_name: string;
  pan_masked: string;
  scope: RunScope;
  /** Deep: "full" | "2 AYs" | "since 2026-04-01" */
  deep_label: string | null;
  deep_request_id: string | null;
  status: SyncRowStatus;
  /** failed/parked/incomplete: reason; paused: reason; awaiting: OTP/CAPTCHA; queued: "after sweep" */
  detail: string | null;
  started_at: string | null;
  duration_s: number | null;
  changes: number | null;
  last_swept_at: string | null;
  next: "nightly" | "weekly" | "tonight" | "fix" | "none";
  cadence_tier: CadenceTier;
  cadence_pinned: boolean;
  position: number | null;
}

export interface SyncOverview {
  run: RunCard | null;
  last_summary: SummaryCard | null;
  schedule_enabled: boolean;
  window_start: string;
  window_end: string;
  dormant_weekday: number;
  /** IST "YYYY-MM-DD HH:MM" */
  next_run_at: string | null;
  estimate_all_s: number;
  deep_queued: number;
  rows: SyncRow[];
}

/** What deleting a client removes (the confirmation dialog). */
export interface DeletePreview {
  client_id: string;
  name: string;
  years: number;
  work_items: number;
  communications: number;
  documents: number;
  /** Another client signs in with the same login; its password stays. */
  login_shared: boolean;
}
