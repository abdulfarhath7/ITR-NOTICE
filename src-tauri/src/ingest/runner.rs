//! The run: strictly one login at a time, attended, resumable (docs/05).
//!
//! for each job in the queue:
//!     acquire the per-login lock
//!     open a session — a human clears captcha / OTP; the queue WAITS
//!     for each of the six panels not yet in the job's cursor:
//!         list headers; hash each; ten known-and-unchanged in a row stops
//!         the panel; new or changed rows are fetched document-first
//!         write the ingestion_runs row, zero counts included
//!         save the cursor
//!     release the lock, log out
//!
//! A wrong password parks the job for the run. Any other failure schedules
//! a retry with backoff. Nothing here writes to the portal.
//!
//! Build 3 (docs/17) adds scopes on top: a sweep probes first and indexes
//! instead of downloading, a deep fetch walks one client to a depth, an item
//! fetch walks to one proceeding. A scheduled run keeps to its window and
//! then drains the deep queue and warms the cache.

use crate::ids::{new_id, now};
use crate::ingest::portal_source::{Controls, PortalSource, SidecarHandle};
use crate::ingest::source::*;
use crate::ingest::state::{self, Counts, Shared};
use crate::intake::{self, NoticeCard, ProceedingCard};
use crate::intake_modules::{self, DemandCard, DemandResponseCard, FormCard, PaymentCard, ReturnCard};
use crate::mask;
use crate::repo::model::{IngestionRun, Status};
use crate::ingest::decide::{self, decide, Decision, Mode, RowFacts};
use crate::ingest::scheduler::{self, Schedule};
use crate::repo::queue::{self, Job, RunKind, SweepScope};
use crate::repo::{clients, documents, local, proceedings, runs, scopes};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

/// Ten consecutive known-and-unchanged rows end a panel (docs/05).
pub const EARLY_STOP_STREAK: u32 = 10;

/// How many logins a sweep works at once (task 12.5, Q08). One, until the
/// two tests in NOTES.md ("Q08") show the portal tolerates parallel
/// sessions for different taxpayers. Nothing else in the runner assumes
/// sequentiality: raising this runs that many jobs side by side, each with
/// its own sidecar and browser.
pub const INGESTION_WORKERS: usize = 1;

fn s(v: Option<&Value>) -> Option<String> {
    v.and_then(Value::as_str).map(str::trim).filter(|x| !x.is_empty()).map(str::to_string)
}

fn card_from(header: &WorkItemHeader) -> Result<ProceedingCard, String> {
    let p = &header.proceeding;
    let (tab, sub) = header.panel.split_once(':').ok_or_else(|| format!("bad panel {}", header.panel))?;
    Ok(ProceedingCard {
        tab: tab.into(), sub_tab: sub.into(),
        proceeding_name: s(p.get("proceeding_name")), pan: s(p.get("pan")),
        assessee_name: s(p.get("assessee_name")), assessment_year: s(p.get("assessment_year")),
        financial_year: s(p.get("financial_year")),
        status: s(p.get("status")), initiated_on: s(p.get("initiated_on")),
        closure_date: s(p.get("closure_date")), closure_order: s(p.get("closure_order")),
    })
}

fn notice_from(n: &HashMap<String, Value>, pdf: Option<Vec<u8>>) -> NoticeCard {
    NoticeCard {
        ref_id: s(n.get("reference_id")).unwrap_or_default(),
        notice_us: s(n.get("section")), doc_ref_id: s(n.get("din")), description: s(n.get("description")),
        issued_on: s(n.get("issued_on")), served_on: s(n.get("served_on")),
        due_date: s(n.get("response_due_date")), due_date_source: None,
        ao_viewed_on: s(n.get("ao_viewed_on")), last_response_on: s(n.get("last_response_on")),
        responded: n.get("responded").and_then(Value::as_i64),
        downloaded_at: Some(now()), pdf,
    }
}

fn opt_map(v: Option<&Value>) -> Option<HashMap<String, Value>> {
    v.and_then(Value::as_object).map(|o| o.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
}

fn demand_from(p: &HashMap<String, Value>) -> DemandCard {
    let response = opt_map(p.get("response")).map(|r| DemandResponseCard {
        stance: s(r.get("stance")), reason: s(r.get("reason")), disputed_amount: s(r.get("disputed_amount")),
        filed_on: s(r.get("filed_on")), transaction_id: s(r.get("transaction_id")),
    });
    let payments = p.get("payments").and_then(Value::as_array).map(|a| a.iter().filter_map(|x| x.as_object()).map(|o| PaymentCard {
        cin: s(o.get("cin")), bsr_code: s(o.get("bsr_code")), paid_on: s(o.get("paid_on")), amount: s(o.get("amount")),
    }).collect()).unwrap_or_default();
    DemandCard {
        pan: s(p.get("pan")), assessee_name: s(p.get("assessee_name")), assessment_year: s(p.get("assessment_year")),
        demand_reference_number: s(p.get("demand_reference_number")), demand_amount: s(p.get("demand_amount")),
        current_outstanding: s(p.get("current_outstanding")), section_or_demand_type: s(p.get("section_or_demand_type")),
        raised_on: s(p.get("raised_on")), uploaded_by: s(p.get("uploaded_by")),
        rectification_rights: s(p.get("rectification_rights")), status: s(p.get("status")), response, payments,
    }
}

fn return_from(p: &HashMap<String, Value>, pdf: Option<Vec<u8>>, receipt: Option<Vec<u8>>) -> ReturnCard {
    ReturnCard {
        pan: s(p.get("pan")), assessee_name: s(p.get("assessee_name")), assessment_year: s(p.get("assessment_year")),
        acknowledgement_number: s(p.get("acknowledgement_number")), return_type: s(p.get("return_type")),
        filing_type: s(p.get("filing_type")), filed_on: s(p.get("filed_on")),
        verification_status: s(p.get("verification_status")), processing_status: s(p.get("processing_status")),
        form_pdf: pdf, receipt_pdf: receipt,
    }
}

fn form_from(p: &HashMap<String, Value>, pdf: Option<Vec<u8>>, receipt: Option<Vec<u8>>) -> FormCard {
    FormCard {
        pan: s(p.get("pan")), assessee_name: s(p.get("assessee_name")), assessment_year: s(p.get("assessment_year")),
        form_label: s(p.get("form_label")), acknowledgement_number: s(p.get("acknowledgement_number")),
        filed_on: s(p.get("filed_on")), filing_type: s(p.get("filing_type")), status: s(p.get("status")),
        filed_by: s(p.get("filed_by")), form_pdf: pdf, receipt_pdf: receipt,
    }
}

/// One panel's sink: decides verdicts, absorbs rows, counts.
struct PanelSink<'a, R: tauri::Runtime> {
    db: &'a Arc<Mutex<Connection>>,
    app: &'a AppHandle<R>,
    shared: &'a Shared,
    login_pan: &'a str,
    mode: &'a Mode,
    scope: &'static str,
    /// Older-than-window rows do not count toward the streak on "For your
    /// action" panels, so every open item there is re-read (D-051).
    action_panel: bool,
    streak: u32,
    pending: Option<(ProceedingCard, HashMap<String, Value>)>,
    /// The row an `index` answer recorded; its bodiless item is expected next.
    indexed: Option<String>,
    counts: Counts,
    low_confidence: HashMap<String, i64>,
    errors: Vec<String>,
    /// New rows outside the lookback window, per panel (§2.3).
    older: i64,
    /// Item fetch: targets already received; the walk stops once all are in.
    found: std::collections::HashSet<String>,
}

fn facts_date(v: Option<&Value>) -> Option<chrono::NaiveDate> {
    crate::dates::to_iso(s(v).as_deref()).and_then(|d| chrono::NaiveDate::parse_from_str(&d, "%Y-%m-%d").ok())
}

impl<'a, R: tauri::Runtime> PanelSink<'a, R> {
    fn note_confidence(&mut self, header: &WorkItemHeader) {
        for (k, v) in header.confidence.proceeding.iter().chain(header.confidence.notice.iter()) {
            if v == "low" { *self.low_confidence.entry(k.clone()).or_insert(0) += 1; }
        }
    }

    fn absorb(&mut self, card: &ProceedingCard, notice: Option<&NoticeCard>) -> Result<(), String> {
        let mut con = self.db.lock().map_err(|e| e.to_string())?;
        let tx = con.transaction().map_err(|e| e.to_string())?;
        crate::repo::rows::with_sweep_context(|| intake::absorb(&tx, Some(self.login_pan), card, notice))
            .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())
    }

    fn publish(&self) {
        let counts = self.counts.clone();
        state::update(self.shared, |st| st.counts = counts);
        let _ = self.app.emit("ingestion", json!({"ev": "state", "scope": self.scope}));
    }

    /// Item fetch: every target is in, so the rest of the listing is noise.
    fn item_done(&self) -> bool {
        matches!(self.mode, Mode::Item { targets } if !targets.is_empty() && targets.iter().all(|t| self.found.contains(t)))
    }

    /// Streak bookkeeping for a row that needs nothing.
    fn quiet_skip(&mut self, quiet: bool, older: bool) -> Verdict {
        if older { self.older += 1; }
        self.counts.skipped += 1;
        let counts_toward = quiet && self.mode.early_stop() && !(older && self.action_panel);
        if counts_toward { self.streak += 1; }
        self.publish();
        if self.mode.early_stop() && self.streak >= EARLY_STOP_STREAK { Verdict::Stop } else { Verdict::Skip }
    }
}

impl<'a, R: tauri::Runtime> PanelSink<'a, R> {
    /// Demands, returns and forms: one card per header, no notice level.
    fn on_module_header(&mut self, header: &WorkItemHeader) -> Verdict {
        self.counts.cards += 1;
        let p = &header.proceeding;
        let module = header.panel.as_str();
        if module == "demands" {
            // Demands carry no documents; the row is always current.
            if let Err(e) = self.absorb_module(module, p, None, None) { self.errors.push(e); }
            self.counts.changed += 1;
            self.streak = 0;
            self.publish();
            return Verdict::Skip;
        }
        let facts: Result<RowFacts, String> = (|| {
            let con = self.db.lock().map_err(|e| e.to_string())?;
            let ack = s(p.get("acknowledgement_number")).ok_or("card has no acknowledgement number")?;
            let (parent_type, exists) = if module == "returns" {
                ("return", crate::repo::modules::return_by_ack(&con, &ack).map_err(|e| e.to_string())?.map(|r| r.id))
            } else {
                ("filed_form", crate::repo::modules::filed_form_by_ack(&con, &ack).map_err(|e| e.to_string())?.map(|f| f.id))
            };
            let stored_docs = match &exists {
                Some(id) => crate::repo::documents::for_parent(&con, parent_type, id).map_err(|e| e.to_string())?
                    .iter().filter(|d| d.state == "stored").count(),
                None => 0,
            };
            // The pair rule: complete means both form and receipt are stored.
            Ok(RowFacts {
                key: ack, stored: exists.is_some(), unchanged: exists.is_some(), has_doc: stored_docs >= 2,
                wants_doc: p.get("has_pdf_button").and_then(Value::as_bool).unwrap_or(false),
                issued_on: facts_date(p.get("filed_on")), assessment_year: s(p.get("assessment_year")),
            })
        })();
        let facts = match facts { Ok(f) => f, Err(e) => { self.errors.push(e); return Verdict::Skip; } };
        match decide(self.mode, &facts) {
            Decision::Skip { quiet, older } => {
                // A stored row is re-written: its status line may have moved.
                if facts.stored {
                    if let Err(e) = self.absorb_module(module, p, None, None) { self.errors.push(e); }
                }
                self.quiet_skip(quiet, older)
            }
            Decision::Index => {
                self.streak = 0;
                self.counts.changed += 1;
                self.counts.indexed += 1;
                if let Err(e) = self.absorb_module(module, p, None, None) { self.errors.push(e); }
                self.mark_module_pending(module, &facts.key);
                self.indexed = Some(facts.key);
                self.publish();
                Verdict::Index
            }
            Decision::Fetch => {
                self.streak = 0;
                self.pending = Some((ProceedingCard::default(), p.clone()));
                Verdict::Fetch
            }
        }
    }

    fn mark_module_pending(&mut self, module: &str, ack: &str) {
        let Ok(con) = self.db.lock() else { return; };
        let parent = if module == "returns" {
            crate::repo::modules::return_by_ack(&con, ack).ok().flatten().map(|r| ("return", r.id))
        } else {
            crate::repo::modules::filed_form_by_ack(&con, ack).ok().flatten().map(|f| ("filed_form", f.id))
        };
        if let Some((pt, id)) = parent {
            for kind in ["form", "receipt"] {
                let _ = crate::repo::rows::with_sweep_context(|| scopes::mark_pending(&con, pt, &id, kind, ack));
            }
        }
    }

    fn absorb_module(&mut self, module: &str, p: &HashMap<String, Value>, pdf: Option<Vec<u8>>, receipt: Option<Vec<u8>>) -> Result<(), String> {
        let mut con = self.db.lock().map_err(|e| e.to_string())?;
        let tx = con.transaction().map_err(|e| e.to_string())?;
        let login = self.login_pan;
        crate::repo::rows::with_sweep_context(|| -> Result<(), String> {
            match module {
                "returns" => { intake_modules::absorb_return(&tx, Some(login), &return_from(p, pdf, receipt)).map_err(|e| e.to_string())?; }
                "forms" => { intake_modules::absorb_filed_form(&tx, Some(login), &form_from(p, pdf, receipt)).map_err(|e| e.to_string())?; }
                "demands" => { intake_modules::absorb_demand(&tx, Some(login), &demand_from(p)).map_err(|e| e.to_string())?; }
                _ => return Err(format!("unknown module panel {module}")),
            }
            Ok(())
        })?;
        tx.commit().map_err(|e| e.to_string())
    }
}

impl<'a, R: tauri::Runtime> crate::ingest::source::PanelSink for PanelSink<'a, R> {
    fn on_header(&mut self, header: &WorkItemHeader) -> Verdict {
        self.note_confidence(header);
        if self.item_done() { return Verdict::Stop; }
        if matches!(header.panel.as_str(), "demands" | "returns" | "forms") {
            return self.on_module_header(header);
        }
        let card = match card_from(header) {
            Ok(c) => c,
            Err(e) => { self.errors.push(e); return Verdict::Skip; }
        };
        self.counts.cards += 1;
        let Some(n) = header.notice.as_ref() else {
            // A proceeding shell without notices: store it, nothing to fetch.
            if let Err(e) = self.absorb(&card, None) { self.errors.push(e); }
            self.publish();
            return Verdict::Skip;
        };
        self.counts.notices += 1;
        let notice = notice_from(n, None);
        if notice.ref_id.is_empty() {
            self.errors.push("a notice header had no reference id".into());
            return Verdict::Skip;
        }
        let pstatus = Status::from_portal(card.status.as_deref());
        let (unchanged, has_doc) = {
            let con = match self.db.lock() { Ok(c) => c, Err(e) => { self.errors.push(e.to_string()); return Verdict::Skip; } };
            (intake::notice_unchanged(&con, pstatus, &notice).unwrap_or(None),
             intake::notice_has_document(&con, &notice.ref_id).unwrap_or(false))
        };
        let facts = RowFacts {
            key: notice.ref_id.clone(), stored: unchanged.is_some(), unchanged: unchanged == Some(true), has_doc,
            wants_doc: n.get("has_pdf_button").and_then(Value::as_bool).unwrap_or(true),
            issued_on: facts_date(n.get("issued_on")), assessment_year: card.assessment_year.clone(),
        };
        match decide(self.mode, &facts) {
            // Known and unchanged, or outside the window. Never stop on the
            // first match: the portal reorders rows; ten in a row is the signal.
            Decision::Skip { quiet, older } => self.quiet_skip(quiet, older),
            Decision::Index => {
                self.streak = 0;
                if !facts.unchanged { self.counts.changed += 1; }
                self.counts.indexed += 1;
                if let Err(e) = self.absorb(&card, Some(&notice)) { self.errors.push(e); self.publish(); return Verdict::Skip; }
                if facts.wants_doc && !facts.has_doc {
                    if let Ok(con) = self.db.lock() {
                        if let Ok(Some(c)) = proceedings::communication_by_reference(&con, &notice.ref_id) {
                            if let Err(e) = crate::repo::rows::with_sweep_context(||
                                scopes::mark_pending(&con, "communication", &c.id, "communication", &notice.ref_id)) {
                                self.errors.push(e.to_string());
                            }
                        }
                    }
                }
                self.indexed = Some(notice.ref_id);
                self.publish();
                Verdict::Index
            }
            Decision::Fetch => {
                // Document first: the row is written when the bytes arrive.
                self.streak = 0;
                if !facts.unchanged { self.counts.changed += 1; }
                self.pending = Some((card, n.clone()));
                Verdict::Fetch
            }
        }
    }

    fn on_item(&mut self, item: WorkItemDetail) {
        let no_bytes = item.pdf.as_ref().map(|b| b.is_empty()).unwrap_or(true)
            && item.receipt.as_ref().map(|b| b.is_empty()).unwrap_or(true);
        if no_bytes && self.pending.is_none() && self.indexed.as_deref() == Some(item.reference_id.as_str()) {
            // The answer to `index`: the row and its pending document are
            // already written.
            self.indexed = None;
            return;
        }
        let Some((card, n)) = self.pending.take() else {
            self.errors.push(format!("an item arrived with nothing pending ({})", item.reference_id));
            return;
        };
        self.found.insert(item.reference_id.clone());
        if card.tab.is_empty() {
            // A module card (return or form): the pair rule applies.
            let module = if n.contains_key("return_type") || n.contains_key("verification_status") { "returns" } else { "forms" };
            if let Err(e) = self.absorb_module(module, &n, item.pdf, item.receipt) { self.errors.push(e); return; }
            if !no_bytes { self.counts.fetched += 1; }
            self.counts.changed += 1;
            self.publish();
            return;
        }
        let got_pdf = item.pdf.as_ref().map(|b| !b.is_empty()).unwrap_or(false);
        let notice = notice_from(&n, item.pdf);
        // The blob is stored before the rows inside one transaction (intake
        // hashes and stores it before attaching); a row never points at a
        // document that was not written.
        if let Err(e) = self.absorb(&card, Some(&notice)) {
            self.errors.push(e);
            return;
        }
        if got_pdf {
            self.counts.fetched += 1;
        } else {
            // The portal gave no file: make the absence visible as a failed
            // document node rather than an absent one.
            if let Ok(con) = self.db.lock() {
                if let Ok(Some(c)) = proceedings::communication_by_reference(&con, &notice.ref_id) {
                    if let Ok(d) = documents::ensure_pending(&con, "communication", &c.id, "communication") {
                        let mut d = d;
                        if d.state != "stored" {
                            d.state = "failed".into();
                            d.updated_at = now();
                            let _ = crate::repo::rows::upsert(&con, "documents", &d);
                        }
                    }
                }
            }
            if let Some(note) = item.note { self.errors.push(format!("{}: {note}", notice.ref_id)); }
        }
        self.publish();
    }

    fn on_challenge(&mut self, challenge: &Challenge) {
        let c = challenge.clone();
        state::update(self.shared, |st| { st.awaiting_operator = Some(c); st.phase = Some("awaiting_operator".into()); });
        // The job is paused, not failed: the queue waits for a person.
        if let Ok(con) = self.db.lock() {
            if let Some(job_id) = state::snapshot(self.shared).job_id {
                let _ = queue::set_job_status(&con, &job_id, "awaiting_operator", None);
            }
        }
        let _ = self.app.emit("ingestion", json!({"ev": "challenge", "kind": challenge.kind, "scope": self.scope}));
        crate::commands::ingestion::notify(self.app, "The portal needs you",
            &format!("A {} is waiting on the Sync screen. The run pauses until it is entered.", challenge.kind));
    }

    fn on_log(&mut self, level: &str, msg: &str) {
        let _ = self.app.emit("ingestion", json!({"ev": "log", "level": level, "msg": msg, "scope": self.scope}));
    }
}

/// Everything the commands need to steer a run in flight.
pub struct RunHandle {
    pub sweep_id: String,
    pub controls: Controls,
    pub sidecar: Arc<Mutex<Option<SidecarHandle>>>,
}

/// What a job's session came to.
#[derive(Debug, Default)]
struct JobOutcome {
    /// Anything new or different was recorded; false when the probe matched.
    changed: bool,
}

pub struct Runner<R: tauri::Runtime> {
    pub app: AppHandle<R>,
    pub db: Arc<Mutex<Connection>>,
    pub shared: Shared,
    pub controls: Controls,
    pub sidecar: Arc<Mutex<Option<SidecarHandle>>>,
    pub sweep_id: String,
    pub device_id: String,
    /// A whole-book sweep needs the collector lease when a relay is
    /// configured; a single-client refresh does not (docs/04).
    pub whole_book: bool,
    /// The scope row, parsed (docs/17 §1).
    pub scope: SweepScope,
    pub settings: Schedule,
    pub mode: Mode,
    /// Scheduled runs stop at the window end (IST); others have none.
    pub deadline: Option<chrono::NaiveDateTime>,
    pub started: std::time::Instant,
    pub window_closed: Arc<AtomicBool>,
    /// Item fetch: the one proceeding and panel to walk.
    pub item: Option<scopes::ItemPlan>,
    /// Deep fetch: the request being worked.
    pub deep: Option<scopes::DeepFetchRequest>,
}

/// Lease renewal cadence (Q06): every 60 minutes while the run is alive.
const LEASE_RENEW_SECONDS: u64 = 60 * 60;

/// Pages of listing a probe hashes (Q42).
const PROBE_PAGES: u32 = 2;

/// The warm cache runs only with at least this share of the window left (§2.6).
const WARM_BUDGET_SHARE: f64 = 0.2;

/// A background task that must not outlive its scope, whatever path
/// leaves it: the renewal loop stops even if the session panics.
struct AbortOnDrop(tokio::task::JoinHandle<()>);
impl Drop for AbortOnDrop {
    fn drop(&mut self) { self.0.abort(); }
}

/// The mode a sweep row runs in, from its scope and the settings.
pub fn mode_for(scope: &SweepScope, settings: &Schedule, deep: Option<&scopes::DeepFetchRequest>,
                item: Option<&scopes::ItemPlan>) -> Mode {
    let today = scheduler::ist_now().date();
    match scope.kind {
        RunKind::Sweep => Mode::Sweep {
            today, lookback_days: settings.lookback_days as i64, download: settings.docs_policy == "download",
        },
        RunKind::Deep => {
            let (min_ay_start, since) = match deep.map(|d| (d.depth.as_str(), d.depth_value.as_deref())) {
                Some(("years", Some(n))) => (n.parse::<i32>().ok().map(|n| decide::latest_ay_start(today) - n + 1), None),
                Some(("since", Some(d))) => (None, chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").ok()),
                _ => (None, None),
            };
            Mode::Deep { download: deep.map(|d| d.docs_policy == "download").unwrap_or(false), min_ay_start, since }
        }
        RunKind::Item => Mode::Item { targets: item.map(|i| i.targets.iter().cloned().collect()).unwrap_or_default() },
    }
}

impl<R: tauri::Runtime> Runner<R> {
    /// A runner for one sweep row: its scope, the settings and, for deep
    /// and item runs, the request or plan it serves.
    #[allow(clippy::too_many_arguments)]
    pub fn for_sweep(app: AppHandle<R>, db: Arc<Mutex<Connection>>, shared: Shared, controls: Controls,
                     sidecar: Arc<Mutex<Option<SidecarHandle>>>, sweep_id: String, device_id: String) -> Self {
        let (scope, settings, deep, item) = {
            let con = db.lock().ok();
            let scope = con.as_ref().and_then(|c| queue::scope_of(c, &sweep_id).ok())
                .unwrap_or_else(|| SweepScope::sweep(queue::Scope::All));
            let settings = con.as_ref().and_then(|c| scheduler::get(c).ok()).unwrap_or_default();
            let deep = scope.deep_request_id.as_deref()
                .and_then(|id| con.as_ref().and_then(|c| scopes::deep(c, id).ok().flatten()));
            let item = scope.item.as_ref()
                .and_then(|t| con.as_ref().and_then(|c| scopes::item_plan(c, &t.module, &t.id).ok()));
            (scope, settings, deep, item)
        };
        let mode = mode_for(&scope, &settings, deep.as_ref(), item.as_ref());
        let deadline = scope.scheduled.then(|| scheduler::window_end_after(&settings, scheduler::ist_now())).flatten();
        Runner {
            app, db, shared, controls, sidecar, sweep_id, device_id, whole_book: scope.whole_book(),
            scope, settings, mode, deadline, started: std::time::Instant::now(),
            window_closed: Arc::new(AtomicBool::new(false)), item, deep,
        }
    }

    /// A runner for another sweep row inside this run (a deep request or an
    /// item fetch after the nightly sweep): same controls, window and screen.
    fn child(&self, sweep_id: String) -> Self {
        let mut r = Runner::for_sweep(self.app.clone(), self.db.clone(), self.shared.clone(), self.controls.clone(),
                                      self.sidecar.clone(), sweep_id, self.device_id.clone());
        r.deadline = self.deadline;
        r.started = self.started;
        r.window_closed = self.window_closed.clone();
        r
    }

    fn kind(&self) -> &'static str { self.scope.kind.as_str() }

    fn log(&self, level: &str, msg: &str) {
        let _ = self.app.emit("ingestion", json!({"ev": "log", "level": level, "msg": msg, "scope": self.kind()}));
    }

    fn publish(&self) {
        let _ = self.app.emit("ingestion", json!({"ev": "state", "scope": self.kind()}));
    }

    fn password_for(&self, login_ref: &str) -> Option<String> {
        crate::keychain::load_portal_password(login_ref).ok().flatten()
    }

    fn relay(&self) -> Option<crate::relay::Relay> {
        let con = self.db.lock().ok()?;
        crate::relay::config(&con).ok().flatten().map(crate::relay::Relay::new)
    }

    /// Past the scheduled window's end (IST)? Latches, so every check after
    /// the first agrees.
    fn window_over(&self) -> bool {
        if self.window_closed.load(Ordering::Relaxed) { return true; }
        let over = self.deadline.map(|d| scheduler::ist_now() >= d).unwrap_or(false);
        if over { self.window_closed.store(true, Ordering::Relaxed); }
        over
    }

    /// Share of the window still ahead; 1.0 without a window.
    fn budget_left(&self) -> f64 {
        let Some(deadline) = self.deadline else { return 1.0; };
        let now = scheduler::ist_now();
        let total = self.started.elapsed().as_secs_f64() + (deadline - now).num_seconds().max(0) as f64;
        if total <= 0.0 { 0.0 } else { (deadline - now).num_seconds().max(0) as f64 / total }
    }

    /// Whole-book sweeps under a relay: sync to current first, then claim
    /// the lease; refuse without it. Returns the renewal task to abort.
    async fn take_lease(&self) -> Result<Option<tokio::task::JoinHandle<()>>, String> {
        let Some(relay) = self.relay() else { return Ok(None); };
        if !self.whole_book { return Ok(None); }
        self.log("info", "syncing to current before the sweep");
        if let Err(e) = crate::sync::sync_now(&self.db).await {
            self.log("warn", &format!("sync before the sweep failed: {e}"));
        }
        relay.claim_lease().await.map_err(|e| format!("this device does not hold the collector lease: {e}"))?;
        self.log("info", "collector lease held");
        // Refresh requests other devices queued for ERI clients go first.
        if let Ok(keys) = relay.take_refresh_requests().await {
            if !keys.is_empty() {
                if let Ok(con) = self.db.lock() {
                    let mut logins = Vec::new();
                    for c in clients::list(&con).unwrap_or_default() {
                        let login = c.portal_login_ref.clone().unwrap_or(c.pan.clone());
                        if let Ok(k) = crate::relay::client_key(&login) {
                            if keys.contains(&k) { logins.push((login, Some(c.id))); }
                        }
                    }
                    let n = queue::prepend_jobs(&con, &self.sweep_id, &logins, queue::MODULES).unwrap_or(0);
                    if n > 0 { self.log("info", &format!("{n} refresh request(s) from other devices queued first")); }
                }
            }
        }
        // Renew hourly; a renewal that says we are no longer the nominee
        // drains the current client and stops (the handoff, docs/04).
        let controls = self.controls.clone();
        let app = self.app.clone();
        let handle = tokio::spawn(async move {
            loop {
                tokio::time::sleep(std::time::Duration::from_secs(LEASE_RENEW_SECONDS)).await;
                match relay.claim_lease().await {
                    Ok(true) => {}
                    Ok(false) => {
                        let _ = app.emit("ingestion", json!({"ev": "log", "level": "warn",
                            "msg": "another device was nominated as collector; finishing this client, then stopping"}));
                        controls.stopping.store(true, std::sync::atomic::Ordering::Relaxed);
                        break;
                    }
                    Err(e) => {
                        let _ = app.emit("ingestion", json!({"ev": "log", "level": "warn", "msg": format!("lease renewal failed: {e}")}));
                    }
                }
            }
        });
        Ok(Some(handle))
    }

    /// The whole run (docs/17 §2): the jobs of this sweep row, then — for a
    /// scheduled whole-book sweep — the deep queue and the warm cache, then
    /// any item fetch that waited for the session, then the summary.
    pub async fn run(self) {
        self.log("info", &format!("{} started, sweep {}", self.kind(), &self.sweep_id[..8.min(self.sweep_id.len())]));
        // docs/19 §3.1: the `public` step — the portal's public calendar,
        // no credentials, no lock, no charge against the client budget.
        if self.scope.scheduled && self.whole_book {
            let due = self.db.lock().ok().and_then(|con| {
                let first = self.settings.days.iter().copied().min();
                crate::statutory::fetch_due(&con, scheduler::ist_now().date(), first).ok()
            }).unwrap_or(false);
            if due {
                match crate::statutory::fetch::refresh(&self.db, scheduler::ist_now().date()).await {
                    Ok(outcomes) => for o in outcomes {
                        self.log("info", &format!("public calendar {}: {} ({} added, {} extended, {} removed)", o.year, o.status, o.added, o.extended, o.removed));
                    },
                    Err(e) => self.log("warn", &format!("public calendar fetch failed: {e}")),
                }
            }
        }
        let renewal = match self.take_lease().await {
            Ok(h) => h,
            Err(e) => {
                self.log("error", &e);
                if let Ok(con) = self.db.lock() {
                    let _ = queue::cancel_open_jobs(&con, &self.sweep_id);
                    let _ = queue::set_sweep_status(&con, &self.sweep_id, "failed");
                }
                if let Some(d) = &self.deep { self.finish_deep(d, Some(&e)); }
                state::update(&self.shared, |st| { st.running = false; st.phase = Some("failed".into()); st.last_error = Some(e); st.finished_at = Some(now()); });
                self.publish();
                return;
            }
        };
        if let Some(d) = &self.deep {
            if let Ok(con) = self.db.lock() { let _ = scopes::set_deep_status(&con, &d.id, "running", None); }
        }
        self.run_jobs().await;
        if let Some(d) = &self.deep {
            let err = self.unfinished_error();
            self.finish_deep(d, err.as_deref());
        }

        let mut deep_done = 0i64;
        let mut warm_cached = 0i64;
        let overnight = self.scope.scheduled && self.whole_book;
        if !self.controls.stopping() && !self.window_over() {
            // `Run now` requests that found this run holding the session.
            deep_done += self.drain_deep_queue("now").await;
        }
        if overnight && !self.controls.stopping() && !self.window_over() {
            deep_done += self.drain_deep_queue("tonight").await;
        }
        if !self.controls.stopping() && !self.window_over() {
            self.run_queued_item_fetches().await;
        }
        if overnight && self.settings.warm_cache_days > 0 && !self.controls.stopping() && !self.window_over()
            && self.budget_left() >= WARM_BUDGET_SHARE {
            warm_cached = self.warm_cache().await;
        }

        let window_closed = self.window_closed.load(Ordering::Relaxed);
        let status = if self.controls.stopping() || window_closed { "stopped" } else { "done" };
        let summary = {
            let con = self.db.lock().ok();
            con.as_ref().map(|con| {
                // A stop by the operator cancels what is left; a closed window
                // keeps it for tomorrow night (§2.7).
                if self.controls.stopping() { let _ = queue::cancel_open_jobs(con, &self.sweep_id); }
                let _ = queue::set_sweep_status(con, &self.sweep_id, status);
                let summary = self.summary(con, deep_done, warm_cached, window_closed);
                if self.scope.kind == RunKind::Sweep { let _ = queue::write_summary(con, &self.sweep_id, &summary); }
                summary
            })
        };
        if let Some(h) = renewal { h.abort(); }
        if let Some(relay) = self.relay() {
            // Publish what the sweep wrote, then let go of the lease.
            if let Err(e) = crate::sync::sync_now(&self.db).await { self.log("warn", &format!("publish after the sweep failed: {e}")); }
            if self.whole_book { let _ = relay.release_lease().await; }
        }
        state::update(&self.shared, |st| {
            st.running = false; st.paused = false; st.phase = Some(if window_closed { "window closed".into() } else { status.into() });
            st.awaiting_operator = None; st.panel = None; st.finished_at = Some(now());
        });
        self.log("info", &format!("run {status}{}", if window_closed { " · window closed" } else { "" }));
        self.publish();
        let _ = self.app.emit("ingestion", json!({"ev": "summary", "scope": self.kind(), "summary": summary}));
        let body = match (&summary, self.scope.kind) {
            (Some(s), RunKind::Sweep) => format!("Swept {}, skipped {} unchanged, {} failed.",
                s["swept"], s["skipped_unchanged"], s["failed"]),
            _ => {
                let counts = state::snapshot(&self.shared).counts;
                format!("{} notices seen, {} fetched, {} indexed.", counts.notices, counts.fetched, counts.indexed)
            }
        };
        let title = match self.scope.kind { RunKind::Sweep => "Sweep", RunKind::Deep => "History fetch", RunKind::Item => "Document fetch" };
        crate::commands::ingestion::notify(&self.app, &format!("{title} {status}"), &body);
    }

    /// Workers pull jobs until the queue is empty, a stop is requested, or
    /// the window closes.
    pub async fn run_jobs(&self) {
        let workers: Vec<_> = (0..INGESTION_WORKERS.max(1)).map(|_| self.worker()).collect();
        futures_join_all(workers).await;
    }

    /// §2.8, from this sweep's jobs, one count per login.
    fn summary(&self, con: &Connection, deep_done: i64, warm_cached: i64, window_closed: bool) -> Value {
        let jobs = queue::jobs(con, &self.sweep_id).unwrap_or_default();
        let mut by_login: HashMap<&str, Vec<&Job>> = HashMap::new();
        for j in &jobs { by_login.entry(j.login_ref.as_str()).or_default().push(j); }
        let (mut swept, mut skipped, mut failed, mut parked) = (0, 0, 0, 0);
        for js in by_login.values() {
            if js.iter().any(|j| j.status == "parked") { parked += 1; }
            else if js.iter().any(|j| j.status == "failed" || (j.status == "queued" && j.attempts > 0)) { failed += 1; }
            else if js.iter().all(|j| j.status == "done") {
                if js.iter().all(|j| j.cursor().unchanged) { skipped += 1; } else { swept += 1; }
            }
        }
        // docs/18 §7: what the run indexed, and the AO-viewed flips it saw
        // (the `ao_viewed` events written since the sweep started).
        let started_at: String = con.query_row("SELECT started_at FROM ingestion_sweeps WHERE id = ?1", [&self.sweep_id], |r| r.get(0))
            .unwrap_or_default();
        let indexed: i64 = con.query_row(
            "SELECT coalesce(sum(coalesce(json_extract(gaps, '$.indexed'), 0)), 0) FROM ingestion_runs
              WHERE run_at >= ?1 AND scope = 'sweep' AND json_valid(gaps)", [&started_at], |r| r.get(0)).unwrap_or(0);
        let ao_viewed_flips: i64 = con.query_row(
            "SELECT count(*) FROM proceeding_events WHERE kind = 'ao_viewed' AND at >= ?1", [&started_at], |r| r.get(0)).unwrap_or(0);
        json!({
            "swept": swept, "skipped_unchanged": skipped, "failed": failed, "parked": parked,
            "deep_done": deep_done, "warm_cached": warm_cached, "indexed": indexed, "ao_viewed_flips": ao_viewed_flips,
            "duration_s": self.started.elapsed().as_secs(), "window_closed": window_closed,
        })
    }

    /// A deep or item run failed when any job did not finish.
    fn unfinished_error(&self) -> Option<String> {
        let con = self.db.lock().ok()?;
        let jobs = queue::jobs(&con, &self.sweep_id).ok()?;
        let bad = jobs.iter().find(|j| j.status != "done")?;
        // No automatic retry for deep or item runs (§2.4): cancel the backoff.
        let _ = queue::cancel_open_jobs(&con, &self.sweep_id);
        Some(bad.last_error.clone().unwrap_or_else(|| format!("stopped at {}", bad.status)))
    }

    /// Completion of a deep request: depth on the client, or failure with
    /// the depth unchanged (§2.4).
    fn finish_deep(&self, req: &scopes::DeepFetchRequest, error: Option<&str>) {
        let Ok(con) = self.db.lock() else { return; };
        match error {
            None => {
                let _ = scopes::set_deep_status(&con, &req.id, "done", None);
                if let Err(e) = scopes::record_history(&con, req) { self.log("warn", &format!("history not recorded: {e}")); }
            }
            Some(e) => { let _ = scopes::set_deep_status(&con, &req.id, "failed", Some(e)); }
        }
    }

    /// §2.4 queued requests of one mode, oldest first, one at a time,
    /// inside the window.
    async fn drain_deep_queue(&self, mode: &str) -> i64 {
        let mut done = 0;
        loop {
            if self.controls.stopping() || self.window_over() { break; }
            let next = { let Ok(con) = self.db.lock() else { break; }; scopes::next_queued(&con, mode).ok().flatten() };
            let Some(req) = next else { break; };
            let sweep = {
                let Ok(con) = self.db.lock() else { break; };
                let modules: Vec<&str> = req.modules.iter().map(String::as_str).collect();
                let scope = SweepScope { kind: RunKind::Deep, selector: queue::Scope::Client { client_id: req.client_id.clone() },
                                         scheduled: self.scope.scheduled, deep_request_id: Some(req.id.clone()), item: None };
                match queue::create_sweep_scoped(&con, &self.device_id, &scope, &modules) {
                    Ok(s) => s,
                    Err(e) => { let _ = scopes::set_deep_status(&con, &req.id, "failed", Some(&e.to_string())); continue; }
                }
            };
            self.log("info", &format!("history fetch for {}", req.client_name.as_deref().map(mask::text).unwrap_or_default()));
            let child = self.child(sweep.id.clone());
            if let Ok(con) = self.db.lock() { let _ = scopes::set_deep_status(&con, &req.id, "running", None); }
            child.run_jobs().await;
            let err = child.unfinished_error();
            // A closed window leaves the request queued for tomorrow, first.
            if self.window_closed.load(Ordering::Relaxed) && err.is_some() {
                if let Ok(con) = self.db.lock() {
                    let _ = con.execute("UPDATE deep_fetch_requests SET status = 'queued', started_at = NULL WHERE id = ?1", [&req.id]);
                    let _ = queue::set_sweep_status(&con, &sweep.id, "stopped");
                }
                break;
            }
            child.finish_deep(&req, err.as_deref());
            if let Ok(con) = self.db.lock() { let _ = queue::set_sweep_status(&con, &sweep.id, if err.is_some() { "failed" } else { "done" }); }
            if err.is_none() { done += 1; }
        }
        done
    }

    /// One item fetch as its own sweep row inside this run.
    async fn item_fetch(&self, module: &str, id: &str) -> bool {
        let sweep = {
            let Ok(con) = self.db.lock() else { return false; };
            let Ok(plan) = scopes::item_plan(&con, module, id) else { return false; };
            let scope = SweepScope { kind: RunKind::Item, selector: queue::Scope::Client { client_id: plan.client_id.clone() },
                                     scheduled: self.scope.scheduled, deep_request_id: None,
                                     item: Some(queue::ItemTarget { module: module.into(), id: id.into() }) };
            match queue::create_sweep_scoped(&con, &self.device_id, &scope, &[plan.module.as_str()]) {
                Ok(s) => s,
                Err(_) => return false,
            }
        };
        let child = self.child(sweep.id.clone());
        child.run_jobs().await;
        let err = child.unfinished_error();
        if let Ok(con) = self.db.lock() { let _ = queue::set_sweep_status(&con, &sweep.id, if err.is_some() { "failed" } else { "done" }); }
        err.is_none()
    }

    async fn run_queued_item_fetches(&self) {
        let queued = { let Ok(con) = self.db.lock() else { return; }; scopes::take_item_fetches(&con).unwrap_or_default() };
        for (module, id) in queued {
            if self.controls.stopping() || self.window_over() {
                if let Ok(con) = self.db.lock() { let _ = scopes::queue_item_fetch(&con, &module, &id); }
                continue;
            }
            self.item_fetch(&module, &id).await;
        }
    }

    /// §2.6: pending documents of open items due soon, soonest first, while
    /// the window stays open.
    async fn warm_cache(&self) -> i64 {
        let items = {
            let Ok(con) = self.db.lock() else { return 0; };
            scopes::warm_candidates(&con, self.settings.warm_cache_days, scheduler::ist_now().date()).unwrap_or_default()
        };
        let mut n = 0;
        for (module, id) in items {
            if self.controls.stopping() || self.window_over() { break; }
            if self.item_fetch(&module, &id).await { n += 1; }
        }
        n
    }

    /// Claim the next job atomically (so two workers never take the same
    /// one), run it, repeat.
    async fn worker(&self) {
        loop {
            if self.controls.stopping() { break; }
            // Between clients: past the window end, stop cleanly (§2.7).
            if self.window_over() { self.log("info", "the run window has closed; the rest waits for the next night"); break; }
            let job = {
                let con = match self.db.lock() { Ok(c) => c, Err(_) => break };
                match queue::next_job(&con, &self.sweep_id) {
                    Ok(Some(j)) => { let _ = queue::set_job_status(&con, &j.id, "running", None); Some(j) }
                    Ok(None) => None,
                    Err(e) => { self.log("error", &e.to_string()); break; }
                }
            };
            let Some(job) = job else { break; };
            self.run_job(&job).await;
            // A stop request during a job ends the run after that job.
            if self.controls.stopping() { break; }
        }
    }

    async fn run_job(&self, job: &Job) {
        let (position, total, client_name) = {
            let con = match self.db.lock() { Ok(c) => c, Err(_) => return };
            let (pending, total) = queue::pending_count(&con, &self.sweep_id).unwrap_or((0, 0));
            let name = job.client_id.as_deref().and_then(|id| clients::get(&con, id).ok().flatten()).map(|c| c.name);
            (total - pending + 1, total, name)
        };
        state::update(&self.shared, |st| {
            st.job_id = Some(job.id.clone());
            st.scope = Some(self.kind().into());
            st.current_login_ref_masked = Some(mask::pan(&job.login_ref));
            st.current_client_id = job.client_id.clone();
            st.current_client_name = client_name.clone();
            st.queue_position = position; st.queue_total = total;
            st.module = Some(job.module.clone()); st.panel = None; st.phase = Some("starting".into());
            st.counts = Counts::default(); st.last_error = None; st.awaiting_operator = None;
        });
        self.publish();
        if let Ok(con) = self.db.lock() { let _ = queue::set_job_status(&con, &job.id, "started", None); }

        // The per-login lock: one live session per taxpayer, ever. The relay
        // arbitrates it across devices; without a relay it is local.
        let locked = match self.relay() {
            Some(relay) => relay.acquire_lock(&job.login_ref).await.unwrap_or(false),
            None => self.db.lock().ok().and_then(|con| queue::acquire_lock(&con, &job.login_ref, &self.device_id).ok()).unwrap_or(false),
        };
        if !locked {
            self.log("warn", "this login is in use by another device; the job will retry later");
            if let Ok(con) = self.db.lock() { let _ = queue::schedule_retry(&con, job, "login in use elsewhere"); }
            return;
        }

        let Some(password) = self.password_for(&job.login_ref) else {
            self.log("warn", "no password in the keychain for this login; the job is parked");
            if let Ok(con) = self.db.lock() {
                let _ = queue::set_job_status(&con, &job.id, "parked", Some("no password stored"));
                let _ = queue::release_lock(&con, &job.login_ref, &self.device_id);
                self.record_run(&con, job, None, 0, "credentials_parked", json!({"reason": "no password stored"}), None);
            }
            return;
        };

        // A session can outlive the lock (six panels plus documents), so
        // the lock is renewed at half its life until the session ends
        // (task 4.5: five minutes, renewable).
        let _renew = AbortOnDrop(self.spawn_lock_renewal(&job.login_ref));
        let outcome = self.run_session(job, &password).await;
        match self.relay() {
            Some(relay) => { let _ = relay.release_lock(&job.login_ref).await; }
            None => { if let Ok(con) = self.db.lock() { let _ = queue::release_lock(&con, &job.login_ref, &self.device_id); } }
        }
        match outcome {
            Ok(o) => {
                if let Ok(con) = self.db.lock() {
                    let _ = queue::set_job_status(&con, &job.id, "done", None);
                    if self.scope.kind == RunKind::Sweep {
                        // The tier follows what this sweep found (§2.5), for
                        // every client the login reaches.
                        for id in login_clients(&con, &job.login_ref) {
                            let _ = crate::repo::rows::with_sweep_context(||
                                scopes::after_client_sweep(&con, &id, o.changed, self.settings.dormant_after_days));
                        }
                    }
                }
            }
            Err(SourceError::WrongPassword) => {
                // Parked immediately, never retried in this run: repeated
                // attempts lock a taxpayer out of their own account.
                self.log("error", "the portal rejected the password; credentials need attention");
                if let Ok(con) = self.db.lock() {
                    let _ = queue::set_job_status(&con, &job.id, "parked", Some("wrong password"));
                    self.record_run(&con, job, None, 0, "credentials_parked", json!({"reason": "wrong password"}), None);
                }
                state::update(&self.shared, |st| st.last_error = Some("credentials need attention".into()));
            }
            Err(e @ (SourceError::WindowClosed | SourceError::TimedOut(_))) => {
                // Not a failure: the cursor is saved and the job resumes (§2.7).
                let msg = e.to_string();
                self.log("warn", &format!("client {msg}; the cursor is saved"));
                if let Ok(con) = self.db.lock() { let _ = queue::set_job_status(&con, &job.id, "incomplete", Some(&msg)); }
            }
            Err(e) => {
                let msg = e.to_string();
                self.log("error", &msg);
                if let Ok(con) = self.db.lock() {
                    if self.controls.stopping() {
                        let _ = queue::set_job_status(&con, &job.id, "incomplete", Some(&msg));
                    } else if self.scope.kind == RunKind::Sweep {
                        let _ = queue::schedule_retry(&con, job, &msg);
                    } else {
                        // Deep and item runs are never retried on their own (§2.4).
                        let _ = queue::set_job_status(&con, &job.id, "failed", Some(&msg));
                    }
                }
                state::update(&self.shared, |st| st.last_error = Some(msg));
            }
        }
        self.publish();
    }

    fn spawn_lock_renewal(&self, login_ref: &str) -> tokio::task::JoinHandle<()> {
        let relay = self.relay();
        let db = self.db.clone();
        let device_id = self.device_id.clone();
        let login_ref = login_ref.to_string();
        let app = self.app.clone();
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(std::time::Duration::from_secs((queue::LOCK_SECONDS / 2) as u64)).await;
                let kept = match &relay {
                    // Re-acquiring by the same holder extends the relay's lock.
                    Some(relay) => relay.acquire_lock(&login_ref).await.unwrap_or(false),
                    None => db.lock().ok().and_then(|con| queue::renew_lock(&con, &login_ref, &device_id).ok()).unwrap_or(false),
                };
                if !kept {
                    let _ = app.emit("ingestion", json!({"ev": "log", "level": "warn",
                        "msg": "the per-login lock could not be renewed; another device may open this session"}));
                }
            }
        })
    }

    async fn run_session(&self, job: &Job, password: &str) -> Result<JobOutcome, SourceError> {
        state::update(&self.shared, |st| st.phase = Some("starting sidecar".into()));
        self.publish();
        // The engine follows the client, never a global switch (docs/06).
        let eri = {
            let con = self.db.lock().map_err(|e| SourceError::Other(e.to_string()))?;
            job.client_id.as_deref().and_then(|id| clients::get(&con, id).ok().flatten())
                .map(|c| c.source == "eri").unwrap_or(false)
        };
        let mut source: Box<dyn NoticeSource> = if eri {
            Box::new(crate::ingest::eri_source::EriSource)
        } else {
            let portal = PortalSource::spawn(self.app.clone(), self.controls.clone(), self.kind()).await?;
            // Expose the handle so a challenge answer can reach the sidecar.
            if let Ok(mut h) = self.sidecar.lock() { *h = Some(portal.handle()); }
            Box::new(portal)
        };
        let result = self.drive(&mut *source, job, password).await;
        source.logout().await;
        if let Ok(mut h) = self.sidecar.lock() { *h = None; }
        result
    }

    /// The panel loop against any engine; the tests drive a mock through it.
    #[cfg(test)]
    pub async fn drive_for_test(&self, source: &mut dyn NoticeSource, job: &Job, password: &str) -> Result<(), SourceError> {
        self.drive(source, job, password).await.map(|_| ())
    }

    /// §2.2: `Some(hashes)` when the client may be skipped or its hashes
    /// kept, with `unchanged` true only when every panel matched a stored
    /// hash. `None` when no probe applies (not a sweep, or open items).
    async fn probe(&self, source: &mut dyn NoticeSource, job: &Job, module: Module, panels: &[&str])
        -> Result<Option<(bool, Vec<ProbeResult>)>, SourceError> {
        if self.scope.kind != RunKind::Sweep { return Ok(None); }
        let (stored, open) = {
            let con = self.db.lock().map_err(|e| SourceError::Other(e.to_string()))?;
            (scopes::probe_hashes(&con, &job.login_ref).unwrap_or_default(),
             module == Module::Proceedings && scopes::login_has_open_items(&con, &job.login_ref).unwrap_or(true))
        };
        if open { return Ok(None); }
        state::update(&self.shared, |st| st.phase = Some("probing".into()));
        self.publish();
        let mut results = Vec::new();
        let mut all_same = true;
        for panel in panels {
            match source.probe(module, panel, PROBE_PAGES).await {
                Ok(r) => {
                    // Never skip on a first sweep or a failed probe.
                    let same = r.list_hash.is_some() && stored.get(*panel) == r.list_hash.as_ref();
                    all_same &= same;
                    results.push(r);
                }
                Err(SourceError::SessionLost(m)) => return Err(SourceError::SessionLost(m)),
                Err(e) => {
                    self.log("warn", &format!("probe {panel} failed ({e}); sweeping the client"));
                    return Ok(None);
                }
            }
        }
        Ok(Some((all_same && !results.is_empty(), results)))
    }

    async fn drive(&self, source: &mut dyn NoticeSource, job: &Job, password: &str) -> Result<JobOutcome, SourceError> {
        let job_started = std::time::Instant::now();
        let scope_str = self.kind();
        let mut sink = PanelSink {
            db: &self.db, app: &self.app, shared: &self.shared, login_pan: &job.login_ref, mode: &self.mode,
            scope: scope_str, action_panel: false,
            streak: 0, pending: None, indexed: None, counts: Counts::default(), low_confidence: HashMap::new(),
            errors: Vec::new(), older: 0, found: std::collections::HashSet::new(),
        };
        state::update(&self.shared, |st| st.phase = Some("logging in".into()));
        self.publish();
        source.login(&LoginRef { login_ref: job.login_ref.clone() }, password, &mut sink).await?;
        state::update(&self.shared, |st| { st.awaiting_operator = None; st.phase = Some("sweeping".into()); });
        self.publish();

        let module = Module::parse(&job.module).unwrap_or(Module::Proceedings);
        let mut cursor = job.cursor();
        let panels: Vec<&str> = match &self.item {
            // An item fetch walks the one panel its proceeding lives on.
            Some(plan) => vec![plan.panel.as_str()],
            None => panels_for(module),
        };
        source.set_target(self.item.as_ref().and_then(|p| p.proceeding.clone()));

        let todo: Vec<&str> = panels.iter().copied().filter(|p| !cursor.panels_done.iter().any(|d| d == p)).collect();
        let probed = if cursor.panels_done.is_empty() { self.probe(source, job, module, &todo).await? } else { None };
        if let Some((true, _)) = &probed {
            // Unchanged on every panel: done, and zero is still a finding.
            let con = self.db.lock().map_err(|e| SourceError::Other(e.to_string()))?;
            self.record_run(&con, job, None, 0, "ok", json!({"probe": "unchanged"}), Some("unchanged"));
            cursor.unchanged = true;
            cursor.panels_done = panels.iter().map(|p| p.to_string()).collect();
            queue::save_cursor(&con, &job.id, &cursor).map_err(|e| SourceError::Other(e.to_string()))?;
            self.log("info", "unchanged since the last sweep; skipped");
            return Ok(JobOutcome { changed: false });
        }

        let total = panels.len() as i64;
        state::update(&self.shared, |st| st.panel_total = total);
        let timeout_min = self.settings.client_timeout_min;
        for panel in panels.iter().copied() {
            if self.controls.stopping() { return Err(SourceError::Other("stopped by the operator".into())); }
            if cursor.panels_done.iter().any(|p| p == panel) { continue; }
            // Between panels: the window and the per-client timeout (§2.7).
            if self.window_over() { return Err(SourceError::WindowClosed); }
            if self.scope.kind == RunKind::Sweep && job_started.elapsed().as_secs() >= u64::from(timeout_min) * 60 {
                return Err(SourceError::TimedOut(timeout_min));
            }
            if sink.item_done() { break; }
            self.controls.wait_while_paused().await;
            state::update(&self.shared, |st| { st.panel = Some(panel.into()); st.paused = false; });
            self.publish();
            sink.streak = 0;
            sink.pending = None;
            sink.indexed = None;
            sink.older = 0;
            sink.action_panel = panel.ends_with(":action");
            sink.errors.clear();
            sink.low_confidence.clear();
            let before = sink.counts.clone();
            let result = source.list_work_items(module, panel, &mut sink).await;
            let con = self.db.lock().map_err(|e| SourceError::Other(e.to_string()))?;
            match result {
                Ok(r) => {
                    let found = if r.notices > 0 { r.notices } else { r.cards };
                    let status = if sink.errors.is_empty() { "ok" } else { "incomplete" };
                    let gaps = json!({
                        "missing_panel": r.missing.then_some(r.note.clone()),
                        "stopped_early": r.stopped_early,
                        "low_confidence": sink.low_confidence,
                        "errors": sink.errors,
                        "fetched": sink.counts.fetched - before.fetched,
                        "indexed": sink.counts.indexed - before.indexed,
                        "changed": sink.counts.changed - before.changed,
                        "older_than_window": sink.older,
                    });
                    self.record_run(&con, job, Some(panel), found, status, gaps, r.note.as_deref());
                    cursor.panels_done.push(panel.into());
                    queue::save_cursor(&con, &job.id, &cursor).map_err(|e| SourceError::Other(e.to_string()))?;
                    sink.counts.panels_done += 1;
                    let c = sink.counts.clone();
                    state::update(&self.shared, |st| st.counts = c);
                    self.publish();
                    // Roll up due dates for everything this login touched.
                    let _ = rollup_due_dates(&con);
                    if let Some(d) = &self.deep {
                        let _ = scopes::set_deep_progress(&con, &d.id, &json!({
                            "module": job.module, "panel": panel, "done": sink.counts.panels_done, "total": total }));
                    }
                }
                Err(e) => {
                    self.record_run(&con, job, Some(panel), 0, "failed", json!({"error": e.to_string()}), None);
                    return Err(e);
                }
            }
        }
        // The walk completed: keep tonight's hashes for tomorrow's probe.
        if let Some((_, results)) = probed {
            let con = self.db.lock().map_err(|e| SourceError::Other(e.to_string()))?;
            for r in results {
                if let Some(h) = &r.list_hash { let _ = scopes::save_probe(&con, &job.login_ref, &r.panel, h, r.rows); }
            }
        }
        Ok(JobOutcome { changed: sink.counts.changed > 0 || sink.counts.indexed > 0 || sink.counts.fetched > 0 })
    }

    #[allow(clippy::too_many_arguments)]
    fn record_run(&self, con: &Connection, job: &Job, panel: Option<&str>, found: i64, status: &str,
                  gaps: Value, notes: Option<&str>) {
        let run = IngestionRun {
            id: new_id(), run_at: now(), device_id: self.device_id.clone(), client_id: job.client_id.clone(),
            module: job.module.clone(), panel_swept: panel.map(str::to_string), records_found: found,
            gaps: Some(gaps.to_string()), operator: None, status: status.into(),
            notes: notes.map(str::to_string), created_at: now(), scope: self.kind().into(),
        };
        let _ = runs::record(con, &run);
    }
}

/// Every client a login lists (its own, and those it reaches as an AR).
fn login_clients(con: &Connection, login_ref: &str) -> Vec<String> {
    let Ok(mut st) = con.prepare("SELECT id FROM clients WHERE coalesce(portal_login_ref, pan) = ?1") else { return Vec::new(); };
    st.query_map([login_ref], |r| r.get(0)).map(|rows| rows.filter_map(Result::ok).collect()).unwrap_or_default()
}

/// Run the workers together without another dependency; each is a future
/// on this task, so a single worker is exactly the old sequential loop.
async fn futures_join_all<F: std::future::Future<Output = ()>>(futures: Vec<F>) {
    let mut futures: Vec<std::pin::Pin<Box<F>>> = futures.into_iter().map(Box::pin).collect();
    std::future::poll_fn(|cx| {
        futures.retain_mut(|f| f.as_mut().poll(cx).is_pending());
        if futures.is_empty() { std::task::Poll::Ready(()) } else { std::task::Poll::Pending }
    }).await;
}

fn rollup_due_dates(con: &Connection) -> crate::error::AppResult<()> {
    let mut st = con.prepare("SELECT id FROM proceedings WHERE status IN ('open','adjournment_sought','unknown')")?;
    let ids: Vec<String> = st.query_map([], |r| r.get(0))?.collect::<Result<_, _>>()?;
    for id in ids { proceedings::refresh_due_date(con, &id)?; }
    let _ = local::set(con, "last_sweep_rollup", &now());
    Ok(())
}
