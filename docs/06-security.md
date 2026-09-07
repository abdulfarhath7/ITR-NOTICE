# 06 · Security & data

## Network
- The app listens on nothing. There is no loopback server, so no port, no CORS
  and no launch token to get wrong.
- Exactly two outbound paths: Playwright to `incometax.gov.in`, and `claude.rs`
  to the firm's proxy over HTTPS with a bearer token.
- The webview holds `core:default` only. A compromised page cannot touch the
  filesystem, spawn a process, or reach the network beyond the CSP.

## Secrets
Windows Credential Manager, service `in.noticedesk.app`:

| Entry | What |
|---|---|
| `archive-key` | 32 random bytes, hex — the SQLCipher key |
| `portal:<PAN>` | the portal password, only if the user ticks "remember" |
| `firm-token` | the proxy bearer token |

`settings.json` holds the proxy URL, the last user id and the remember flag —
nothing secret. The default path is still "typed each time": the app logs in
without ever storing a password.

## Data at rest
- One SQLCipher file holds everything: proceedings, notices, PDF blobs, drafts.
  Data never leaves the machine except one PDF at a time to the proxy.
- The scraper's staging cache holds no real PDF — the blob is replaced by a
  1-byte marker as soon as the archive has it.
- **The key is per Windows user and per machine.** Losing the profile loses the
  archive. Say this in onboarding before a firm has a year of notices in it.

## The proxy boundary
- It holds the Anthropic key and the prompts; the desktop app holds neither.
- Stateless by construction: a PDF in, JSON out, nothing written, nothing logged.
  Under DPDP that keeps you a processor for the firm — keep it that way.
- One bearer token per firm, compared with `secrets.compare_digest`. No metering
  and no cap yet (QUESTIONS.md Q11).
