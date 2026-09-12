//! The cross-module list every screen reads (docs/08 `list_work_items`) and
//! the per-item detail DTOs. Never a raw row: every field here is chosen.

use crate::error::AppResult;
use crate::mask;
use crate::repo::model::{AdjournmentRequest, Communication, Document, Proceeding, Response};
use crate::repo::{clients, documents, drafts, proceedings, registry};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WorkItemFilter {
    pub client_ids: Option<Vec<String>>,
    pub assessment_year: Option<String>,
    pub module: Option<String>,
    pub status: Option<String>,
    pub search: Option<String>,
}

/// One row of the attention list, client detail, or a client's module pane.
#[derive(Debug, Clone, Serialize)]
pub struct WorkItemRow {
    pub module: String,                 // proceedings | demands | returns | forms
    pub id: String,
    pub client_id: String,
    pub client_name: String,
    pub client_code: Option<String>,
    pub pan_masked: String,
    pub year_context_id: String,
    pub assessment_year: Option<String>,
    pub title: String,                  // what it is
    pub type_label: String,
    pub reference: Option<String>,      // DIN, demand ref, ack no.
    pub section: Option<String>,        // "268 (old 148)" rendered by the screen
    pub section_2025: Option<String>,
    pub section_1961: Option<String>,
    pub due_date: Option<String>,
    pub manual_due_date: Option<String>,
    pub suggested_due_date: Option<String>,
    pub limitation_date: Option<String>,
    pub status: String,
    pub source_panel: Option<String>,
    pub verified_flag: i64,
    pub gap_flags: Vec<String>,
    pub document_count: i64,
    pub open_communications: i64,
    pub last_seen_at: String,
}

fn gaps(json: Option<String>) -> Vec<String> {
    json.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

pub fn list(con: &Connection, f: &WorkItemFilter) -> AppResult<Vec<WorkItemRow>> {
    let mut sql = String::from(
        "SELECT p.id, cl.id, cl.name, cl.client_code, cl.pan, yc.id, yc.assessment_year,
                p.display_name, t.label, p.din_reference, p.section_2025, p.section_1961,
                p.due_date, p.manual_due_date, p.suggested_due_date, p.limitation_date, p.status,
                p.source_panel, p.verified_flag, p.gap_flags,
                (SELECT count(*) FROM documents d JOIN communications c2 ON c2.id = d.parent_id
                  WHERE d.parent_type = 'communication' AND c2.proceeding_id = p.id AND d.state = 'stored'),
                (SELECT count(*) FROM communications c3 WHERE c3.proceeding_id = p.id
                  AND c3.status IN ('open','adjournment_sought','unknown')),
                p.last_seen_at
         FROM proceedings p
         JOIN year_contexts yc ON yc.id = p.year_context_id
         JOIN clients cl ON cl.id = yc.client_id
         JOIN type_registry t ON t.id = p.proceeding_type_id
         WHERE 1 = 1");
    let mut binds: Vec<rusqlite::types::Value> = Vec::new();
    if let Some(ids) = &f.client_ids {
        if !ids.is_empty() {
            let marks: Vec<String> = ids.iter().map(|id| { binds.push(id.clone().into()); format!("?{}", binds.len()) }).collect();
            sql.push_str(&format!(" AND cl.id IN ({})", marks.join(",")));
        }
    }
    if let Some(ay) = f.assessment_year.as_deref().filter(|s| !s.is_empty()) {
        binds.push(ay.to_string().into());
        sql.push_str(&format!(" AND yc.assessment_year = ?{}", binds.len()));
    }
    if let Some(st) = f.status.as_deref().filter(|s| !s.is_empty()) {
        binds.push(st.to_string().into());
        sql.push_str(&format!(" AND p.status = ?{}", binds.len()));
    }
    if let Some(q) = f.search.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        binds.push(format!("%{}%", q.to_lowercase()).into());
        let n = binds.len();
        sql.push_str(&format!(
            " AND (lower(cl.name) LIKE ?{n} OR lower(p.display_name) LIKE ?{n}
               OR lower(coalesce(cl.client_code,'')) LIKE ?{n} OR lower(coalesce(p.din_reference,'')) LIKE ?{n})"));
    }
    if matches!(f.module.as_deref(), Some(m) if !m.is_empty() && m != "proceedings") {
        // Other modules arrive in Phase 5; until then their lists are empty.
        return Ok(Vec::new());
    }
    sql.push_str(" ORDER BY p.due_date IS NULL, p.due_date, p.last_seen_at DESC");

    let mut st = con.prepare(&sql)?;
    let rows = st.query_map(rusqlite::params_from_iter(binds), |r| {
        let pan: String = r.get(4)?;
        Ok(WorkItemRow {
            module: "proceedings".into(), id: r.get(0)?, client_id: r.get(1)?, client_name: r.get(2)?,
            client_code: r.get(3)?, pan_masked: mask::pan(&pan), year_context_id: r.get(5)?,
            assessment_year: r.get(6)?,
            title: r.get::<_, Option<String>>(7)?.unwrap_or_else(|| "Proceeding".into()),
            type_label: r.get(8)?, reference: r.get(9)?,
            section: None, section_2025: r.get(10)?, section_1961: r.get(11)?,
            due_date: r.get(12)?, manual_due_date: r.get(13)?, suggested_due_date: r.get(14)?,
            limitation_date: r.get(15)?, status: r.get(16)?, source_panel: r.get(17)?,
            verified_flag: r.get(18)?, gap_flags: gaps(r.get(19)?), document_count: r.get(20)?,
            open_communications: r.get(21)?, last_seen_at: r.get(22)?,
        })
    })?;
    let mut out: Vec<WorkItemRow> = rows.collect::<Result<Vec<_>, _>>()?;
    for row in &mut out {
        row.section = render_section(row.section_2025.as_deref(), row.section_1961.as_deref());
    }
    Ok(out)
}

/// `Sec 268 (old 148)` when both are known; either alone otherwise.
pub fn render_section(new: Option<&str>, old: Option<&str>) -> Option<String> {
    match (new, old) {
        (Some(n), Some(o)) => Some(format!("Sec {n} (old {o})")),
        (Some(n), None) => Some(format!("Sec {n}")),
        (None, Some(o)) => Some(format!("Sec {o}")),
        (None, None) => None,
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct CommunicationView {
    #[serde(flatten)]
    pub row: Communication,
    pub type_label: String,
    pub documents: Vec<Document>,
    pub has_draft: bool,
    pub gaps: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProceedingDetail {
    #[serde(flatten)]
    pub row: Proceeding,
    pub client_id: String,
    pub client_name: String,
    pub client_code: Option<String>,
    pub pan_masked: String,
    pub assessment_year: Option<String>,
    pub financial_year: Option<String>,
    pub type_label: String,
    pub type_category: Option<String>,
    pub section: Option<String>,
    pub gaps: Vec<String>,
    pub communications: Vec<CommunicationView>,
    pub responses: Vec<Response>,
    pub adjournments: Vec<AdjournmentRequest>,
    pub documents: Vec<Document>,
}

pub fn proceeding_detail(con: &Connection, id: &str) -> AppResult<Option<ProceedingDetail>> {
    let Some(p) = proceedings::get(con, id)? else { return Ok(None); };
    let (client_id, client_name, client_code, pan, ay, fy): (String, String, Option<String>, String, Option<String>, Option<String>) =
        con.query_row(
            "SELECT cl.id, cl.name, cl.client_code, cl.pan, yc.assessment_year, yc.financial_year
             FROM year_contexts yc JOIN clients cl ON cl.id = yc.client_id WHERE yc.id = ?1",
            params![p.year_context_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)))?;
    let t = registry::get(con, &p.proceeding_type_id)?;
    let mut comms = Vec::new();
    for c in proceedings::communications_for(con, id)? {
        let ct = registry::get(con, &c.communication_type_id)?;
        comms.push(CommunicationView {
            type_label: ct.map(|t| t.label).unwrap_or_else(|| "Communication".into()),
            documents: documents::for_parent(con, "communication", &c.id)?,
            has_draft: drafts::for_communication(con, &c.id)?.is_some(),
            gaps: gaps(c.gap_flags.clone()),
            row: c,
        });
    }
    Ok(Some(ProceedingDetail {
        client_id, client_name, client_code, pan_masked: mask::pan(&pan),
        assessment_year: ay, financial_year: fy,
        type_label: t.as_ref().map(|t| t.label.clone()).unwrap_or_else(|| "Proceeding".into()),
        type_category: t.and_then(|t| t.category),
        section: render_section(p.section_2025.as_deref(), p.section_1961.as_deref()),
        gaps: gaps(p.gap_flags.clone()),
        communications: comms,
        responses: proceedings::responses_for(con, id)?,
        adjournments: proceedings::adjournments_for(con, id)?,
        documents: documents::for_parent(con, "proceeding", id)?,
        row: p,
    }))
}

/// The client book row (docs/09 screen 2).
#[derive(Debug, Clone, Serialize)]
pub struct ClientSummary {
    pub id: String,
    pub name: String,
    pub client_code: Option<String>,
    pub pan_masked: String,
    pub gstin: Option<String>,
    pub entity_type: String,
    pub client_group: Option<String>,
    pub source: String,
    pub portal_login_ref: Option<String>,
    pub tags: Option<String>,
    pub open_count: i64,
    pub overdue_count: i64,
    pub last_sync_at: Option<String>,
    pub last_sync_status: Option<String>,
    pub year_count: i64,
}

pub fn client_summaries(con: &Connection, search: Option<&str>) -> AppResult<Vec<ClientSummary>> {
    let today = crate::dates::today_ist().format("%Y-%m-%d").to_string();
    let mut st = con.prepare(
        "SELECT cl.id, cl.name, cl.client_code, cl.pan, cl.gstin, cl.entity_type, cl.client_group,
                cl.source, cl.portal_login_ref, cl.tags,
                (SELECT count(*) FROM proceedings p JOIN year_contexts y ON y.id = p.year_context_id
                  WHERE y.client_id = cl.id AND p.status IN ('open','adjournment_sought','unknown')),
                (SELECT count(*) FROM proceedings p JOIN year_contexts y ON y.id = p.year_context_id
                  WHERE y.client_id = cl.id AND p.status IN ('open','adjournment_sought','unknown')
                    AND p.due_date IS NOT NULL AND p.due_date < ?1),
                (SELECT run_at FROM ingestion_runs r WHERE r.client_id = cl.id ORDER BY run_at DESC LIMIT 1),
                (SELECT status FROM ingestion_runs r WHERE r.client_id = cl.id ORDER BY run_at DESC LIMIT 1),
                (SELECT count(*) FROM year_contexts y WHERE y.client_id = cl.id)
         FROM clients cl
         WHERE (?2 IS NULL OR lower(cl.name) LIKE ?2 OR lower(coalesce(cl.client_code,'')) LIKE ?2
                OR cl.pan LIKE ?3)
         ORDER BY cl.name COLLATE NOCASE")?;
    let needle = search.map(str::trim).filter(|s| !s.is_empty()).map(|s| format!("%{}%", s.to_lowercase()));
    let pan_needle = search.map(str::trim).filter(|s| !s.is_empty()).map(|s| format!("%{}%", s.to_ascii_uppercase()));
    let rows = st.query_map(params![today, needle, pan_needle], |r| {
        let pan: String = r.get(3)?;
        Ok(ClientSummary {
            id: r.get(0)?, name: r.get(1)?, client_code: r.get(2)?, pan_masked: mask::pan(&pan),
            gstin: r.get(4)?, entity_type: r.get(5)?, client_group: r.get(6)?, source: r.get(7)?,
            portal_login_ref: r.get(8)?, tags: r.get(9)?, open_count: r.get(10)?,
            overdue_count: r.get(11)?, last_sync_at: r.get(12)?, last_sync_status: r.get(13)?,
            year_count: r.get(14)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// Full client for the detail and edit screens. PAN is unmasked here — the
/// edit form must show it — and never logged.
#[derive(Debug, Clone, Serialize)]
pub struct ClientDetail {
    #[serde(flatten)]
    pub row: crate::repo::model::Client,
    pub pan_masked: String,
    pub years: Vec<crate::repo::model::YearContext>,
    pub has_credential: bool,
    pub login_ref_effective: String,
}

pub fn client_detail(con: &Connection, id: &str, has_credential: impl Fn(&str) -> bool) -> AppResult<Option<ClientDetail>> {
    let Some(c) = clients::get(con, id)? else { return Ok(None); };
    let login_ref = c.portal_login_ref.clone().unwrap_or_else(|| c.pan.clone());
    Ok(Some(ClientDetail {
        pan_masked: mask::pan(&c.pan),
        years: clients::year_contexts(con, id)?,
        has_credential: has_credential(&login_ref),
        login_ref_effective: login_ref,
        row: c,
    }))
}
