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
- **PDFs live in the database, not the filesystem.** `notices.pdf_blob` holds
  the file; `data/notices/` and NOTICES_DIR are gone. `init_db()` runs a
  one-time `_absorb_pdf_files()` that reads any row still carrying a
  `pdf_path` into its blob, clears the path and then deletes the file (rows
  committed first, so a crash duplicates rather than loses); a path whose file
  has already gone is left alone. The cache rule is now `pdf_blob IS NOT
  NULL`, `upsert_notice` COALESCEs the blob so re-seeing a notice never blanks
  it, and `list_notices()` selects explicit columns plus `has_pdf` - never the
  blob itself, which would push megabytes of base64 into every table refresh.
  The scraper reads the browser's temp download into memory and then calls
  `download.delete()`, so a notice exists in exactly one place. TESTED
  (test_app.py section 23): round trip, both dispositions, the move off disk,
  and that it is idempotent.
- Dependencies: fastapi, uvicorn, playwright, python-dotenv, anthropic, and
  openpyxl (the Excel export only).
- `app/config.py` — .env knobs only: ANTHROPIC_API_KEY, HEADLESS,
  HOLD_ON_ERROR (default 15s, 0 disables), DEBUG_DIR. Portal credentials
  deliberately absent. Browser pace is NOT a knob here any more — see the
  speed control below; NOTICES_DIR is gone — PDFs are in the database.
- `app/portal/session.py` — login flow. `PortalSession(events, user_id,
  password)` takes the login from the caller, never from settings. Written
  from screenshots, NOT yet run against the live portal. Implements: User ID
  page → Continue → tick the "confirm your secure access message" checkbox →
  password → Continue; then a 60s settle loop that handles force-login popups
  (generic button-name match), OTP pause (blocks on `events.request_otp()`),
  and wrong-password abort. Proactive re-login when <2 min of the 15-min
  session remain (`ensure_alive()` — call it before every scraping action).
  TESTED (test_app.py, fake page, no browser): every check in the settle loop
  goes through `first_visible()`, which requires `count()` **and**
  `is_visible()`. This is not a nicety — the portal ships hidden Angular
  templates from page load and `get_by_text` matches substrings, so a
  count-only check read "Please enter valid password" on a perfectly good
  login and aborted every run. Password errors are additionally ignored for
  the first `ERROR_GRACE_SECONDS` (3s) while the password page is still on
  screen, and a real WrongPasswordError quotes the portal's visible words (the
  password itself is never logged). An OTP prompt is relayed once per prompt,
  not once per poll. `save_debug_screenshot()` writes a full-page PNG to
  `data/debug/` on the failure path.
- `app/portal/scraper.py` — REWRITTEN against the live DOM (recon dumps in
  `data/debug/recon*/`, 2026-09-01). Cards are `div.card-container.matCardRow`
  (proceedings) and `div.card-container.matCard` (notices). Navigation between
  pages uses the portal's own "Back" button and same-document hash changes
  only. Parsers TESTED against card text captured verbatim from the account.
  Reaching the list is a hash change plus `_wait_for_list()` - the URL changes
  instantly but Angular paints later, and waiting on the URL alone made the
  first live sync "skip" every tab and report success with 0 proceedings.
  A run that finds no tab now raises instead of finishing clean.
  The end-to-end automated walk has still not completed - that is what remains
  of step 1.
- **The walk commits as it goes** — once per proceeding row, once per notice
  (metadata + `pdf_blob` together), in `_walk_pages()` and
  `_collect_notices()`. It used to hold ONE transaction open for the entire
  sync, so /api/notices and /api/summary read 0 until the run ended and a
  crash at notice 38 discarded the 37 already downloaded. Never wrap the walk
  in a single transaction again. Because the cache check keys on what is
  stored, a crashed run resumes where it died rather than refetching.
  Each committed notice is announced as `{"type": "notice_added", "ref_id"}`
  (`hub.notice_added()`, reached through `_announce()` so an events object
  without the hook still works); the dashboard refreshes the table, the stat
  cards and the report line on it, throttled to at most one refresh per 2s
  with a trailing one so the last notice of a run is never left off. The
  report's "N notices scanned" therefore ticks up live — it counts the
  register, which is whatever is committed.
- Download temp files: Playwright writes each download to a temp path; the
  bytes go into `pdf_blob` and `_discard()` deletes that file immediately in a
  `finally` (`download.delete()`, falling back to an unlink). The download
  shelf visible in a headed run is the portal handing the file over — the
  portal's own UI — and nothing this tool fetches is left on disk.
- Download limit: the dashboard's "Download at most" box caps how many NEW
  PDFs one run may fetch (blank = every notice). It rides on POST /api/sync
  and POST /api/credentials as `limit`, is held on `hub.download_limit`, and
  the walk raises `DownloadLimitReached` the moment the cap is met. Everything
  already stored stays stored, so pressing Sync again carries on where the
  capped run stopped - the notice cache makes that free.
- Speed control (live): three header buttons, Slow / Fast / Extreme, one
  always active, default fast, with a "testing only" caption under Extreme.
  Playwright's `slow_mo` is fixed at launch, so it is set to 0 and the pacing
  is ours: `MODES = {slow: 1.0s, fast: 0.25s, extreme: 0}` on `hub.mode`,
  changed by `POST /api/speed {"mode": "slow|fast|extreme"}` (400 on an
  unknown mode, 422 on a missing one; case and spaces are forgiven), broadcast
  as `{"type": "speed", "mode", "delay_ms"}` over the WebSocket (also sent on
  connect, right after `state`), and
  waited out by `await session.pace()` / `pace_for(events)` before every fill,
  click, parse and download. The delay is re-read on every call, so pressing a
  button in the middle of a sync is felt by the very next action. TESTED
  (test_app.py section 22), including the mid-run change.
- Pipeline bar: the backend emits `{"type": "progress", "stage", "counts"}`
  at every transition — `login` (and `login done=True`), `list`, `walk` (per
  tab/sub-tab and then per card, carrying the human tab labels), `download`
  (notice N of M) and `done` (the run's totals). The dashboard draws a stepper
  above the log: ticked stages behind, the active one pulsing, and
  `countText()` turning the raw counts into "downloading 3 of 12" rather than
  "notice 3 · of 12". An unrecognised key still prints as `key value`.
  `hub.last_progress` is replayed to a browser that connects mid-sync.
- Command palette: Ctrl/Cmd+K, subsequence matching, and the entries are Run
  sync, Toggle theme, Speed: slow/fast/extreme, Filter: missing due date,
  Clear filters, Toggle live viewport, and every stored notice (searched by
  reference id, description or proceeding name; Enter opens the View modal).
  Esc closes it. `s` starts a sync and `/` focuses the name filter, neither
  while the focus is in an input, textarea or select.
- Live viewport: `_viewport_loop()` in main.py screenshots the page every
  `VIEWPORT_INTERVAL` (1.5s) as `type="jpeg", quality=45` and broadcasts
  `{"type": "viewport", "img": <base64>}`. **It captures nothing whenever a
  credential could be on screen**: `session.safe_to_capture()` is false for
  the whole login and for 2s after the password is submitted
  (`sensitive_until`), and the loop skips every frame while
  `hub.state == "otp_required"`. TESTED four ways (test_app.py section 20).
  The dashboard shows it in a collapsed 16:9 monitor card that expands itself
  when a run starts, with the latest log line as the caption; the REC light is
  dim until frames actually arrive and says "paused - OTP on screen" when they
  stop for one.
- Access lock: `APP_PASSWORD` in .env gates the whole app. Unset = open, with
  a loud startup warning (localhost dev only). Set = every HTTP request and the
  WebSocket handshake need a cookie: `<issued-unix-seconds>.<hmac-sha256 of it
  keyed by APP_PASSWORD>`, httpOnly, samesite=lax, 12h. `/api/*` gets 401 JSON,
  anything else gets the password page; a wrong password costs
  `FAILED_LOGIN_DELAY` (2s). Changing APP_PASSWORD invalidates every cookie.
  **secure=False until this is behind TLS** — on plain http the password and
  cookie are readable and replayable by anyone on the path.
- `drafts` table: one row per notice (ref_id primary key) holding summary,
  checklist_json, draft_text and `response_pdf` — the same draft rendered as a
  document by `app/response_pdf.py` (fpdf2). Regenerate overwrites; it never
  accumulates. The PDF is re-rendered anywhere the text can change — a
  generation, a regeneration, and `POST /api/notices/{ref}/draft/text` (the
  drawer's "Save edits", which costs nothing because Claude is not called) —
  so the document and the textarea can never tell different stories.
  `GET /api/notices/{ref}/draft.pdf?inline=1` feeds the same viewer modal the
  notices use; without the flag it downloads. A draft written before the
  column existed is rendered on first request rather than 404ing.
  fpdf2's core fonts are cp1252-only, so `_plain()` maps ₹ → "Rs.", em/en
  dashes → "-", curly quotes → straight, ✦ → "*"; the footer on every page is
  literally `DRAFT - prepared for review. Not filed.`
- `app/claude_client.py` — the Claude API calls. Model `claude-sonnet-4-6`,
  async SDK client, PDF taken as bytes (from `pdf_blob`) and sent as a base64
  document block, answers pinned by
  `output_config={"format": {"type": "json_schema", ...}}` so the reply is a
  dict, not prose. `have_key()` treats the .env.example placeholder as missing.
- `app/main.py` — REST + WebSocket event hub, and the in-memory credential
  holder on `EventHub` (`set_credentials` / `credentials` / `has_credentials` /
  `clear_credentials`). POST /api/credentials stores the login and starts the
  sync; DELETE /api/credentials is the "Change login" wipe; /api/sync returns
  `{"state": "credentials_required"}` instead of starting when nothing is held.
  A WrongPasswordError clears the login and pushes `credentials_required` with
  the error text. TESTED (test_app.py): the credential rules above, /api/otp
  relay, /api/notices, 404 on missing PDF, WS handshake,
  /api/notices/{ref_id}/ask-claude is a 501 stub (build step 5).
- Preview vs Download: `/api/notices/{ref_id}/pdf?inline=1` streams the stored
  blob as `Content-Disposition: inline` with `application/pdf`, so the browser
  renders it; without the flag it is an attachment download.
- Overview, above the table, all computed from one /api/notices call:
  (a) the hero strip — due this week, overdue, missing date, drafts ready,
  total — plus a ring for documents held; (b) a "Last sync" line reading the
  newest finished row of `runs`, which now carries `notices_new`,
  `pdfs_saved` and `skipped_cached` (written by `db.finish_run()` from the
  scraper's stats; a failed run shows its status and message instead of
  counts it did not earn); (c) a Status cell on every row with three marks —
  PDF ✓/·, Date ✓/·, Draft ✓/· — so the table reads as the checklist. The
  numbers always count everything, never the filtered view. Filters
  (assessment year, proceeding-name contains, missing-due-date toggle) stay
  pure frontend over the rows already fetched.
  `list_notices()` supplies `has_pdf` and `has_draft` for all of it.
- The dashboard is **dark-first, one accent, colour only where it means
  something** (the owner chose the build brief's palette over the VCFO
  borrowings that were here before): ground #0a0b0d, panels #131417,
  hairlines #26272b, text #ececf1, muted #8b8d98; #ef4444 overdue, #f59e0b
  missing date, #22c55e done, #6e79f7 for everything Claude wrote — never the
  action colour, so AI text can never read as a button. Exactly one gradient,
  `135deg #5b63f0 → #8b5cf6`, worn by exactly two buttons: Sync and Draft
  (`class="primary accent"`). Status stays a solid/-soft/-text triple, chips
  are tinted fills with no outline, radii 10/8/6 with pills only for chips.
  Geist Sans + Geist Mono self-hosted in `app/static/fonts/`; both stacks fall
  back to the system face, and nothing on the page depends on the webfont
  loading. Light theme redefines every semantic token under
  `[data-theme='light']`. The hero band (greeting, ring) stays gone;
  what came back in its place is a plain row of five stat cards — Total
  notices, Due this week, Missing date, Docs saved, Drafts ready, counted over
  everything the account holds and never over the filtered view — and one
  "Last sync" line off the runs table. **That line is failure-safe on
  purpose**: a failed run renders only its status word, with the message in
  the tooltip, and the line is `nowrap` + `text-overflow: ellipsis`. The
  earlier version printed the message inline and a WrongPasswordError sentence
  spilled across the top of the page, truncated mid-word. Do not put run
  messages back into the page text.
- Per-notice state is four dots in the row's Status cell — PDF, date, draft,
  responded on portal — filled green when done, hollow when not, dashed when
  unknown, each with its own tooltip and aria-label.
- The report (`app/report.py`) now knows about replies: `bucket_of(days,
  open_, responded)` puts an answered open notice in its own **Responded**
  bucket, so a filed reply outranks any date and can never show as overdue.
  The chips are the seven exclusive buckets — Overdue, Due ≤3 days, Due ≤10
  days, On track, No due date, Responded, Closed — plus one group chip, **To
  respond**, which is the total of the five outstanding ones (`GROUPS` in
  report.py, `BUCKET_GROUPS` in app.js: one rule, two places that must agree).
  The attention list is overdue + due ≤3 days + no due date at all, answered
  notices excluded by virtue of their bucket, sorted worst first with the
  dateless ones last. Both spreadsheet sheets carry a **Responded** column
  reading Yes / No / Unknown.
- Responded status: the notice card shows either "Submit Response" (nothing
  filed) or "View Response" (a reply exists), so `_responded_from(card_text)`
  reads which one is there — **neither is ever clicked; both stay in
  FORBIDDEN**. Stored as `notices.responded` (1 / 0 / NULL unknown). This is
  the one field that is deliberately NOT cached: a reply can be filed at any
  time, so every sync rewrites it, including for notices whose PDF is already
  held (`db.set_responded()` runs before the cache `continue`). An unknown
  reading never clobbers a known one — the upsert COALESCEs
  `excluded.responded` over the stored value. TESTED (section 28): both button
  texts, neither, casing, and that "Seek/View Adjournment" is not mistaken for
  a filed reply.
- Table: sticky 11px uppercase muted headers, hairline row separators only,
  mono + tabular-nums for identifiers and dates, and the row's action buttons
  appear on hover (`:focus-within` for the keyboard, always on a touch
  device). Due dates are countdown chips — `12d` / `3d` / `overdue 2d` — red
  inside three days or already gone, amber to a fortnight, green beyond it.
  Skeleton shimmer while loading, a designed empty state with its own title
  and description. Every animation sits inside a
  `prefers-reduced-motion: no-preference` guard and runs in 150–200ms.
- Dashboard v2 is three static files, no build step: `index.html` (markup),
  `style.css` (tokens + components), `app.js` (all behaviour). Geist Sans and
  Geist Mono are self-hosted in `app/static/fonts/` — no CDN at runtime, and a
  test fails if one reappears. Dark is default; `[data-theme=light]` is the
  light token set and the choice rides in a cookie, not localStorage.
  Colour is meaning-only: red overdue, amber missing date, green fine, indigo
  (#6e79f7) for everything Claude, and the gradient is reserved for Sync and
  Generate response. Due dates render as countdown chips computed client-side.
- Live viewport: during a sync the server screenshots the page every
  `VIEWPORT_INTERVAL` (1.5s) at jpeg quality 45 and pushes
  `{"type":"viewport","img":<base64>}` over the existing WebSocket.
  During login the card shows a staged animation instead of frames - a pulsing
  lock, the phase in words, and a step bar - fed by
  `{"type":"login_phase","phase":...}` pushed from `session.announce_phase()`
  at five real moments: opening, credentials, otp, force_login, done. The hub
  only forwards a phase when it changes (the settle loop polls). The REC light
  stays off through every phase and lights only when the first real frame
  arrives; a rejected password swaps the card to a quiet "Login failed" rather
  than leaving it stuck mid-phase. This changed nothing about capture:
  **it must never show a credential**: `PortalSession.safe_to_capture()` is
  false for the whole of `login()` and two seconds after it, and the loop also
  skips every frame while `hub.state == "otp_required"`. Tests cover all three.
- Pipeline stepper: `hub.progress(stage, **counts)` broadcasts
  `{"type":"progress","stage":...,"counts":{...}}` at login / list / walk /
  download / done. Note the stored dict is `hub.last_progress` — naming it
  `hub.progress` shadowed the method and broke every sync.
- `app/report.py` — the firm's old Excel tracker, rebuilt. `build_summary(con)`
  is the single place the bucket rules live: a notice is OPEN while its
  proceeding status is not "Closed", and only open notices get an urgency
  bucket (overdue / due ≤3d / due ≤10d / on track >10d / no due date yet);
  closed ones are counted on their own line, so a notice already answered can
  never read as overdue. It also returns run info (last finish, notices
  scanned, new this run), the attention list (overdue or due ≤3 days, most
  overdue first) and the full register. `build_workbook()` turns that same
  dict into a real three-sheet .xlsx (openpyxl, imported lazily so a missing
  dependency cannot stop the server booting); dates go in as dates, and the
  Attention header keeps the tracker's dark blue with a frozen header row.
  TESTED (test_app.py, on a throwaway database of its own): the bucket edges
  (day 3 vs 4, day 10 vs 11), closed kept out of the urgency buckets,
  attention contents and order, the export's content type / filename / three
  sheets / styled frozen header, and 401 on both routes when APP_PASSWORD is set.
- GET /api/summary returns that dict; GET /api/export.xlsx returns the workbook
  named `itr-summary-YYYY-MM-DD.xlsx`. Both sit behind the same cookie as
  everything else under `/api/`.
- Summary section on the dashboard, above the table: "Position at a glance",
  a run-date line, the buckets as a row of clickable chips (clicking one
  filters the table client-side — `bucketOf()` in app.js repeats the server's
  rules, so it costs no round trip), the "Attention — overdue & due within 3
  days" table with the dark header band, and the italic caution line. With
  nothing urgent it prints the old sheet's own words, "Nothing overdue or
  critical." The header's **Export** button downloads the workbook.
- `app/static/index.html` + `app/static/app.js` + `app/static/style.css` —
  the dashboard: credentials form (masked password, shown when the server
  holds no login and re-shown with an error after a rejected password),
  "Change login" in the header, the header's primary **Sync** button, live
  log, OTP input that appears on `otp_required`, notices table with overdue
  highlight, "no due date" pill and the "✦ by Claude" tag.
- Row buttons, short labels, always visible and right-aligned:
  **View** (in-page modal — dark overlay, big iframe on
  `/api/notices/{ref}/pdf?inline=1`, closed by Esc or a click on the overlay,
  and the iframe is reset to about:blank on close so the PDF plugin stops),
  **Save** (`location.href` to the same endpoint without `inline`, which the
  server answers as an attachment), **✦ Date** (only on rows with no due date;
  the ask-Claude call, spinner, then the date and its tag appear in place) and
  **Draft** (the drawer: summary, document checklist, editable reply, Copy and
  Regenerate, under the "DRAFT — review before filing" banner).
- `test_app.py` — TestClient script plus fake-page unit tests for the settle
  loop, no browser. Run `.venv/bin/python test_app.py`.

## Portal facts (from real screenshots of this account — trust these)

- Login URL: https://eportal.incometax.gov.in/iec/foservices/#/login
  Page 1: placeholder "PAN/ AADHAAR/ OTHER USER ID", button "Continue".
  Page 2: shows "Secure Access Message" + a checkbox labelled "Please confirm
  your secure access message displayed above" (MUST be ticked), password
  field, "Continue". No captcha. OTP not seen on this account but the relay
  must stay in place.
- Force-login: CONFIRMED live. The popup's button is
  `<button type="button" data-dismiss="modal"
   class="defaultButton primaryButton primaryBtnMargin"> Login Here </button>`,
  so `get_by_role("button", name="Login Here")` finds it. Keep it auto-click
  (owner wants the tool to steal the session).
- **The browser Back button is a trap.** The portal answers Back / Forward /
  Refresh with "For security reasons, we have disabled Back, Forward and
  Refresh actions of the browser. Are you sure you want to Logout?" with
  YES / No, and its markup is `div#securityReasonPopup.modal.fade.show`.
  **It fires for ANY url or hash change, not only the Back button** — writing
  `window.location.hash` to reach a route raised it in a live run (verified
  2026-09-01), and while it is up it intercepts pointer events, so every
  click underneath just times out. So: never `page.go_back()`, never
  `goto()`/reload a route, never touch `location.hash`. Navigate only by
  clicking the portal's own menu, and return only via each page's own "Back"
  button (`get_by_role("button", name="Back", exact=True)`), verified to walk
  detail → notices → list with no dialog.
  When the modal does appear, answer **No** — `session.dismiss_security_popup()`
  does this and is called before every click. Its YES logs the session out, so
  "yes" and "logout" are in the scraper's FORBIDDEN tuple.
- An expired session lands on `#/sessionExpire` (not `/login`), and the
  password page has its own route, `#/login/password`.
- The password page sometimes answers a CORRECT password with
  "Error : Request is not authenticated" and just wants Continue pressed
  again (owner confirmed live). `TRANSIENT_ERRORS` in session.py handles it:
  press Continue again, at most `MAX_CONTINUE_RETRIES` (5) times with
  `RETRY_PAUSE_SECONDS` (2s) between presses, re-ticking the secure-access box
  and resetting the error grace period each time. Two presses with no pause
  was not enough in a live run — the owner had to press it a third time by
  hand. This is not a password retry and must
  never be widened into one — a rejection message still aborts on sight.
- Playwright 1.62 raises InvalidSelectorError for
  `get_by_role(name=re.compile(...))` when the pattern contains "/". Every
  notice-level locator here used to. Use plain substring names with
  `exact=False`, which also handles the button reading "Notice/Letter pdf"
  with a lowercase p.
- Header shows "Session Time 14:59" counting down from 15:00. Optional
  improvement: parse it instead of the internal clock in `session.py`.
- e-Proceedings URL: .../#/dashboard/eProceedings
  Tabs: "Self", "Of Other PAN/TAN", "As Authorized Representative" (third tab
  CONFIRMED absent on this company account — skip if missing). They are
  `mat-button-toggle`s: the clickable text lives in
  `span.mat-button-toggle-label-content`, so a `role=button` lookup alone
  misses them — `_find_tab()` tries button, tab and text. Sub-tabs are Angular Material tabs with `role="tab"`: "For your
  Action (40)", "For your Information (24)" on this account. Top right: search box, "Filter" button,
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
- Notice card label trap, seen live: the card prints "Notice u/s" and then the
  document reference on the *next* line, because the "Document reference ID"
  label sits BELOW its own value. A notice with no section (an Issue Letter)
  therefore parses the ITBA reference as its section unless that is rejected
  explicitly. The real text of both card types is pinned in test_app.py.
- The PDF download is a genuine browser download (`expect_download`), and the
  file the portal serves is named like
  `70000000172639792_216809962_2026_COM_AAACU3358G_Issue Letter_1092231604(1)_17082026.pdf`.

## Roadmap, in order

1. **Verify live** — the DOM recon is DONE (2026-09-01, dumps under
   `data/debug/recon*/`): login, force-login, card containers, the Back-button
   trap, pagination and the download were all confirmed against the real
   account, and scraper.py was rewritten around them. What is left is one
   uninterrupted automated run: `./run.sh` with HEADLESS=false (press Slow in
   the header to make it watchable), log in through the dashboard, and watch a full sync
   walk both tabs. A failure leaves `data/debug/fail-*.png` and holds the
   window open for HOLD_ON_ERROR seconds. Then set the README checkbox for
   step 3 to "verified".
2. **Step 5 — Ask-Claude due date. DONE** (kept here for the rules it must
   keep obeying.) Implemented in `app/claude_client.py` +
   POST /api/notices/{ref_id}/ask-claude:
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
3. **Step 6 — draft replies. DONE** (kept here for the rule that outlives it.)
   POST /api/notices/{ref_id}/draft sends the stored PDF to Claude and gets
   back a plain-language summary, a checklist of documents demanded, and a
   draft reply, stored one-per-notice in the `drafts` table. `?regenerate=1`
   is the only thing that spends a second call. The dashboard shows it in a
   side panel with the draft editable and a Copy button, headed "DRAFT —
   review before filing. This tool never submits to the portal."
   **That stays true: never add portal-submission code.** A test greps the
   backend for submit-shaped names and fails if one appears.

## Hard guardrails — never violate, never "improve" away

- READ-ONLY on the portal: never click Submit Response, View Response,
  File Appeal, Seek Video Conferencing, Seek/View Adjournment, or anything
  that writes. The FORBIDDEN tuple in scraper.py documents this.
- NEVER retry a rejected password — the portal locks accounts. The
  WrongPasswordError flow must stay a hard stop. The one permitted re-press of
  Continue is for the exact transient wording in `TRANSIENT_ERRORS`, capped at
  `MAX_CONTINUE_RETRIES`; do not add rejection wording to that list.
- Portal credentials are memory-only: typed into the dashboard, held on the
  EventHub for the life of the process, never written to SQLite or any file,
  never logged, never echoed in a response body. A server restart forgetting
  them is intended — do not add persistence. .env holds only ANTHROPIC_API_KEY
  and HEADLESS (gitignored; never commit it).
- Never overwrite a portal-sourced due date with a Claude one; Claude dates
  are always tagged due_date_source='claude' and shown with the badge.
- A sync that scrapes nothing is a failure, not a success. Never let a missing
  tab, an unrendered list or an empty walk report "Sync done" - raise, so the
  failure path screenshots the screen and the dashboard says so.
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
