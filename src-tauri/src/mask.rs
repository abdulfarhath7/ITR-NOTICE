//! PII masking for logs and screens (docs/07): PAN renders as
//! `AABCV••••K`, phone numbers keep their last four digits.

pub fn pan(pan: &str) -> String {
    let p = pan.trim();
    if p.len() != 10 {
        return "•".repeat(p.len().clamp(1, 10));
    }
    format!("{}••••{}", &p[..5], &p[9..])
}

