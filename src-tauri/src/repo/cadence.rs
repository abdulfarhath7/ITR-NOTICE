//! Per-module sweep cadence (task 5.5, Q12 defaults). Stored in local_kv;
//! a module is "due" when its last successful sweep on this device is older
//! than its cadence. A manual "sweep everything now" ignores it.

use crate::error::AppResult;
use crate::repo::local;
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

pub const KEY: &str = "sweep_cadence";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Cadence { Daily, Weekly, Monthly, Manual }

impl Cadence {
    pub fn hours(&self) -> Option<i64> {
        match self { Cadence::Daily => Some(24), Cadence::Weekly => Some(24 * 7), Cadence::Monthly => Some(24 * 30), Cadence::Manual => None }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Cadences {
    pub proceedings: Cadence,
    pub demands: Cadence,
    pub returns: Cadence,
    pub forms: Cadence,
}

impl Default for Cadences {
    fn default() -> Self {
        Self { proceedings: Cadence::Daily, demands: Cadence::Daily, returns: Cadence::Weekly, forms: Cadence::Weekly }
    }
}

impl Cadences {
    pub fn for_module(&self, module: &str) -> &Cadence {
        match module { "demands" => &self.demands, "returns" => &self.returns, "forms" => &self.forms, _ => &self.proceedings }
    }
}

pub fn get(con: &Connection) -> AppResult<Cadences> {
    Ok(local::get(con, KEY)?.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default())
}

pub fn set(con: &Connection, c: &Cadences) -> AppResult<()> {
    local::set(con, KEY, &serde_json::to_string(c)?)
}

/// Modules whose cadence has elapsed since the last `ok` run on this
/// device (or that never ran). `Manual` modules are never due on their own.
pub fn modules_due(con: &Connection) -> AppResult<Vec<String>> {
    let c = get(con)?;
    let mut due = Vec::new();
    for module in ["proceedings", "demands", "returns", "forms"] {
        let Some(hours) = c.for_module(module).hours() else { continue; };
        let last: Option<String> = con.query_row(
            "SELECT max(run_at) FROM ingestion_runs WHERE module = ?1 AND status = 'ok'", [module], |r| r.get(0)).optional()?.flatten();
        let elapsed = match last.as_deref().and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok()) {
            Some(t) => chrono::Utc::now().signed_duration_since(t).num_hours(),
            None => i64::MAX,
        };
        if elapsed >= hours { due.push(module.to_string()); }
    }
    Ok(due)
}
