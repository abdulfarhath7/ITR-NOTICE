//! Excel export (docs/11-exports.md). Built in the core, one tab per
//! module; the proceedings sheet is the firm's own 16-column format, in
//! order. Dates are real Excel dates (`dd-mmm-yyyy`), amounts numeric with
//! two decimals, identifiers text so Excel leaves leading zeros alone.
//! Blank means blank: a gap-flagged field is an empty cell, never "N/A".
//! Every status is exported; only the Attention list filters by status.

use crate::dates::parse_portal_date;
use crate::error::{AppError, AppResult};
use crate::ledger;
use crate::repo::{local, runs};
use chrono::Datelike;
use rusqlite::{Connection, OptionalExtension};
use rust_xlsxwriter::{ExcelDateTime, Format, FormatAlign, Workbook, Worksheet};
use serde::{Deserialize, Serialize};

/// Which rows go out (task 8.3).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ExportScope {
    /// The rows the screen is showing: (module, id) pairs.
    View { items: Vec<(String, String)>, label: Option<String> },
    All,
    Client { client_id: String },
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct ExportReport {
    pub path: String,
    pub proceedings: usize,
    pub demands: usize,
    pub returns: usize,
    pub forms: usize,
    pub unverified_fields: usize,
}

/// The 16 columns, in the firm's order (Q01 dropped "Created Mode" from
/// the sheet; `proceedings.created_mode` stays in the database). Do not
/// reorder.
pub const PROCEEDING_COLUMNS: [&str; 16] = [
    "S.No", "Client ID", "Client Name", "PAN", "Self/Other", "AY", "Type", "Assessee Name", "Section",
    "Proceeding Name", "DIN", "Issued On", "Response Due Date", "Manual Due Date", "Response Submitted On",
    "Client File #",
];

/// Appended after the 16 (docs/16 §8): the positions of the 16 never move.
pub const PROCEEDING_EXTRA_COLUMNS: [&str; 2] = ["Owner", "Note"];

/// Column widths follow the longest cell, never wider than this (docs/16 §8).
const MAX_WIDTH: usize = 60;

const DEMAND_COLUMNS: [&str; 15] = [
    "S.No", "Client", "AY", "Demand Reference", "Raised On", "Demand Amount", "Current Outstanding", "Section",
    "Stance", "Disputed Amount", "Filed On", "Challan CIN", "Paid On", "Amount", "Status",
];
const RETURN_COLUMNS: [&str; 10] = [
    "S.No", "Client", "AY", "Acknowledgement Number", "Return Type", "Filing Type", "Filed On",
    "Verification Status", "Processing Status", "Supersedes",
];
const FORM_COLUMNS: [&str; 9] = [
    "S.No", "Client", "AY", "Form Type", "Acknowledgement Number", "Filed On", "Filing Type", "Status", "Filed By",
];

struct Styles {
    title: Format,
    meta: Format,
    header: Format,
    date: Format,
    money: Format,
    text: Format,
    num: Format,
}

impl Styles {
    fn new() -> Self {
        Styles {
            title: Format::new().set_bold(),
            meta: Format::new().set_italic(),
            // Bold on the light surface-2 fill (docs/10 tokens, light mode).
            header: Format::new().set_bold().set_background_color(0xF4F3EF)
                .set_border_bottom(rust_xlsxwriter::FormatBorder::Thin),
            date: Format::new().set_num_format("dd-mmm-yyyy").set_align(FormatAlign::Right),
            money: Format::new().set_num_format("#,##0.00").set_align(FormatAlign::Right),
            text: Format::new().set_num_format("@"),
            num: Format::new().set_align(FormatAlign::Right),
        }
    }
}

/// A cell as the sheet writes it. Blank means blank.
enum Cell {
    Blank,
    Text(String),
    Date(String),          // YYYY-MM-DD
    Money(f64),
    Int(i64),
}

fn text(v: Option<&str>) -> Cell {
    match v.map(str::trim).filter(|s| !s.is_empty()) { Some(s) => Cell::Text(s.to_string()), None => Cell::Blank }
}
fn date(v: Option<&str>) -> Cell {
    match v { Some(d) if parse_portal_date(d).is_some() => Cell::Date(d.to_string()), _ => Cell::Blank }
}
fn money(v: Option<f64>) -> Cell {
    match v { Some(m) => Cell::Money(m), None => Cell::Blank }
}

fn write_cell(ws: &mut Worksheet, styles: &Styles, row: u32, col: u16, cell: &Cell) -> AppResult<()> {
    let r = match cell {
        Cell::Blank => Ok(&mut *ws),
        Cell::Text(s) => ws.write_string_with_format(row, col, s, &styles.text),
        Cell::Date(iso) => {
            let d = parse_portal_date(iso).ok_or_else(|| AppError::state(format!("bad date {iso}")))?;
            let dt = ExcelDateTime::from_ymd(d.year() as u16, d.month() as u8, d.day() as u8)
                .map_err(|e| AppError::state(e.to_string()))?;
            ws.write_datetime_with_format(row, col, dt, &styles.date)
        }
        Cell::Money(m) => ws.write_number_with_format(row, col, *m, &styles.money),
        Cell::Int(n) => ws.write_number_with_format(row, col, *n as f64, &styles.num),
    };
    r.map_err(|e| AppError::state(e.to_string()))?;
    Ok(())
}

/// Rows 1–3 of every sheet (docs/11 "Header block"): a stale export must be
/// self-evident on its face.
fn header_block(ws: &mut Worksheet, styles: &Styles, provenance: &Provenance, scope_label: &str, unverified: usize,
                filters: &str) -> AppResult<()> {
    let line1 = format!("Litigation Command Center export · {scope_label} · generated {}", provenance.generated_ist);
    let line2 = format!("Data as of: collector last run {}, this device cursor {}", provenance.collector_last_run, provenance.cursor_summary);
    let line3 = format!("Unverified fields in this export: {unverified}");
    ws.write_string_with_format(0, 0, &line1, &styles.title).map_err(|e| AppError::state(e.to_string()))?;
    ws.write_string_with_format(1, 0, &line2, &styles.meta).map_err(|e| AppError::state(e.to_string()))?;
    ws.write_string_with_format(2, 0, &line3, &styles.meta).map_err(|e| AppError::state(e.to_string()))?;
    ws.write_string_with_format(3, 0, &format!("Active filters: {filters}"), &styles.meta).map_err(|e| AppError::state(e.to_string()))?;
    Ok(())
}

fn finish_sheet(ws: &mut Worksheet, columns: &[&str], styles: &Styles, rows: &[Vec<Cell>]) -> AppResult<()> {
    let header_row: u32 = 4;
    for (i, name) in columns.iter().enumerate() {
        ws.write_string_with_format(header_row, i as u16, *name, &styles.header).map_err(|e| AppError::state(e.to_string()))?;
    }
    for (r, row) in rows.iter().enumerate() {
        for (c, cell) in row.iter().enumerate() {
            write_cell(ws, styles, header_row + 1 + r as u32, c as u16, cell)?;
        }
    }
    ws.set_freeze_panes(header_row + 1, 0).map_err(|e| AppError::state(e.to_string()))?;
    let last_data = header_row + rows.len() as u32;
    ws.autofilter(header_row, 0, last_data, columns.len() as u16 - 1).map_err(|e| AppError::state(e.to_string()))?;
    // Widths from the longest cell in each column (header included), capped.
    for (c, name) in columns.iter().enumerate() {
        let longest = rows.iter().map(|r| match r.get(c) {
            Some(Cell::Text(t)) => t.chars().count(),
            Some(Cell::Date(_)) => 11,
            Some(Cell::Money(m)) => format!("{m:.2}").len() + 3,
            Some(Cell::Int(n)) => n.to_string().len(),
            _ => 0,
        }).max().unwrap_or(0).max(name.chars().count() + 3);
        ws.set_column_width(c as u16, (longest.min(MAX_WIDTH) + 2) as f64).map_err(|e| AppError::state(e.to_string()))?;
    }
    ws.set_landscape();
    ws.set_print_fit_to_pages(1, 0);
    let last_row = header_row + rows.len() as u32;
    ws.set_print_area(0, 0, last_row.max(header_row), columns.len() as u16 - 1).map_err(|e| AppError::state(e.to_string()))?;
    Ok(())
}

/// (stance, disputed_amount, filed_on, response id) of a demand's latest response.
type LatestResponse = (Option<String>, Option<f64>, Option<String>, String);

struct Provenance {
    generated_ist: String,
    collector_last_run: String,
    cursor_summary: String,
}

fn provenance(con: &Connection) -> AppResult<Provenance> {
    let ist = chrono::Utc::now().with_timezone(&chrono_tz::Asia::Kolkata).format("%d-%b-%Y %H:%M IST").to_string();
    let collector = local::get(con, crate::relay::KEY_COLLECTOR_SEEN)?
        .or(runs::latest(con)?.map(|r| r.run_at))
        .map(|s| ist_of(&s)).unwrap_or_else(|| "never".into());
    let cursor = ledger::full_cursor_map(con)?;
    let device = local::device_id(con)?;
    let mut parts: Vec<String> = cursor.iter().map(|(d, s)| format!("{}{}:{}", if *d == device { "*" } else { "" }, short(d), s)).collect();
    parts.sort();
    Ok(Provenance { generated_ist: ist, collector_last_run: collector,
                    cursor_summary: if parts.is_empty() { "no streams".into() } else { parts.join(" ") } })
}

fn short(device: &str) -> String { device.chars().take(12).collect() }

fn ist_of(iso: &str) -> String {
    chrono::DateTime::parse_from_rfc3339(iso).map(|t| t.with_timezone(&chrono_tz::Asia::Kolkata).format("%d-%b-%Y %H:%M IST").to_string())
        .unwrap_or_else(|_| iso.to_string())
}

fn gap_count(json: Option<&str>) -> usize {
    json.and_then(|s| serde_json::from_str::<Vec<String>>(s).ok()).map(|v| v.len()).unwrap_or(0)
}

fn scope_where(scope: &ExportScope, module: &str, alias_client: &str) -> (String, Vec<String>) {
    match scope {
        ExportScope::All => (String::new(), Vec::new()),
        ExportScope::Client { client_id } => (format!(" AND {alias_client}.id = ?1"), vec![client_id.clone()]),
        ExportScope::View { items, .. } => {
            let ids: Vec<String> = items.iter().filter(|(m, _)| m == module).map(|(_, id)| id.to_owned()).collect();
            if ids.is_empty() { return (" AND 0".into(), Vec::new()); }
            let marks: Vec<String> = (1..=ids.len()).map(|i| format!("?{i}")).collect();
            (format!(" AND x.id IN ({})", marks.join(",")), ids)
        }
    }
}

/// The provenance block's filter line: a view's label names its filters.
fn scope_filters(scope: &ExportScope) -> String {
    match scope {
        ExportScope::View { label: Some(l), .. } => l.clone(),
        ExportScope::View { label: None, items } => format!("current view ({} rows)", items.len()),
        ExportScope::Client { .. } => "one client".into(),
        ExportScope::All => "none".into(),
    }
}

fn scope_label(scope: &ExportScope, con: &Connection) -> String {
    match scope {
        ExportScope::All => "all clients".into(),
        ExportScope::Client { client_id } => crate::repo::clients::get(con, client_id).ok().flatten()
            .map(|c| format!("client {}", c.name)).unwrap_or_else(|| "one client".into()),
        ExportScope::View { label, items } => label.clone().unwrap_or_else(|| format!("current view ({} rows)", items.len())),
    }
}

pub fn export_workbook(con: &Connection, scope: &ExportScope, path: &str) -> AppResult<ExportReport> {
    let styles = Styles::new();
    let prov = provenance(con)?;
    let label = scope_label(scope, con);
    let filters = scope_filters(scope);
    let mut wb = Workbook::new();
    let mut report = ExportReport { path: path.into(), ..Default::default() };

    // ---- Sheet 1: Proceedings, the 16 columns
    let (extra, binds) = scope_where(scope, "proceedings", "cl");
    let sql = format!(
        "SELECT cl.client_code, cl.name, cl.pan, x.source_panel, yc.assessment_year, t.label, x.assessee_name,
                x.section_2025, x.section_1961, x.display_name, x.din_reference, x.initiated_on, x.due_date,
                x.manual_due_date, cl.client_file_no, x.gap_flags, x.id, m.assignee, m.note
         FROM proceedings x
         JOIN year_contexts yc ON yc.id = x.year_context_id
         JOIN clients cl ON cl.id = yc.client_id
         JOIN type_registry t ON t.id = x.proceeding_type_id
         LEFT JOIN work_item_meta m ON m.id = 'proceedings:' || x.id
         WHERE 1 = 1 {extra}
         ORDER BY cl.name COLLATE NOCASE, yc.assessment_year, x.initiated_on");
    let mut st = con.prepare(&sql)?;
    let mut rows: Vec<Vec<Cell>> = Vec::new();
    let mut unverified = 0usize;
    let q = st.query_map(rusqlite::params_from_iter(binds.iter()), |r| Ok((
        r.get::<_, Option<String>>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?,
        r.get::<_, Option<String>>(4)?, r.get::<_, String>(5)?, r.get::<_, Option<String>>(6)?,
        r.get::<_, Option<String>>(7)?, r.get::<_, Option<String>>(8)?, r.get::<_, Option<String>>(9)?,
        r.get::<_, Option<String>>(10)?, r.get::<_, Option<String>>(11)?, r.get::<_, Option<String>>(12)?,
        r.get::<_, Option<String>>(13)?, r.get::<_, Option<String>>(14)?,
        r.get::<_, Option<String>>(15)?, r.get::<_, String>(16)?,
        (r.get::<_, Option<String>>(17)?, r.get::<_, Option<String>>(18)?))))?;
    for (i, row) in q.enumerate() {
        let (code, name, pan, panel, ay, type_label, assessee, s2025, s1961, display, din, initiated, due, manual, file_no, gaps, id, (owner, note)) = row?;
        // DIN and Issued On fall back to the communications when the
        // proceeding card did not carry them (docs/11 columns 11 and 12).
        let comm: Option<(Option<String>, Option<String>)> = con.prepare_cached(
            "SELECT din, issued_on FROM communications WHERE proceeding_id = ?1 ORDER BY issued_on IS NULL, issued_on LIMIT 1")?
            .query_row([&id], |r| Ok((r.get(0)?, r.get(1)?))).optional()?;
        let submitted: Option<String> = con.prepare_cached(
            "SELECT filed_on FROM responses WHERE proceeding_id = ?1 AND filed_on IS NOT NULL ORDER BY filed_on DESC LIMIT 1")?
            .query_row([&id], |r| r.get(0)).optional()?;
        let section = match (s2025.as_deref(), s1961.as_deref()) {
            (Some(n), Some(o)) => Some(format!("{n} ({o})")), (Some(n), None) => Some(n.to_string()),
            (None, Some(o)) => Some(o.to_string()), (None, None) => None,
        };
        let self_other = if panel.starts_with("self") { "Self" } else if panel.starts_with("auth_rep") { "AR" } else { "Other" };
        unverified += gap_count(gaps.as_deref());
        rows.push(vec![
            Cell::Int(i as i64 + 1),
            text(code.as_deref()), Cell::Text(name), Cell::Text(pan), Cell::Text(self_other.into()),
            text(ay.as_deref()), Cell::Text(type_label), text(assessee.as_deref()), text(section.as_deref()),
            text(display.as_deref()),
            text(din.as_deref().or(comm.as_ref().and_then(|c| c.0.as_deref()))),
            date(initiated.as_deref().or(comm.as_ref().and_then(|c| c.1.as_deref()))),
            date(due.as_deref()), date(manual.as_deref()), date(submitted.as_deref()),
            text(file_no.as_deref()),
            text(owner.as_deref()), text(note.as_deref()),
        ]);
    }
    report.proceedings = rows.len();
    let ws = wb.add_worksheet();
    ws.set_name("Proceedings").map_err(|e| AppError::state(e.to_string()))?;
    let proceedings_unverified = unverified;
    header_block(ws, &styles, &prov, &label, proceedings_unverified, &filters)?;
    let columns: Vec<&str> = PROCEEDING_COLUMNS.iter().chain(PROCEEDING_EXTRA_COLUMNS.iter()).copied().collect();
    finish_sheet(ws, &columns, &styles, &rows)?;

    // ---- Demands
    let (extra, binds) = scope_where(scope, "demands", "cl");
    let sql = format!(
        "SELECT cl.name, yc.assessment_year, x.demand_reference_number, x.raised_on, x.demand_amount,
                x.current_outstanding, x.section_or_demand_type, x.status, x.gap_flags, x.id, yc.id
         FROM demands x JOIN year_contexts yc ON yc.id = x.year_context_id JOIN clients cl ON cl.id = yc.client_id
         WHERE 1 = 1 {extra} ORDER BY cl.name COLLATE NOCASE, yc.assessment_year");
    let mut st = con.prepare(&sql)?;
    let mut rows: Vec<Vec<Cell>> = Vec::new();
    let mut unverified = 0usize;
    let q = st.query_map(rusqlite::params_from_iter(binds.iter()), |r| Ok((
        r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?, r.get::<_, Option<String>>(2)?, r.get::<_, Option<String>>(3)?,
        r.get::<_, Option<f64>>(4)?, r.get::<_, Option<f64>>(5)?, r.get::<_, Option<String>>(6)?, r.get::<_, String>(7)?,
        r.get::<_, Option<String>>(8)?, r.get::<_, String>(9)?, r.get::<_, String>(10)?)))?;
    for (i, row) in q.enumerate() {
        let (name, ay, reference, raised, amount, outstanding, section, status, gaps, id, yc_id) = row?;
        let resp: Option<LatestResponse> = con.prepare_cached(
            "SELECT stance, disputed_amount, filed_on, id FROM demand_responses WHERE demand_id = ?1 ORDER BY filed_on DESC LIMIT 1")?
            .query_row([&id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).optional()?;
        let pay: Option<(Option<String>, Option<String>, Option<f64>)> = match &resp {
            Some((_, _, _, rid)) => con.prepare_cached(
                "SELECT cin, paid_on, amount FROM payments WHERE demand_response_id = ?1 ORDER BY paid_on DESC LIMIT 1")?
                .query_row([rid], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).optional()?,
            None => con.prepare_cached(
                "SELECT cin, paid_on, amount FROM payments WHERE year_context_id = ?1 AND purpose = 'demand_settlement' ORDER BY paid_on DESC LIMIT 1")?
                .query_row([&yc_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).optional()?,
        };
        unverified += gap_count(gaps.as_deref());
        rows.push(vec![
            Cell::Int(i as i64 + 1), Cell::Text(name), text(ay.as_deref()), text(reference.as_deref()), date(raised.as_deref()),
            money(amount), money(outstanding), text(section.as_deref()),
            text(resp.as_ref().and_then(|r| r.0.as_deref()).map(|st| st.replace('_', " ")).as_deref()), money(resp.as_ref().and_then(|r| r.1)),
            date(resp.as_ref().and_then(|r| r.2.as_deref())),
            text(pay.as_ref().and_then(|p| p.0.as_deref())), date(pay.as_ref().and_then(|p| p.1.as_deref())), money(pay.as_ref().and_then(|p| p.2)),
            Cell::Text(status.replace('_', " ")),
        ]);
    }
    report.demands = rows.len();
    let ws = wb.add_worksheet();
    ws.set_name("Demands").map_err(|e| AppError::state(e.to_string()))?;
    header_block(ws, &styles, &prov, &label, unverified, &filters)?;
    finish_sheet(ws, &DEMAND_COLUMNS, &styles, &rows)?;
    let demands_unverified = unverified;

    // ---- Returns
    let (extra, binds) = scope_where(scope, "returns", "cl");
    let sql = format!(
        "SELECT cl.name, yc.assessment_year, x.acknowledgement_number, x.return_type, x.filing_type, x.filed_on,
                x.verification_status, x.processing_status, x.gap_flags,
                (SELECT acknowledgement_number FROM returns s WHERE s.id = x.supersedes_id)
         FROM returns x JOIN year_contexts yc ON yc.id = x.year_context_id JOIN clients cl ON cl.id = yc.client_id
         WHERE 1 = 1 {extra} ORDER BY cl.name COLLATE NOCASE, yc.assessment_year, x.filed_on");
    let mut st = con.prepare(&sql)?;
    let mut rows: Vec<Vec<Cell>> = Vec::new();
    let mut unverified = 0usize;
    let q = st.query_map(rusqlite::params_from_iter(binds.iter()), |r| Ok((
        r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?, r.get::<_, String>(2)?, r.get::<_, Option<String>>(3)?,
        r.get::<_, Option<String>>(4)?, r.get::<_, Option<String>>(5)?, r.get::<_, Option<String>>(6)?,
        r.get::<_, Option<String>>(7)?, r.get::<_, Option<String>>(8)?, r.get::<_, Option<String>>(9)?)))?;
    for (i, row) in q.enumerate() {
        let (name, ay, ack, rtype, ftype, filed, verif, proc_status, gaps, supersedes) = row?;
        unverified += gap_count(gaps.as_deref());
        rows.push(vec![
            Cell::Int(i as i64 + 1), Cell::Text(name), text(ay.as_deref()), Cell::Text(ack), text(rtype.as_deref()),
            text(ftype.as_deref()), date(filed.as_deref()), text(verif.as_deref()), text(proc_status.as_deref()),
            text(supersedes.as_deref()),
        ]);
    }
    report.returns = rows.len();
    let ws = wb.add_worksheet();
    ws.set_name("Returns").map_err(|e| AppError::state(e.to_string()))?;
    header_block(ws, &styles, &prov, &label, unverified, &filters)?;
    finish_sheet(ws, &RETURN_COLUMNS, &styles, &rows)?;
    let returns_unverified = unverified;

    // ---- Forms
    let (extra, binds) = scope_where(scope, "forms", "cl");
    let sql = format!(
        "SELECT cl.name, yc.assessment_year, coalesce(x.form_label, t.label), x.acknowledgement_number, x.filed_on,
                x.filing_type, coalesce(x.portal_status, x.status), x.filed_by, x.gap_flags
         FROM filed_forms x JOIN year_contexts yc ON yc.id = x.year_context_id JOIN clients cl ON cl.id = yc.client_id
         JOIN type_registry t ON t.id = x.form_type_id
         WHERE 1 = 1 {extra} ORDER BY cl.name COLLATE NOCASE, yc.assessment_year, x.filed_on");
    let mut st = con.prepare(&sql)?;
    let mut rows: Vec<Vec<Cell>> = Vec::new();
    let mut unverified = 0usize;
    let q = st.query_map(rusqlite::params_from_iter(binds.iter()), |r| Ok((
        r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?,
        r.get::<_, Option<String>>(4)?, r.get::<_, Option<String>>(5)?, r.get::<_, String>(6)?,
        r.get::<_, Option<String>>(7)?, r.get::<_, Option<String>>(8)?)))?;
    for (i, row) in q.enumerate() {
        let (name, ay, form, ack, filed, ftype, status, filed_by, gaps) = row?;
        unverified += gap_count(gaps.as_deref());
        rows.push(vec![
            Cell::Int(i as i64 + 1), Cell::Text(name), text(ay.as_deref()), Cell::Text(form), Cell::Text(ack),
            date(filed.as_deref()), text(ftype.as_deref()), Cell::Text(status), text(filed_by.as_deref()),
        ]);
    }
    report.forms = rows.len();
    let ws = wb.add_worksheet();
    ws.set_name("Forms").map_err(|e| AppError::state(e.to_string()))?;
    header_block(ws, &styles, &prov, &label, unverified, &filters)?;
    finish_sheet(ws, &FORM_COLUMNS, &styles, &rows)?;

    report.unverified_fields = proceedings_unverified + demands_unverified + returns_unverified + unverified;
    wb.save(path).map_err(|e| AppError::Io { message: format!("could not write the workbook: {e}") })?;
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::intake::{self, NoticeCard, ProceedingCard};
    use crate::repo::local;

    /// docs/11 (Q01): the proceedings sheet has exactly the 16 columns in
    /// order, a gap is an empty cell, and the three header rows carry
    /// provenance.
    #[test]
    fn sixteen_columns_in_order_and_blank_means_blank() {
        assert_eq!(PROCEEDING_COLUMNS.len(), 16);
        assert_eq!(PROCEEDING_COLUMNS[0], "S.No");
        assert_eq!(PROCEEDING_COLUMNS[1], "Client ID");
        assert_eq!(PROCEEDING_COLUMNS[12], "Response Due Date");
        assert_eq!(PROCEEDING_COLUMNS[13], "Manual Due Date");
        assert_eq!(PROCEEDING_COLUMNS[15], "Client File #");
        assert!(!PROCEEDING_COLUMNS.contains(&"Created Mode"));

        let mut con = Connection::open_in_memory().unwrap();
        crate::migrate::run(&mut con).unwrap();
        local::set(&con, local::DEVICE_ID, "dev_x").unwrap();
        let card = ProceedingCard { tab: "self".into(), sub_tab: "action".into(), proceeding_name: Some("Penalty Proceeding".into()),
            pan: Some("ABCDE1234F".into()), assessee_name: Some("Example".into()), assessment_year: Some("2024-25".into()),
            status: Some("Open".into()), ..Default::default() };
        let notice = NoticeCard { ref_id: "100000000001".into(), description: Some("[ITBA]Show Cause Notice u/s 270A".into()),
            issued_on: Some("17-Aug-2026".into()), due_date: None, responded: Some(0), ..Default::default() };
        intake::absorb(&con, None, &card, Some(&notice)).unwrap();

        let dir = std::env::temp_dir().join(format!("draftax-xlsx-{}", crate::ids::new_id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("export.xlsx");
        let report = export_workbook(&con, &ExportScope::All, path.to_str().unwrap()).unwrap();
        assert_eq!(report.proceedings, 1);
        assert!(report.unverified_fields > 0, "the missing due date is a gap");
        let bytes = std::fs::read(&path).unwrap();
        assert!(bytes.starts_with(b"PK"), "a real xlsx (zip) file");
        // The sheet XML must carry the header block words and the column
        // names; a gap-flagged due date writes no cell at all.
        let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
        let mut shared = String::new();
        std::io::Read::read_to_string(&mut zip.by_name("xl/sharedStrings.xml").unwrap(), &mut shared).unwrap();
        assert!(shared.contains("Litigation Command Center export"));
        assert!(shared.contains("Unverified fields in this export"));
        assert!(shared.contains("Client File #"));
        assert!(!shared.contains("N/A"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}

/// The Updates screen's export (docs/16 §4, task 17.4): one sheet per
/// non-empty group, in the screen's order.
pub fn export_updates(con: &Connection, report: &crate::repo::updates::UpdatesReport, path: &str) -> AppResult<usize> {
    const GROUPS: [(&str, &str); 6] = [
        ("new_notice", "New notices"), ("due_changed", "Due date changed"), ("response_filed", "Response filed"),
        ("closed", "Proceeding closed"), ("demand_changed", "Demand changed"), ("sync_failed", "Sync failed"),
    ];
    const COLUMNS: [&str; 11] = ["S.No", "When", "Client", "PAN", "AY", "Section", "Due Date", "Old", "New", "Reference / Filed On", "Reason"];
    let styles = Styles::new();
    let prov = provenance(con)?;
    let since = report.since.as_deref().map(ist_of).unwrap_or_else(|| "nothing (no sync yet)".into());
    let mut wb = Workbook::new();
    let mut written = 0;
    for (key, name) in GROUPS {
        let entries: Vec<_> = report.entries.iter().filter(|e| e.group == key).collect();
        if entries.is_empty() { continue; }
        let ws = wb.add_worksheet();
        ws.set_name(name).map_err(|e| AppError::state(e.to_string()))?;
        header_block(ws, &styles, &prov, &format!("updates since {since} · {name}"), 0, "none")?;
        let rows: Vec<Vec<Cell>> = entries.iter().enumerate().map(|(i, e)| vec![
            Cell::Int(i as i64 + 1), text(Some(&ist_of(&e.at))), text(e.client_name.as_deref()), text(e.pan_masked.as_deref()),
            text(e.assessment_year.as_deref()), text(e.section.as_deref()), date(e.due_date.as_deref()),
            text(e.old_value.as_deref()), text(e.new_value.as_deref()),
            text(e.reference.as_deref().or(e.filed_on.as_deref())), text(e.reason.as_deref()),
        ]).collect();
        written += rows.len();
        finish_sheet(ws, &COLUMNS, &styles, &rows)?;
    }
    if written == 0 {
        let ws = wb.add_worksheet();
        ws.set_name("Updates").map_err(|e| AppError::state(e.to_string()))?;
        header_block(ws, &styles, &prov, &format!("updates since {since}"), 0, "none")?;
        finish_sheet(ws, &COLUMNS, &styles, &[])?;
    }
    wb.save(path).map_err(|e| AppError::Io { message: e.to_string() })?;
    Ok(written)
}
