//! Excel export (docs/11-exports.md, docs/18 §4). Built in the core, one
//! tab per module; the proceedings sheet is the firm's own 16 columns in
//! order, then Viewed by AO and Limitation Date (Build 4), then Owner and
//! Note. Dates are real Excel dates (`dd-mmm-yyyy`), amounts numeric with
//! two decimals, identifiers text so Excel leaves leading zeros alone.
//! Blank means blank: a gap-flagged field is an empty cell, never "N/A".
//! Every status is exported; only the Attention list filters by status.
//!
//! The proceedings columns are one declarative table (`PROCEEDING_SHEET`):
//! header, cell function. Adding, splitting or dropping a column is one
//! row there (Q51), and the dialog's column picker selects from it.
//!
//! Nothing here reads a credential: this module never imports
//! `keychain.rs` and never touches a secret (docs/07).

use crate::dates::parse_portal_date;
use crate::error::{AppError, AppResult};
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

/// What the dialog chose beyond the scope (docs/18 §4.1).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ExportOptions {
    /// Proceedings-sheet headers to write, in sheet order; None = all.
    #[serde(default)]
    pub columns: Option<Vec<String>>,
}

/// The dialog's preview (docs/18 §4.1): the header lines as the sheet will
/// carry them, the columns, and the first rows rendered as text.
#[derive(Debug, Clone, Serialize)]
pub struct ExportPreview {
    pub header: Vec<String>,
    pub columns: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub total_rows: usize,
    pub unverified: usize,
    pub file_name: String,
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
/// reorder. `PROCEEDING_SHEET` starts with exactly these; the test pins it.
#[cfg_attr(not(test), allow(dead_code))]
pub const PROCEEDING_COLUMNS: [&str; 16] = [
    "S.No", "Client ID", "Client Name", "PAN", "Self/Other", "AY", "Type", "Assessee Name", "Section",
    "Proceeding Name", "DIN", "Issued On", "Response Due Date", "Manual Due Date", "Response Submitted On",
    "Client File #",
];

/// One proceedings row as the queries return it; the column table turns
/// it into cells.
pub struct ProcRow {
    code: Option<String>, name: String, pan: String, self_other: &'static str, ay: Option<String>,
    type_label: String, assessee: Option<String>, section: Option<String>, display: Option<String>,
    din: Option<String>, issued: Option<String>, due: Option<String>, manual: Option<String>,
    submitted: Option<String>, file_no: Option<String>,
    /// `Yes (dd-mm-yyyy)` / `No` / blank (docs/18 §4.4, D-064).
    ao_viewed: Option<String>,
    limitation: Option<String>,
    owner: Option<String>, note: Option<String>,
    status: String,
}

/// The Q51 seam: one row per column, in sheet order.
pub struct ProcColumn {
    pub header: &'static str,
    cell: fn(&ProcRow, usize) -> Cell,
}

pub const PROCEEDING_SHEET: &[ProcColumn] = &[
    ProcColumn { header: "S.No", cell: |_, i| Cell::Int(i as i64 + 1) },
    ProcColumn { header: "Client ID", cell: |r, _| text(r.code.as_deref()) },
    ProcColumn { header: "Client Name", cell: |r, _| Cell::Text(r.name.clone()) },
    ProcColumn { header: "PAN", cell: |r, _| Cell::Text(r.pan.clone()) },
    ProcColumn { header: "Self/Other", cell: |r, _| Cell::Text(r.self_other.into()) },
    ProcColumn { header: "AY", cell: |r, _| text(r.ay.as_deref()) },
    ProcColumn { header: "Type", cell: |r, _| Cell::Text(r.type_label.clone()) },
    ProcColumn { header: "Assessee Name", cell: |r, _| text(r.assessee.as_deref()) },
    ProcColumn { header: "Section", cell: |r, _| text(r.section.as_deref()) },
    ProcColumn { header: "Proceeding Name", cell: |r, _| text(r.display.as_deref()) },
    ProcColumn { header: "DIN", cell: |r, _| text(r.din.as_deref()) },
    ProcColumn { header: "Issued On", cell: |r, _| date(r.issued.as_deref()) },
    ProcColumn { header: "Response Due Date", cell: |r, _| date(r.due.as_deref()) },
    ProcColumn { header: "Manual Due Date", cell: |r, _| date(r.manual.as_deref()) },
    ProcColumn { header: "Response Submitted On", cell: |r, _| date(r.submitted.as_deref()) },
    ProcColumn { header: "Client File #", cell: |r, _| text(r.file_no.as_deref()) },
    ProcColumn { header: "Viewed by AO", cell: |r, _| text(r.ao_viewed.as_deref()) },
    ProcColumn { header: "Limitation Date", cell: |r, _| date(r.limitation.as_deref()) },
    ProcColumn { header: "Owner", cell: |r, _| text(r.owner.as_deref()) },
    ProcColumn { header: "Note", cell: |r, _| text(r.note.as_deref()) },
];

/// The columns the picker chose, in sheet order; unknown names are ignored.
fn chosen_columns(options: &ExportOptions) -> Vec<&'static ProcColumn> {
    match &options.columns {
        None => PROCEEDING_SHEET.iter().collect(),
        Some(want) => PROCEEDING_SHEET.iter().filter(|c| want.iter().any(|w| w == c.header)).collect(),
    }
}

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

/// What row 3 says about one sheet (docs/18 §4.2).
struct SheetMeta {
    title: &'static str,
    module: &'static str,
    /// Distinct client names in the sheet's rows (View), or the scope's.
    client_scope: String,
    /// Distinct statuses in the sheet's rows (View), else "every status".
    status: String,
}

/// Rows 1–4 of every sheet (docs/18 §4.2): a stale export must be
/// self-evident on its face. Row 5 stays blank; the column headers sit on
/// row 6.
fn header_lines(provenance: &Provenance, filter_line: &str, meta: &SheetMeta, rows: usize, unverified: usize) -> [String; 4] {
    let unv = if unverified > 0 { format!(" · Unverified: {unverified}") } else { String::new() };
    [
        format!("Litigation Command Center — {}", meta.title),
        format!("Filter: {filter_line}"),
        format!("Client: {} · Module: {} · Status: {}", meta.client_scope, meta.module, meta.status),
        format!("Exported: {} · Rows: {rows} · Last sweep: {}{unv}", provenance.generated_ist, provenance.collector_last_run),
    ]
}

fn header_block(ws: &mut Worksheet, styles: &Styles, lines: &[String; 4]) -> AppResult<()> {
    ws.write_string_with_format(0, 0, &lines[0], &styles.title).map_err(|e| AppError::state(e.to_string()))?;
    for (i, line) in lines.iter().enumerate().skip(1) {
        ws.write_string_with_format(i as u32, 0, line, &styles.meta).map_err(|e| AppError::state(e.to_string()))?;
    }
    Ok(())
}

/// Row 3's client and status for a sheet, from what the sheet holds.
fn sheet_meta(scope: &ExportScope, con: &Connection, title: &'static str, module: &'static str,
              clients: &[String], statuses: &[String]) -> SheetMeta {
    let client_scope = match scope {
        ExportScope::All => "all clients".into(),
        ExportScope::Client { client_id } => crate::repo::clients::get(con, client_id).ok().flatten()
            .map(|c| c.name).unwrap_or_else(|| "one client".into()),
        ExportScope::View { .. } => {
            let mut names: Vec<&String> = clients.iter().collect();
            names.sort(); names.dedup();
            match names.len() { 0 => "none".into(), 1 => names[0].clone(), n => format!("{n} clients") }
        }
    };
    let status = match scope {
        ExportScope::View { .. } => {
            let mut st: Vec<String> = statuses.iter().map(|s| s.replace('_', " ")).collect();
            st.sort(); st.dedup();
            if st.is_empty() { "none".into() } else { st.join(", ") }
        }
        _ => "every status".into(),
    };
    SheetMeta { title, module, client_scope, status }
}

fn finish_sheet(ws: &mut Worksheet, columns: &[&str], styles: &Styles, rows: &[Vec<Cell>]) -> AppResult<()> {
    let header_row: u32 = 5;
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
}

fn provenance(con: &Connection) -> AppResult<Provenance> {
    let ist = chrono::Utc::now().with_timezone(&chrono_tz::Asia::Kolkata).format("%d %b %Y %H:%M IST").to_string();
    let collector = local::get(con, crate::relay::KEY_COLLECTOR_SEEN)?
        .or(runs::latest(con)?.map(|r| r.run_at))
        .map(|s| ist_of(&s)).unwrap_or_else(|| "never".into());
    Ok(Provenance { generated_ist: ist, collector_last_run: collector })
}

fn ist_of(iso: &str) -> String {
    chrono::DateTime::parse_from_rfc3339(iso).map(|t| t.with_timezone(&chrono_tz::Asia::Kolkata).format("%d %b %Y %H:%M").to_string())
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

/// Row 2's filter line (docs/18 §4.2). A view's `label` is the line the
/// screen built from its chips and passes through unchanged; the two
/// fixed scopes have fixed strings.
pub fn scope_label(scope: &ExportScope, con: &Connection) -> String {
    match scope {
        ExportScope::All => "All proceedings, every status".into(),
        ExportScope::Client { client_id } => crate::repo::clients::get(con, client_id).ok().flatten()
            .map(|c| format!("Client {}, every status", c.name)).unwrap_or_else(|| "One client, every status".into()),
        ExportScope::View { label: Some(l), .. } => l.clone(),
        ExportScope::View { label: None, .. } => "All open items".into(),
    }
}

/// `LCC_<slug>_<yyyy-mm-dd>.xlsx` (docs/18 §4.3). `window` is the screen's
/// active window chip as `issued-15d` / `due-30d`, when any.
pub fn suggested_file_name(scope: &ExportScope, window: Option<&str>, con: &Connection) -> String {
    let slug = match scope {
        ExportScope::All => "all".to_string(),
        ExportScope::Client { client_id } => crate::repo::clients::get(con, client_id).ok().flatten()
            .map(|c| format!("client-{}", c.client_code.filter(|x| !x.trim().is_empty()).unwrap_or(c.pan)))
            .unwrap_or_else(|| "client".into()),
        ExportScope::View { .. } => window.filter(|w| !w.is_empty()).unwrap_or("view").to_string(),
    };
    let safe: String = slug.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '-' }).collect();
    let day = chrono::Utc::now().with_timezone(&chrono_tz::Asia::Kolkata).format("%Y-%m-%d");
    format!("LCC_{safe}_{day}.xlsx")
}

/// Every proceedings row of the scope, plus its unverified-field count.
fn collect_proceedings(con: &Connection, scope: &ExportScope) -> AppResult<(Vec<ProcRow>, usize)> {
    let (extra, binds) = scope_where(scope, "proceedings", "cl");
    let sql = format!(
        "SELECT cl.client_code, cl.name, cl.pan, x.source_panel, yc.assessment_year, t.label, x.assessee_name,
                x.section_2025, x.section_1961, x.display_name, x.din_reference, x.initiated_on, x.due_date,
                x.manual_due_date, cl.client_file_no, x.gap_flags, x.id, m.assignee, m.note,
                x.limitation_date, t.is_assessment, x.status
         FROM proceedings x
         JOIN year_contexts yc ON yc.id = x.year_context_id
         JOIN clients cl ON cl.id = yc.client_id
         JOIN type_registry t ON t.id = x.proceeding_type_id
         LEFT JOIN work_item_meta m ON m.id = 'proceedings:' || x.id
         WHERE 1 = 1 {extra}
         ORDER BY cl.name COLLATE NOCASE, yc.assessment_year, x.initiated_on");
    let mut st = con.prepare(&sql)?;
    let mut rows: Vec<ProcRow> = Vec::new();
    let mut unverified = 0usize;
    let q = st.query_map(rusqlite::params_from_iter(binds.iter()), |r| Ok((
        r.get::<_, Option<String>>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?,
        r.get::<_, Option<String>>(4)?, r.get::<_, String>(5)?, r.get::<_, Option<String>>(6)?,
        r.get::<_, Option<String>>(7)?, r.get::<_, Option<String>>(8)?, r.get::<_, Option<String>>(9)?,
        r.get::<_, Option<String>>(10)?, r.get::<_, Option<String>>(11)?, r.get::<_, Option<String>>(12)?,
        r.get::<_, Option<String>>(13)?, r.get::<_, Option<String>>(14)?,
        r.get::<_, Option<String>>(15)?, r.get::<_, String>(16)?,
        (r.get::<_, Option<String>>(17)?, r.get::<_, Option<String>>(18)?, r.get::<_, Option<String>>(19)?,
         r.get::<_, i64>(20)?, r.get::<_, String>(21)?))))?;
    for row in q {
        let (code, name, pan, panel, ay, type_label, assessee, s2025, s1961, display, din, initiated, due, manual, file_no, gaps, id,
             (owner, note, limitation, is_assessment, status)) = row?;
        // DIN and Issued On fall back to the communications when the
        // proceeding card did not carry them (docs/11 columns 11 and 12).
        let comm: Option<(Option<String>, Option<String>)> = con.prepare_cached(
            "SELECT din, issued_on FROM communications WHERE proceeding_id = ?1 ORDER BY issued_on IS NULL, issued_on LIMIT 1")?
            .query_row([&id], |r| Ok((r.get(0)?, r.get(1)?))).optional()?;
        let submitted: Option<String> = con.prepare_cached(
            "SELECT filed_on FROM responses WHERE proceeding_id = ?1 AND filed_on IS NOT NULL ORDER BY filed_on DESC LIMIT 1")?
            .query_row([&id], |r| r.get(0)).optional()?;
        // Column 17 (docs/18 §4.4, D-064): the latest inbound notice's AO
        // date; "No" only once a reply to it is on record; blank otherwise
        // and always blank off assessment proceedings.
        let ao_viewed = if is_assessment == 1 {
            let latest: Option<(String, Option<String>)> = con.prepare_cached(
                "SELECT id, ao_viewed_on FROM communications WHERE proceeding_id = ?1 AND direction = 'inbound'
                  ORDER BY issued_on DESC, created_at DESC LIMIT 1")?
                .query_row([&id], |r| Ok((r.get(0)?, r.get(1)?))).optional()?;
            match latest {
                Some((_, Some(seen))) => Some(match parse_portal_date(&seen) {
                    Some(d) => format!("Yes ({})", d.format("%d-%m-%Y")), None => format!("Yes ({seen})") }),
                Some((cid, None)) => {
                    let replied: i64 = con.prepare_cached("SELECT count(*) FROM responses WHERE in_reply_to = ?1")?
                        .query_row([&cid], |r| r.get(0))?;
                    if replied > 0 { Some("No".into()) } else { None }
                }
                None => None,
            }
        } else { None };
        let section = match (s2025.as_deref(), s1961.as_deref()) {
            (Some(n), Some(o)) => Some(format!("{n} ({o})")), (Some(n), None) => Some(n.to_string()),
            (None, Some(o)) => Some(o.to_string()), (None, None) => None,
        };
        let self_other = if panel.starts_with("self") { "Self" } else if panel.starts_with("auth_rep") { "AR" } else { "Other" };
        unverified += gap_count(gaps.as_deref());
        rows.push(ProcRow {
            code, name, pan, self_other, ay, type_label, assessee, section, display,
            din: din.or(comm.as_ref().and_then(|c| c.0.clone())),
            issued: initiated.or(comm.as_ref().and_then(|c| c.1.clone())),
            due, manual, submitted, file_no, ao_viewed,
            limitation: if is_assessment == 1 { limitation } else { None },
            owner, note, status,
        });
    }
    Ok((rows, unverified))
}

fn render_cell(cell: &Cell) -> String {
    match cell {
        Cell::Blank => String::new(),
        Cell::Text(t) => t.clone(),
        Cell::Date(iso) => parse_portal_date(iso).map(|d| d.format("%d-%b-%Y").to_string()).unwrap_or_else(|| iso.clone()),
        Cell::Money(m) => format!("{m:.2}"),
        Cell::Int(n) => n.to_string(),
    }
}

/// The dialog's preview: the header block as it will be written, the
/// chosen columns, and the first three rows as text (docs/18 §4.1).
pub fn preview_proceedings(con: &Connection, scope: &ExportScope, options: &ExportOptions, window: Option<&str>) -> AppResult<ExportPreview> {
    let prov = provenance(con)?;
    let (rows, unverified) = collect_proceedings(con, scope)?;
    let clients: Vec<String> = rows.iter().map(|r| r.name.clone()).collect();
    let statuses: Vec<String> = rows.iter().map(|r| r.status.clone()).collect();
    let meta = sheet_meta(scope, con, "Proceedings", "Proceedings", &clients, &statuses);
    let header = header_lines(&prov, &scope_label(scope, con), &meta, rows.len(), unverified);
    let cols = chosen_columns(options);
    let preview_rows: Vec<Vec<String>> = rows.iter().take(3).enumerate()
        .map(|(i, r)| cols.iter().map(|c| render_cell(&(c.cell)(r, i))).collect()).collect();
    Ok(ExportPreview {
        header: header.to_vec(), columns: cols.iter().map(|c| c.header.to_string()).collect(),
        rows: preview_rows, total_rows: rows.len(), unverified, file_name: suggested_file_name(scope, window, con),
    })
}

/// Every column (the tests and the bundle round trip use this form).
#[cfg_attr(not(test), allow(dead_code))]
pub fn export_workbook(con: &Connection, scope: &ExportScope, path: &str) -> AppResult<ExportReport> {
    export_workbook_with(con, scope, &ExportOptions::default(), path)
}

pub fn export_workbook_with(con: &Connection, scope: &ExportScope, options: &ExportOptions, path: &str) -> AppResult<ExportReport> {
    let styles = Styles::new();
    let prov = provenance(con)?;
    let filter_line = scope_label(scope, con);
    let mut wb = Workbook::new();
    let mut report = ExportReport { path: path.into(), ..Default::default() };

    // ---- Sheet 1: Proceedings, the column table
    let (proc_rows, unverified) = collect_proceedings(con, scope)?;
    let cols = chosen_columns(options);
    let rows: Vec<Vec<Cell>> = proc_rows.iter().enumerate().map(|(i, r)| cols.iter().map(|c| (c.cell)(r, i)).collect()).collect();
    report.proceedings = rows.len();
    let ws = wb.add_worksheet();
    ws.set_name("Proceedings").map_err(|e| AppError::state(e.to_string()))?;
    let proceedings_unverified = unverified;
    let clients: Vec<String> = proc_rows.iter().map(|r| r.name.clone()).collect();
    let statuses: Vec<String> = proc_rows.iter().map(|r| r.status.clone()).collect();
    let meta = sheet_meta(scope, con, "Proceedings", "Proceedings", &clients, &statuses);
    header_block(ws, &styles, &header_lines(&prov, &filter_line, &meta, rows.len(), unverified))?;
    let columns: Vec<&str> = cols.iter().map(|c| c.header).collect();
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
    let mut names: Vec<String> = Vec::new();
    let mut statuses: Vec<String> = Vec::new();
    for (i, row) in q.enumerate() {
        let (name, ay, reference, raised, amount, outstanding, section, status, gaps, id, yc_id) = row?;
        names.push(name.clone()); statuses.push(status.clone());
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
    let meta = sheet_meta(scope, con, "Demands", "Demands", &names, &statuses);
    header_block(ws, &styles, &header_lines(&prov, &filter_line, &meta, rows.len(), unverified))?;
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
    let mut names: Vec<String> = Vec::new();
    let mut statuses: Vec<String> = Vec::new();
    for (i, row) in q.enumerate() {
        let (name, ay, ack, rtype, ftype, filed, verif, proc_status, gaps, supersedes) = row?;
        names.push(name.clone());
        if let Some(st) = verif.as_deref() { statuses.push(st.to_string()); }
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
    let meta = sheet_meta(scope, con, "Returns", "Returns", &names, &statuses);
    header_block(ws, &styles, &header_lines(&prov, &filter_line, &meta, rows.len(), unverified))?;
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
    let mut names: Vec<String> = Vec::new();
    let mut statuses: Vec<String> = Vec::new();
    for (i, row) in q.enumerate() {
        let (name, ay, form, ack, filed, ftype, status, filed_by, gaps) = row?;
        names.push(name.clone()); statuses.push(status.clone());
        unverified += gap_count(gaps.as_deref());
        rows.push(vec![
            Cell::Int(i as i64 + 1), Cell::Text(name), text(ay.as_deref()), Cell::Text(form), Cell::Text(ack),
            date(filed.as_deref()), text(ftype.as_deref()), Cell::Text(status), text(filed_by.as_deref()),
        ]);
    }
    report.forms = rows.len();
    let ws = wb.add_worksheet();
    ws.set_name("Forms").map_err(|e| AppError::state(e.to_string()))?;
    let meta = sheet_meta(scope, con, "Forms", "Forms", &names, &statuses);
    header_block(ws, &styles, &header_lines(&prov, &filter_line, &meta, rows.len(), unverified))?;
    finish_sheet(ws, &FORM_COLUMNS, &styles, &rows)?;

    report.unverified_fields = proceedings_unverified + demands_unverified + returns_unverified + unverified;
    wb.save(path).map_err(|e| AppError::Io { message: format!("could not write the workbook: {e}") })?;
    Ok(report)
}

/// docs/18 §5: every registration field as entered, blanks blank, plus the
/// sync-health columns at the end (Q55). Never a credential: this module
/// does not import `keychain.rs` and reads no secret.
pub const CLIENT_COLUMNS: [&str; 17] = [
    "S.No", "Client ID", "Client Name", "PAN", "Entity Type", "Group", "Phone", "Email", "GSTIN", "Client File #",
    "Tags", "Login", "Source", "Added On", "Last Sync", "Last Result", "Open Items",
];

fn entity_label(code: &str) -> String {
    match code {
        "individual" => "Individual", "company" => "Company", "firm" => "Firm", "huf" => "HUF",
        "trust" => "Trust", "aop" => "AOP", _ => "Other",
    }.into()
}

pub fn export_clients(con: &Connection, path: &str) -> AppResult<usize> {
    let styles = Styles::new();
    let prov = provenance(con)?;
    let mut wb = Workbook::new();
    let clients = crate::repo::clients::list(con)?;
    let mut rows: Vec<Vec<Cell>> = Vec::new();
    for (i, c) in clients.iter().enumerate() {
        let health = runs::sync_health(con, &c.id)?;
        let open: i64 = con.query_row(
            "SELECT count(*) FROM proceedings p JOIN year_contexts y ON y.id = p.year_context_id
              WHERE y.client_id = ?1 AND p.status IN ('open','adjournment_sought','unknown')", [&c.id], |r| r.get(0))?;
        // Phone stays blank when no number was entered, even though the
        // country code defaults to +91.
        let phone = c.phone.as_deref().map(str::trim).filter(|p| !p.is_empty()).map(|p| format!("{} {p}", c.phone_cc.trim()));
        rows.push(vec![
            Cell::Int(i as i64 + 1),
            text(c.client_code.as_deref()), Cell::Text(c.name.clone()), Cell::Text(c.pan.clone()),
            Cell::Text(entity_label(&c.entity_type)), text(c.client_group.as_deref()), text(phone.as_deref()),
            text(c.email.as_deref()), text(c.gstin.as_deref()), text(c.client_file_no.as_deref()), text(c.tags.as_deref()),
            Cell::Text(c.portal_login_ref.clone().unwrap_or_else(|| "Own".into())), Cell::Text(c.source.clone()),
            date(Some(&c.created_at[..10.min(c.created_at.len())])),
            match &health.last_run_at { Some(t) => Cell::Text(ist_of(t)), None => Cell::Blank },
            text(health.label.as_deref()), Cell::Int(open),
        ]);
    }
    let ws = wb.add_worksheet();
    ws.set_name("Clients").map_err(|e| AppError::state(e.to_string()))?;
    let meta = SheetMeta { title: "Clients", module: "Clients", client_scope: "all clients".into(), status: "every status".into() };
    header_block(ws, &styles, &header_lines(&prov, "All clients", &meta, rows.len(), 0))?;
    finish_sheet(ws, &CLIENT_COLUMNS, &styles, &rows)?;
    wb.save(path).map_err(|e| AppError::Io { message: format!("could not write the workbook: {e}") })?;
    Ok(rows.len())
}

/// `LCC_clients_<yyyy-mm-dd>.xlsx` (docs/18 §5).
pub fn clients_file_name() -> String {
    format!("LCC_clients_{}.xlsx", chrono::Utc::now().with_timezone(&chrono_tz::Asia::Kolkata).format("%Y-%m-%d"))
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
        assert!(shared.contains("Litigation Command Center — Proceedings"));
        assert!(shared.contains("Filter: All proceedings, every status"));
        assert!(shared.contains("Unverified: "));
        assert!(shared.contains("Viewed by AO") && shared.contains("Limitation Date"));
        assert_eq!(PROCEEDING_SHEET.len(), 20);
        for (i, name) in PROCEEDING_COLUMNS.iter().enumerate() { assert_eq!(PROCEEDING_SHEET[i].header, *name, "column {}", i + 1); }
        assert_eq!(PROCEEDING_SHEET[16].header, "Viewed by AO");
        assert_eq!(PROCEEDING_SHEET[17].header, "Limitation Date");
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
        let meta = SheetMeta { title: name, module: "Updates", client_scope: "all clients".into(), status: "every status".into() };
        header_block(ws, &styles, &header_lines(&prov, &format!("Updates since {since} · {name}"), &meta, entries.len(), 0))?;
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
        let meta = SheetMeta { title: "Updates", module: "Updates", client_scope: "all clients".into(), status: "every status".into() };
        header_block(ws, &styles, &header_lines(&prov, &format!("Updates since {since}"), &meta, 0, 0))?;
        finish_sheet(ws, &COLUMNS, &styles, &[])?;
    }
    wb.save(path).map_err(|e| AppError::Io { message: e.to_string() })?;
    Ok(written)
}
