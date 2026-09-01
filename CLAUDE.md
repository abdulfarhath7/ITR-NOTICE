# CLAUDE.md — ITR notice tool

## What this is

A single-user internal web tool. It logs into the Indian income tax portal
(eportal.incometax.gov.in) by itself with credentials the owner types into the
dashboard (held in server memory only), walks
Pending Actions → e-Proceedings, downloads every notice PDF, and shows them in
a local dashboard. Later, the Claude API reads notices to (a) find missing due
dates and (b) draft replies. One user, own account, no multi-tenant anything.

Stack: FastAPI + Playwright (async) + SQLite + vanilla-JS dashboard, all in
one process. `uvicorn app.main:app --reload`, open http://localhost:8000.
Docker files exist and must keep working (deploy target: AWS Lightsail Mumbai).

## Current state (all tested except where noted)

- `app/db.py` — schema + upserts. TESTED: proceeding dedup across syncs
  (NULL keys normalized to ''), notice dedup by ref_id, and
  `set_claude_due_date()` fills only NULL due dates and never overwrites.
- `app/config.py` — .env knobs only: ANTHROPIC_API_KEY, HEADLESS, NOTICES_DIR.
  Portal credentials deliberately absent.
- `app/portal/session.py` — login flow. `PortalSession(events, user_id,
  password)` takes the login from the caller, never from settings. Written
  from screenshots, NOT yet run
  against the live portal. Implements: User ID page → Continue → tick the
  "confirm your secure access message" checkbox → password → Continue; then a
  60s settle loop that handles force-login popups (generic button-name match),
  OTP pause (blocks on `events.request_otp()`), and wrong-password abort.
  Proactive re-login when <2 min of the 15-min session remain
  (`ensure_alive()` — call it before every scraping action).
- `app/portal/scraper.py` — full walk structure + parsers. Written from
  screenshots, NOT yet run live. **This is the first thing to verify.**
- `app/main.py` — REST + WebSocket event hub, and the in-memory credential
  holder on `EventHub` (`set_credentials` / `credentials` / `has_credentials` /
  `clear_credentials`). POST /api/credentials stores the login and starts the
  sync; DELETE /api/credentials is the "Change login" wipe; /api/sync returns
  `{"state": "credentials_required"}` instead of starting when nothing is held.
  A WrongPasswordError clears the login and pushes `credentials_required` with
  the error text. TESTED (test_app.py): the credential rules above, /api/otp
  relay, /api/notices, 404 on missing PDF, WS handshake,
  /api/notices/{ref_id}/ask-claude is a 501 stub (build step 5).
- `app/static/index.html` — working dashboard: credentials form (masked
  password, shown when the server holds no login and re-shown with an error
  after a rejected password), "Change login" in the header, Sync button, live
  log, OTP input that appears on `otp_required`, notices table with overdue
  highlight, "no due date" pill, "by Claude" tag, per-notice Download.
- `test_app.py` — TestClient script, no browser. Run `python test_app.py`.

## Portal facts (from real screenshots of this account — trust these)

- Login URL: https://eportal.incometax.gov.in/iec/foservices/#/login
  Page 1: placeholder "PAN/ AADHAAR/ OTHER USER ID", button "Continue".
  Page 2: shows "Secure Access Message" + a checkbox labelled "Please confirm
  your secure access message displayed above" (MUST be ticked), password
  field, "Continue". No captcha. OTP not seen on this account but the relay
  must stay in place.
- Force-login: when logged in elsewhere the portal shows a popup; exact
  markup unknown (screenshot pending). Current handler clicks the first
  visible button named "Login Here" / "Force Login" / "Continue Login" /
  "Yes". Tighten when the screenshot arrives; keep it auto-click (owner wants
  the tool to steal the session).
- Header shows "Session Time 14:59" counting down from 15:00. Optional
  improvement: parse it instead of the internal clock in `session.py`.
- e-Proceedings URL: .../#/dashboard/eProceedings
  Tabs: "Self", "Of Other PAN/TAN", "As Authorized Representative" (third tab
  absent on company accounts — skip if missing). Sub-tabs: "For your Action
  (N)", "For your Information (N)". Top right: search box, "Filter" button,
  "Excel Download". Pagination: "Items per Page" select.
- Filter panel contains: Proceeding Status radios (Open/Pending, Closed,
  Submitted, e-Submission re-enabled by AO, e-Submission closed by officer),
  "New e-Proceedings" checkbox, Applicable Act (Income Tax Act 1961 / 2025),
  four date ranges (Proc Created / Proc Closure / Proc Limitation / Notice
  Issued), Reset / Cancel / Apply. Not used yet; v1 scrapes everything.
- Proceeding card labels: "Proceeding Name", PAN, "Name of Assessee",
  "Assessment Year", "Financial Year", "Applicable Act", "Proceeding Closure
  Date", "Proceeding Closure Order", status words Open/Closed, and a button
  "View Notices/Orders (N)".
- View Notices page (.../viewNotices/all): each notice card shows
  "Notice/ Communication Reference ID : <digits>", "Notice u/s", a document
  reference like ITBA/COM/F/17/2026-27/1092231604(1), "Description",
  "Issued On", sometimes "Served On", sometimes "Response Due Date",
  sometimes "Response viewed by AO on". Buttons vary per notice:
  "Notice/Letter Pdf" (always), "View Response" / "Submit Response",
  "Seek Video Conferencing", "Seek/View Adjournment".
- Clicking "Notice/Letter Pdf" navigates to .../viewNotices/viewDetailedNotice
  — a letter view with a .pdf filename link and a "Download" button. The
  scraper downloads there, then goes back.
- Real quirk to test with: this account has an "Issue Letter" notice
  (ref 100118320996) with Date "-", AY "Not Available" and NO due date —
  the exact case the Ask-Claude feature exists for.

## Roadmap, in order

1. **Verify live** — run with HEADLESS=false, watch login + one full sync.
   Fix `_proceeding_cards` / `_notice_cards` / `_parse_*` in scraper.py
   against the real DOM (the current `div has_text` locators are almost
   certainly too broad — they may match ancestor divs; prefer the tightest
   repeating container). Handle pagination if >10 items despite the
   items-per-page select. Then set the README checkbox for step 3 to
   "verified".
2. **Step 5 — Ask-Claude due date.** Implement the 501 stub:
   read the stored PDF for ref_id → send to Claude API (model
   claude-sonnet-4-6 unless owner says otherwise, anthropic Python SDK,
   key from ANTHROPIC_API_KEY) with the PDF as a document block → ask for the
   response due date; if none is stated, infer from the notice text (e.g.
   "within 15 days of receipt" + Issued On/Served On) → expect strict JSON
   {"due_date": "DD-MMM-YYYY" | null, "basis": "<one line>"} → on a date,
   call `db.set_claude_due_date()` (already written; fills once, never
   overwrites, tags source='claude') → return it. Frontend: add an
   "Ask Claude" button on rows with the "no due date" pill; on success swap
   in the date + the existing "by Claude" tag; store `basis` in a new
   nullable column and show it as a tooltip/subtitle. Cache rule is sacred:
   if due_date_source='claude' already, return the stored value, never call
   the API again.
3. **Step 6 — draft replies (LAST).** New endpoint: send the notice PDF to
   Claude, get a structured draft reply + list of documents demanded.
   Output is a DRAFT for the owner to review — never auto-submit anything.

## Hard guardrails — never violate, never "improve" away

- READ-ONLY on the portal: never click Submit Response, View Response,
  File Appeal, Seek Video Conferencing, Seek/View Adjournment, or anything
  that writes. The FORBIDDEN tuple in scraper.py documents this.
- NEVER retry a rejected password — the portal locks accounts. The
  WrongPasswordError flow must stay a hard stop.
- Portal credentials are memory-only: typed into the dashboard, held on the
  EventHub for the life of the process, never written to SQLite or any file,
  never logged, never echoed in a response body. A server restart forgetting
  them is intended — do not add persistence. .env holds only ANTHROPIC_API_KEY
  and HEADLESS (gitignored; never commit it).
- Never overwrite a portal-sourced due date with a Claude one; Claude dates
  are always tagged due_date_source='claude' and shown with the badge.
- Once a notice PDF is stored, never re-download it; once Claude has answered
  for a ref_id, never re-ask (cost + consistency).
- No third-party services beyond the portal itself and the Anthropic API.
- Playwright locators stay text/label-based (survives portal facelifts);
  don't switch to brittle CSS class chains.

## Conventions

- Python 3.12, async throughout the portal layer; keep everything in the
  existing modules rather than adding frameworks.
- Any new browser action must call `session.ensure_alive()` first.
- New DB columns: add to SCHEMA and write a tiny idempotent
  `ALTER TABLE ... ADD COLUMN` migration guarded by a PRAGMA table_info
  check in `init_db()` (the db file already exists on the owner's machine).
- Test the way the repo already does: plain `python -c` scripts hitting
  db.py and FastAPI's TestClient; no browser automation in tests.
- The owner is a developer but new to tax terminology — keep comments plain.

## Run / test

    ./run.sh                 # the only command: venv, deps, chromium, .env,
                             # opens http://localhost:8000, starts the server
    RUN_DEV=1 ./run.sh       # same but with uvicorn --reload
    .venv/bin/python test_app.py    # TestClient checks, no browser

`run.sh` is idempotent: a marker file (`.venv/.deps-ok`, invalidated whenever
requirements.txt is newer) skips pip, and a glob on the Playwright browser
cache skips the Chromium download, so a second run starts in about a second.
It refuses to start if port 8000 is already in use rather than picking another.
Keep it that way - one command, never two.

The portal user ID and password are typed into the dashboard on first sync.

Docker (must keep working): docker compose up -d
