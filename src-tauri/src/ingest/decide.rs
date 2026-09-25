//! The per-header decision table (docs/17 §2.3, §2.4, §3). Pure: the sink
//! gathers the facts about a row, this says what to answer. The early-stop
//! streak stays in the sink; this only says whether a row counts toward it.

use chrono::NaiveDate;
use std::collections::HashSet;

/// What the run is for, with the settings that shape its answers.
#[derive(Debug, Clone)]
pub enum Mode {
    /// Nightly or `Sync now`: new rows inside the lookback, every stored row
    /// re-compared, documents per the sweep policy.
    Sweep { today: NaiveDate, lookback_days: i64, download: bool },
    /// One client's history, to a depth. No early stop.
    Deep { download: bool, min_ay_start: Option<i32>, since: Option<NaiveDate> },
    /// One work item: fetch these references, skip everything else.
    Item { targets: HashSet<String> },
}

impl Mode {
    pub fn early_stop(&self) -> bool { matches!(self, Mode::Sweep { .. }) }
}

/// What the store already knows about a listed row.
#[derive(Debug, Clone, Default)]
pub struct RowFacts {
    /// The row's key: notice reference id, acknowledgement or demand number.
    pub key: String,
    pub stored: bool,
    /// Stored and the recomputed row hash equals the stored one.
    pub unchanged: bool,
    /// A document for it is already `stored`.
    pub has_doc: bool,
    /// The portal offers a document for it.
    pub wants_doc: bool,
    pub issued_on: Option<NaiveDate>,
    /// `2024-25` as the portal shows it.
    pub assessment_year: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    /// Nothing to do. `quiet` rows count toward the early-stop streak;
    /// `older` marks a new row outside the lookback window.
    Skip { quiet: bool, older: bool },
    /// Record the header, document stays `pending`.
    Index,
    /// Record the header and download the document now.
    Fetch,
}

fn index_or_fetch(download: bool, f: &RowFacts) -> Decision {
    if download && f.wants_doc && !f.has_doc { Decision::Fetch } else { Decision::Index }
}

/// `2024-25` → 2024.
pub fn ay_start(ay: &str) -> Option<i32> {
    ay.trim().split(['-', '/']).next()?.trim().parse().ok()
}

/// The latest assessment year the portal can hold today: the one whose
/// return is being filed this financial year (FY 2026-27 files AY 2026-27).
pub fn latest_ay_start(today: NaiveDate) -> i32 {
    use chrono::Datelike;
    if today.month() >= 4 { today.year() } else { today.year() - 1 }
}

pub fn decide(mode: &Mode, f: &RowFacts) -> Decision {
    match mode {
        Mode::Sweep { today, lookback_days, download } => {
            if f.stored {
                if f.unchanged {
                    // Known and unchanged. With a download policy a missing
                    // document is still worth taking inside the window.
                    if *download && f.wants_doc && !f.has_doc { Decision::Fetch } else { Decision::Skip { quiet: true, older: false } }
                } else {
                    index_or_fetch(*download, f)
                }
            } else {
                match f.issued_on {
                    // Blank beats guessed: an undated row is inside the window.
                    None => index_or_fetch(*download, f),
                    Some(d) if (*today - d).num_days() <= *lookback_days => index_or_fetch(*download, f),
                    Some(_) => Decision::Skip { quiet: true, older: true },
                }
            }
        }
        Mode::Deep { download, min_ay_start, since } => {
            let in_ay = match (min_ay_start, f.assessment_year.as_deref().and_then(ay_start)) {
                (Some(min), Some(ay)) => ay >= *min,
                _ => true,
            };
            let in_date = match (since, f.issued_on) {
                (Some(s), Some(d)) => d >= *s,
                _ => true,
            };
            if !(in_ay && in_date) { return Decision::Skip { quiet: false, older: true }; }
            if f.stored && f.unchanged && (f.has_doc || !*download || !f.wants_doc) {
                return Decision::Skip { quiet: false, older: false };
            }
            index_or_fetch(*download, f)
        }
        Mode::Item { targets } => {
            if targets.contains(&f.key) {
                if f.wants_doc { Decision::Fetch } else { Decision::Index }
            } else {
                Decision::Skip { quiet: false, older: false }
            }
        }
    }
}
