//! What the monitor screen shows (docs/09 screen 5), kept current by the
//! runner and read by `get_ingestion_state`.

use crate::ingest::source::Challenge;
use serde::Serialize;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Serialize, Default)]
pub struct Counts {
    pub cards: i64,
    pub notices: i64,
    pub fetched: i64,
    pub skipped: i64,
    pub changed: i64,
    pub panels_done: i64,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct IngestionState {
    pub running: bool,
    pub paused: bool,
    pub sweep_id: Option<String>,
    pub job_id: Option<String>,
    pub current_login_ref_masked: Option<String>,
    pub current_client_id: Option<String>,
    pub current_client_name: Option<String>,
    pub queue_position: i64,
    pub queue_total: i64,
    pub module: Option<String>,
    pub panel: Option<String>,
    pub panel_total: i64,
    pub phase: Option<String>,
    pub awaiting_operator: Option<Challenge>,
    pub counts: Counts,
    pub last_error: Option<String>,
    pub finished_at: Option<String>,
}

pub type Shared = Arc<Mutex<IngestionState>>;

pub fn update(shared: &Shared, f: impl FnOnce(&mut IngestionState)) {
    if let Ok(mut s) = shared.lock() {
        f(&mut s);
    }
}

pub fn snapshot(shared: &Shared) -> IngestionState {
    shared.lock().map(|s| s.clone()).unwrap_or_default()
}
