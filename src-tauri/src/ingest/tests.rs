//! docs/12 "Ingestion" and "Source independence": the streak, the zero-count
//! row, gaps stay NULL, resume after a kill, and one row for one item
//! whichever engine fetched it. A mock `NoticeSource` feeds fixed headers.

use crate::ingest::portal_source::Controls;
use crate::ingest::runner::{Runner, EARLY_STOP_STREAK};
use crate::ingest::source::*;
use crate::ingest::state::IngestionState;
use crate::intake::{self, NoticeCard, ProceedingCard};
use crate::repo::queue::{self, Scope};
use crate::repo::{clients, local, proceedings};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

const PAN: &str = "ABCDE1234F";

fn db() -> Arc<Mutex<Connection>> {
    let mut con = Connection::open_in_memory().unwrap();
    crate::migrate::run(&mut con).unwrap();
    clients::create_minimal(&con, PAN, Some("Example Assessee")).unwrap();
    Arc::new(Mutex::new(con))
}

fn header(panel: &str, name: &str, ref_id: &str, due: Option<&str>, responded: i64) -> WorkItemHeader {
    let mut p: HashMap<String, Value> = HashMap::new();
    p.insert("proceeding_name".into(), json!(name));
    p.insert("pan".into(), json!(PAN));
    p.insert("assessment_year".into(), json!("2024-25"));
    p.insert("status".into(), json!("Open"));
    p.insert("initiated_on".into(), json!("18-Aug-2026"));
    let mut n: HashMap<String, Value> = HashMap::new();
    n.insert("reference_id".into(), json!(ref_id));
    n.insert("description".into(), json!("[ITBA]Show Cause Notice u/s 270A"));
    n.insert("issued_on".into(), json!("17-Aug-2026"));
    n.insert("response_due_date".into(), json!(due));
    n.insert("responded".into(), json!(responded));
    n.insert("has_pdf_button".into(), json!(true));
    WorkItemHeader { panel: panel.into(), proceeding: p, notice: Some(n), confidence: Confidence::default() }
}

/// A source that lists fixed headers per panel and fails on a chosen panel.
struct MockSource {
    headers: HashMap<String, Vec<WorkItemHeader>>,
    fail_on: Option<String>,
    listed: Arc<Mutex<Vec<String>>>,
}

impl NoticeSource for MockSource {
    fn login<'a>(&'a mut self, _l: &'a LoginRef, _p: &'a str, _s: &'a mut dyn PanelSink) -> BoxFuture<'a, Result<(), SourceError>> {
        Box::pin(async { Ok(()) })
    }
    fn list_work_items<'a>(&'a mut self, _m: Module, panel: &'a str, sink: &'a mut dyn PanelSink)
        -> BoxFuture<'a, Result<PanelResult, SourceError>> {
        Box::pin(async move {
            self.listed.lock().unwrap().push(panel.to_string());
            if self.fail_on.as_deref() == Some(panel) {
                return Err(SourceError::SessionLost("simulated kill".into()));
            }
            let headers = self.headers.get(panel).cloned().unwrap_or_default();
            let (mut fetched, mut skipped, mut stopped) = (0, 0, false);
            for h in &headers {
                match sink.on_header(h) {
                    Verdict::Fetch => {
                        fetched += 1;
                        let ref_id = h.notice.as_ref().unwrap()["reference_id"].as_str().unwrap().to_string();
                        sink.on_item(WorkItemDetail { reference_id: ref_id.clone(), filename: Some(format!("{ref_id}.pdf")),
                                                      pdf: Some(format!("%PDF-{ref_id}").into_bytes()), note: None });
                    }
                    Verdict::Skip => skipped += 1,
                    Verdict::Stop => { stopped = true; break; }
                }
            }
            Ok(PanelResult { panel: panel.into(), cards: headers.len() as i64, notices: headers.len() as i64,
                             fetched, skipped, stopped_early: stopped, note: None, missing: headers.is_empty() })
        })
    }
    fn fetch_item<'a>(&'a mut self, _r: &'a str, _s: &'a mut dyn PanelSink) -> BoxFuture<'a, Result<Option<WorkItemDetail>, SourceError>> {
        Box::pin(async { Ok(None) })
    }
    fn logout<'a>(&'a mut self) -> BoxFuture<'a, ()> { Box::pin(async {}) }
    fn health(&self) -> SourceHealth { SourceHealth::Ok }
}

fn runner(db: &Arc<Mutex<Connection>>, sweep_id: &str) -> Runner<tauri::test::MockRuntime> {
    let app = tauri::test::mock_app();
    Runner {
        app: app.handle().clone(), db: db.clone(), shared: Arc::new(Mutex::new(IngestionState::default())),
        controls: Controls::default(), sidecar: Arc::new(Mutex::new(None)), sweep_id: sweep_id.into(),
        device_id: "dev_test".into(),
    }
}

fn sweep(db: &Arc<Mutex<Connection>>) -> String {
    let con = db.lock().unwrap();
    let id = local::device_id(&con).unwrap();
    queue::create_sweep(&con, &id, &Scope::All, &["proceedings"]).unwrap().id
}

fn count(db: &Arc<Mutex<Connection>>, sql: &str) -> i64 {
    db.lock().unwrap().query_row(sql, [], |r| r.get(0)).unwrap()
}

#[tokio::test]
async fn early_stop_after_ten_known_rows_and_reset_on_change() {
    let db = db();
    let sweep_id = sweep(&db);
    // First pass: twelve notices, all new, all fetched.
    let twelve: Vec<WorkItemHeader> = (0..12).map(|i| header("self:action", "Penalty Proceeding", &format!("10000000{i:02}"), Some("09-Sep-2026"), 0)).collect();
    let mut headers = HashMap::new();
    headers.insert("self:action".to_string(), twelve.clone());
    let listed = Arc::new(Mutex::new(Vec::new()));
    let mut src = MockSource { headers: headers.clone(), fail_on: None, listed: listed.clone() };
    let job = { let con = db.lock().unwrap(); queue::next_job(&con, &sweep_id).unwrap().unwrap() };
    runner(&db, &sweep_id).drive_for_test(&mut src, &job, "pw").await.unwrap();
    assert_eq!(count(&db, "SELECT count(*) FROM communications"), 12);
    assert_eq!(count(&db, "SELECT count(*) FROM documents WHERE state='stored'"), 12);

    // Second pass, nothing changed: ten known rows in a row stop the panel.
    let sweep2 = sweep(&db);
    let job2 = { let con = db.lock().unwrap(); queue::next_job(&con, &sweep2).unwrap().unwrap() };
    let mut src2 = MockSource { headers: headers.clone(), fail_on: None, listed: listed.clone() };
    runner(&db, &sweep2).drive_for_test(&mut src2, &job2, "pw").await.unwrap();
    let run_gaps: String = db.lock().unwrap().query_row(
        "SELECT gaps FROM ingestion_runs WHERE panel_swept='self:action' ORDER BY run_at DESC LIMIT 1", [], |r| r.get(0)).unwrap();
    assert!(run_gaps.contains("\"stopped_early\":true"), "{run_gaps}");
    assert_eq!(count(&db, "SELECT count(*) FROM communications"), 12, "no duplicates");
    assert_eq!(EARLY_STOP_STREAK, 10);

    // Third pass: the fifth row changed (a response was filed) — the streak
    // resets and the panel runs to the end.
    let mut changed = twelve.clone();
    changed[4].notice.as_mut().unwrap().insert("responded".into(), json!(1));
    changed[4].notice.as_mut().unwrap().insert("last_response_on".into(), json!("20-Aug-2026"));
    let mut headers3 = HashMap::new();
    headers3.insert("self:action".to_string(), changed);
    let sweep3 = sweep(&db);
    let job3 = { let con = db.lock().unwrap(); queue::next_job(&con, &sweep3).unwrap().unwrap() };
    let mut src3 = MockSource { headers: headers3, fail_on: None, listed: listed.clone() };
    runner(&db, &sweep3).drive_for_test(&mut src3, &job3, "pw").await.unwrap();
    let run_gaps: String = db.lock().unwrap().query_row(
        "SELECT gaps FROM ingestion_runs WHERE panel_swept='self:action' ORDER BY run_at DESC LIMIT 1", [], |r| r.get(0)).unwrap();
    assert!(run_gaps.contains("\"stopped_early\":false"), "{run_gaps}");
    assert_eq!(count(&db, "SELECT count(*) FROM responses"), 1);
    assert_eq!(count(&db, "SELECT count(*) FROM communications WHERE status='response_submitted'"), 1);
}

#[tokio::test]
async fn zero_result_panels_write_rows_and_gaps_stay_null() {
    let db = db();
    let sweep_id = sweep(&db);
    let mut headers = HashMap::new();
    headers.insert("self:action".to_string(), vec![header("self:action", "Issue Letter", "100000000001", None, 0)]);
    let mut src = MockSource { headers, fail_on: None, listed: Arc::new(Mutex::new(Vec::new())) };
    let job = { let con = db.lock().unwrap(); queue::next_job(&con, &sweep_id).unwrap().unwrap() };
    runner(&db, &sweep_id).drive_for_test(&mut src, &job, "pw").await.unwrap();
    // Six panels, six rows; five of them found nothing and say so.
    assert_eq!(count(&db, "SELECT count(*) FROM ingestion_runs"), 6);
    assert_eq!(count(&db, "SELECT count(*) FROM ingestion_runs WHERE records_found = 0"), 5);
    // The due date the portal did not show is NULL with a gap flag, and a
    // second pass does not fill it.
    let (due, gaps): (Option<String>, String) = db.lock().unwrap().query_row(
        "SELECT response_due_date, gap_flags FROM communications", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
    assert_eq!(due, None);
    assert!(gaps.contains("response_due_date"));
}

#[tokio::test]
async fn killed_mid_run_resumes_at_the_next_panel_without_duplicates() {
    let db = db();
    let sweep_id = sweep(&db);
    let mut headers = HashMap::new();
    headers.insert("self:action".to_string(), vec![header("self:action", "Penalty Proceeding", "100000000001", Some("09-Sep-2026"), 0)]);
    headers.insert("other_pan:action".to_string(), vec![header("other_pan:action", "Recovery Process", "100000000002", None, 0)]);
    let listed = Arc::new(Mutex::new(Vec::new()));
    // Dies on the third panel.
    let mut src = MockSource { headers: headers.clone(), fail_on: Some("other_pan:action".into()), listed: listed.clone() };
    let job = { let con = db.lock().unwrap(); queue::next_job(&con, &sweep_id).unwrap().unwrap() };
    let err = runner(&db, &sweep_id).drive_for_test(&mut src, &job, "pw").await;
    assert!(err.is_err());
    let job_after = { let con = db.lock().unwrap(); queue::jobs(&con, &sweep_id).unwrap().remove(0) };
    assert_eq!(job_after.cursor().panels_done, vec!["self:action", "self:information"]);
    assert_eq!(count(&db, "SELECT count(*) FROM communications"), 1);

    // Restart: continues at the third panel, lists only the remaining four.
    listed.lock().unwrap().clear();
    let mut src2 = MockSource { headers, fail_on: None, listed: listed.clone() };
    runner(&db, &sweep_id).drive_for_test(&mut src2, &job_after, "pw").await.unwrap();
    assert_eq!(*listed.lock().unwrap(), vec!["other_pan:action", "other_pan:information", "auth_rep:action", "auth_rep:information"]);
    assert_eq!(count(&db, "SELECT count(*) FROM communications"), 2);
    assert_eq!(count(&db, "SELECT count(*) FROM proceedings"), 2);
}

/// docs/12 "Source independence": one row whichever engine read it.
#[test]
fn same_item_from_two_engines_is_one_row() {
    let db = db();
    let con = db.lock().unwrap();
    let card = ProceedingCard {
        tab: "self".into(), sub_tab: "action".into(), proceeding_name: Some("Penalty Proceeding".into()),
        pan: Some(PAN.into()), assessee_name: Some("Example Assessee".into()), assessment_year: Some("2024-25".into()),
        financial_year: None, applicable_act: None, status: Some("Open".into()), initiated_on: None,
        closure_date: None, closure_order: None,
    };
    let notice = NoticeCard { ref_id: "100000000009".into(), description: Some("[ITBA]Show Cause Notice u/s 270A".into()),
        issued_on: Some("17-Aug-2026".into()), due_date: Some("09-Sep-2026".into()), responded: Some(0),
        pdf: Some(b"%PDF-x".to_vec()), ..Default::default() };
    // "portal" read
    intake::absorb(&con, Some(PAN), &card, Some(&notice)).unwrap();
    // "eri" read of the same item: same DIN/reference, same content
    let eri_notice = NoticeCard { downloaded_at: Some("2026-09-12T10:00:00Z".into()), ..notice.clone() };
    intake::absorb(&con, Some(PAN), &card, Some(&eri_notice)).unwrap();
    let comms: i64 = con.query_row("SELECT count(*) FROM communications", [], |r| r.get(0)).unwrap();
    let procs: i64 = con.query_row("SELECT count(*) FROM proceedings", [], |r| r.get(0)).unwrap();
    let blobs: i64 = con.query_row("SELECT count(*) FROM document_blobs", [], |r| r.get(0)).unwrap();
    assert_eq!((comms, procs, blobs), (1, 1, 1));
    let p = proceedings::by_natural_key(&con, &crate::ids::sha256_hex(format!("{PAN}|2024-25|self:action|Penalty Proceeding").as_bytes())).unwrap();
    assert!(p.is_some());
}

/// The whole loop: a login with no stored password is parked with a
/// credentials_parked row, the lock is released, the sweep finishes.
#[tokio::test]
async fn run_parks_a_login_without_a_password() {
    let db = db();
    let sweep_id = sweep(&db);
    runner(&db, &sweep_id).run().await;
    let (status, jobs_parked, runs_parked, locks): (String, i64, i64, i64) = db.lock().unwrap().query_row(
        "SELECT (SELECT status FROM ingestion_sweeps WHERE id = ?1),
                (SELECT count(*) FROM ingestion_jobs WHERE sweep_id = ?1 AND status = 'parked'),
                (SELECT count(*) FROM ingestion_runs WHERE status = 'credentials_parked'),
                (SELECT count(*) FROM session_locks)",
        [&sweep_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).unwrap();
    assert_eq!(status, "done");
    assert_eq!(jobs_parked, 1);
    assert_eq!(runs_parked, 1);
    assert_eq!(locks, 0, "the lock is released");
}
