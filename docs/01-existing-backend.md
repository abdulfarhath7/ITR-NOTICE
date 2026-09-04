# 01 · Existing backend — REUSE VERBATIM

The `app/` package is a working FastAPI service. **You ship it unchanged as a
sidecar.** Do not rewrite it. This file is the map so you never need to re-read
it wholesale.

## File map (Python, keep as-is)
- `app/main.py` — FastAPI app. `APP_PASSWORD` signed-cookie auth middleware.
  `EventHub` bridges the scraper → WebSocket. Owns all routes + `/ws`.
  Portal credentials are held **in memory only** (typed in at runtime).
- `app/config.py` — `Settings` from `.env`: `anthropic_api_key`, `app_password`,
  `headless`, `hold_on_error`. Credentials are intentionally NOT here.
- `app/db.py` — SQLite. Tables: `proceedings`, `notices` (PDF in `pdf_blob`),
  `drafts` (`response_pdf` blob), `runs`. `init_db()` is idempotent with ALTER
  migrations. **PDFs live in the DB, not on disk.**
- `app/claude_client.py` — `anthropic.AsyncAnthropic`; `MODEL="claude-sonnet-4-6"`.
  `due_date_from_pdf()` and `draft_from_pdf()` send the notice PDF as a document
  block and return JSON. **The prompt text here is the product IP — do not edit.**
- `app/portal/session.py` — `PortalSession` (login, `dismiss_security_popup`,
  `pace_for` = Slow/Fast/Extreme pacing, `announce_phase`, `WrongPasswordError`).
- `app/portal/scraper.py` — `run_sync()`: walks e-Proceedings
  (self / other_pan / auth_rep × action / information), paginates, parses
  proceedings + notices, downloads PDFs. **Fragile portal selectors — never
  regenerate.**
- `app/report.py` — builds the summary (filed / to-file / overdue) + Excel data.
- `app/response_pdf.py` — renders draft text → PDF via `fpdf2`.
- `app/static/` — the OLD vanilla-JS UI. Treat as a **spec** to re-implement in
  React (see `03-api-contract.md`); do not keep it.

## Runtime deps (already in requirements.txt)
`fastapi`, `uvicorn[standard]`, `playwright`, `python-dotenv`, `anthropic`,
`openpyxl`, `fpdf2`.

## The ONLY edits allowed to `app/`
1. Add a tiny `GET /health` returning `{"ok":true}` for sidecar readiness.
2. Add CORS allowing the Tauri app origin + `127.0.0.1` only.
3. Read bind host/port and a shared auth token from env (injected by the shell).
Everything else in `app/` is off-limits.
