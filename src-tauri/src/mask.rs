//! PII masking for logs and screens (docs/07): PAN renders as
//! `AABCV••••K`, phone numbers keep their last four digits.

pub fn pan(pan: &str) -> String {
    let p = pan.trim();
    if p.len() != 10 {
        return "•".repeat(p.len().clamp(1, 10));
    }
    format!("{}••••{}", &p[..5], &p[9..])
}


fn looks_like_pan(w: &[char]) -> bool {
    w.len() == 10
        && w[..5].iter().all(|c| c.is_ascii_alphabetic())
        && w[5..9].iter().all(|c| c.is_ascii_digit())
        && w[9].is_ascii_alphabetic()
}

/// Free text (a run's notes, an error) with every PAN-shaped word masked
/// and every run of ten or more digits cut to its last four.
pub fn text(s: &str) -> String {
    let chars: Vec<char> = s.chars().collect();
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while i < chars.len() {
        if chars[i].is_ascii_alphanumeric() {
            let start = i;
            while i < chars.len() && chars[i].is_ascii_alphanumeric() { i += 1; }
            let word = &chars[start..i];
            if looks_like_pan(word) {
                out.push_str(&pan(&word.iter().collect::<String>()));
            } else if word.len() >= 10 && word.iter().all(|c| c.is_ascii_digit()) {
                out.push_str(&"•".repeat(word.len() - 4));
                out.extend(&word[word.len() - 4..]);
            } else {
                out.extend(word);
            }
        } else {
            out.push(chars[i]);
            i += 1;
        }
    }
    out
}

