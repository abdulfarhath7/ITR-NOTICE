//! Proceeding events (docs/18 §3.4): `ao_viewed` when a re-checked reply
//! flips from unseen to seen by the AO, `limitation_changed` when the
//! limitation date moves. Each is one immutable row of a synced table, so
//! it is a ledger entry like any other and reaches every device.

use crate::error::AppResult;
use crate::ids::{new_id, now};
use crate::repo::model::ProceedingEvent;
use crate::repo::rows;
use rusqlite::{Connection, Row};
use serde_json::{json, Value};

pub const AO_VIEWED: &str = "ao_viewed";
pub const LIMITATION_CHANGED: &str = "limitation_changed";

pub fn from_row(r: &Row) -> rusqlite::Result<ProceedingEvent> {
    Ok(ProceedingEvent {
        id: r.get("id")?, proceeding_id: r.get("proceeding_id")?, communication_id: r.get("communication_id")?,
        kind: r.get("kind")?, payload: r.get("payload")?, at: r.get("at")?,
        created_at: r.get("created_at")?, updated_at: r.get("updated_at")?,
    })
}

fn write(con: &Connection, proceeding_id: &str, communication_id: Option<&str>, kind: &str, payload: Value) -> AppResult<ProceedingEvent> {
    let ts = now();
    let e = ProceedingEvent {
        id: new_id(), proceeding_id: proceeding_id.into(), communication_id: communication_id.map(str::to_string),
        kind: kind.into(), payload: payload.to_string(), at: ts.clone(), created_at: ts.clone(), updated_at: ts,
    };
    rows::upsert(con, "proceeding_events", &e)?;
    Ok(e)
}

/// The reply on `communication_id` was seen by the AO on `ao_viewed_on`;
/// this device first noticed at `first_seen_at`.
pub fn ao_viewed(con: &Connection, proceeding_id: &str, communication_id: &str, ao_viewed_on: &str, first_seen_at: &str) -> AppResult<()> {
    write(con, proceeding_id, Some(communication_id), AO_VIEWED,
          json!({ "ao_viewed_on": ao_viewed_on, "first_seen_at": first_seen_at }))?;
    Ok(())
}

/// `source` is `portal` or `manual`.
pub fn limitation_changed(con: &Connection, proceeding_id: &str, from: Option<&str>, to: Option<&str>, source: &str) -> AppResult<()> {
    write(con, proceeding_id, None, LIMITATION_CHANGED, json!({ "from": from, "to": to, "source": source }))?;
    Ok(())
}

pub fn for_proceeding(con: &Connection, proceeding_id: &str) -> AppResult<Vec<ProceedingEvent>> {
    let mut st = con.prepare("SELECT * FROM proceeding_events WHERE proceeding_id = ?1 ORDER BY at")?;
    let rows = st.query_map([proceeding_id], from_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}
