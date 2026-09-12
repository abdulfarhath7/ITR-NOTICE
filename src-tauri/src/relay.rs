//! The relay client (docs/04, docs/08). Every request is signed with the
//! device's Ed25519 key; every changeset body is sealed with the firm key
//! before it leaves this machine. The relay sees ciphertext and routing.

use crate::bundle;
use crate::error::{AppError, AppResult};
use crate::ids::now;
use crate::ledger::{CursorMap, Entry};
use crate::repo::local;
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::Engine;
use ed25519_dalek::Signer;
use rand::RngCore;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

pub const KEY_URL: &str = "relay_url";
pub const KEY_FIRM: &str = "firm_id";
pub const KEY_FIRM_NAME: &str = "firm_name";
pub const KEY_PUBLISHED: &str = "relay_published_seq";
pub const KEY_LAST_SYNC: &str = "relay_last_sync_at";
pub const KEY_LAST_ERROR: &str = "relay_last_error";
pub const KEY_COLLECTOR_SEEN: &str = "relay_collector_last_seen";
pub const KEY_COLLECTOR_ID: &str = "relay_collector_id";
pub const KEY_HEADS: &str = "relay_heads";
pub const KEY_PERMISSION: &str = "relay_permission";
pub const FIRM_KEY: &str = "firm-key";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelayConfig {
    pub url: String,
    pub firm_id: String,
    pub firm_name: Option<String>,
    pub device_id: String,
}

pub fn config(con: &Connection) -> AppResult<Option<RelayConfig>> {
    let (Some(url), Some(firm_id)) = (local::get(con, KEY_URL)?, local::get(con, KEY_FIRM)?) else { return Ok(None); };
    Ok(Some(RelayConfig { url, firm_id, firm_name: local::get(con, KEY_FIRM_NAME)?, device_id: local::device_id(con)? }))
}

pub fn require_config(con: &Connection) -> AppResult<RelayConfig> {
    config(con)?.ok_or_else(|| AppError::state("this device is not enrolled with a relay"))
}

// ------------------------------------------------------------ firm key

fn firm_key() -> AppResult<[u8; 32]> {
    let hex_key = crate::keychain::load_secret(FIRM_KEY).map_err(|e| AppError::Keychain { message: e })?
        .ok_or_else(|| AppError::state("the firm key is not on this device"))?;
    let bytes = hex::decode(hex_key).map_err(|_| AppError::state("firm key is malformed"))?;
    bytes.try_into().map_err(|_| AppError::state("firm key has the wrong length"))
}

fn store_firm_key(key: &[u8; 32]) -> AppResult<()> {
    crate::keychain::save_secret(FIRM_KEY, &hex::encode(key)).map_err(|e| AppError::Keychain { message: e })
}

pub fn seal(plain: &[u8]) -> AppResult<Vec<u8>> {
    let key = firm_key()?;
    let mut nonce = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce);
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| AppError::state(e.to_string()))?;
    let ct = cipher.encrypt(Nonce::from_slice(&nonce), plain).map_err(|_| AppError::state("sealing failed"))?;
    let mut out = nonce.to_vec();
    out.extend_from_slice(&ct);
    Ok(out)
}

pub fn open(sealed: &[u8]) -> AppResult<Vec<u8>> {
    if sealed.len() < 12 { return Err(AppError::invalid("sealed blob too short")); }
    let key = firm_key()?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| AppError::state(e.to_string()))?;
    cipher.decrypt(Nonce::from_slice(&sealed[..12]), &sealed[12..])
        .map_err(|_| AppError::state("a changeset could not be opened with this firm's key"))
}

/// Opaque per-client key for the relay's locks and refresh requests: the
/// relay never learns a PAN.
pub fn client_key(login_ref: &str) -> AppResult<String> {
    let key = firm_key()?;
    let mut h = Sha256::new();
    h.update(key);
    h.update(b"|client|");
    h.update(login_ref.trim().to_ascii_uppercase().as_bytes());
    Ok(hex::encode(h.finalize()))
}

// ------------------------------------------------------------ transport

pub struct Relay {
    pub cfg: RelayConfig,
    http: reqwest::Client,
}

/// What an enrolment call brings back; stored by `store_enrolment`.
pub struct Enrolment {
    pub config: RelayConfig,
    pub firm_key: [u8; 32],
    pub permission: String,
    pub recovery_code: String,
}

pub fn store_enrolment(con: &Connection, e: &Enrolment) -> AppResult<()> {
    store_firm_key(&e.firm_key)?;
    local::set(con, KEY_URL, &e.config.url)?;
    local::set(con, KEY_FIRM, &e.config.firm_id)?;
    if let Some(n) = &e.config.firm_name { local::set(con, KEY_FIRM_NAME, n)?; }
    local::set(con, KEY_PERMISSION, &e.permission)?;
    Ok(())
}

#[derive(Debug)]
pub struct Fetched {
    pub entries: Vec<Entry>,
    pub heads: CursorMap,
    pub more: bool,
    pub collector: Option<(String, Option<String>)>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DeviceRow {
    pub id: String,
    pub name: String,
    pub permission: String,
    pub role: String,
    pub ram_mb: Option<i64>,
    pub enrolled_at: String,
    pub last_seen: Option<String>,
    pub removed_at: Option<String>,
    #[serde(default)]
    pub head: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Roster {
    pub firm: Value,
    pub devices: Vec<DeviceRow>,
    pub lease: Option<Value>,
    pub nominee_id: Option<String>,
    pub you: Value,
}

impl Relay {
    pub fn new(cfg: RelayConfig) -> Self {
        let http = reqwest::Client::builder().timeout(std::time::Duration::from_secs(60)).build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Relay { cfg, http }
    }

    fn signed_headers(&self, method: &str, path: &str, body: &[u8], device_id: Option<&str>) -> AppResult<Vec<(String, String)>> {
        let key = bundle::signing_key()?;
        let ts = now();
        let digest = hex::encode(Sha256::digest(body));
        let msg = format!("{method}\n{path}\n{ts}\n{digest}");
        let sig = key.sign(msg.as_bytes());
        let mut h = vec![
            ("X-Timestamp".to_string(), ts),
            ("X-Signature".to_string(), base64::engine::general_purpose::STANDARD.encode(sig.to_bytes())),
        ];
        if let Some(d) = device_id { h.push(("X-Device-Id".to_string(), d.to_string())); }
        Ok(h)
    }

    #[allow(clippy::too_many_arguments)]
    async fn call(&self, method: reqwest::Method, path: &str, query: &[(&str, String)], body: Vec<u8>,
                  content_type: &str, extra: &[(&str, String)], device_id: Option<&str>) -> AppResult<reqwest::Response> {
        let url = format!("{}{}", self.cfg.url.trim_end_matches('/'), path);
        let mut req = self.http.request(method.clone(), &url).query(query);
        for (k, v) in self.signed_headers(method.as_str(), path, &body, device_id)? { req = req.header(k, v); }
        for (k, v) in extra { req = req.header(*k, v); }
        req = req.header("Content-Type", content_type).body(body);
        let resp = req.send().await.map_err(|e| AppError::Proxy { message: format!("cannot reach the relay: {e}") })?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            let detail: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
            let msg = detail.get("detail").and_then(Value::as_str).map(str::to_string).unwrap_or(text);
            return Err(AppError::Proxy { message: format!("relay {status}: {msg}") });
        }
        Ok(resp)
    }

    async fn json(&self, method: reqwest::Method, path: &str, body: Option<Value>, extra: &[(&str, String)]) -> AppResult<Value> {
        let bytes = body.map(|b| serde_json::to_vec(&b)).transpose()?.unwrap_or_default();
        let resp = self.call(method, path, &[], bytes, "application/json", extra, Some(&self.cfg.device_id.clone())).await?;
        resp.json().await.map_err(|e| AppError::Proxy { message: format!("bad relay answer: {e}") })
    }

    // -------------------------------------------------------- bootstrap

    /// Register a firm: this device becomes admin, mints the firm key, and
    /// receives the recovery code (returned once; the caller shows it once).
    /// No archive lock is held across the network call; the caller stores
    /// the result with `store_enrolment`.
    pub async fn register_firm(url: &str, device_id: &str, firm_name: &str, device_name: &str, email: Option<&str>) -> AppResult<Enrolment> {
        let key = bundle::signing_key()?;
        let tmp = Relay::new(RelayConfig { url: url.into(), firm_id: String::new(), firm_name: None, device_id: device_id.into() });
        let body = json!({ "name": firm_name, "device_id": device_id, "device_name": device_name, "email": email,
                           "public_key": bundle::public_key_b64(&key), "ram_mb": ram_mb() });
        let bytes = serde_json::to_vec(&body)?;
        let resp = tmp.call(reqwest::Method::POST, "/v1/firms", &[], bytes, "application/json", &[], None).await?;
        let v: Value = resp.json().await.map_err(|e| AppError::Proxy { message: e.to_string() })?;
        let firm_id = v["firm_id"].as_str().ok_or_else(|| AppError::Proxy { message: "no firm id".into() })?.to_string();
        let mut fk = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut fk);
        Ok(Enrolment {
            config: RelayConfig { url: url.into(), firm_id, firm_name: Some(firm_name.into()), device_id: device_id.into() },
            firm_key: fk, permission: "admin".into(),
            recovery_code: v["recovery_code"].as_str().unwrap_or("").to_string(),
        })
    }

    /// Join with an invite string `firm_id.invite_code.firm_key_hex`
    /// (typed from the admin). The key part never reaches the relay.
    pub async fn enrol(url: &str, device_id: &str, invite: &str, device_name: &str, email: Option<&str>) -> AppResult<Enrolment> {
        let parts: Vec<&str> = invite.trim().split('.').collect();
        if parts.len() != 3 { return Err(AppError::invalid("an invite looks like firm.code.key")); }
        let (firm_id, code, key_hex) = (parts[0], parts[1], parts[2]);
        let fk: [u8; 32] = hex::decode(key_hex).ok().and_then(|b| b.try_into().ok())
            .ok_or_else(|| AppError::invalid("the invite's key part is malformed"))?;
        let key = bundle::signing_key()?;
        let tmp = Relay::new(RelayConfig { url: url.into(), firm_id: firm_id.into(), firm_name: None, device_id: device_id.into() });
        let body = json!({ "invite_code": code, "device_id": device_id, "device_name": device_name, "email": email,
                           "public_key": bundle::public_key_b64(&key), "ram_mb": ram_mb() });
        let path = format!("/v1/firms/{firm_id}/devices");
        let bytes = serde_json::to_vec(&body)?;
        tmp.call(reqwest::Method::POST, &path, &[], bytes, "application/json", &[], None).await?;
        Ok(Enrolment {
            config: RelayConfig { url: url.into(), firm_id: firm_id.into(), firm_name: None, device_id: device_id.into() },
            firm_key: fk, permission: "member".into(), recovery_code: String::new(),
        })
    }

    /// Recover admin on a fresh device with the recovery code plus the
    /// firm key (from any other firm device or a bundle).
    pub async fn recover(url: &str, device_id: &str, firm_id: &str, recovery_code: &str, key_hex: &str, device_name: &str, email: Option<&str>) -> AppResult<Enrolment> {
        let fk: [u8; 32] = hex::decode(key_hex.trim()).ok().and_then(|b| b.try_into().ok())
            .ok_or_else(|| AppError::invalid("the firm key is malformed"))?;
        let key = bundle::signing_key()?;
        let tmp = Relay::new(RelayConfig { url: url.into(), firm_id: firm_id.into(), firm_name: None, device_id: device_id.into() });
        let body = json!({ "recovery_code": recovery_code, "device_id": device_id, "device_name": device_name, "email": email,
                           "public_key": bundle::public_key_b64(&key), "ram_mb": ram_mb() });
        let path = format!("/v1/firms/{firm_id}/admin/recover");
        let bytes = serde_json::to_vec(&body)?;
        let resp = tmp.call(reqwest::Method::POST, &path, &[], bytes, "application/json", &[], None).await?;
        let v: Value = resp.json().await.map_err(|e| AppError::Proxy { message: e.to_string() })?;
        Ok(Enrolment {
            config: RelayConfig { url: url.into(), firm_id: firm_id.into(), firm_name: None, device_id: device_id.into() },
            firm_key: fk, permission: "admin".into(),
            recovery_code: v["recovery_code"].as_str().unwrap_or("").to_string(),
        })
    }

    // -------------------------------------------------------- roster & roles

    pub async fn roster(&self) -> AppResult<Roster> {
        let v = self.json(reqwest::Method::GET, &format!("/v1/firms/{}/devices", self.cfg.firm_id), None, &[]).await?;
        Ok(serde_json::from_value(v)?)
    }

    pub async fn create_invite(&self) -> AppResult<String> {
        let v = self.json(reqwest::Method::POST, &format!("/v1/firms/{}/invites", self.cfg.firm_id), Some(json!({})), &[]).await?;
        let code = v["invite_code"].as_str().unwrap_or("").to_string();
        Ok(format!("{}.{}.{}", self.cfg.firm_id, code, hex::encode(firm_key()?)))
    }

    pub async fn set_collector(&self, device_id: &str) -> AppResult<()> {
        self.json(reqwest::Method::POST, &format!("/v1/firms/{}/collector", self.cfg.firm_id), Some(json!({"device_id": device_id})), &[]).await?;
        Ok(())
    }

    pub async fn remove_device(&self, device_id: &str) -> AppResult<()> {
        self.json(reqwest::Method::DELETE, &format!("/v1/firms/{}/devices/{device_id}", self.cfg.firm_id), None, &[]).await?;
        Ok(())
    }

    /// Where collector-silent alerts go for this device's user (Q17).
    pub async fn set_email(&self, email: Option<&str>) -> AppResult<()> {
        self.json(reqwest::Method::POST, &format!("/v1/firms/{}/me/email", self.cfg.firm_id), Some(json!({"email": email})), &[]).await?;
        Ok(())
    }

    pub async fn transfer_admin(&self, device_id: &str) -> AppResult<()> {
        self.json(reqwest::Method::POST, &format!("/v1/firms/{}/admin/transfer", self.cfg.firm_id), Some(json!({"device_id": device_id})), &[]).await?;
        Ok(())
    }

    // -------------------------------------------------------- lease & locks

    /// Claim or renew. `still_nominee = false` on a renewal means the admin
    /// has nominated someone else: finish the client in progress and release.
    pub async fn claim_lease(&self) -> AppResult<bool> {
        let v = self.json(reqwest::Method::POST, &format!("/v1/firms/{}/lease", self.cfg.firm_id), Some(json!({})), &[]).await?;
        Ok(v["still_nominee"].as_bool().unwrap_or(true))
    }

    pub async fn release_lease(&self) -> AppResult<()> {
        self.json(reqwest::Method::DELETE, &format!("/v1/firms/{}/lease", self.cfg.firm_id), None, &[]).await?;
        Ok(())
    }

    pub async fn lease(&self) -> AppResult<Value> {
        self.json(reqwest::Method::GET, &format!("/v1/firms/{}/lease", self.cfg.firm_id), None, &[]).await
    }

    pub async fn acquire_lock(&self, login_ref: &str) -> AppResult<bool> {
        let key = client_key(login_ref)?;
        match self.json(reqwest::Method::POST, &format!("/v1/firms/{}/locks/{key}", self.cfg.firm_id), Some(json!({})), &[]).await {
            Ok(_) => Ok(true),
            Err(AppError::Proxy { message }) if message.contains("409") => Ok(false),
            Err(e) => Err(e),
        }
    }

    pub async fn release_lock(&self, login_ref: &str) -> AppResult<()> {
        let key = client_key(login_ref)?;
        self.json(reqwest::Method::DELETE, &format!("/v1/firms/{}/locks/{key}", self.cfg.firm_id), None, &[]).await?;
        Ok(())
    }

    pub async fn request_refresh(&self, login_ref: &str) -> AppResult<()> {
        let key = client_key(login_ref)?;
        self.json(reqwest::Method::POST, &format!("/v1/firms/{}/refresh/{key}", self.cfg.firm_id), Some(json!({})), &[]).await?;
        Ok(())
    }

    pub async fn take_refresh_requests(&self) -> AppResult<Vec<String>> {
        let v = self.json(reqwest::Method::GET, &format!("/v1/firms/{}/refresh", self.cfg.firm_id), None, &[]).await?;
        Ok(v["requests"].as_array().map(|a| a.iter().filter_map(|r| r["client_key"].as_str().map(str::to_string)).collect()).unwrap_or_default())
    }

    // -------------------------------------------------------- changesets

    pub async fn publish(&self, entries: &[Entry], kind: &str) -> AppResult<()> {
        let (Some(first), Some(last)) = (entries.first(), entries.last()) else { return Ok(()); };
        let plain = serde_json::to_vec(entries)?;
        let blob = seal(&plain)?;
        let extra = [("X-Seq-From", first.seq.to_string()), ("X-Seq-To", last.seq.to_string()), ("X-Kind", kind.to_string())];
        self.call(reqwest::Method::POST, &format!("/v1/firms/{}/changesets", self.cfg.firm_id), &[], blob,
                  "application/octet-stream", &extra, Some(&self.cfg.device_id.clone())).await?;
        Ok(())
    }

    pub async fn fetch(&self, cursor: &CursorMap) -> AppResult<Fetched> {
        let path = format!("/v1/firms/{}/changesets", self.cfg.firm_id);
        let q = [("cursor", serde_json::to_string(cursor)?), ("limit", "50".to_string())];
        let resp = self.call(reqwest::Method::GET, &path, &q, Vec::new(), "application/json", &[], Some(&self.cfg.device_id.clone())).await?;
        let v: Value = resp.json().await.map_err(|e| AppError::Proxy { message: e.to_string() })?;
        let mut entries = Vec::new();
        for c in v["changesets"].as_array().cloned().unwrap_or_default() {
            let blob = base64::engine::general_purpose::STANDARD.decode(c["blob_b64"].as_str().unwrap_or(""))
                .map_err(|_| AppError::Proxy { message: "bad blob".into() })?;
            let plain = open(&blob)?;
            let mut batch: Vec<Entry> = serde_json::from_slice(&plain)?;
            entries.append(&mut batch);
        }
        let heads: CursorMap = serde_json::from_value(v["heads"].clone()).unwrap_or_default();
        let collector = v["collector"].as_object().map(|c| (
            c.get("device_id").and_then(Value::as_str).unwrap_or("").to_string(),
            c.get("last_seen").and_then(Value::as_str).map(str::to_string)));
        Ok(Fetched { entries, heads, more: v["more"].as_bool().unwrap_or(false), collector })
    }

    pub async fn publish_snapshot(&self, snapshot_json: &[u8], cursor: &CursorMap) -> AppResult<()> {
        let blob = seal(snapshot_json)?;
        let extra = [("X-Cursor", serde_json::to_string(cursor)?)];
        self.call(reqwest::Method::POST, &format!("/v1/firms/{}/snapshot", self.cfg.firm_id), &[], blob,
                  "application/octet-stream", &extra, Some(&self.cfg.device_id.clone())).await?;
        Ok(())
    }

    pub async fn latest_snapshot(&self) -> AppResult<Option<Vec<u8>>> {
        let path = format!("/v1/firms/{}/snapshot/latest", self.cfg.firm_id);
        match self.call(reqwest::Method::GET, &path, &[], Vec::new(), "application/json", &[], Some(&self.cfg.device_id.clone())).await {
            Ok(resp) => {
                let bytes = resp.bytes().await.map_err(|e| AppError::Proxy { message: e.to_string() })?;
                Ok(Some(open(&bytes)?))
            }
            Err(AppError::Proxy { message }) if message.contains("404") => Ok(None),
            Err(e) => Err(e),
        }
    }
}

fn ram_mb() -> Option<i64> {
    // Best effort: Linux exposes it in /proc; other platforms report nothing.
    std::fs::read_to_string("/proc/meminfo").ok().and_then(|s| {
        s.lines().find(|l| l.starts_with("MemTotal:"))
            .and_then(|l| l.split_whitespace().nth(1)).and_then(|kb| kb.parse::<i64>().ok()).map(|kb| kb / 1024)
    })
}
