//! From what the portal shows to what the archive stores. One mapping, used
//! by the legacy backfill (migration 0009) and by live ingestion, so a
//! notice absorbed either way lands in the same shape.
//!
//! Rules that live here (docs/05-ingestion.md):
//!   - blank beats guessed: a field the portal did not show is NULL and
//!     named in `gap_flags`;
//!   - machine-read rows start with `verified_flag = 0`;
//!   - a row that changes on re-read resets `verified_flag` to 0;
//!   - the document is stored before the row that points at it.

use crate::dates::to_iso;
use crate::error::{AppError, AppResult};
use crate::ids::{new_id, now, row_hash, sha256_hex};
use crate::repo::model::{Communication, Proceeding, Response, Status};
use crate::repo::{clients, documents, proceedings, registry};
use rusqlite::{Connection, OptionalExtension};

/// A proceeding card as the scraper reads it (`app/portal/scraper.py`).
#[derive(Debug, Clone, Default)]
pub struct ProceedingCard {
    pub tab: String,          // self | other_pan | auth_rep
    pub sub_tab: String,      // action | information
    pub proceeding_name: Option<String>,
    pub pan: Option<String>,
    pub assessee_name: Option<String>,
    pub assessment_year: Option<String>,
    pub financial_year: Option<String>,
    pub applicable_act: Option<String>,
    pub status: Option<String>,
    /// The date on the stepper's first step: when the proceeding reached
    /// its first state (read anchored from the card; see sidecar/ingest/parse.py).
    pub initiated_on: Option<String>,
    pub closure_date: Option<String>,
    pub closure_order: Option<String>,
}

/// A notice card, with the PDF if it was fetched.
#[derive(Debug, Clone, Default)]
pub struct NoticeCard {
    pub ref_id: String,
    pub notice_us: Option<String>,
    pub doc_ref_id: Option<String>,
    pub description: Option<String>,
    pub issued_on: Option<String>,
    pub served_on: Option<String>,
    pub due_date: Option<String>,
    /// `portal` or `claude` in the legacy archive. A Claude date is a
    /// suggestion and is stored as one; it never becomes `response_due_date`.
    pub due_date_source: Option<String>,
    pub ao_viewed_on: Option<String>,
    /// "Last Response submitted On" — the date the firm's reply was filed.
    pub last_response_on: Option<String>,
    pub responded: Option<i64>,
    pub downloaded_at: Option<String>,
    pub pdf: Option<Vec<u8>>,
}

pub struct Absorbed {
    pub client_id: String,
    pub proceeding_id: String,
    pub communication_id: Option<String>,
}

fn clean(s: &Option<String>) -> Option<String> {
    s.as_deref().map(str::trim).filter(|v| !v.is_empty() && *v != "-").map(str::to_string)
}

pub fn source_panel(tab: &str, sub_tab: &str) -> AppResult<String> {
    let tab = match tab { "self" | "other_pan" | "auth_rep" => tab, _ => return Err(AppError::invalid(format!("unknown tab {tab}"))) };
    let sub = match sub_tab { "action" | "information" => sub_tab, _ => return Err(AppError::invalid(format!("unknown sub-tab {sub_tab}"))) };
    Ok(format!("{tab}:{sub}"))
}

/// The proceeding type from the portal's "Proceeding Name". Unrecognised
/// names map to `other`; the display name is kept verbatim regardless.
pub fn proceeding_type_code(name: Option<&str>) -> &'static str {
    let n = name.unwrap_or("").to_ascii_lowercase();
    if n.contains("143(1)(a)") || n.contains("adjustment") { "adjustment_143_1a" }
    else if n.contains("139(9)") || n.contains("defective") { "defective_return_139_9" }
    else if n.contains("first appeal") { "first_appeal" }
    else if n.contains("drp") { "drp" }
    else if n.contains("penalty") { "penalty" }
    else if n.contains("recovery") { "recovery" }
    else if n.contains("give effect") { "give_effect_250" }
    else if n.contains("rectification") || n.contains("154") { "rectification_154" }
    else if n.contains("clarification") { "seek_clarification" }
    else if n.contains("issue letter") { "issue_letter" }
    else if n.contains("148") || n.contains("reassessment") || n.contains("re-assessment") { "reassessment_148" }
    else if n.contains("144") { "best_judgement_144" }
    else if n.contains("263") || n.contains("revision") { "revision_263" }
    else if n.contains("faceless") { "faceless_assessment" }
    else if n.contains("143(3)") || n.contains("143(2)") || n.contains("scrutiny") || n.contains("assessment") { "scrutiny_assessment" }
    else if n.contains("tds") { "tds_default" }
    else { "other" }
}

/// The communication type from the notice description
/// (`[ITBA]Show Cause Notice u/s 270A`).
pub fn communication_type_code(description: Option<&str>) -> &'static str {
    let d = description.unwrap_or("").to_ascii_lowercase();
    if d.contains("show cause") { "show_cause_notice" }
    else if d.contains("hearing") { "hearing_notice" }
    else if d.contains("questionnaire") { "questionnaire" }
    else if d.contains("issue letter") { "issue_letter" }
    else if d.contains("clarification") { "clarification_letter" }
    else if d.contains("intimation") { "intimation" }
    else if d.contains("communication window") { "communication_window" }
    else if d.contains("order") { "order" }
    else if d.contains("adjournment") { "adjournment_reply" }
    else if d.contains("notice") { "notice" }
    else { "other" }
}

/// `Show Cause Notice u/s 270Aof Income Tax Act 1961.` → `270A`. The portal
/// runs the section straight into the next word, so the match stops at the
/// first character that cannot be part of a section reference.
pub fn section_from_text(text: Option<&str>) -> Option<String> {
    let t = text?;
    let lower = t.to_ascii_lowercase();
    let idx = lower.find("u/s")?;
    let rest = t[idx + 3..].trim_start();
    let mut out = String::new();
    for ch in rest.chars() {
        if ch.is_ascii_digit() || ch == '(' || ch == ')' || (ch.is_ascii_uppercase() && !out.is_empty()) {
            out.push(ch);
        } else if out.is_empty() {
            return None;
        } else {
            break;
        }
    }
    // A trailing lowercase word ("270Aof") is cut by the loop; a dangling
    // "(" from "r.w.s. 143(3)" cannot happen because the loop stops at 'r'.
    Some(out).filter(|s| !s.is_empty())
}

/// `Rectification Proceeding u/s 154 r.w.s. 143(3)` → `154 r.w.s. 143(3)`.
/// Keeps the "read with" chain the portal prints, since a partner reads it.
pub fn section_chain_from_name(name: Option<&str>) -> Option<String> {
    let n = name?;
    let idx = n.to_ascii_lowercase().find("u/s")?;
    let rest = n[idx + 3..].trim();
    if rest.is_empty() { None } else { Some(rest.to_string()) }
}

/// Which PAN a card belongs to. A "Self" card without a printed PAN is the
/// logged-in taxpayer's by the portal's own definition of that tab; the
/// caller passes that PAN in `self_pan`. Anything else without a PAN cannot
/// be attached and is refused rather than guessed.
fn resolve_pan(card: &ProceedingCard, self_pan: Option<&str>) -> AppResult<(String, bool)> {
    if let Some(p) = clean(&card.pan) {
        return Ok((p.to_ascii_uppercase(), false));
    }
    match self_pan {
        Some(p) if !p.trim().is_empty() => Ok((p.trim().to_ascii_uppercase(), true)),
        _ => Err(AppError::invalid("card shows no PAN and no login PAN is known")),
    }
}

/// Absorb one proceeding card, and one notice under it if given. Returns the
/// ids written. Everything inside runs on the caller's connection, which
/// should be a transaction.
pub fn absorb(con: &Connection, self_pan: Option<&str>, card: &ProceedingCard,
              notice: Option<&NoticeCard>) -> AppResult<Absorbed> {
    let (pan, pan_from_login) = resolve_pan(card, self_pan)?;
    let client = match clients::find_by_pan(con, &pan)? {
        Some(c) => c,
        None => clients::create_minimal(con, &pan, card.assessee_name.as_deref())?,
    };
    let ay = clean(&card.assessment_year);
    let yc = clients::ensure_year_context(con, &client.id, ay.as_deref(), clean(&card.financial_year).as_deref())?;
    let panel = source_panel(&card.tab, &card.sub_tab)?;
    let name = clean(&card.proceeding_name);
    let natural_key = sha256_hex(format!("{}|{}|{}|{}", pan, ay.as_deref().unwrap_or(""), panel,
                                         name.as_deref().unwrap_or("")).as_bytes());
    let type_id = registry::require(con, "proceeding_type", proceeding_type_code(name.as_deref()))?;
    let status = Status::from_portal(card.status.as_deref());
    let closure_date = to_iso(card.closure_date.as_deref());
    let initiated_on = to_iso(card.initiated_on.as_deref());

    let mut gaps: Vec<&str> = Vec::new();
    if ay.is_none() { gaps.push("assessment_year"); }
    if pan_from_login { gaps.push("pan"); }
    // The proceeding card never shows these; the portal states them, if at
    // all, inside the notice PDF.
    gaps.extend(["authority", "limitation_date"]);
    if initiated_on.is_none() { gaps.push("initiated_on"); }
    if card.status.is_none() { gaps.push("status"); }
    if card.closure_date.is_some() && closure_date.is_none() { gaps.push("closure_date"); }
    gaps.sort();
    let gap_json = serde_json::to_string(&gaps)?;

    let hash = proceeding_row_hash(name.as_deref(), clean(&card.assessee_name).as_deref(), status,
                                   initiated_on.as_deref(), closure_date.as_deref(),
                                   clean(&card.closure_order).as_deref(), &gap_json);

    let ts = now();
    let proceeding = match proceedings::by_natural_key(con, &natural_key)? {
        Some(existing) => {
            let changed = existing.row_hash != hash;
            let p = Proceeding {
                proceeding_type_id: type_id,
                assessee_name: clean(&card.assessee_name).or(existing.assessee_name),
                section_1961: section_chain_from_name(name.as_deref()).or(existing.section_1961),
                initiated_on: initiated_on.or(existing.initiated_on),
                status: status.as_str().into(),
                portal_status: clean(&card.status),
                closure_date, closure_order: clean(&card.closure_order),
                verified_flag: if changed { 0 } else { existing.verified_flag },
                gap_flags: Some(gap_json),
                row_hash: hash,
                last_seen_at: ts.clone(),
                updated_at: if changed { ts.clone() } else { existing.updated_at.clone() },
                ..existing
            };
            if changed || p.last_seen_at != ts {
                proceedings::save(con, &p)?;
            }
            p
        }
        None => {
            let p = Proceeding {
                id: new_id(), year_context_id: yc.id.clone(), proceeding_type_id: type_id,
                natural_key, display_name: name.clone(),
                assessee_name: clean(&card.assessee_name),
                section_2025: None,
                section_1961: section_chain_from_name(name.as_deref()),
                din_reference: None, authority: None, initiated_on, due_date: None,
                manual_due_date: None, suggested_due_date: None, limitation_date: None,
                hearing_date: None, status: status.as_str().into(),
                portal_status: clean(&card.status), closure_date,
                closure_order: clean(&card.closure_order), source_panel: panel,
                created_mode: "auto".into(), appeal_number: None, order_appealed_against: None,
                verified_flag: 0, gap_flags: Some(gap_json), row_hash: hash,
                first_seen_at: ts.clone(), last_seen_at: ts.clone(),
                created_at: ts.clone(), updated_at: ts.clone(),
            };
            proceedings::save(con, &p)?;
            p
        }
    };

    let communication_id = match notice {
        Some(n) => Some(absorb_notice(con, &proceeding, n)?),
        None => None,
    };
    proceedings::refresh_due_date(con, &proceeding.id)?;

    Ok(Absorbed { client_id: client.id, proceeding_id: proceeding.id, communication_id })
}

fn absorb_notice(con: &Connection, proceeding: &Proceeding, n: &NoticeCard) -> AppResult<String> {
    let reference_id = n.ref_id.trim().to_string();
    if reference_id.is_empty() {
        return Err(AppError::invalid("notice card has no reference id"));
    }
    let description = clean(&n.description);
    let type_id = registry::require(con, "communication_type", communication_type_code(description.as_deref()))?;
    let section = clean(&n.notice_us).or_else(|| section_from_text(description.as_deref()));

    // A date the legacy tool got from Claude is a suggestion, not a
    // portal fact. It moves to the proceeding's suggested_due_date column
    // and the communication records the gap.
    let claude_sourced = n.due_date_source.as_deref() == Some("claude");
    let stated_due = if claude_sourced { None } else { clean(&n.due_date) };
    let response_due_date = to_iso(stated_due.as_deref());
    let issued_on = to_iso(n.issued_on.as_deref());
    let served_on = to_iso(n.served_on.as_deref());
    let ao_viewed_on = to_iso(n.ao_viewed_on.as_deref());

    let proceeding_status = Status::parse(&proceeding.status);
    let status = match n.responded {
        Some(1) => Status::ResponseSubmitted,
        Some(0) => if proceeding_status == Status::Closed { Status::Closed } else { Status::Open },
        _ => if proceeding_status == Status::Closed { Status::Closed } else { Status::Unknown },
    };

    let mut gaps: Vec<&str> = Vec::new();
    if response_due_date.is_none() { gaps.push("response_due_date"); }
    if issued_on.is_none() { gaps.push("issued_on"); }
    if served_on.is_none() { gaps.push("served_on"); }
    if clean(&n.doc_ref_id).is_none() { gaps.push("din"); }
    if section.is_none() { gaps.push("section"); }
    if n.responded.is_none() { gaps.push("status"); }
    gaps.sort();
    let gap_json = serde_json::to_string(&gaps)?;

    let last_response_on = to_iso(n.last_response_on.as_deref());
    let hash = notice_row_hash(&reference_id, clean(&n.doc_ref_id).as_deref(), description.as_deref(),
                               issued_on.as_deref(), served_on.as_deref(), response_due_date.as_deref(),
                               ao_viewed_on.as_deref(), last_response_on.as_deref(), status, &gap_json);

    // Document first, row second (docs/05): the bytes are content-addressed
    // and written before any row that will point at them.
    if let Some(bytes) = n.pdf.as_deref().filter(|b| !b.is_empty()) {
        documents::store_blob(con, bytes)?;
    }

    let ts = now();
    let comm = match proceedings::communication_by_reference(con, &reference_id)? {
        Some(existing) => {
            let changed = existing.row_hash != hash;
            let c = Communication {
                proceeding_id: proceeding.id.clone(), communication_type_id: type_id,
                din: clean(&n.doc_ref_id).or(existing.din),
                section_1961: section.or(existing.section_1961),
                description: description.or(existing.description),
                issued_on: issued_on.or(existing.issued_on),
                served_on: served_on.or(existing.served_on),
                response_due_date, ao_viewed_on: ao_viewed_on.or(existing.ao_viewed_on),
                status: status.as_str().into(),
                verified_flag: if changed { 0 } else { existing.verified_flag },
                gap_flags: Some(gap_json), row_hash: hash,
                last_seen_at: ts.clone(),
                updated_at: if changed { ts.clone() } else { existing.updated_at.clone() },
                ..existing
            };
            proceedings::save_communication(con, &c)?;
            c
        }
        None => {
            let c = Communication {
                id: new_id(), proceeding_id: proceeding.id.clone(), communication_type_id: type_id,
                reference_id: reference_id.clone(), din: clean(&n.doc_ref_id), section_2025: None,
                section_1961: section, description, issued_on, served_on, response_due_date,
                ao_viewed_on, status: status.as_str().into(), direction: "inbound".into(),
                verified_flag: 0, gap_flags: Some(gap_json), row_hash: hash,
                first_seen_at: ts.clone(), last_seen_at: ts.clone(),
                created_at: ts.clone(), updated_at: ts.clone(),
            };
            proceedings::save_communication(con, &c)?;
            c
        }
    };

    // The firm's filed reply, as the card states it: a date and nothing more.
    // One response node per notice; the mode is not stated, so it is NULL.
    if let Some(filed) = last_response_on.clone() {
        let existing_resp: Option<Response> = con.query_row(
            "SELECT * FROM responses WHERE in_reply_to = ?1 LIMIT 1", [&comm.id],
            proceedings::response_row).optional()?;
        let resp_gaps = serde_json::to_string(&["filed_by", "response_mode", "transaction_id"])?;
        let resp_hash = row_hash(&[Some(&filed), Some(&resp_gaps)]);
        match existing_resp {
            Some(r) if r.row_hash == resp_hash => {}
            Some(r) => proceedings::save_response(con, &Response {
                filed_on: Some(filed), row_hash: resp_hash, gap_flags: Some(resp_gaps),
                verified_flag: 0, updated_at: ts.clone(), ..r })?,
            None => proceedings::save_response(con, &Response {
                id: new_id(), proceeding_id: proceeding.id.clone(), in_reply_to: Some(comm.id.clone()),
                response_mode: None, filed_on: Some(filed), filed_by: None, remarks: None, transaction_id: None,
                direction: "outbound".into(), verified_flag: 0, gap_flags: Some(resp_gaps), row_hash: resp_hash,
                created_at: ts.clone(), updated_at: ts.clone(),
            })?,
        }
    }

    if claude_sourced {
        if let Some(d) = to_iso(n.due_date.as_deref()) {
            let mut p = proceeding.clone();
            if p.suggested_due_date.is_none() {
                p.suggested_due_date = Some(d);
                p.updated_at = ts.clone();
                proceedings::save(con, &p)?;
            }
        }
    }

    if let Some(bytes) = n.pdf.as_deref().filter(|b| !b.is_empty()) {
        documents::attach_stored(con, &documents::Attach {
            parent_type: "communication", parent_id: &comm.id, doc_kind: "communication",
            filename: Some(&format!("{reference_id}.pdf")), bytes, source_url: None,
            fetched_at: n.downloaded_at.as_deref().and_then(sqlite_stamp_to_iso).as_deref(),
        })?;
    }
    Ok(comm.id)
}

/// The proceeding row hash: what a re-read compares against to decide
/// "known and unchanged". Includes status and the gap list (docs/05).
#[allow(clippy::too_many_arguments)]
pub fn proceeding_row_hash(name: Option<&str>, assessee: Option<&str>, status: Status,
                           initiated_on: Option<&str>, closure_date: Option<&str>,
                           closure_order: Option<&str>, gap_json: &str) -> String {
    row_hash(&[name, assessee, Some(status.as_str()), initiated_on, closure_date, closure_order, Some(gap_json)])
}

#[allow(clippy::too_many_arguments)]
pub fn notice_row_hash(reference_id: &str, din: Option<&str>, description: Option<&str>,
                       issued_on: Option<&str>, served_on: Option<&str>, due: Option<&str>,
                       ao_viewed_on: Option<&str>, last_response_on: Option<&str>, status: Status,
                       gap_json: &str) -> String {
    row_hash(&[Some(reference_id), din, description, issued_on, served_on, due, ao_viewed_on,
               last_response_on, Some(status.as_str()), Some(gap_json)])
}

/// Would this notice card change anything already stored? Computes the
/// same hash `absorb` would write and compares it with the stored row,
/// without writing. `None` when the notice is unknown.
pub fn notice_unchanged(con: &Connection, proceeding_status: Status, n: &NoticeCard) -> AppResult<Option<bool>> {
    let reference_id = n.ref_id.trim();
    let Some(existing) = proceedings::communication_by_reference(con, reference_id)? else { return Ok(None); };
    let description = clean(&n.description);
    let section = clean(&n.notice_us).or_else(|| section_from_text(description.as_deref()));
    let claude_sourced = n.due_date_source.as_deref() == Some("claude");
    let response_due_date = if claude_sourced { None } else { to_iso(clean(&n.due_date).as_deref()) };
    let issued_on = to_iso(n.issued_on.as_deref());
    let served_on = to_iso(n.served_on.as_deref());
    let ao_viewed_on = to_iso(n.ao_viewed_on.as_deref());
    let last_response_on = to_iso(n.last_response_on.as_deref());
    let status = match n.responded {
        Some(1) => Status::ResponseSubmitted,
        Some(0) => if proceeding_status == Status::Closed { Status::Closed } else { Status::Open },
        _ => if proceeding_status == Status::Closed { Status::Closed } else { Status::Unknown },
    };
    let mut gaps: Vec<&str> = Vec::new();
    if response_due_date.is_none() { gaps.push("response_due_date"); }
    if issued_on.is_none() { gaps.push("issued_on"); }
    if served_on.is_none() { gaps.push("served_on"); }
    if clean(&n.doc_ref_id).is_none() { gaps.push("din"); }
    if section.is_none() { gaps.push("section"); }
    if n.responded.is_none() { gaps.push("status"); }
    gaps.sort();
    let gap_json = serde_json::to_string(&gaps)?;
    let hash = notice_row_hash(reference_id, clean(&n.doc_ref_id).as_deref(), description.as_deref(),
                               issued_on.as_deref(), served_on.as_deref(), response_due_date.as_deref(),
                               ao_viewed_on.as_deref(), last_response_on.as_deref(), status, &gap_json);
    Ok(Some(existing.row_hash == hash))
}

/// Is a stored document already attached to this notice?
pub fn notice_has_document(con: &Connection, reference_id: &str) -> AppResult<bool> {
    let Some(c) = proceedings::communication_by_reference(con, reference_id.trim())? else { return Ok(false); };
    Ok(documents::find(con, "communication", &c.id, "communication")?
        .map(|d| d.state == "stored").unwrap_or(false))
}

/// The legacy archive stamped `YYYY-MM-DD HH:MM:SS` (UTC, no marker).
fn sqlite_stamp_to_iso(s: &str) -> Option<String> {
    let s = s.trim();
    if s.len() == 19 && s.as_bytes()[10] == b' ' {
        Some(format!("{}T{}Z", &s[..10], &s[11..]))
    } else if s.ends_with('Z') {
        Some(s.to_string())
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sections_come_out_of_portal_wording() {
        assert_eq!(section_from_text(Some("[ITBA]Show Cause Notice u/s 270Aof Income Tax Act 1961.")).as_deref(), Some("270A"));
        assert_eq!(section_from_text(Some("[ITBA]Show Cause Notice u/s 271AAC(1)of Income Tax Act 1961.")).as_deref(), Some("271AAC(1)"));
        assert_eq!(section_from_text(Some("[ITBA]Hearing Notice u/s 250of Income Tax Act 1961.")).as_deref(), Some("250"));
        assert_eq!(section_from_text(Some("[ITBA]Issue Letter")), None);
        assert_eq!(section_chain_from_name(Some("Rectification Proceeding u/s 154 r.w.s. 143(3)")).as_deref(),
                   Some("154 r.w.s. 143(3)"));
    }

    #[test]
    fn types_map_from_names() {
        assert_eq!(proceeding_type_code(Some("Adjustment u/s 143(1)(a)")), "adjustment_143_1a");
        assert_eq!(proceeding_type_code(Some("First Appeal Proceedings")), "first_appeal");
        assert_eq!(proceeding_type_code(Some("Issue Letter")), "issue_letter");
        assert_eq!(proceeding_type_code(Some("Give effect Proceeding u/s 250 r.w.s 143(3)")), "give_effect_250");
        assert_eq!(proceeding_type_code(None), "other");
        assert_eq!(communication_type_code(Some("[ITBA]Enablement of Communication Window")), "communication_window");
    }
}
