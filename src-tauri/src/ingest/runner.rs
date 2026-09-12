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

use crate::ids::{new_id, now};
use crate::ingest::portal_source::{Controls, PortalSource, SidecarHandle};
use crate::ingest::source::*;
use crate::ingest::state::{self, Counts, Shared};
use crate::intake::{self, NoticeCard, ProceedingCard};
use crate::intake_modules::{self, DemandCard, DemandResponseCard, FormCard, PaymentCard, ReturnCard};
use crate::mask;
use crate::repo::model::{IngestionRun, Status};
use crate::repo::queue::{self, Job};
use crate::repo::{clients, documents, local, proceedings, runs};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::collections::HashMap;
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
        financial_year: s(p.get("financial_year")), applicable_act: s(p.get("applicable_act")),
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
    streak: u32,
    pending: Option<(ProceedingCard, HashMap<String, Value>)>,
    counts: Counts,
    low_confidence: HashMap<String, i64>,
    errors: Vec<String>,
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
        let _ = self.app.emit("ingestion", json!({"ev": "state"}));
    }
}

impl<'a, R: tauri::Runtime> PanelSink<'a, R> {
    /// Demands, returns and forms: one card per header, no notice level.
    fn on_module_header(&mut self, header: &WorkItemHeader) -> Verdict {
        self.counts.cards += 1;
        let p = &header.proceeding;
        let module = header.panel.as_str();
        let result: Result<(bool, bool), String> = (|| {
            let con = self.db.lock().map_err(|e| e.to_string())?;
            match module {
                "demands" => {
                    let card = demand_from(p);
                    drop(con);
                    let mut con = self.db.lock().map_err(|e| e.to_string())?;
                    let tx = con.transaction().map_err(|e| e.to_string())?;
                    crate::repo::rows::with_sweep_context(|| intake_modules::absorb_demand(&tx, Some(self.login_pan), &card))
                        .map_err(|e| e.to_string())?;
                    tx.commit().map_err(|e| e.to_string())?;
                    Ok((false, true))
                }
                "returns" | "forms" => {
                    let ack = s(p.get("acknowledgement_number")).ok_or("card has no acknowledgement number")?;
                    let (parent_type, exists) = if module == "returns" {
                        ("return", crate::repo::modules::return_by_ack(&con, &ack).map_err(|e| e.to_string())?.map(|r| r.id))
                    } else {
                        ("filed_form", crate::repo::modules::filed_form_by_ack(&con, &ack).map_err(|e| e.to_string())?.map(|f| f.id))
                    };
                    let stored = match &exists {
                        Some(id) => crate::repo::documents::for_parent(&con, parent_type, id).map_err(|e| e.to_string())?
                            .iter().filter(|d| d.state == "stored").count(),
                        None => 0,
                    };
                    let wants = p.get("has_pdf_button").and_then(Value::as_bool).unwrap_or(false);
                    // Fetch when the portal offers a file and the pair is not yet complete.
                    Ok((wants && stored < 2, stored >= 2 && exists.is_some()))
                }
                _ => Err(format!("unknown module panel {module}")),
            }
        })();
        match result {
            Ok((fetch, _)) if fetch => { self.pending = Some((ProceedingCard::default(), p.clone())); Verdict::Fetch }
            Ok((_, known)) => {
                if module != "demands" {
                    // Row without files to fetch: write it now.
                    if let Err(e) = self.absorb_module(module, p, None, None) { self.errors.push(e); }
                }
                if known { self.streak += 1; self.counts.skipped += 1; } else { self.streak = 0; self.counts.changed += 1; }
                self.publish();
                if self.streak >= EARLY_STOP_STREAK { Verdict::Stop } else { Verdict::Skip }
            }
            Err(e) => { self.errors.push(e); Verdict::Skip }
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
        match unchanged {
            Some(true) if has_doc => {
                // Known and unchanged. Never stop on the first match: the
                // portal reorders rows; ten in a row is the signal.
                self.streak += 1;
                self.counts.skipped += 1;
                self.publish();
                if self.streak >= EARLY_STOP_STREAK { Verdict::Stop } else { Verdict::Skip }
            }
            Some(true) => {
                // Row known, document never stored: fetch it.
                self.streak = 0;
                let wants_pdf = n.get("has_pdf_button").and_then(Value::as_bool).unwrap_or(true);
                if wants_pdf { self.pending = Some((card, n.clone())); Verdict::Fetch }
                else { self.publish(); Verdict::Skip }
            }
            _ => {
                // New or changed. Document first when there is one to fetch
                // and none stored; otherwise write the row now.
                self.streak = 0;
                self.counts.changed += 1;
                let wants_pdf = n.get("has_pdf_button").and_then(Value::as_bool).unwrap_or(true);
                if wants_pdf && !has_doc {
                    self.pending = Some((card, n.clone()));
                    Verdict::Fetch
                } else {
                    if let Err(e) = self.absorb(&card, Some(&notice)) { self.errors.push(e); }
                    self.publish();
                    Verdict::Skip
                }
            }
        }
    }

    fn on_item(&mut self, item: WorkItemDetail) {
        let Some((card, n)) = self.pending.take() else {
            self.errors.push(format!("an item arrived with nothing pending ({})", item.reference_id));
            return;
        };
        if card.tab.is_empty() {
            // A module card (return or form): the pair rule applies.
            let module = if n.contains_key("return_type") || n.contains_key("verification_status") { "returns" } else { "forms" };
            let got = item.pdf.as_ref().map(|b| !b.is_empty()).unwrap_or(false) || item.receipt.as_ref().map(|b| !b.is_empty()).unwrap_or(false);
            if let Err(e) = self.absorb_module(module, &n, item.pdf, item.receipt) { self.errors.push(e); return; }
            if got { self.counts.fetched += 1; }
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
        let _ = self.app.emit("ingestion", json!({"ev": "challenge", "kind": challenge.kind}));
        crate::commands::ingestion::notify(self.app, "The portal needs you",
            &format!("A {} is waiting on the Ingestion screen. The run pauses until it is entered.", challenge.kind));
    }

    fn on_log(&mut self, level: &str, msg: &str) {
        let _ = self.app.emit("ingestion", json!({"ev": "log", "level": level, "msg": msg}));
    }
}

/// Everything the commands need to steer a run in flight.
pub struct RunHandle {
    pub sweep_id: String,
    pub controls: Controls,
    pub sidecar: Arc<Mutex<Option<SidecarHandle>>>,
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
}

/// Lease renewal cadence (Q06): every 60 minutes while the run is alive.
const LEASE_RENEW_SECONDS: u64 = 60 * 60;

impl<R: tauri::Runtime> Runner<R> {
    fn log(&self, level: &str, msg: &str) {
        let _ = self.app.emit("ingestion", json!({"ev": "log", "level": level, "msg": msg}));
    }

    fn publish(&self) {
        let _ = self.app.emit("ingestion", json!({"ev": "state"}));
    }

    fn password_for(&self, login_ref: &str) -> Option<String> {
        crate::keychain::load_portal_password(login_ref).ok().flatten()
    }

    fn relay(&self) -> Option<crate::relay::Relay> {
        let con = self.db.lock().ok()?;
        crate::relay::config(&con).ok().flatten().map(crate::relay::Relay::new)
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

    pub async fn run(self) {
        self.log("info", &format!("run started, sweep {}", &self.sweep_id[..8]));
        let renewal = match self.take_lease().await {
            Ok(h) => h,
            Err(e) => {
                self.log("error", &e);
                if let Ok(con) = self.db.lock() {
                    let _ = queue::cancel_open_jobs(&con, &self.sweep_id);
                    let _ = queue::set_sweep_status(&con, &self.sweep_id, "failed");
                }
                state::update(&self.shared, |st| { st.running = false; st.phase = Some("failed".into()); st.last_error = Some(e); st.finished_at = Some(now()); });
                self.publish();
                return;
            }
        };
        // Workers pull jobs until the queue is empty or a stop is requested.
        let workers: Vec<_> = (0..INGESTION_WORKERS.max(1)).map(|_| self.worker()).collect();
        futures_join_all(workers).await;
        let status = if self.controls.stopping() { "stopped" } else { "done" };
        if let Ok(con) = self.db.lock() {
            if status == "stopped" { let _ = queue::cancel_open_jobs(&con, &self.sweep_id); }
            let _ = queue::set_sweep_status(&con, &self.sweep_id, status);
        }
        if let Some(h) = renewal { h.abort(); }
        if let Some(relay) = self.relay() {
            // Publish what the sweep wrote, then let go of the lease.
            if let Err(e) = crate::sync::sync_now(&self.db).await { self.log("warn", &format!("publish after the sweep failed: {e}")); }
            if self.whole_book { let _ = relay.release_lease().await; }
        }
        state::update(&self.shared, |st| {
            st.running = false; st.paused = false; st.phase = Some(status.into());
            st.awaiting_operator = None; st.panel = None; st.finished_at = Some(now());
        });
        self.log("info", &format!("run {status}"));
        self.publish();
        let counts = state::snapshot(&self.shared).counts;
        crate::commands::ingestion::notify(&self.app, &format!("Sweep {status}"),
            &format!("{} notices seen, {} fetched, {} changed.", counts.notices, counts.fetched, counts.changed));
    }

    /// Claim the next job atomically (so two workers never take the same
    /// one), run it, repeat.
    async fn worker(&self) {
        loop {
            if self.controls.stopping() { break; }
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

        let outcome = self.run_session(job, &password).await;
        match self.relay() {
            Some(relay) => { let _ = relay.release_lock(&job.login_ref).await; }
            None => { if let Ok(con) = self.db.lock() { let _ = queue::release_lock(&con, &job.login_ref, &self.device_id); } }
        }
        match outcome {
            Ok(()) => { if let Ok(con) = self.db.lock() { let _ = queue::set_job_status(&con, &job.id, "done", None); } }
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
            Err(e) => {
                let msg = e.to_string();
                self.log("error", &msg);
                if let Ok(con) = self.db.lock() {
                    if self.controls.stopping() {
                        let _ = queue::set_job_status(&con, &job.id, "incomplete", Some(&msg));
                    } else {
                        let _ = queue::schedule_retry(&con, job, &msg);
                    }
                }
                state::update(&self.shared, |st| st.last_error = Some(msg));
            }
        }
        self.publish();
    }

    async fn run_session(&self, job: &Job, password: &str) -> Result<(), SourceError> {
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
            let portal = PortalSource::spawn(self.app.clone(), self.controls.clone()).await?;
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
        self.drive(source, job, password).await
    }

    async fn drive(&self, source: &mut dyn NoticeSource, job: &Job, password: &str) -> Result<(), SourceError> {
        let mut sink = PanelSink {
            db: &self.db, app: &self.app, shared: &self.shared, login_pan: &job.login_ref,
            streak: 0, pending: None, counts: Counts::default(), low_confidence: HashMap::new(), errors: Vec::new(),
        };
        state::update(&self.shared, |st| st.phase = Some("logging in".into()));
        self.publish();
        source.login(&LoginRef { login_ref: job.login_ref.clone() }, password, &mut sink).await?;
        state::update(&self.shared, |st| { st.awaiting_operator = None; st.phase = Some("sweeping".into()); });
        self.publish();

        let module = Module::parse(&job.module).unwrap_or(Module::Proceedings);
        let mut cursor = job.cursor();
        let panels = panels_for(module);
        let total = panels.len() as i64;
        state::update(&self.shared, |st| st.panel_total = total);
        for panel in panels {
            if self.controls.stopping() { return Err(SourceError::Other("stopped by the operator".into())); }
            if cursor.panels_done.iter().any(|p| p == panel) { continue; }
            self.controls.wait_while_paused().await;
            state::update(&self.shared, |st| { st.panel = Some(panel.into()); st.paused = false; });
            self.publish();
            sink.streak = 0;
            sink.pending = None;
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
                        "changed": sink.counts.changed - before.changed,
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
                }
                Err(e) => {
                    self.record_run(&con, job, Some(panel), 0, "failed", json!({"error": e.to_string()}), None);
                    return Err(e);
                }
            }
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn record_run(&self, con: &Connection, job: &Job, panel: Option<&str>, found: i64, status: &str,
                  gaps: Value, notes: Option<&str>) {
        let run = IngestionRun {
            id: new_id(), run_at: now(), device_id: self.device_id.clone(), client_id: job.client_id.clone(),
            module: job.module.clone(), panel_swept: panel.map(str::to_string), records_found: found,
            gaps: Some(gaps.to_string()), operator: None, status: status.into(),
            notes: notes.map(str::to_string), created_at: now(),
        };
        let _ = runs::record(con, &run);
    }
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
