# 06 · Security & data

## Network
- Sidecar binds `127.0.0.1` only, on an ephemeral port.
- A random shared token is generated per launch and required on every request
  (header). The UI receives it from the Rust layer, never from disk.
- CORS allows only the Tauri app origin + `127.0.0.1`.

## Secrets
- Portal credentials, `APP_PASSWORD`, and the LLM key live in the **OS keychain**
  (Windows Credential Manager via a Tauri keychain plugin), injected into the
  sidecar at spawn. Default mode stays memory-only ("ask each time").
- Never log credentials, the token, or the LLM key. Never write them to files.

## Data at rest
- SQLite holds everything (notices, PDF blobs, drafts). Encrypt with SQLCipher
  (key from keychain). Data never leaves the machine.

## LLM path
- Read the key from keychain/config. Keep a single seam so calls can later be
  pointed at a **managed proxy URL** instead of Anthropic directly.
- If a managed proxy is ever used, that becomes a data-processor path — it must
  be stateless, no-log, and disclosed. Not in scope now; leave the seam only.
