//! Category and applicability rules (docs/19 §2.3, §2.4): two ordered
//! tables, data not code. The first matching category wins; every
//! applicability tag that matches is kept. Unmatched rows are `other`,
//! never dropped.

/// Legend order is the table order.
pub const CATEGORIES: &[(&str, &str, &[&str])] = &[
    ("tds_deposit", "TDS/TCS deposit", &["deposit of tax deducted", "deposit of tds", "tax collected", "challan", "form 24g"]),
    ("tds_returns", "Returns & certificates", &["tds certificate", "tcs certificate", "form 16", "form 27", "statement of deduction",
                                                "quarterly statement", "form 26q", "form 24q", "form 27q"]),
    ("advance_tax", "Advance tax", &["advance tax", "instalment"]),
    // Audit before ITR (Q67): an audit-report row names the return it
    // precedes ("... required to submit his return of income on ..."), and
    // the first match wins.
    ("audit", "Audit & reports", &["audit report", "form 3ca", "form 3cb", "form 3cd", "form 3ceb", "form 10b", "transfer pricing"]),
    ("itr", "ITR filing", &["return of income", "belated", "revised return", "itr"]),
    ("forms", "Statements & forms", &["form 15g", "form 15h", "form 27c", "form 61", "form 49", "form 3bb", "form 10", "declaration", "statement in form"]),
];

pub const OTHER: &str = "other";
pub const FIRM: &str = "firm";

/// Every legend category id in order, `firm` last (Notices is a layer).
pub fn legend_ids() -> Vec<&'static str> {
    CATEGORIES.iter().map(|c| c.0).chain([OTHER, FIRM]).collect()
}

pub fn category_label(id: &str) -> &'static str {
    match id {
        "other" => "Other",
        "firm" => "Firm dates",
        "notices" => "Notices due",
        _ => CATEGORIES.iter().find(|c| c.0 == id).map(|c| c.1).unwrap_or("Other"),
    }
}

/// The portal writes "Form No. 3CEB", "Form No.15G"; the needles say
/// "form 3ceb". One normalisation, so the tables stay readable.
fn matchable(title: &str) -> String {
    title.to_lowercase().replace("form no.", "form ").replace("form no ", "form ").replace("  ", " ")
}

pub fn category_of(title: &str) -> &'static str {
    let t = matchable(title);
    CATEGORIES.iter().find(|(_, _, needles)| needles.iter().any(|n| t.contains(n))).map(|c| c.0).unwrap_or(OTHER)
}

/// Applicability tags (docs/19 §2.4). `tds_deductor` follows the category.
pub const TAG_RULES: &[(&str, &[&str])] = &[
    ("corporate", &["corporate-assessee", "company"]),
    ("audit", &["audited", "audit report", "partner of a firm whose accounts"]),
    ("tp", &["international or specified domestic transaction", "transfer pricing", "3ceb"]),
    ("individual", &["individual", "resident individuals"]),
];

pub fn tags_of(title: &str, category: &str) -> Vec<&'static str> {
    let t = matchable(title);
    let mut tags: Vec<&'static str> = TAG_RULES.iter().filter(|(_, needles)| needles.iter().any(|n| t.contains(n))).map(|r| r.0).collect();
    if category == "tds_deposit" || category == "tds_returns" { tags.push("tds_deductor"); }
    if tags.is_empty() { tags.push("everyone"); }
    tags
}

/// A client's calendar profile as §2.4 reads it.
pub struct Profile<'a> {
    pub entity_kind: Option<&'a str>,
    pub audit_case: bool,
    pub tp_case: bool,
    pub tds_deductor: bool,
}

/// Does a deadline with these tags apply to a client with this profile?
pub fn applies_to(tags: &[String], p: &Profile) -> bool {
    tags.iter().any(|t| match t.as_str() {
        "everyone" => true,
        "corporate" => p.entity_kind == Some("company"),
        "audit" => p.audit_case,
        "tp" => p.tp_case,
        "tds_deductor" => p.tds_deductor,
        "individual" => p.entity_kind == Some("individual"),
        _ => false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::statutory::parse::parse_page;

    const FIXTURE: &str = include_str!("../../../sidecar/tests/fixtures/statutory/yearly-deadlines-2026.html");

    /// One assertion per category rule, on fixture titles (docs/19 §2.3).
    #[test]
    fn each_category_rule_matches_a_fixture_title() {
        let titles: Vec<String> = parse_page(FIXTURE).into_iter().map(|r| r.title).collect();
        let find = |needle: &str| titles.iter().find(|t| t.to_lowercase().contains(needle)).cloned().unwrap();
        assert_eq!(category_of(&find("deposit of tax deducted")), "tds_deposit");
        assert_eq!(category_of(&find("form 24g")), "tds_deposit");
        assert_eq!(category_of(&find("tds certificate")), "tds_returns");
        assert_eq!(category_of(&find("quarterly statement of tds")), "tds_returns");
        assert_eq!(category_of(&find("instalment of advance tax")), "advance_tax");
        assert_eq!(category_of(&find("belated or revised return")), "itr");
        assert_eq!(category_of(&find("audit report under section 44ab")), "audit");
        assert_eq!(category_of(&find("form no. 3ceb")), "audit");
        assert_eq!(category_of(&find("form no. 15g/15h")), "forms");
        assert_eq!(category_of(&find("form 9a")), OTHER, "Form 9A is not in the forms needles: it is the fixture's one \"other\"");
        assert_eq!(category_of("Something the rules never heard of"), OTHER);
        let other = titles.iter().filter(|t| category_of(t) == OTHER).count();
        assert!(other * 100 <= titles.len() * 15, "no more than 15% other: {other} of {}", titles.len());
    }

    /// One assertion per applicability rule (docs/19 §2.4).
    #[test]
    fn each_tag_rule_matches_a_fixture_title() {
        let rows = parse_page(FIXTURE);
        let find = |needle: &str| rows.iter().find(|r| r.title.to_lowercase().contains(needle)).unwrap().title.clone();
        let tags = |t: &str| tags_of(t, category_of(t));
        assert!(tags(&find("corporate-assessee")).contains(&"corporate"));
        assert!(tags(&find("required to be audited")).contains(&"audit"));
        assert!(tags(&find("form no. 3ceb")).contains(&"tp"));
        assert!(tags(&find("quarterly statement of tds")).contains(&"tds_deductor"));
        assert_eq!(tags("Return of income for resident individuals"), vec!["individual"]);
        assert_eq!(tags(&find("instalment of advance tax")), vec!["everyone"]);
        let p = Profile { entity_kind: None, audit_case: false, tp_case: false, tds_deductor: false };
        assert!(applies_to(&["everyone".into()], &p));
        assert!(!applies_to(&["corporate".into()], &p));
        let co = Profile { entity_kind: Some("company"), audit_case: true, tp_case: false, tds_deductor: true };
        assert!(applies_to(&["corporate".into()], &co) && applies_to(&["tds_deductor".into()], &co) && !applies_to(&["tp".into()], &co));
    }
}
