//! The public Tax Calendar page (docs/19 §2.1) as server-rendered HTML: a
//! month heading, then per deadline a weekday-date heading, one
//! description paragraph and sometimes a note paragraph. Written against
//! `sidecar/tests/fixtures/statutory/yearly-deadlines-2026.html`
//! (docs/05 "Parsing discipline"); the fixture is synthetic until the
//! portal can be fetched from a build machine (Q66).
//!
//! Tolerant by design: it walks headings and paragraphs in document order
//! and never drops a dated row for a wording it does not know.

use crate::ids::sha256_hex;
use chrono::NaiveDate;
use regex::Regex;
use std::sync::LazyLock;

/// One deadline as the page states it, before rules and storage.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedDeadline {
    pub id: String,
    /// The date on the heading (the source date; extensions move `due_on` later).
    pub source_on: NaiveDate,
    pub title: String,
    pub note: Option<String>,
}

static TAG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?is)<(/?)(h[1-6]|p)\b[^>]*>").unwrap());
static STRIP: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?is)<script.*?</script>|<style.*?</style>|<!--.*?-->").unwrap());
static ANY_TAG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)<[^>]+>").unwrap());
static WS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").unwrap());
/// "Wednesday, January 7, 2026" — the weekday is decoration.
static DATE_HEADING: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^(?:[a-z]+,\s*)?([a-z]+)\s+(\d{1,2}),\s*(\d{4})$").unwrap());

/// Scripts, styles and comments out; tags out; entities and whitespace normalised.
pub fn normalise_text(html: &str) -> String {
    let no_tags = ANY_TAG.replace_all(html, " ");
    let text = no_tags.replace("&nbsp;", " ").replace("&amp;", "&").replace("&#39;", "'").replace("&quot;", "\"")
        .replace("&lt;", "<").replace("&gt;", ">");
    WS.replace_all(text.trim(), " ").to_string()
}

/// The whole page as normalised text, for the change hash (docs/19 §3.2).
pub fn page_text(html: &str) -> String {
    normalise_text(&STRIP.replace_all(html, " "))
}

pub fn page_hash(html: &str) -> String {
    sha256_hex(page_text(html).as_bytes())
}

/// "January 7, 2026" → 2026-01-07; None for anything else.
pub fn parse_long_date(text: &str) -> Option<NaiveDate> {
    let caps = DATE_HEADING.captures(text.trim())?;
    let month = match caps[1].to_ascii_lowercase().as_str() {
        "january" => 1, "february" => 2, "march" => 3, "april" => 4, "may" => 5, "june" => 6,
        "july" => 7, "august" => 8, "september" => 9, "october" => 10, "november" => 11, "december" => 12,
        _ => return None,
    };
    NaiveDate::from_ymd_opt(caps[3].parse().ok()?, month, caps[2].parse().ok()?)
}

/// Title as stored: whitespace-normalised, no trailing period.
pub fn normalise_title(text: &str) -> String {
    let t = WS.replace_all(text.trim(), " ").to_string();
    t.trim_end_matches('.').trim().to_string()
}

/// docs/19 §2.2: sha256(source_date || normalised title)[:16].
pub fn deadline_id(source_on: NaiveDate, title: &str) -> String {
    sha256_hex(format!("{}{}", source_on.format("%Y-%m-%d"), normalise_title(title).to_lowercase()).as_bytes())[..16].to_string()
}

#[derive(Debug)]
enum Block { Heading(String), Para(String) }

fn blocks(html: &str) -> Vec<Block> {
    let clean = STRIP.replace_all(html, " ");
    let mut out = Vec::new();
    let mut open: Option<(String, usize)> = None;
    for m in TAG.captures_iter(&clean) {
        let closing = &m[1] == "/";
        let tag = m[2].to_ascii_lowercase();
        let at = m.get(0).unwrap();
        if !closing {
            open = Some((tag, at.end()));
        } else if let Some((t, start)) = open.take() {
            if t == tag {
                let inner = normalise_text(&clean[start..at.start()]);
                if inner.is_empty() { continue; }
                out.push(if t == "p" { Block::Para(inner) } else { Block::Heading(inner) });
            }
        }
    }
    out
}

/// Every dated row of a page, in document order. A heading that is not a
/// date (the month headings) resets nothing; a paragraph after a dated
/// heading is its description, a second paragraph before the next heading
/// is its note.
pub fn parse_page(html: &str) -> Vec<ParsedDeadline> {
    let mut out: Vec<ParsedDeadline> = Vec::new();
    let mut current: Option<NaiveDate> = None;
    let mut awaiting_desc = false;
    for b in blocks(html) {
        match b {
            Block::Heading(text) => {
                current = parse_long_date(&text);
                awaiting_desc = current.is_some();
            }
            Block::Para(text) => {
                let Some(date) = current else { continue };
                if awaiting_desc {
                    let title = normalise_title(&text);
                    if title.is_empty() { continue; }
                    out.push(ParsedDeadline { id: deadline_id(date, &title), source_on: date, title, note: None });
                    awaiting_desc = false;
                } else if let Some(last) = out.last_mut() {
                    if last.source_on == date && last.note.is_none() {
                        last.note = Some(WS.replace_all(text.trim(), " ").to_string());
                    }
                }
            }
        }
    }
    out
}

/// docs/19 §3.3: the extension a note states. `None` when the note does
/// not mention an extension; `Some((None, ..))` when it does but the date
/// cannot be read (blank beats guessed).
pub struct Extension {
    pub from: Option<NaiveDate>,
    pub to: Option<NaiveDate>,
    pub circular: Option<String>,
}

static EXT: LazyLock<Regex> = LazyLock::new(|| Regex::new(
    r"(?i)extended\s+(?:from\s+(?P<from>[A-Za-z]+\s+\d{1,2},\s*\d{4})\s+)?to\s+(?P<to>[A-Za-z]+\s+\d{1,2},\s*\d{4})").unwrap());
static CIRC: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)circular\s+no\.?\s*(?P<circ>[\d/]+)").unwrap());

pub fn parse_extension(note: &str) -> Option<Extension> {
    if !note.to_ascii_lowercase().contains("extended") { return None; }
    let circular = CIRC.captures(note).map(|c| c["circ"].trim_matches('/').to_string()).filter(|c| !c.is_empty());
    match EXT.captures(note) {
        Some(c) => Some(Extension {
            from: c.name("from").and_then(|m| parse_long_date(m.as_str())),
            to: parse_long_date(&c["to"]),
            circular,
        }),
        None => Some(Extension { from: None, to: None, circular }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Datelike;

    const FIXTURE: &str = include_str!("../../../sidecar/tests/fixtures/statutory/yearly-deadlines-2026.html");

    #[test]
    fn fixture_parses_one_row_per_deadline_with_valid_dates() {
        let rows = parse_page(FIXTURE);
        assert_eq!(rows.len(), 22, "one row per dated heading");
        assert!(rows.iter().all(|r| r.source_on.format("%Y").to_string() == "2026"));
        assert_eq!(rows[0].source_on, NaiveDate::from_ymd_opt(2026, 1, 7).unwrap());
        assert!(rows[0].title.starts_with("Due date for deposit of Tax deducted/collected"));
        assert!(!rows[0].title.ends_with('.'), "no trailing period");
        let extended = rows.iter().find(|r| r.note.is_some() && r.source_on.month() == 7).unwrap();
        assert!(extended.note.as_deref().unwrap().contains("Circular No. 06/2026"));
        // Same date and title on two pages → same id; different title → different id.
        assert_eq!(rows[0].id, deadline_id(rows[0].source_on, &rows[0].title));
        assert_ne!(rows[0].id, rows[1].id);
        assert_eq!(rows[0].id.len(), 16);
    }

    #[test]
    fn extension_regex_reads_both_dates_and_the_circular() {
        let e = parse_extension("The due date has been extended from July 31, 2026 to September 15, 2026 vide Circular No. 06/2026, dated 27-05-2026.").unwrap();
        assert_eq!(e.from, NaiveDate::from_ymd_opt(2026, 7, 31));
        assert_eq!(e.to, NaiveDate::from_ymd_opt(2026, 9, 15));
        assert_eq!(e.circular.as_deref(), Some("06/2026"));
        let vague = parse_extension("The due date has been extended to a later date; details will follow.").unwrap();
        assert!(vague.to.is_none(), "an unparseable extension leaves the date alone");
        assert!(parse_extension("Nothing about it.").is_none());
    }

    #[test]
    fn page_hash_ignores_markup_and_whitespace() {
        assert_eq!(page_hash("<p>a  b</p>"), page_hash("<div><p>a\n b</p></div><script>x()</script>"));
        assert_ne!(page_hash("<p>a b</p>"), page_hash("<p>a c</p>"));
    }
}
