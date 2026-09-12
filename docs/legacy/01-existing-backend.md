# 01 · The reused code

Two Python trees exist in this repo. Know which is which.

## `sidecar/` — shipped
The desktop app's child process.

- `sidecar/app/portal/session.py` — `PortalSession`: login,
  `dismiss_security_popup`, `pace_for` (the Slow/Fast/Extreme pacing),
  `announce_phase`, `WrongPasswordError`.
- `sidecar/app/portal/scraper.py` — `run_sync()`: walks e-Proceedings
  (self / other_pan / auth_rep × action / information), paginates, parses
  proceedings and notices, downloads PDFs. **Fragile portal selectors — never
  regenerate them.**
- `sidecar/app/db.py` — the scraper's own SQLite. In the desktop app this is a
  **staging cache only**; the real record is the Rust-side encrypted archive.
- `sidecar/app/config.py` — `HEADLESS`, `HOLD_ON_ERROR`, `DEBUG_DIR` from env.
- `sidecar/notice_scraper.py` — the wrapper this port added: a JSON-lines
  protocol on stdin/stdout, an `Events` object shaped like the web tool's hub,
  and the handoff that pushes each committed notice (PDF included) to Rust and
  scrubs the staging blob.

`sidecar/app/portal/*` is byte-for-byte the web tool's `app/portal/*`. Keep the
two copies identical; fix selectors in both.

## `app/` — reference only, not shipped
The original FastAPI web tool: `main.py`, `db.py`, `claude_client.py`,
`report.py`, `response_pdf.py`, `static/`. Nothing in the desktop build imports
it. It stays as the origin of the automation and as a behavioural reference —
`report.py` is what `src/lib/buckets.ts` was ported from, and
`claude_client.py` is where the prompts in `proxy/main.py` came from.

Do not "modernise" either tree. Touch `app/` only to keep `portal/` in step.
