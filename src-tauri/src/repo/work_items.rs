//! The cross-module list every screen reads (docs/08 `list_work_items`) and
//! the per-item detail DTOs. Never a raw row: every field here is chosen.

use crate::error::AppResult;
use crate::mask;
use crate::repo::model::{AdjournmentRequest, Communication, Document, Proceeding, Response};
use crate::repo::{clients, documents, drafts, proceedings, registry};
use rusqlite::{params, Connection, OptionalExtension};
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
    let want = |m: &str| f.module.as_deref().map(|x| x.is_empty() || x == m).unwrap_or(true);
    let mut out: Vec<WorkItemRow> = Vec::new();
    if want("proceedings") { out.extend(list_proceedings(con, f)?); }
    if want("demands") { out.extend(list_demands(con, f)?); }
    if want("returns") { out.extend(list_returns(con, f)?); }
    if want("forms") { out.extend(list_forms(con, f)?); }
    // Stated due first, soonest first; then most recently seen.
    out.sort_by(|a, b| a.due_date.is_none().cmp(&b.due_date.is_none())
        .then_with(|| a.due_date.cmp(&b.due_date))
        .then_with(|| b.last_seen_at.cmp(&a.last_seen_at)));
    Ok(out)
}

/// The WHERE clause shared by the four module queries: client, year,
/// status and search against the client and the item's own title column.
fn common_filter(f: &WorkItemFilter, title_col: &str, ref_col: &str, binds: &mut Vec<rusqlite::types::Value>) -> String {
    let mut sql = String::new();
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
        sql.push_str(&format!(" AND x.status = ?{}", binds.len()));
    }
    if let Some(q) = f.search.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        binds.push(format!("%{}%", q.to_lowercase()).into());
        let n = binds.len();
        sql.push_str(&format!(
            " AND (lower(cl.name) LIKE ?{n} OR lower(coalesce({title_col},'')) LIKE ?{n}
               OR lower(coalesce(cl.client_code,'')) LIKE ?{n} OR lower(coalesce({ref_col},'')) LIKE ?{n})"));
    }
    sql
}

fn list_proceedings(con: &Connection, f: &WorkItemFilter) -> AppResult<Vec<WorkItemRow>> {
    let mut sql = String::from(
        "SELECT x.id, cl.id, cl.name, cl.client_code, cl.pan, yc.id, yc.assessment_year,
                x.display_name, t.label, x.din_reference, x.section_2025, x.section_1961,
                x.due_date, x.manual_due_date, x.suggested_due_date, x.limitation_date, x.status,
                x.source_panel, x.verified_flag, x.gap_flags,
                (SELECT count(*) FROM documents d JOIN communications c2 ON c2.id = d.parent_id
                  WHERE d.parent_type = 'communication' AND c2.proceeding_id = x.id AND d.state = 'stored'),
                (SELECT count(*) FROM communications c3 WHERE c3.proceeding_id = x.id
                  AND c3.status IN ('open','adjournment_sought','unknown')),
                x.last_seen_at
         FROM proceedings x
         JOIN year_contexts yc ON yc.id = x.year_context_id
         JOIN clients cl ON cl.id = yc.client_id
         JOIN type_registry t ON t.id = x.proceeding_type_id
         WHERE 1 = 1");
    let mut binds: Vec<rusqlite::types::Value> = Vec::new();
    sql.push_str(&common_filter(f, "x.display_name", "x.din_reference", &mut binds));

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

fn list_demands(con: &Connection, f: &WorkItemFilter) -> AppResult<Vec<WorkItemRow>> {
    let mut sql = String::from(
        "SELECT x.id, cl.id, cl.name, cl.client_code, cl.pan, yc.id, yc.assessment_year,
                x.demand_reference_number, x.section_or_demand_type, x.demand_amount, x.current_outstanding,
                x.raised_on, x.status, x.verified_flag, x.gap_flags, x.last_seen_at,
                (SELECT count(*) FROM demand_responses r WHERE r.demand_id = x.id)
         FROM demands x
         JOIN year_contexts yc ON yc.id = x.year_context_id
         JOIN clients cl ON cl.id = yc.client_id
         WHERE 1 = 1");
    let mut binds: Vec<rusqlite::types::Value> = Vec::new();
    sql.push_str(&common_filter(f, "x.section_or_demand_type", "x.demand_reference_number", &mut binds));
    let mut st = con.prepare(&sql)?;
    let rows = st.query_map(rusqlite::params_from_iter(binds), |r| {
        let pan: String = r.get(4)?;
        let reference: Option<String> = r.get(7)?;
        let section: Option<String> = r.get(8)?;
        let outstanding: Option<f64> = r.get(10)?;
        let responses: i64 = r.get(16)?;
        Ok(WorkItemRow {
            module: "demands".into(), id: r.get(0)?, client_id: r.get(1)?, client_name: r.get(2)?,
            client_code: r.get(3)?, pan_masked: mask::pan(&pan), year_context_id: r.get(5)?,
            assessment_year: r.get(6)?,
            title: match outstanding {
                Some(a) => format!("Demand · outstanding {}", money(a)),
                None => "Demand · outstanding amount not stated".into(),
            },
            type_label: section.clone().unwrap_or_else(|| "Outstanding demand".into()),
            reference, section, section_2025: None, section_1961: None,
            due_date: None, manual_due_date: None, suggested_due_date: None, limitation_date: None,
            status: r.get(12)?, source_panel: None, verified_flag: r.get(13)?, gap_flags: gaps(r.get(14)?),
            document_count: 0, open_communications: responses, last_seen_at: r.get(15)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

fn list_returns(con: &Connection, f: &WorkItemFilter) -> AppResult<Vec<WorkItemRow>> {
    let mut sql = String::from(
        "SELECT x.id, cl.id, cl.name, cl.client_code, cl.pan, yc.id, yc.assessment_year,
                x.acknowledgement_number, x.return_type, x.filing_type, x.filed_on, x.verification_status,
                x.processing_status, x.status, x.verified_flag, x.gap_flags, x.last_seen_at,
                (SELECT count(*) FROM documents d WHERE d.parent_type = 'return' AND d.parent_id = x.id AND d.state = 'stored')
         FROM returns x
         JOIN year_contexts yc ON yc.id = x.year_context_id
         JOIN clients cl ON cl.id = yc.client_id
         WHERE NOT EXISTS (SELECT 1 FROM returns s WHERE s.supersedes_id = x.id)");
    // One thread per chain: a revised or updated return replaces its
    // predecessor in every list (task 11.2); the detail shows the chain and
    // the export still carries every row.
    let mut binds: Vec<rusqlite::types::Value> = Vec::new();
    sql.push_str(&common_filter(f, "x.return_type", "x.acknowledgement_number", &mut binds));
    let mut st = con.prepare(&sql)?;
    let rows = st.query_map(rusqlite::params_from_iter(binds), |r| {
        let pan: String = r.get(4)?;
        let rtype: Option<String> = r.get(8)?;
        let ftype: Option<String> = r.get(9)?;
        let verification: Option<String> = r.get(11)?;
        Ok(WorkItemRow {
            module: "returns".into(), id: r.get(0)?, client_id: r.get(1)?, client_name: r.get(2)?,
            client_code: r.get(3)?, pan_masked: mask::pan(&pan), year_context_id: r.get(5)?,
            assessment_year: r.get(6)?,
            title: format!("{} {}", rtype.clone().unwrap_or_else(|| "Return".into()),
                           ftype.clone().map(|t| format!("({t})")).unwrap_or_default()).trim().to_string(),
            type_label: verification.map(|v| format!("Verification: {v}")).unwrap_or_else(|| "Return filed".into()),
            reference: r.get(7)?, section: None, section_2025: None, section_1961: None,
            due_date: None, manual_due_date: None, suggested_due_date: None, limitation_date: None,
            status: r.get(13)?, source_panel: None, verified_flag: r.get(14)?, gap_flags: gaps(r.get(15)?),
            document_count: r.get(17)?, open_communications: 0, last_seen_at: r.get(16)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

fn list_forms(con: &Connection, f: &WorkItemFilter) -> AppResult<Vec<WorkItemRow>> {
    let mut sql = String::from(
        "SELECT x.id, cl.id, cl.name, cl.client_code, cl.pan, yc.id, yc.assessment_year,
                x.acknowledgement_number, coalesce(x.form_label, t.label), t.label, x.filed_on, x.portal_status,
                x.status, x.verified_flag, x.gap_flags, x.last_seen_at,
                (SELECT count(*) FROM documents d WHERE d.parent_type = 'filed_form' AND d.parent_id = x.id AND d.state = 'stored')
         FROM filed_forms x
         JOIN year_contexts yc ON yc.id = x.year_context_id
         JOIN clients cl ON cl.id = yc.client_id
         JOIN type_registry t ON t.id = x.form_type_id
         WHERE 1 = 1");
    let mut binds: Vec<rusqlite::types::Value> = Vec::new();
    sql.push_str(&common_filter(f, "x.form_label", "x.acknowledgement_number", &mut binds));
    let mut st = con.prepare(&sql)?;
    let rows = st.query_map(rusqlite::params_from_iter(binds), |r| {
        let pan: String = r.get(4)?;
        Ok(WorkItemRow {
            module: "forms".into(), id: r.get(0)?, client_id: r.get(1)?, client_name: r.get(2)?,
            client_code: r.get(3)?, pan_masked: mask::pan(&pan), year_context_id: r.get(5)?,
            assessment_year: r.get(6)?, title: r.get(8)?, type_label: r.get(9)?, reference: r.get(7)?,
            section: None, section_2025: None, section_1961: None,
            due_date: None, manual_due_date: None, suggested_due_date: None, limitation_date: None,
            status: r.get(12)?, source_panel: None, verified_flag: r.get(13)?, gap_flags: gaps(r.get(14)?),
            document_count: r.get(16)?, open_communications: 0, last_seen_at: r.get(15)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// `1,23,456.00` in the Indian grouping, no symbol.
pub fn money(amount: f64) -> String {
    let negative = amount < 0.0;
    let whole = amount.abs().trunc() as i64;
    let paise = ((amount.abs() - amount.abs().trunc()) * 100.0).round() as i64;
    let digits = whole.to_string();
    let grouped = if digits.len() <= 3 { digits } else {
        let (head, tail) = digits.split_at(digits.len() - 3);
        let mut parts: Vec<String> = Vec::new();
        let mut h = head.to_string();
        while h.len() > 2 { let (a, b) = h.split_at(h.len() - 2); parts.push(b.to_string()); h = a.to_string(); }
        if !h.is_empty() { parts.push(h); }
        parts.reverse();
        format!("{},{}", parts.join(","), tail)
    };
    format!("{}{grouped}.{paise:02}", if negative { "-" } else { "" })
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
                    AND coalesce(p.manual_due_date, p.due_date) IS NOT NULL AND coalesce(p.manual_due_date, p.due_date) < ?1),
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

// ------------------------------------------------------------ module details

#[derive(Debug, Clone, Serialize)]
pub struct ItemContext {
    pub client_id: String,
    pub client_name: String,
    pub client_code: Option<String>,
    pub pan_masked: String,
    pub assessment_year: Option<String>,
    pub financial_year: Option<String>,
}

fn context_for(con: &Connection, year_context_id: &str) -> AppResult<ItemContext> {
    Ok(con.query_row(
        "SELECT cl.id, cl.name, cl.client_code, cl.pan, yc.assessment_year, yc.financial_year
         FROM year_contexts yc JOIN clients cl ON cl.id = yc.client_id WHERE yc.id = ?1",
        params![year_context_id],
        |r| Ok(ItemContext {
            client_id: r.get(0)?, client_name: r.get(1)?, client_code: r.get(2)?,
            pan_masked: mask::pan(&r.get::<_, String>(3)?), assessment_year: r.get(4)?, financial_year: r.get(5)?,
        }))?)
}

#[derive(Debug, Clone, Serialize)]
pub struct DemandDetail {
    #[serde(flatten)]
    pub row: crate::repo::model::Demand,
    #[serde(flatten)]
    pub context: ItemContext,
    pub gaps: Vec<String>,
    pub responses: Vec<DemandResponseView>,
    pub payments: Vec<crate::repo::model::Payment>,
    pub documents: Vec<Document>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DemandResponseView {
    #[serde(flatten)]
    pub row: crate::repo::model::DemandResponse,
    pub reason_label: Option<String>,
    pub documents: Vec<Document>,
}

pub fn demand_detail(con: &Connection, id: &str) -> AppResult<Option<DemandDetail>> {
    use crate::repo::modules;
    let Some(d) = modules::get_demand(con, id)? else { return Ok(None); };
    let context = context_for(con, &d.year_context_id)?;
    let mut responses = Vec::new();
    for r in modules::demand_responses_for(con, id)? {
        let reason_label = match &r.reason_code_id { Some(rid) => registry::get(con, rid)?.map(|t| t.label), None => None };
        responses.push(DemandResponseView { documents: documents::for_parent(con, "demand_response", &r.id)?, reason_label, row: r });
    }
    let payments = modules::payments_for_year(con, &d.year_context_id)?.into_iter()
        .filter(|p| responses.iter().any(|r| Some(&r.row.id) == p.demand_response_id.as_ref()) || p.demand_response_id.is_none())
        .collect();
    Ok(Some(DemandDetail {
        gaps: gaps(d.gap_flags.clone()), responses, payments,
        documents: documents::for_parent(con, "demand", id)?, context, row: d,
    }))
}

#[derive(Debug, Clone, Serialize)]
pub struct ReturnDetail {
    #[serde(flatten)]
    pub row: crate::repo::model::Return,
    #[serde(flatten)]
    pub context: ItemContext,
    pub gaps: Vec<String>,
    pub supersedes_ack: Option<String>,
    pub superseded_by_ack: Option<String>,
    /// The whole chain, oldest first: original, revised, updated.
    pub chain: Vec<crate::repo::model::Return>,
    pub documents: Vec<Document>,
}

pub fn return_detail(con: &Connection, id: &str) -> AppResult<Option<ReturnDetail>> {
    use crate::repo::modules;
    let Some(r) = modules::get_return(con, id)? else { return Ok(None); };
    let context = context_for(con, &r.year_context_id)?;
    let supersedes_ack = match &r.supersedes_id { Some(sid) => modules::get_return(con, sid)?.map(|x| x.acknowledgement_number), None => None };
    let superseded_by_ack: Option<String> = con.query_row(
        "SELECT acknowledgement_number FROM returns WHERE supersedes_id = ?1 LIMIT 1", [id], |x| x.get(0)).optional()?;
    // walk to the root, then forward
    let mut root = r.clone();
    while let Some(prev) = root.supersedes_id.clone().and_then(|sid| modules::get_return(con, &sid).ok().flatten()) {
        root = prev;
    }
    let mut chain = vec![root.clone()];
    let mut cur = root;
    while let Some(next) = con.query_row("SELECT * FROM returns WHERE supersedes_id = ?1 LIMIT 1", [&cur.id], modules::return_row).optional()? {
        chain.push(next.clone());
        cur = next;
    }
    Ok(Some(ReturnDetail {
        gaps: gaps(r.gap_flags.clone()), supersedes_ack, superseded_by_ack, chain,
        documents: documents::for_parent(con, "return", id)?, context, row: r,
    }))
}

#[derive(Debug, Clone, Serialize)]
pub struct FiledFormDetail {
    #[serde(flatten)]
    pub row: crate::repo::model::FiledForm,
    #[serde(flatten)]
    pub context: ItemContext,
    pub type_label: String,
    pub type_category: Option<String>,
    pub gaps: Vec<String>,
    pub documents: Vec<Document>,
}

pub fn filed_form_detail(con: &Connection, id: &str) -> AppResult<Option<FiledFormDetail>> {
    use crate::repo::modules;
    let Some(f) = modules::get_filed_form(con, id)? else { return Ok(None); };
    let context = context_for(con, &f.year_context_id)?;
    let t = registry::get(con, &f.form_type_id)?;
    Ok(Some(FiledFormDetail {
        type_label: t.as_ref().map(|t| t.label.clone()).unwrap_or_else(|| "Form".into()),
        type_category: t.and_then(|t| t.category),
        gaps: gaps(f.gap_flags.clone()), documents: documents::for_parent(con, "filed_form", id)?, context, row: f,
    }))
}
