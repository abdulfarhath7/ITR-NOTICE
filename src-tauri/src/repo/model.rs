//! Row structs, one per table, every column present. Serialising one of
//! these is the ledger payload ("JSON of the full row after the change"),
//! so nothing may be skipped or renamed here.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Client {
    pub id: String,
    pub client_code: Option<String>,
    pub name: String,
    pub pan: String,
    pub gstin: Option<String>,
    pub entity_type: String,
    pub client_group: Option<String>,
    pub phone_cc: String,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub portal_login_ref: Option<String>,
    pub source: String,
    pub client_file_no: Option<String>,
    pub tags: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    /// Migrations 0019/0020. Skipped when unset so writers that predate the
    /// columns (the legacy backfill, 0009) still work (D-039). A cleared
    /// note is stored as an empty string so the clear is written.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sync_enabled: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    /// Migration 0022 (docs/17 §2.4, §2.5, §6.2); same skip-when-unset rule.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub history_depth: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub history_fetched_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub history_note: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cadence_tier: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cadence_pinned: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_swept_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sync_pause_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YearContext {
    pub id: String,
    pub client_id: String,
    pub assessment_year: Option<String>,
    pub financial_year: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Proceeding {
    pub id: String,
    pub year_context_id: String,
    pub proceeding_type_id: String,
    pub natural_key: String,
    pub display_name: Option<String>,
    pub assessee_name: Option<String>,
    pub section_2025: Option<String>,
    pub section_1961: Option<String>,
    pub din_reference: Option<String>,
    pub authority: Option<String>,
    pub initiated_on: Option<String>,
    pub due_date: Option<String>,
    pub manual_due_date: Option<String>,
    pub suggested_due_date: Option<String>,
    pub limitation_date: Option<String>,
    pub hearing_date: Option<String>,
    pub status: String,
    pub portal_status: Option<String>,
    pub closure_date: Option<String>,
    pub closure_order: Option<String>,
    pub source_panel: String,
    pub created_mode: String,
    pub appeal_number: Option<String>,
    pub order_appealed_against: Option<String>,
    pub verified_flag: i64,
    pub gap_flags: Option<String>,
    pub row_hash: String,
    pub first_seen_at: String,
    pub last_seen_at: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Communication {
    pub id: String,
    pub proceeding_id: String,
    pub communication_type_id: String,
    pub reference_id: String,
    pub din: Option<String>,
    pub section_2025: Option<String>,
    pub section_1961: Option<String>,
    pub description: Option<String>,
    pub issued_on: Option<String>,
    pub served_on: Option<String>,
    pub response_due_date: Option<String>,
    pub ao_viewed_on: Option<String>,
    pub status: String,
    pub direction: String,
    pub verified_flag: i64,
    pub gap_flags: Option<String>,
    pub row_hash: String,
    pub first_seen_at: String,
    pub last_seen_at: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Response {
    pub id: String,
    pub proceeding_id: String,
    pub in_reply_to: Option<String>,
    pub response_mode: Option<String>,
    pub filed_on: Option<String>,
    pub filed_by: Option<String>,
    pub remarks: Option<String>,
    pub transaction_id: Option<String>,
    pub direction: String,
    pub verified_flag: i64,
    pub gap_flags: Option<String>,
    pub row_hash: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdjournmentRequest {
    pub id: String,
    pub proceeding_id: String,
    pub sought_date: Option<String>,
    pub reason: Option<String>,
    pub outcome: Option<String>,
    pub filed_on: Option<String>,
    pub verified_flag: i64,
    pub gap_flags: Option<String>,
    pub row_hash: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Document {
    pub id: String,
    pub parent_type: String,
    pub parent_id: String,
    pub doc_kind: String,
    pub filename: Option<String>,
    pub file_hash: Option<String>,
    pub source_url: Option<String>,
    pub fetched_at: Option<String>,
    pub page_count: Option<i64>,
    pub byte_size: Option<i64>,
    pub state: String,
    pub storage_path: Option<String>,
    pub verified_flag: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Draft {
    pub id: String,
    pub communication_id: String,
    pub generated_at: Option<String>,
    pub model: Option<String>,
    pub summary: Option<String>,
    pub checklist_json: Option<String>,
    pub draft_text: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    /// Migration 0018. Skipped when unset so the legacy backfill (0009),
    /// which runs before the column exists, still writes; `db::save_draft`
    /// clears it explicitly on regenerate.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reviewed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypeEntry {
    pub id: String,
    pub registry_name: String,
    pub code: String,
    pub label: String,
    pub category: Option<String>,
    pub statute: Option<String>,
    pub field_template: Option<String>,
    pub status_set: Option<String>,
    pub sort_order: i64,
    pub active: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IngestionRun {
    pub id: String,
    pub run_at: String,
    pub device_id: String,
    pub client_id: Option<String>,
    pub module: String,
    pub panel_swept: Option<String>,
    pub records_found: i64,
    pub gaps: Option<String>,
    pub operator: Option<String>,
    pub status: String,
    pub notes: Option<String>,
    pub created_at: String,
    /// `sweep` | `deep` | `item` (migration 0022, docs/17 §1).
    #[serde(default = "default_run_scope")]
    pub scope: String,
}

fn default_run_scope() -> String { "sweep".into() }

/// The status state machine (docs/02-data-model.md). Stored as text; this
/// enum is the one place the allowed set is spelled out in Rust.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Open,
    AdjournmentSought,
    ResponseSubmitted,
    Closed,
    Unknown,
}

impl Status {
    pub fn as_str(self) -> &'static str {
        match self {
            Status::Open => "open",
            Status::AdjournmentSought => "adjournment_sought",
            Status::ResponseSubmitted => "response_submitted",
            Status::Closed => "closed",
            Status::Unknown => "unknown",
        }
    }

    pub fn parse(s: &str) -> Status {
        match s {
            "open" => Status::Open,
            "adjournment_sought" => Status::AdjournmentSought,
            "response_submitted" => Status::ResponseSubmitted,
            "closed" => Status::Closed,
            _ => Status::Unknown,
        }
    }

    /// The action matrix (docs/02): View and Save are always allowed; only
    /// Draft and the manual due date follow the status. This is the Rust
    /// half of the one place the matrix lives (`src/lib/status.ts` mirrors it
    /// for the screens).
    pub fn allows_draft(self) -> bool {
        matches!(self, Status::Open | Status::AdjournmentSought)
    }

    pub fn allows_manual_due_date(self) -> bool {
        matches!(self, Status::Open | Status::AdjournmentSought | Status::Unknown)
    }


    /// The portal's own words. Anything unrecognised is `unknown`, never a
    /// guess.
    pub fn from_portal(word: Option<&str>) -> Status {
        match word.map(|w| w.trim().to_ascii_lowercase()).as_deref() {
            Some("open") => Status::Open,
            Some("closed") => Status::Closed,
            Some("submitted") | Some("response submitted") => Status::ResponseSubmitted,
            Some("adjournment sought") => Status::AdjournmentSought,
            _ => Status::Unknown,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Demand {
    pub id: String,
    pub year_context_id: String,
    pub natural_key: String,
    pub demand_reference_number: Option<String>,
    pub demand_amount: Option<f64>,
    pub current_outstanding: Option<f64>,
    pub section_or_demand_type: Option<String>,
    pub raised_on: Option<String>,
    pub uploaded_by: Option<String>,
    pub rectification_rights: Option<String>,
    pub status: String,
    pub portal_status: Option<String>,
    pub proceeding_id: Option<String>,
    pub verified_flag: i64,
    pub gap_flags: Option<String>,
    pub row_hash: String,
    pub first_seen_at: String,
    pub last_seen_at: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DemandResponse {
    pub id: String,
    pub demand_id: String,
    pub stance: Option<String>,
    pub reason_code_id: Option<String>,
    pub disputed_amount: Option<f64>,
    pub filed_on: Option<String>,
    pub transaction_id: Option<String>,
    pub verified_flag: i64,
    pub gap_flags: Option<String>,
    pub row_hash: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Payment {
    pub id: String,
    pub year_context_id: String,
    pub demand_response_id: Option<String>,
    pub proceeding_id: Option<String>,
    pub purpose: String,
    pub cin: Option<String>,
    pub bsr_code: Option<String>,
    pub paid_on: Option<String>,
    pub amount: Option<f64>,
    pub verified_flag: i64,
    pub gap_flags: Option<String>,
    pub row_hash: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Return {
    pub id: String,
    pub year_context_id: String,
    pub acknowledgement_number: String,
    pub return_type: Option<String>,
    pub filing_type: Option<String>,
    pub filed_on: Option<String>,
    pub verification_status: Option<String>,
    pub processing_status: Option<String>,
    pub status: String,
    pub supersedes_id: Option<String>,
    pub verified_flag: i64,
    pub gap_flags: Option<String>,
    pub row_hash: String,
    pub first_seen_at: String,
    pub last_seen_at: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FiledForm {
    pub id: String,
    pub year_context_id: String,
    pub form_type_id: String,
    pub acknowledgement_number: String,
    pub form_label: Option<String>,
    pub filed_on: Option<String>,
    pub filing_type: Option<String>,
    pub portal_status: Option<String>,
    pub status: String,
    pub filed_by: Option<String>,
    pub verified_flag: i64,
    pub gap_flags: Option<String>,
    pub row_hash: String,
    pub first_seen_at: String,
    pub last_seen_at: String,
    pub created_at: String,
    pub updated_at: String,
}
