//! "What changed since the last sync?" (docs/16 §4). Read-only: diffs the
//! ledger against the previous ingestion run and classifies each changed
//! entity into one group. Nothing here writes.
//!
//! Per entity, the newest ledger entry after `since` is compared with the
//! newest entry at or before it (the baseline), so an item touched twice
//! in one sweep is one update, not two.

use crate::error::AppResult;
use crate::mask;
use crate::repo::model::Status;
use crate::repo::work_items::render_section;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::Value;


#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct UpdateEntry {
    pub group: String,
    /// When the change was recorded (ledger `created_at`, or the run's `run_at`).
    pub at: String,
    pub client_id: Option<String>,
    pub client_name: Option<String>,
    pub pan_masked: Option<String>,
    pub assessment_year: Option<String>,
    /// Module and id of the work item `View` opens.
    pub module: Option<String>,
    pub item_id: Option<String>,
    /// A communication's portal reference, for Draft and ✦ Date.
    pub reference: Option<String>,
    pub section: Option<String>,
    pub section_1961: Option<String>,
    pub due_date: Option<String>,
    pub old_value: Option<String>,
    pub new_value: Option<String>,
    pub filed_on: Option<String>,
    /// Sync failed: the run's note, PII masked.
    pub reason: Option<String>,
    pub status: Option<String>,
    /// Sync failed: `failed` or `credentials_parked` (Fix vs Retry).
    pub run_status: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct UpdatesReport {
    /// What the entries were compared against; None when nothing has run.
    pub since: Option<String>,
    pub entries: Vec<UpdateEntry>,
}

/// docs/16 §4.1: the previous completed sweep's end (its start when it
/// never recorded one). With one sweep, that sweep's start, so the screen
/// shows everything it produced. Runs with no sweep row (attended one-offs)
/// fall back to the start of the newest run's day.
pub fn default_since(con: &Connection) -> AppResult<Option<String>> {
    let mut st = con.prepare(
        "SELECT started_at, finished_at FROM ingestion_sweeps
         WHERE status IN ('done','stopped','failed') OR finished_at IS NOT NULL
         ORDER BY started_at DESC LIMIT 2")?;
    let sweeps: Vec<(String, Option<String>)> = st.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<_, _>>()?;
    match sweeps.as_slice() {
        [_, (prev_start, prev_end)] => return Ok(Some(prev_end.clone().unwrap_or_else(|| prev_start.clone()))),
        [(only_start, _)] => return Ok(Some(only_start.clone())),
        _ => {}
    }
    let last: Option<String> = con.query_row("SELECT max(run_at) FROM ingestion_runs", [], |r| r.get(0))?;
    Ok(last.map(|l| format!("{}T00:00:00.000Z", &l[..10.min(l.len())])))
}

fn s(v: &Value, k: &str) -> Option<String> {
    match v.get(k) {
        Some(Value::String(x)) => Some(x.clone()),
        Some(Value::Number(n)) => Some(n.to_string()),
        _ => None,
    }
}

fn settled(status: Option<&str>) -> bool {
    matches!(Status::parse(status.unwrap_or("unknown")), Status::Closed | Status::ResponseSubmitted)
}

struct Context {
    client_id: String,
    client_name: String,
    pan_masked: String,
    assessment_year: Option<String>,
}

fn context_for_year(con: &Connection, year_context_id: &str) -> AppResult<Option<Context>> {
    Ok(con.query_row(
        "SELECT cl.id, cl.name, cl.pan, yc.assessment_year FROM year_contexts yc JOIN clients cl ON cl.id = yc.client_id
         WHERE yc.id = ?1", [year_context_id],
        |r| Ok(Context { client_id: r.get(0)?, client_name: r.get(1)?, pan_masked: mask::pan(&r.get::<_, String>(2)?),
                         assessment_year: r.get(3)? })).optional()?)
}

/// (year_context_id, section_2025, section_1961)
type ProceedingBits = (String, Option<String>, Option<String>);

/// The proceeding's year context and sections, from the live row.
fn proceeding_bits(con: &Connection, id: &str) -> AppResult<Option<ProceedingBits>> {
    Ok(con.query_row("SELECT year_context_id, section_2025, section_1961 FROM proceedings WHERE id = ?1", [id],
                     |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).optional()?)
}

fn blank(group: &str, at: &str) -> UpdateEntry {
    UpdateEntry {
        group: group.into(), at: at.into(), client_id: None, client_name: None, pan_masked: None, assessment_year: None,
        module: None, item_id: None, reference: None, section: None, section_1961: None, due_date: None,
        old_value: None, new_value: None, filed_on: None, reason: None, status: None, run_status: None,
    }
}

fn with_context(mut e: UpdateEntry, c: Context) -> UpdateEntry {
    e.client_id = Some(c.client_id);
    e.client_name = Some(c.client_name);
    e.pan_masked = Some(c.pan_masked);
    e.assessment_year = c.assessment_year;
    e
}

fn money_of(v: &Value) -> Option<String> {
    let n = v.get("current_outstanding").and_then(Value::as_f64).or_else(|| v.get("demand_amount").and_then(Value::as_f64))?;
    Some(crate::repo::work_items::money(n))
}

/// Classify one entity's change: `after` is its newest payload in the
/// window, `before` its baseline (None on first sight).
fn classify(con: &Connection, entity_type: &str, at: &str, after: &Value, before: Option<&Value>) -> AppResult<Option<UpdateEntry>> {
    match entity_type {
        "communications" if before.is_none() => {
            let Some(pid) = s(after, "proceeding_id") else { return Ok(None) };
            let Some((yc, s25, s61)) = proceeding_bits(con, &pid)? else { return Ok(None) };
            let Some(c) = context_for_year(con, &yc)? else { return Ok(None) };
            let mut e = with_context(blank("new_notice", at), c);
            e.module = Some("proceedings".into());
            e.item_id = Some(pid);
            e.reference = s(after, "reference_id");
            let (c25, c61) = (s(after, "section_2025").or(s25), s(after, "section_1961").or(s61));
            e.section = render_section(c25.as_deref(), c61.as_deref());
            e.section_1961 = c61;
            e.due_date = s(after, "response_due_date");
            e.status = s(after, "status");
            Ok(Some(e))
        }
        "proceedings" => {
            let Some(before) = before else { return Ok(None) };
            let (old_due, new_due) = (s(before, "due_date"), s(after, "due_date"));
            let closing = settled(s(after, "status").as_deref()) && !settled(s(before, "status").as_deref());
            let group = if old_due != new_due { "due_changed" } else if closing { "closed" } else { return Ok(None) };
            let Some(id) = s(after, "id") else { return Ok(None) };
            let Some(yc) = s(after, "year_context_id") else { return Ok(None) };
            let Some(c) = context_for_year(con, &yc)? else { return Ok(None) };
            let mut e = with_context(blank(group, at), c);
            e.module = Some("proceedings".into());
            e.item_id = Some(id);
            let (s25, s61) = (s(after, "section_2025"), s(after, "section_1961"));
            e.section = render_section(s25.as_deref(), s61.as_deref());
            e.section_1961 = s61;
            e.status = s(after, "status");
            if group == "due_changed" {
                e.old_value = old_due;
                e.new_value = new_due;
            } else {
                e.filed_on = s(after, "closure_date");
            }
            Ok(Some(e))
        }
        "responses" if before.is_none() => {
            let Some(pid) = s(after, "proceeding_id") else { return Ok(None) };
            let Some((yc, s25, s61)) = proceeding_bits(con, &pid)? else { return Ok(None) };
            let Some(c) = context_for_year(con, &yc)? else { return Ok(None) };
            let mut e = with_context(blank("response_filed", at), c);
            e.module = Some("proceedings".into());
            e.item_id = Some(pid);
            e.section = render_section(s25.as_deref(), s61.as_deref());
            e.section_1961 = s61;
            e.filed_on = s(after, "filed_on");
            e.reference = s(after, "transaction_id");
            Ok(Some(e))
        }
        "demands" => {
            let Some(before) = before else { return Ok(None) };
            let (old_amt, new_amt) = (money_of(before), money_of(after));
            let (old_st, new_st) = (s(before, "status"), s(after, "status"));
            if old_amt == new_amt && old_st == new_st { return Ok(None); }
            let Some(yc) = s(after, "year_context_id") else { return Ok(None) };
            let Some(c) = context_for_year(con, &yc)? else { return Ok(None) };
            let mut e = with_context(blank("demand_changed", at), c);
            e.module = Some("demands".into());
            e.item_id = s(after, "id");
            e.section = s(after, "section_or_demand_type");
            if old_amt != new_amt {
                e.old_value = old_amt;
                e.new_value = new_amt;
            } else {
                e.old_value = old_st;
                e.new_value = new_st.clone();
            }
            e.status = new_st;
            Ok(Some(e))
        }
        _ => Ok(None),
    }
}

pub fn list(con: &Connection, since: Option<String>) -> AppResult<UpdatesReport> {
    let since = match since { Some(x) => Some(x), None => default_since(con)? };
    let Some(since) = since else { return Ok(UpdatesReport { since: None, entries: Vec::new() }) };

    // The newest upsert per entity in the window.
    let mut st = con.prepare(
        "SELECT l.entity_type, l.entity_id, l.payload, l.created_at FROM ledger l
         WHERE l.op = 'upsert' AND l.created_at > ?1
           AND l.entity_type IN ('communications','proceedings','responses','demands')
           AND NOT EXISTS (SELECT 1 FROM ledger n WHERE n.entity_type = l.entity_type AND n.entity_id = l.entity_id
                           AND n.op = 'upsert' AND (n.created_at > l.created_at
                                OR (n.created_at = l.created_at AND (n.device_id, n.seq) > (l.device_id, l.seq))))
         ORDER BY l.created_at DESC")?;
    let latest: Vec<(String, String, String, String)> = st.query_map([&since], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
        .collect::<Result<_, _>>()?;
    let mut base = con.prepare_cached(
        "SELECT payload FROM ledger WHERE entity_type = ?1 AND entity_id = ?2 AND op = 'upsert' AND created_at <= ?3
         ORDER BY created_at DESC, device_id DESC, seq DESC LIMIT 1")?;
    let mut entries = Vec::new();
    for (etype, eid, payload, at) in latest {
        let after: Value = serde_json::from_str(&payload).unwrap_or(Value::Null);
        let before: Option<Value> = base.query_row(params![etype, eid, since], |r| r.get::<_, String>(0)).optional()?
            .and_then(|p| serde_json::from_str(&p).ok());
        if let Some(e) = classify(con, &etype, &at, &after, before.as_ref())? {
            entries.push(e);
        }
    }

    // Sync failed: straight from ingestion_runs.
    let mut st = con.prepare(
        "SELECT r.run_at, r.status, r.notes, r.module, cl.id, cl.name, cl.pan FROM ingestion_runs r
         LEFT JOIN clients cl ON cl.id = r.client_id
         WHERE r.status IN ('failed','credentials_parked') AND r.run_at > ?1 ORDER BY r.run_at DESC")?;
    let runs = st.query_map([&since], |r| {
        let mut e = blank("sync_failed", &r.get::<_, String>(0)?);
        e.run_status = r.get(1)?;
        e.reason = r.get::<_, Option<String>>(2)?.map(|n| mask::text(&n));
        e.module = r.get(3)?;
        e.client_id = r.get(4)?;
        e.client_name = r.get(5)?;
        e.pan_masked = r.get::<_, Option<String>>(6)?.map(|p| mask::pan(&p));
        Ok(e)
    })?;
    for e in runs { entries.push(e?); }

    Ok(UpdatesReport { since: Some(since), entries })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repo::{clients, local};

    fn ledger(con: &Connection, seq: i64, etype: &str, id: &str, payload: Value, at: &str) {
        con.execute("INSERT INTO ledger (device_id, seq, op, entity_type, entity_id, payload, created_at)
                     VALUES ('dev_a', ?1, 'upsert', ?2, ?3, ?4, ?5)",
                    params![seq, etype, id, payload.to_string(), at]).unwrap();
    }

    /// Task 17.1: a fixture with two runs returns one entry per §4.2 rule.
    #[test]
    fn two_runs_one_entry_per_rule() {
        let mut con = Connection::open_in_memory().unwrap();
        crate::migrate::run(&mut con).unwrap();
        local::set(&con, local::DEVICE_ID, "dev_a").unwrap();
        let c = clients::create_minimal(&con, "ABCDE1234F", Some("Example")).unwrap();
        let t: String = con.query_row("SELECT id FROM type_registry LIMIT 1", [], |r| r.get(0)).unwrap();
        con.execute_batch(&format!(
            "INSERT INTO year_contexts (id, client_id, assessment_year) VALUES ('yc1', '{}', '2024-25');
             INSERT INTO proceedings (id, year_context_id, proceeding_type_id, natural_key, status, source_panel,
                                      row_hash, first_seen_at, last_seen_at, section_1961)
               VALUES ('p1', 'yc1', '{t}', 'nk1', 'open', 'self:action', 'h', 'x', 'x', '143(2)'),
                      ('p2', 'yc1', '{t}', 'nk2', 'closed', 'self:action', 'h', 'x', 'x', '148');
             INSERT INTO ingestion_sweeps (id, device_id, scope, status, started_at, finished_at) VALUES
               ('s1', 'dev_a', '{{}}', 'done', '2026-09-01T00:00:00.000Z', '2026-09-01T01:00:00.000Z'),
               ('s2', 'dev_a', '{{}}', 'done', '2026-09-10T00:00:00.000Z', '2026-09-10T01:00:00.000Z');
             INSERT INTO ingestion_runs (id, run_at, device_id, client_id, module, status, notes) VALUES
               ('r1', '2026-09-10T00:30:00.000Z', 'dev_a', '{}', 'proceedings', 'credentials_parked', 'login ABCDE1234F refused');",
            c.id, c.id)).unwrap();
        let (a, b) = ("2026-09-01T00:30:00.000Z", "2026-09-10T00:30:00.000Z");
        // run 1 baselines
        ledger(&con, 100, "proceedings", "p1", serde_json::json!({"id":"p1","year_context_id":"yc1","status":"open","due_date":"2026-09-20"}), a);
        ledger(&con, 101, "proceedings", "p2", serde_json::json!({"id":"p2","year_context_id":"yc1","status":"open","due_date":null}), a);
        ledger(&con, 102, "demands", "d1", serde_json::json!({"id":"d1","year_context_id":"yc1","status":"open","current_outstanding":1000.0}), a);
        // run 2 changes
        ledger(&con, 200, "communications", "cm1", serde_json::json!({"id":"cm1","proceeding_id":"p1","reference_id":"R1","response_due_date":"2026-09-30"}), b);
        ledger(&con, 201, "proceedings", "p1", serde_json::json!({"id":"p1","year_context_id":"yc1","status":"open","due_date":"2026-09-25"}), b);
        ledger(&con, 202, "responses", "rs1", serde_json::json!({"id":"rs1","proceeding_id":"p1","filed_on":"2026-09-09","transaction_id":"77120391"}), b);
        ledger(&con, 203, "proceedings", "p2", serde_json::json!({"id":"p2","year_context_id":"yc1","status":"closed","due_date":null}), b);
        ledger(&con, 204, "demands", "d1", serde_json::json!({"id":"d1","year_context_id":"yc1","status":"open","current_outstanding":500.0}), b);

        let r = list(&con, None).unwrap();
        assert_eq!(r.since.as_deref(), Some("2026-09-01T01:00:00.000Z"));
        let mut groups: Vec<&str> = r.entries.iter().map(|e| e.group.as_str()).collect();
        groups.sort();
        assert_eq!(groups, vec!["closed", "demand_changed", "due_changed", "new_notice", "response_filed", "sync_failed"]);
        let due = r.entries.iter().find(|e| e.group == "due_changed").unwrap();
        assert_eq!((due.old_value.as_deref(), due.new_value.as_deref()), (Some("2026-09-20"), Some("2026-09-25")));
        let failed = r.entries.iter().find(|e| e.group == "sync_failed").unwrap();
        assert_eq!(failed.reason.as_deref(), Some("login ABCDE••••F refused"));
    }
}
