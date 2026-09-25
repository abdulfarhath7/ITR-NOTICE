//! `NoticeSource`: the interface both engines implement (docs/06). Nothing
//! above it knows which engine ran — the runner, the ledger, sync and
//! exports never branch on source.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use thiserror::Error;

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Module { Proceedings, Demands, Returns, Forms }

impl Module {
    pub fn as_str(self) -> &'static str {
        match self { Module::Proceedings => "proceedings", Module::Demands => "demands",
                     Module::Returns => "returns", Module::Forms => "forms" }
    }
    pub fn parse(s: &str) -> Option<Module> {
        match s { "proceedings" => Some(Module::Proceedings), "demands" => Some(Module::Demands),
                  "returns" => Some(Module::Returns), "forms" => Some(Module::Forms), _ => None }
    }
}

/// The six e-Proceedings panels, in sweep order.
pub const PANELS: [&str; 6] = [
    "self:action", "self:information", "other_pan:action", "other_pan:information",
    "auth_rep:action", "auth_rep:information",
];

/// Who logs in. The PAN of the account whose session lists the work.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoginRef {
    pub login_ref: String,
}

/// A human is needed: captcha or OTP. The runner relays it to the screen
/// and waits, without a timeout.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Challenge {
    pub kind: String,
    pub image_b64: Option<String>,
}

/// A proceeding card plus, when present, one notice card under it, exactly
/// as the source read them, with a per-field confidence map.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WorkItemHeader {
    pub panel: String,
    pub proceeding: HashMap<String, serde_json::Value>,
    pub notice: Option<HashMap<String, serde_json::Value>>,
    #[serde(default)]
    pub confidence: Confidence,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Confidence {
    #[serde(default)]
    pub proceeding: HashMap<String, String>,
    #[serde(default)]
    pub notice: HashMap<String, String>,
}

/// The document behind a header.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkItemDetail {
    pub reference_id: String,
    pub filename: Option<String>,
    pub pdf: Option<Vec<u8>>,
    /// The acknowledgement / receipt for returns and forms (the pair rule).
    pub receipt: Option<Vec<u8>>,
    pub note: Option<String>,
}

/// What a module sweeps: e-Proceedings has six panels, the others one list.
pub fn panels_for(module: Module) -> Vec<&'static str> {
    match module {
        Module::Proceedings => PANELS.to_vec(),
        Module::Demands => vec!["demands"],
        Module::Returns => vec!["returns"],
        Module::Forms => vec!["forms"],
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PanelResult {
    pub panel: String,
    pub cards: i64,
    pub notices: i64,
    pub fetched: i64,
    pub skipped: i64,
    pub stopped_early: bool,
    pub note: Option<String>,
    /// The panel was not on the account at all (still recorded, count 0).
    pub missing: bool,
}

/// The runner's answer to each header. `Index` records the header and
/// leaves the document on the portal (docs/17 §2.3); the engine answers it
/// with an item whose bytes are empty.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict { Skip, Index, Fetch, Stop }

/// One panel's probe answer (docs/17 §2.2). `list_hash` is `None` when the
/// probe failed, which the runner treats as "changed".
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProbeResult {
    pub panel: String,
    pub list_hash: Option<String>,
    pub rows: i64,
}

/// The one proceeding an item fetch walks to (docs/17 §3): the engine
/// opens only the card whose name and AY match.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProceedingTarget {
    pub proceeding_name: Option<String>,
    pub assessment_year: Option<String>,
}

/// Part of the docs/06 contract (task 4.1); nothing displays it until the
/// ERI engine lands, so the lint is silenced here rather than the trait
/// narrowed.
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SourceHealth { Ok, NotConfigured, Degraded, Down }

#[derive(Debug, Error)]
pub enum SourceError {
    /// One failure parks the client for the run; never retried (docs/05).
    #[error("the portal rejected the password")]
    WrongPassword,
    #[error("login did not complete: {0}")]
    LoginFailed(String),
    #[error("the session ended: {0}")]
    SessionLost(String),
    #[error("source not configured: {0}")]
    NotConfigured(String),
    /// The run window closed between panels (docs/17 §2.7): the cursor is
    /// saved and the job resumes next night. Never a failure.
    #[error("window closed")]
    WindowClosed,
    /// The per-client timeout (docs/17 §2.7): incomplete, cursor saved.
    #[error("timed out after {0} min")]
    TimedOut(u32),
    #[error("{0}")]
    Other(String),
}

/// What the runner does with each header and each fetched item while a
/// panel is listed. `on_header` decides; `on_item` stores. Both are called
/// on the runner's task in order.
pub trait PanelSink: Send {
    fn on_header(&mut self, header: &WorkItemHeader) -> Verdict;
    fn on_item(&mut self, item: WorkItemDetail);
    fn on_challenge(&mut self, challenge: &Challenge);
    fn on_log(&mut self, level: &str, msg: &str);
}

/// The seam. `list_work_items` streams headers to the sink and fetches the
/// items the sink asks for (`fetch_item` is what it calls per Fetch verdict,
/// exposed so a caller can re-fetch one item by reference).
#[allow(dead_code)]   // fetch_item and health: docs/06 contract, callers arrive with ERI
pub trait NoticeSource: Send {
    fn login<'a>(&'a mut self, login: &'a LoginRef, password: &'a str, sink: &'a mut dyn PanelSink)
        -> BoxFuture<'a, Result<(), SourceError>>;
    fn list_work_items<'a>(&'a mut self, module: Module, panel: &'a str, sink: &'a mut dyn PanelSink)
        -> BoxFuture<'a, Result<PanelResult, SourceError>>;
    fn fetch_item<'a>(&'a mut self, reference_id: &'a str, sink: &'a mut dyn PanelSink)
        -> BoxFuture<'a, Result<Option<WorkItemDetail>, SourceError>>;
    fn logout<'a>(&'a mut self) -> BoxFuture<'a, ()>;
    fn health(&self) -> SourceHealth;

    /// Hash a panel's first `pages` pages of listing. An engine that cannot
    /// probe answers an error, which the runner reads as "changed".
    fn probe<'a>(&'a mut self, _module: Module, panel: &'a str, _pages: u32)
        -> BoxFuture<'a, Result<ProbeResult, SourceError>> {
        Box::pin(async move { Err(SourceError::Other(format!("this engine cannot probe {panel}"))) })
    }

    /// Narrow the next listings to one proceeding (item fetch), or clear it.
    fn set_target(&mut self, _target: Option<ProceedingTarget>) {}
}
