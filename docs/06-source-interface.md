# 06 — The source interface

The portal scraper is a temporary layer. The ERI API is the long-term path:
no browser, no per-client password, no session eviction, no captcha. Build
the seam now so that swap is not a rewrite.

## The interface

```
trait NoticeSource {
    fn login(&mut self, login_ref: &LoginRef) -> Result<Session>;
    fn list_work_items(&self, s: &Session, client: &Client, module: Module)
        -> Result<Vec<WorkItemHeader>>;
    fn fetch_item(&self, s: &Session, id: &ItemRef) -> Result<WorkItemDetail>;
    fn health(&self) -> Result<SourceHealth>;
}
```

Two implementations:

| | `PortalSource` | `EriSource` |
|---|---|---|
| Transport | Playwright sidecar | signed HTTPS calls |
| Credential | per-client or AR login | firm ERI identity + signing key |
| Human at login | yes | no |
| Concurrency | strictly sequential | parallel, rate-limited |
| Can file responses | never | yes, phase 2, behind an approval gate |

Nothing above this interface knows which implementation ran. The UI, the
ledger, sync and exports must not branch on source.

### Build 3 additions (docs/17, protocol v3)

The trait as built also carries the scope hooks. Both have defaults, so an
engine that lacks them still works; it just never gets skipped by the probe.

```
fn probe(&mut self, module: Module, panel: &str, pages: u32) -> Result<ProbeResult>;
fn set_target(&mut self, target: Option<ProceedingTarget>);   // item fetch
```

The runner answers each header with one of four verdicts: `Skip`, `Index`,
`Fetch` or `Stop`. `Index` records the row and leaves its document `pending`.
The engine replies with an item whose bytes are empty.

The portal sidecar speaks line protocol **v3** (`sidecar/ingest/protocol.py`):

| | v2 | v3 |
|---|---|---|
| `probe` command → `probe_done` event | — | SHA-256 over portal row content, first `pages` pages; `list_hash: null` on failure |
| `next` action `index` | — | record the header, no download, answer `item` with `pdf_b64: null, indexed: true` |
| `list.target` | — | walk only the proceeding with this name and AY |
| `panel_done.unidentified` | — | cards rendered without an identifier |

The Rust side reads `ready.protocol`, logs which version it got, and still
drives a v2 sidecar. Against v2 it sends `skip` in place of `index`, since
the runner has already recorded the row, and it treats `probe` as
unavailable, which means "changed".

## Per-client source

`clients.source` ∈ `portal | eri`. **Not a global setting.** A client must
individually authorise the firm as their e-Return Intermediary on the portal,
which happens one client at a time over months. Both engines run side by side
indefinitely. Design for mixed, never for a cutover.

## Row identity must be source-independent

A work item is identified by DIN or reference number plus content hash.
Never by which engine fetched it. A client migrating from `portal` to `eri`
must produce **zero duplicates and zero history loss**. Write a test for this.

## ERI facts already established in this project

Do not re-derive these; they cost real effort to establish.

- Ground truth is **CMS/PKCS#7 detached signature (SHA256withRSA)** with an
  **AES-128/ECB/PKCS5** password cipher, payload shaped
  `{ sign, data, eriUserId }`.
- The OAuth-style flow described in the vendor Word briefs is **wrong**.
  Ignore it.
- `eri_crypto.py` (Python port of the Java/BouncyCastle logic) and
  `test_eri_login.py` (Phase A offline crypto validation, Phase B live UAT
  login) were written for this project but are **not in this repository**
  (checked 2026-09-12); bring them into `sidecar/eri/` when ERI work resumes.
- Phase A crypto roundtrip is confirmed correct.
- Phase B is blocked pending the ITD-supplied UAT URL list, the `SERVICE_NAME`
  string, and the real `clientid` / `client-secret` header names.
- UAT host `uatocpservices.incometax.gov.in` needs a hosts-file entry to
  `43.239.60.30`.
- Python `cryptography`: `pkcs7.PKCS7SignatureBuilder` with `DetachedSignature`
  and `Binary`; `Cipher(algorithms.AES, modes.ECB)` with `padding.PKCS7(128)`.

## What to build now

Build `PortalSource` behind the interface. Create `EriSource` as a stub that
returns `SourceHealth::NotConfigured` and compiles. Do not attempt live ERI
work in this build — it is blocked externally.

## Two consequences to respect

**The ERI signing key never leaves the collector.** It is a far more valuable
secret than 200 portal passwords. It does not sync to laptops.

**Therefore an on-demand refresh of an ERI client cannot run on a laptop.**
It becomes a request queued to the collector. A portal-source client can still
refresh locally. Build both paths from the start.

**When ERI filing eventually arrives,** the current read-only rule becomes:
never write without an explicit per-filing human confirmation recorded in the
audit log. No batch job ever files anything.
