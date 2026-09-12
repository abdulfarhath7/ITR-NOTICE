//! Portal shapes → rows for demands, returns and filed forms (Phase 5).
//! The same rules as `intake`: blank beats guessed, machine rows start
//! unverified, the document is stored before the row that points at it,
//! and a form always has its two nodes (form + receipt) — the awaited one
//! pending, never absent.

use crate::dates::to_iso;
use crate::error::{AppError, AppResult};
use crate::ids::{new_id, now, row_hash, sha256_hex};
use crate::repo::model::{Demand, DemandResponse, FiledForm, Payment, Return, Status};
use crate::repo::{clients, documents, modules, registry};
use rusqlite::Connection;

fn clean(s: &Option<String>) -> Option<String> {
    s.as_deref().map(str::trim).filter(|v| !v.is_empty() && *v != "-" && !v.eq_ignore_ascii_case("not available")).map(str::to_string)
}

/// `₹ 1,23,456.00` → 123456.0. `None` for anything that is not a number.
pub fn parse_amount(text: Option<&str>) -> Option<f64> {
    let t = text?.trim();
    let cleaned: String = t.chars().filter(|c| c.is_ascii_digit() || *c == '.' || *c == '-').collect();
    if cleaned.is_empty() { return None; }
    cleaned.parse().ok()
}

fn resolve_client(con: &Connection, pan: &Option<String>, name: &Option<String>, self_pan: Option<&str>) -> AppResult<(String, bool)> {
    let (pan, from_login) = match clean(pan) {
        Some(p) => (p.to_ascii_uppercase(), false),
        None => match self_pan {
            Some(p) if !p.trim().is_empty() => (p.trim().to_ascii_uppercase(), true),
            _ => return Err(AppError::invalid("card shows no PAN and no login PAN is known")),
        },
    };
    let client = match clients::find_by_pan(con, &pan)? {
        Some(c) => c,
        None => clients::create_minimal(con, &pan, name.as_deref())?,
    };
    let _ = from_login;
    Ok((client.id, from_login))
}

// ---------------------------------------------------------------- demands

#[derive(Debug, Clone, Default)]
pub struct DemandResponseCard {
    pub stance: Option<String>,        // agreed | disagreed | partially_disagreed, or the portal's words
    pub reason: Option<String>,        // reason code or the portal's words
    pub disputed_amount: Option<String>,
    pub filed_on: Option<String>,
    pub transaction_id: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct PaymentCard {
    pub cin: Option<String>,
    pub bsr_code: Option<String>,
    pub paid_on: Option<String>,
    pub amount: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct DemandCard {
    pub pan: Option<String>,
    pub assessee_name: Option<String>,
    pub assessment_year: Option<String>,
    pub demand_reference_number: Option<String>,
    pub demand_amount: Option<String>,
    pub current_outstanding: Option<String>,
    pub section_or_demand_type: Option<String>,
    pub raised_on: Option<String>,
    pub uploaded_by: Option<String>,
    pub rectification_rights: Option<String>,
    pub status: Option<String>,
    pub response: Option<DemandResponseCard>,
    pub payments: Vec<PaymentCard>,
}

/// The portal's demand words onto the state machine. Unrecognised is unknown.
pub fn demand_status(word: Option<&str>, has_response: bool) -> Status {
    let w = word.map(|s| s.trim().to_ascii_lowercase()).unwrap_or_default();
    if w.contains("response submitted") || w.contains("responded") { return Status::ResponseSubmitted; }
    if w.contains("paid") || w.contains("nil") || w.contains("closed") || w.contains("adjusted") { return Status::Closed; }
    if w.contains("outstanding") || w.contains("pending") || w.contains("open") {
        return if has_response { Status::ResponseSubmitted } else { Status::Open };
    }
    if has_response { Status::ResponseSubmitted } else { Status::Unknown }
}

pub fn stance_code(word: Option<&str>) -> Option<&'static str> {
    let w = word?.trim().to_ascii_lowercase();
    if w.contains("partial") { Some("partially_disagreed") }
    else if w.contains("disagree") { Some("disagreed") }
    else if w.contains("agree") { Some("agreed") }
    else { None }
}

pub fn absorb_demand(con: &Connection, self_pan: Option<&str>, card: &DemandCard) -> AppResult<String> {
    let (client_id, pan_from_login) = resolve_client(con, &card.pan, &card.assessee_name, self_pan)?;
    let ay = clean(&card.assessment_year);
    let yc = clients::ensure_year_context(con, &client_id, ay.as_deref(), None)?;
    let pan = clients::get(con, &client_id)?.map(|c| c.pan).unwrap_or_default();
    let reference = clean(&card.demand_reference_number);
    let natural_key = sha256_hex(format!("{}|{}|{}", pan, ay.as_deref().unwrap_or(""),
                                         reference.as_deref().unwrap_or("")).as_bytes());
    let status = demand_status(card.status.as_deref(), card.response.is_some());
    let raised_on = to_iso(card.raised_on.as_deref());
    let demand_amount = parse_amount(card.demand_amount.as_deref());
    let current_outstanding = parse_amount(card.current_outstanding.as_deref());

    let mut gaps: Vec<&str> = Vec::new();
    if ay.is_none() { gaps.push("assessment_year"); }
    if pan_from_login { gaps.push("pan"); }
    if reference.is_none() { gaps.push("demand_reference_number"); }
    if raised_on.is_none() { gaps.push("raised_on"); }
    if demand_amount.is_none() { gaps.push("demand_amount"); }
    if current_outstanding.is_none() { gaps.push("current_outstanding"); }
    if clean(&card.section_or_demand_type).is_none() { gaps.push("section_or_demand_type"); }
    if card.status.is_none() { gaps.push("status"); }
    gaps.sort();
    let gap_json = serde_json::to_string(&gaps)?;
    let amt = |a: Option<f64>| a.map(|x| format!("{x:.2}"));
    let hash = row_hash(&[reference.as_deref(), amt(demand_amount).as_deref(), amt(current_outstanding).as_deref(),
                          clean(&card.section_or_demand_type).as_deref(), raised_on.as_deref(),
                          Some(status.as_str()), Some(&gap_json)]);
    let ts = now();
    let demand = match modules::demand_by_natural_key(con, &natural_key)? {
        Some(existing) => {
            let changed = existing.row_hash != hash;
            let d = Demand {
                demand_amount, current_outstanding,
                section_or_demand_type: clean(&card.section_or_demand_type).or(existing.section_or_demand_type),
                raised_on: raised_on.or(existing.raised_on),
                uploaded_by: clean(&card.uploaded_by).or(existing.uploaded_by),
                rectification_rights: clean(&card.rectification_rights).or(existing.rectification_rights),
                status: status.as_str().into(), portal_status: clean(&card.status),
                verified_flag: if changed { 0 } else { existing.verified_flag },
                gap_flags: Some(gap_json), row_hash: hash, last_seen_at: ts.clone(),
                updated_at: if changed { ts.clone() } else { existing.updated_at.clone() },
                ..existing
            };
            modules::save_demand(con, &d)?;
            d
        }
        None => {
            let d = Demand {
                id: new_id(), year_context_id: yc.id.clone(), natural_key, demand_reference_number: reference,
                demand_amount, current_outstanding, section_or_demand_type: clean(&card.section_or_demand_type),
                raised_on, uploaded_by: clean(&card.uploaded_by), rectification_rights: clean(&card.rectification_rights),
                status: status.as_str().into(), portal_status: clean(&card.status), proceeding_id: None,
                verified_flag: 0, gap_flags: Some(gap_json), row_hash: hash,
                first_seen_at: ts.clone(), last_seen_at: ts.clone(), created_at: ts.clone(), updated_at: ts.clone(),
            };
            modules::save_demand(con, &d)?;
            d
        }
    };

    if let Some(r) = &card.response {
        let filed_on = to_iso(r.filed_on.as_deref());
        let stance = stance_code(r.stance.as_deref());
        let reason_code_id = match clean(&r.reason) {
            Some(code) => registry::id_for(con, "demand_reason_code", &code.to_ascii_lowercase().replace(' ', "_"))?
                .or(registry::id_for(con, "demand_reason_code", "other")?),
            None => None,
        };
        let disputed = parse_amount(r.disputed_amount.as_deref());
        let mut rg: Vec<&str> = Vec::new();
        if stance.is_none() { rg.push("stance"); }
        if filed_on.is_none() { rg.push("filed_on"); }
        if disputed.is_none() { rg.push("disputed_amount"); }
        if clean(&r.transaction_id).is_none() { rg.push("transaction_id"); }
        let rg_json = serde_json::to_string(&rg)?;
        let rhash = row_hash(&[stance, reason_code_id.as_deref(), amt(disputed).as_deref(), filed_on.as_deref(),
                               clean(&r.transaction_id).as_deref(), Some(&rg_json)]);
        let existing = modules::demand_responses_for(con, &demand.id)?.into_iter().next();
        match existing {
            Some(e) if e.row_hash == rhash => {}
            Some(e) => modules::save_demand_response(con, &DemandResponse {
                stance: stance.map(str::to_string), reason_code_id, disputed_amount: disputed, filed_on,
                transaction_id: clean(&r.transaction_id), verified_flag: 0, gap_flags: Some(rg_json),
                row_hash: rhash, updated_at: ts.clone(), ..e })?,
            None => modules::save_demand_response(con, &DemandResponse {
                id: new_id(), demand_id: demand.id.clone(), stance: stance.map(str::to_string), reason_code_id,
                disputed_amount: disputed, filed_on, transaction_id: clean(&r.transaction_id), verified_flag: 0,
                gap_flags: Some(rg_json), row_hash: rhash, created_at: ts.clone(), updated_at: ts.clone() })?,
        }
    }

    let response_id = modules::demand_responses_for(con, &demand.id)?.into_iter().next().map(|r| r.id);
    for p in &card.payments {
        let cin = clean(&p.cin);
        let paid_on = to_iso(p.paid_on.as_deref());
        let amount = parse_amount(p.amount.as_deref());
        let mut pg: Vec<&str> = Vec::new();
        if cin.is_none() { pg.push("cin"); }
        if clean(&p.bsr_code).is_none() { pg.push("bsr_code"); }
        if paid_on.is_none() { pg.push("paid_on"); }
        if amount.is_none() { pg.push("amount"); }
        let pg_json = serde_json::to_string(&pg)?;
        let phash = row_hash(&[cin.as_deref(), clean(&p.bsr_code).as_deref(), paid_on.as_deref(), amt(amount).as_deref(), Some(&pg_json)]);
        let same: Option<Payment> = modules::payments_for_year(con, &yc.id)?.into_iter()
            .find(|x| x.cin.is_some() && x.cin == cin || (x.cin.is_none() && x.row_hash == phash));
        match same {
            Some(x) if x.row_hash == phash => {}
            Some(x) => modules::save_payment(con, &Payment { paid_on, amount, bsr_code: clean(&p.bsr_code),
                gap_flags: Some(pg_json), row_hash: phash, verified_flag: 0, updated_at: ts.clone(), ..x })?,
            None => modules::save_payment(con, &Payment {
                id: new_id(), year_context_id: yc.id.clone(), demand_response_id: response_id.clone(),
                proceeding_id: None, purpose: "demand_settlement".into(), cin, bsr_code: clean(&p.bsr_code),
                paid_on, amount, verified_flag: 0, gap_flags: Some(pg_json), row_hash: phash,
                created_at: ts.clone(), updated_at: ts.clone() })?,
        }
    }
    Ok(demand.id)
}

// ---------------------------------------------------------------- returns

#[derive(Debug, Clone, Default)]
pub struct ReturnCard {
    pub pan: Option<String>,
    pub assessee_name: Option<String>,
    pub assessment_year: Option<String>,
    pub acknowledgement_number: Option<String>,
    pub return_type: Option<String>,
    pub filing_type: Option<String>,
    pub filed_on: Option<String>,
    pub verification_status: Option<String>,
    pub processing_status: Option<String>,
    pub form_pdf: Option<Vec<u8>>,
    pub receipt_pdf: Option<Vec<u8>>,
}

pub fn filing_type_code(word: Option<&str>) -> Option<&'static str> {
    let w = word?.trim().to_ascii_lowercase();
    if w.contains("updated") { Some("updated") }
    else if w.contains("revised") { Some("revised") }
    else if w.contains("original") { Some("original") }
    else { None }
}

/// A return is "open" while the portal says verification is pending;
/// otherwise it is a filed record (closed). The date it must be verified by
/// is not on the card, so no due date is stored.
pub fn return_status(verification: Option<&str>) -> Status {
    let w = verification.map(|s| s.trim().to_ascii_lowercase()).unwrap_or_default();
    if w.is_empty() { Status::Unknown }
    else if w.contains("pending") || w.contains("not verified") || w.contains("unverified") { Status::Open }
    else { Status::Closed }
}

/// The pair rule: two nodes, always. Fetched bytes become stored nodes;
/// missing ones are pending, never absent.
fn ensure_pair(con: &Connection, parent_type: &str, parent_id: &str, form: Option<&[u8]>, receipt: Option<&[u8]>,
               ack: &str) -> AppResult<()> {
    match form {
        Some(b) if !b.is_empty() => { documents::attach_stored(con, &documents::Attach {
            parent_type, parent_id, doc_kind: "form", filename: Some(&format!("{ack}-form.pdf")),
            bytes: b, source_url: None, fetched_at: None })?; }
        _ => { documents::ensure_pending(con, parent_type, parent_id, "form")?; }
    }
    match receipt {
        Some(b) if !b.is_empty() => { documents::attach_stored(con, &documents::Attach {
            parent_type, parent_id, doc_kind: "receipt", filename: Some(&format!("{ack}-receipt.pdf")),
            bytes: b, source_url: None, fetched_at: None })?; }
        _ => { documents::ensure_pending(con, parent_type, parent_id, "receipt")?; }
    }
    Ok(())
}

pub fn absorb_return(con: &Connection, self_pan: Option<&str>, card: &ReturnCard) -> AppResult<String> {
    let (client_id, pan_from_login) = resolve_client(con, &card.pan, &card.assessee_name, self_pan)?;
    let ay = clean(&card.assessment_year);
    let yc = clients::ensure_year_context(con, &client_id, ay.as_deref(), None)?;
    let ack = clean(&card.acknowledgement_number).ok_or_else(|| AppError::invalid("return card has no acknowledgement number"))?;
    let filed_on = to_iso(card.filed_on.as_deref());
    let filing_type = filing_type_code(card.filing_type.as_deref());
    let status = return_status(card.verification_status.as_deref());
    // Document first.
    if let Some(b) = card.form_pdf.as_deref().filter(|b| !b.is_empty()) { documents::store_blob(con, b)?; }
    if let Some(b) = card.receipt_pdf.as_deref().filter(|b| !b.is_empty()) { documents::store_blob(con, b)?; }

    let mut gaps: Vec<&str> = Vec::new();
    if ay.is_none() { gaps.push("assessment_year"); }
    if pan_from_login { gaps.push("pan"); }
    if filed_on.is_none() { gaps.push("filed_on"); }
    if filing_type.is_none() { gaps.push("filing_type"); }
    if clean(&card.return_type).is_none() { gaps.push("return_type"); }
    if clean(&card.verification_status).is_none() { gaps.push("verification_status"); }
    if clean(&card.processing_status).is_none() { gaps.push("processing_status"); }
    gaps.sort();
    let gap_json = serde_json::to_string(&gaps)?;
    let hash = row_hash(&[Some(&ack), clean(&card.return_type).as_deref(), filing_type, filed_on.as_deref(),
                          clean(&card.verification_status).as_deref(), clean(&card.processing_status).as_deref(),
                          Some(status.as_str()), Some(&gap_json)]);
    let ts = now();
    // Siblings chained by supersedes_id: a revised or updated return
    // supersedes the latest earlier-filed return of the same year.
    let supersedes = if matches!(filing_type, Some("revised") | Some("updated")) {
        modules::returns_for_year(con, &yc.id)?.into_iter().rev()
            .find(|r| r.acknowledgement_number != ack && (filed_on.is_none() || r.filed_on.as_deref() <= filed_on.as_deref()))
            .map(|r| r.id)
    } else { None };

    let ret = match modules::return_by_ack(con, &ack)? {
        Some(existing) => {
            let changed = existing.row_hash != hash;
            let r = Return {
                return_type: clean(&card.return_type).or(existing.return_type),
                filing_type: filing_type.map(str::to_string).or(existing.filing_type),
                filed_on: filed_on.or(existing.filed_on),
                verification_status: clean(&card.verification_status).or(existing.verification_status),
                processing_status: clean(&card.processing_status).or(existing.processing_status),
                status: status.as_str().into(), supersedes_id: supersedes.or(existing.supersedes_id),
                verified_flag: if changed { 0 } else { existing.verified_flag },
                gap_flags: Some(gap_json), row_hash: hash, last_seen_at: ts.clone(),
                updated_at: if changed { ts.clone() } else { existing.updated_at.clone() },
                ..existing
            };
            modules::save_return(con, &r)?;
            r
        }
        None => {
            let r = Return {
                id: new_id(), year_context_id: yc.id.clone(), acknowledgement_number: ack.clone(),
                return_type: clean(&card.return_type), filing_type: filing_type.map(str::to_string), filed_on,
                verification_status: clean(&card.verification_status), processing_status: clean(&card.processing_status),
                status: status.as_str().into(), supersedes_id: supersedes, verified_flag: 0, gap_flags: Some(gap_json),
                row_hash: hash, first_seen_at: ts.clone(), last_seen_at: ts.clone(), created_at: ts.clone(), updated_at: ts.clone(),
            };
            modules::save_return(con, &r)?;
            r
        }
    };
    ensure_pair(con, "return", &ret.id, card.form_pdf.as_deref(), card.receipt_pdf.as_deref(), &ack)?;
    Ok(ret.id)
}

// ------------------------------------------------------------ filed forms

#[derive(Debug, Clone, Default)]
pub struct FormCard {
    pub pan: Option<String>,
    pub assessee_name: Option<String>,
    pub assessment_year: Option<String>,
    pub form_label: Option<String>,        // "Form 35", "Form 3CB-3CD" ...
    pub acknowledgement_number: Option<String>,
    pub filed_on: Option<String>,
    pub filing_type: Option<String>,
    pub status: Option<String>,
    pub filed_by: Option<String>,
    pub form_pdf: Option<Vec<u8>>,
    pub receipt_pdf: Option<Vec<u8>>,
}

/// `Form 3CB-3CD` → `form_3cb_3cd`; `Form 10-IC` → `form_10ic`. Unknown
/// forms map to `other` and keep the portal's label verbatim.
pub fn form_type_code(label: Option<&str>) -> String {
    let l = label.unwrap_or("").to_ascii_lowercase();
    let rest = l.trim().trim_start_matches("form").trim();
    let rest = rest.split(['—', '(', ':']).next().unwrap_or("").trim();
    // "3cb-3cd" and "3ca-3cd" are pairs joined with an underscore; every
    // other hyphen ("10-ic") is dropped.
    let parts: Vec<String> = rest.split(['-', ' ', '/'])
        .map(|p| p.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>())
        .filter(|p| !p.is_empty()).collect();
    if parts.is_empty() { return "other".into(); }
    let joined = if parts.len() == 2 && parts[1].ends_with("cd") { parts.join("_") } else { parts.concat() };
    format!("form_{joined}")
}

pub fn form_status(word: Option<&str>) -> Status {
    let w = word.map(|s| s.trim().to_ascii_lowercase()).unwrap_or_default();
    if w.is_empty() { Status::Unknown }
    else if w.contains("pending") || w.contains("awaiting") || w.contains("not verified") { Status::Open }
    else { Status::Closed }
}

pub fn absorb_filed_form(con: &Connection, self_pan: Option<&str>, card: &FormCard) -> AppResult<String> {
    let (client_id, pan_from_login) = resolve_client(con, &card.pan, &card.assessee_name, self_pan)?;
    let ay = clean(&card.assessment_year);
    let yc = clients::ensure_year_context(con, &client_id, ay.as_deref(), None)?;
    let ack = clean(&card.acknowledgement_number).ok_or_else(|| AppError::invalid("form card has no acknowledgement number"))?;
    let label = clean(&card.form_label);
    let code = form_type_code(label.as_deref());
    let form_type_id = match registry::id_for(con, "form_type", &code)? {
        Some(id) => id,
        None => registry::require(con, "form_type", "other")?,
    };
    let filed_on = to_iso(card.filed_on.as_deref());
    let status = form_status(card.status.as_deref());
    if let Some(b) = card.form_pdf.as_deref().filter(|b| !b.is_empty()) { documents::store_blob(con, b)?; }
    if let Some(b) = card.receipt_pdf.as_deref().filter(|b| !b.is_empty()) { documents::store_blob(con, b)?; }

    let mut gaps: Vec<&str> = Vec::new();
    if ay.is_none() { gaps.push("assessment_year"); }
    if pan_from_login { gaps.push("pan"); }
    if filed_on.is_none() { gaps.push("filed_on"); }
    if label.is_none() { gaps.push("form_type"); }
    if clean(&card.filing_type).is_none() { gaps.push("filing_type"); }
    if card.status.is_none() { gaps.push("status"); }
    if clean(&card.filed_by).is_none() { gaps.push("filed_by"); }
    gaps.sort();
    let gap_json = serde_json::to_string(&gaps)?;
    let hash = row_hash(&[Some(&ack), label.as_deref(), filed_on.as_deref(), clean(&card.filing_type).as_deref(),
                          clean(&card.status).as_deref(), clean(&card.filed_by).as_deref(), Some(status.as_str()), Some(&gap_json)]);
    let ts = now();
    let form = match modules::filed_form_by_ack(con, &ack)? {
        Some(existing) => {
            let changed = existing.row_hash != hash;
            let f = FiledForm {
                form_type_id, form_label: label.or(existing.form_label),
                filed_on: filed_on.or(existing.filed_on), filing_type: clean(&card.filing_type).or(existing.filing_type),
                portal_status: clean(&card.status), status: status.as_str().into(),
                filed_by: clean(&card.filed_by).or(existing.filed_by),
                verified_flag: if changed { 0 } else { existing.verified_flag },
                gap_flags: Some(gap_json), row_hash: hash, last_seen_at: ts.clone(),
                updated_at: if changed { ts.clone() } else { existing.updated_at.clone() },
                ..existing
            };
            modules::save_filed_form(con, &f)?;
            f
        }
        None => {
            let f = FiledForm {
                id: new_id(), year_context_id: yc.id.clone(), form_type_id, acknowledgement_number: ack.clone(),
                form_label: label, filed_on, filing_type: clean(&card.filing_type), portal_status: clean(&card.status),
                status: status.as_str().into(), filed_by: clean(&card.filed_by), verified_flag: 0,
                gap_flags: Some(gap_json), row_hash: hash, first_seen_at: ts.clone(), last_seen_at: ts.clone(),
                created_at: ts.clone(), updated_at: ts.clone(),
            };
            modules::save_filed_form(con, &f)?;
            f
        }
    };
    ensure_pair(con, "filed_form", &form.id, card.form_pdf.as_deref(), card.receipt_pdf.as_deref(), &ack)?;
    Ok(form.id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn amounts_and_codes() {
        assert_eq!(parse_amount(Some("₹ 1,23,456.00")), Some(123456.0));
        assert_eq!(parse_amount(Some("-")), None);
        assert_eq!(form_type_code(Some("Form 35")), "form_35");
        assert_eq!(form_type_code(Some("Form 3CB-3CD")), "form_3cb_3cd");
        assert_eq!(form_type_code(Some("Form 10-IC")), "form_10ic");
        assert_eq!(form_type_code(Some("Form 10-IEA")), "form_10iea");
        assert_eq!(form_type_code(None), "other");
        assert_eq!(stance_code(Some("Disagree with demand (Partially)")), Some("partially_disagreed"));
        assert_eq!(filing_type_code(Some("Revised Return")), Some("revised"));
    }

    /// docs/02: both nodes always exist; an awaited receipt is pending.
    #[test]
    fn form_and_receipt_pair_rule() {
        let mut con = Connection::open_in_memory().unwrap();
        crate::migrate::run(&mut con).unwrap();
        let card = FormCard { pan: Some("ABCDE1234F".into()), assessment_year: Some("2024-25".into()),
            form_label: Some("Form 35".into()), acknowledgement_number: Some("123456789012345".into()),
            filed_on: Some("12-Aug-2026".into()), status: Some("Submitted".into()),
            form_pdf: Some(b"%PDF-form".to_vec()), receipt_pdf: None, ..Default::default() };
        let id = absorb_filed_form(&con, None, &card).unwrap();
        let docs = documents::for_parent(&con, "filed_form", &id).unwrap();
        assert_eq!(docs.len(), 2);
        let receipt = docs.iter().find(|d| d.doc_kind == "receipt").unwrap();
        assert_eq!(receipt.state, "pending");
        assert!(receipt.storage_path.is_none());
        // The receipt arrives later: still two nodes, now both stored.
        let later = FormCard { receipt_pdf: Some(b"%PDF-receipt".to_vec()), ..card };
        absorb_filed_form(&con, None, &later).unwrap();
        let docs = documents::for_parent(&con, "filed_form", &id).unwrap();
        assert_eq!(docs.len(), 2);
        assert!(docs.iter().all(|d| d.state == "stored"));
    }

    /// Task 11.1: a demand with a challan round-trips from the card shape to
    /// the Excel workbook (CIN and amount on the Demands sheet).
    #[test]
    fn demand_with_challan_round_trips_to_excel() {
        let mut con = Connection::open_in_memory().unwrap();
        crate::migrate::run(&mut con).unwrap();
        crate::repo::local::set(&con, crate::repo::local::DEVICE_ID, "dev_t").unwrap();
        let card = DemandCard {
            pan: Some("ABCDE1234F".into()), assessment_year: Some("2023-24".into()),
            demand_reference_number: Some("2023202400012345".into()), demand_amount: Some("₹ 1,50,000".into()),
            current_outstanding: Some("50,000.00".into()), section_or_demand_type: Some("143(1)".into()),
            raised_on: Some("12-Jan-2026".into()), status: Some("Outstanding".into()),
            response: Some(DemandResponseCard { stance: Some("Disagree with demand (Partially)".into()), reason: Some("demand_paid_partly".into()),
                                                disputed_amount: Some("50,000".into()), filed_on: Some("20-Jan-2026".into()), transaction_id: None }),
            payments: vec![PaymentCard { cin: Some("0004567890123456789".into()), bsr_code: Some("0004567".into()),
                                         paid_on: Some("18-Jan-2026".into()), amount: Some("1,00,000".into()) }],
            ..Default::default()
        };
        let id = absorb_demand(&con, None, &card).unwrap();
        let d = modules::get_demand(&con, &id).unwrap().unwrap();
        assert_eq!(d.demand_amount, Some(150000.0));
        assert_eq!(d.current_outstanding, Some(50000.0));
        assert_eq!(d.status, "response_submitted");
        let pays = modules::payments_for_year(&con, &d.year_context_id).unwrap();
        assert_eq!(pays.len(), 1);
        assert_eq!(pays[0].purpose, "demand_settlement");
        assert!(pays[0].demand_response_id.is_some(), "linked to the response, parented by the year (Q03)");
        // same card again: no duplicate payment
        absorb_demand(&con, None, &card).unwrap();
        assert_eq!(modules::payments_for_year(&con, &d.year_context_id).unwrap().len(), 1);

        let dir = std::env::temp_dir().join(format!("draftax-demand-{}", crate::ids::new_id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("d.xlsx");
        let report = crate::export::export_workbook(&con, &crate::export::ExportScope::All, path.to_str().unwrap()).unwrap();
        assert_eq!(report.demands, 1);
        let mut zip = zip::ZipArchive::new(std::io::Cursor::new(std::fs::read(&path).unwrap())).unwrap();
        let mut shared = String::new();
        std::io::Read::read_to_string(&mut zip.by_name("xl/sharedStrings.xml").unwrap(), &mut shared).unwrap();
        assert!(shared.contains("0004567890123456789"), "the CIN is on the sheet");
        assert!(shared.contains("partially disagreed"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn revised_return_supersedes_the_original() {
        let mut con = Connection::open_in_memory().unwrap();
        crate::migrate::run(&mut con).unwrap();
        let original = ReturnCard { pan: Some("ABCDE1234F".into()), assessment_year: Some("2024-25".into()),
            acknowledgement_number: Some("111111111111111".into()), return_type: Some("ITR-3".into()),
            filing_type: Some("Original".into()), filed_on: Some("31-Jul-2025".into()),
            verification_status: Some("Verified".into()), ..Default::default() };
        let o = absorb_return(&con, None, &original).unwrap();
        let revised = ReturnCard { acknowledgement_number: Some("222222222222222".into()),
            filing_type: Some("Revised".into()), filed_on: Some("15-Dec-2025".into()), ..original.clone() };
        let r = absorb_return(&con, None, &revised).unwrap();
        let row = modules::get_return(&con, &r).unwrap().unwrap();
        assert_eq!(row.supersedes_id.as_deref(), Some(o.as_str()));
        assert_eq!(modules::get_return(&con, &o).unwrap().unwrap().supersedes_id, None);
        // Task 11.2: one thread, not two rows — the list shows the head only,
        // the detail shows the chain.
        let rows = crate::repo::work_items::list(&con, &crate::repo::work_items::WorkItemFilter {
            module: Some("returns".into()), ..Default::default() }).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, r);
        let detail = crate::repo::work_items::return_detail(&con, &r).unwrap().unwrap();
        assert_eq!(detail.chain.iter().map(|x| x.acknowledgement_number.clone()).collect::<Vec<_>>(),
                   vec!["111111111111111", "222222222222222"]);
        assert_eq!(crate::repo::work_items::return_detail(&con, &o).unwrap().unwrap().chain.len(), 2);
    }
}
