//! PII masking for logs and screens (docs/07): PAN renders as
//! `AABCV••••K`, phone numbers keep their last four digits.

pub fn pan(pan: &str) -> String {
    let p = pan.trim();
    if p.len() != 10 {
        return "•".repeat(p.len().clamp(1, 10));
    }
    format!("{}••••{}", &p[..5], &p[9..])
}

pub fn phone(phone: &str) -> String {
    let digits: String = phone.chars().filter(|c| c.is_ascii_digit()).collect();
    if digits.len() < 4 {
        return "•".repeat(digits.len().max(1));
    }
    format!("••••••{}", &digits[digits.len() - 4..])
}
