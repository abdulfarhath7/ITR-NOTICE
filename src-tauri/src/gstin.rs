//! GSTIN → PAN and state (docs/14). A GSTIN is 15 characters: 2-digit state
//! code, the 10-character PAN, an entity code, `Z`, a checksum. PAN is
//! characters 3 to 12 — derivable, no lookup.

use serde::Serialize;

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
pub struct Derived {
    pub pan: String,
    pub state_code: String,
    pub state_name: Option<String>,
}

/// The GST state codes as published; unknown codes derive a PAN but no
/// state name, and the form leaves the state editable either way.
const STATES: &[(&str, &str)] = &[
    ("01", "Jammu and Kashmir"), ("02", "Himachal Pradesh"), ("03", "Punjab"), ("04", "Chandigarh"),
    ("05", "Uttarakhand"), ("06", "Haryana"), ("07", "Delhi"), ("08", "Rajasthan"),
    ("09", "Uttar Pradesh"), ("10", "Bihar"), ("11", "Sikkim"), ("12", "Arunachal Pradesh"),
    ("13", "Nagaland"), ("14", "Manipur"), ("15", "Mizoram"), ("16", "Tripura"), ("17", "Meghalaya"),
    ("18", "Assam"), ("19", "West Bengal"), ("20", "Jharkhand"), ("21", "Odisha"),
    ("22", "Chhattisgarh"), ("23", "Madhya Pradesh"), ("24", "Gujarat"),
    ("26", "Dadra and Nagar Haveli and Daman and Diu"), ("27", "Maharashtra"), ("29", "Karnataka"),
    ("30", "Goa"), ("31", "Lakshadweep"), ("32", "Kerala"), ("33", "Tamil Nadu"), ("34", "Puducherry"),
    ("35", "Andaman and Nicobar Islands"), ("36", "Telangana"), ("37", "Andhra Pradesh"),
    ("38", "Ladakh"), ("97", "Other Territory"), ("99", "Centre Jurisdiction"),
];

pub fn state_name(code: &str) -> Option<&'static str> {
    STATES.iter().find(|(c, _)| *c == code).map(|(_, n)| *n)
}

pub fn is_pan_shaped(pan: &str) -> bool {
    let b = pan.as_bytes();
    b.len() == 10
        && b[..5].iter().all(|c| c.is_ascii_uppercase())
        && b[5..9].iter().all(|c| c.is_ascii_digit())
        && b[9].is_ascii_uppercase()
}

pub fn derive(gstin: &str) -> Result<Derived, String> {
    let g: String = gstin.trim().to_ascii_uppercase();
    if g.len() != 15 {
        return Err("a GSTIN is 15 characters".into());
    }
    let state_code = g[..2].to_string();
    if !state_code.bytes().all(|c| c.is_ascii_digit()) {
        return Err("a GSTIN starts with a two-digit state code".into());
    }
    let pan = g[2..12].to_string();
    if !is_pan_shaped(&pan) {
        return Err("characters 3 to 12 do not look like a PAN".into());
    }
    Ok(Derived { pan, state_name: state_name(&state_code).map(str::to_string), state_code })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pan_is_characters_three_to_twelve() {
        // The glossary's own example PAN, wrapped in a Karnataka GSTIN shape.
        let d = derive("29AABCV1234K1Z5").unwrap();
        assert_eq!(d.pan, "AABCV1234K");
        assert_eq!(d.state_code, "29");
        assert_eq!(d.state_name.as_deref(), Some("Karnataka"));
        assert!(derive("29AABCV1234K1Z").is_err());
        assert!(derive("XXAABCV1234K1Z5").is_err());
    }
}
