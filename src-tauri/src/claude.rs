//! Talks to proxy/main.py. The firm's bearer token is the only credential
//! here, and it lives in the OS keychain like everything else.

use base64::Engine;
use serde::{Deserialize, Serialize};

#[derive(Clone)]
pub struct Proxy {
    pub base_url: String,
    pub firm_token: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DueDateAnswer {
    pub due_date: Option<String>,
    pub basis: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DraftAnswer {
    pub summary: String,
    pub checklist: Vec<String>,
    pub draft_reply: String,
}

fn b64(pdf: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(pdf)
}

impl Proxy {
    fn client(&self) -> reqwest::Client {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(300))
            .build()
            .expect("reqwest client")
    }

    pub async fn due_date(&self, ref_id: &str, pdf: &[u8], issued_on: Option<&str>,
                          served_on: Option<&str>) -> Result<DueDateAnswer, String> {
        let body = serde_json::json!({
            "ref_id": ref_id, "pdf_b64": b64(pdf),
            "issued_on": issued_on, "served_on": served_on,
        });
        self.post("/v1/due-date", &body).await
    }

    pub async fn draft(&self, ref_id: &str, pdf: &[u8], notice_us: Option<&str>,
                       assessee: Option<&str>, assessment_year: Option<&str>) -> Result<DraftAnswer, String> {
        let body = serde_json::json!({
            "ref_id": ref_id, "pdf_b64": b64(pdf), "notice_us": notice_us,
            "assessee": assessee, "assessment_year": assessment_year,
        });
        self.post("/v1/draft", &body).await
    }

    async fn post<T: for<'a> Deserialize<'a>>(&self, path: &str, body: &serde_json::Value) -> Result<T, String> {
        let url = format!("{}{}", self.base_url.trim_end_matches('/'), path);
        let resp = self.client()
            .post(&url)
            .bearer_auth(&self.firm_token)
            .json(body)
            .send().await
            .map_err(|e| format!("proxy unreachable: {e}"))?;
        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("proxy {status}: {text}"));
        }
        resp.json::<T>().await.map_err(|e| format!("bad proxy answer: {e}"))
    }
}
