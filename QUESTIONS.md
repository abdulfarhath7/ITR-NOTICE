# QUESTIONS.md

Questions Claude could not answer from the specification. **The build did not
stop for any of these** — a default was chosen and used. Read each one, fill
in `Answer:`, then re-run Claude Code to apply any that differ.

## Template for new entries

```
### Qnn — short title
- **Context:** where this came up
- **Options:** A / B / C
- **Default used:** which one, and why
- **Blast radius:** what changes if the answer differs
- **Answer:**
- **Resolved:** no
```

---

---

## Apply these — answers that differ from the default

These changed. Everything else was confirmed as built.

| Q | Change |
|---|---|
| Q01 | Drop `Created Mode` from the Excel sheet (16 columns, not 17). Keep the DB field. |
| Q04 | Delete the web app. Keep `relay/`. Diff `app/` before removing it. |
| Q09 | Add a scheduler for unattended runs; attended flow becomes the fallback. |
| Q14 | Manual due date may override; show both; manual drives the worklist. |
| Q16 | Implement best-effort remote wipe on device removal. |
| Q17 | Email everyone plus the banner, after one missed run. |
| Q21 | Rename to Litigation Command Center. Fix the `in.llc.app` identifier typo. `.draftax` becomes `.lcc`. |
| Q22 | Stop parsing the stepper date. `Issued On` comes from the communication. |
| Q24 | Ship unsigned. Revisit at self-serve distribution. |

Still open: **Q11** (count the AR panel) and **Q08** (run the two session tests).

---

## Seeded questions — answered

### Q01 — What does the Excel column "Created Mode" mean?
- **Context:** `docs/11-exports.md`, 17-column proceedings sheet.
- **Options:** A) the portal's own field (system-generated vs manually initiated proceeding). B) our field (auto-scraped vs hand-added in our tool).
- **Default used:** B. Stored as `proceedings.created_mode` enum `auto|manual`, populated by the ingestion service.
- **Blast radius:** One column mapping and one enum. Small.
- **Answer:** Drop the column from the Excel sheet. Keep `proceedings.created_mode` in the database as provenance (scraped vs hand-added) but remove it from the export. Sheet goes 17 columns to 16.
- **Resolved:** yes

### Q02 — What is "Client ID" in the Excel sheet?
- **Context:** Same sheet.
- **Options:** A) the firm's own internal client code. B) something the portal displays.
- **Default used:** A. `clients.client_code`, free text, unique per firm, user-entered, editable.
- **Blast radius:** One column, one uniqueness constraint.
- **Answer:** Option A, as built. `clients.client_code`, the firm's own internal code.
- **Resolved:** yes

### Q03 — Where does a pre-deposit payment on appeal hang?
- **Context:** Open point raised by the SBC architecture document.
- **Options:** A) under `DemandResponse`. B) under the appeal `Proceeding`. C) under `YearContext` with optional links to both.
- **Default used:** C. `payments.year_context_id` is the real parent; `demand_response_id` and `proceeding_id` are both nullable; `purpose` enum is `demand_settlement|pre_deposit|self_assessment|other`.
- **Blast radius:** Reconciliation reporting shape. Medium.
- **Answer:** No preference expressed. Default C stands: `payments.year_context_id` is the parent, with nullable links to both `demand_response_id` and `proceeding_id` plus a `purpose` enum. Tell SBC this is the choice, since they raised it.
- **Resolved:** yes

### Q04 — Which surface is the product?
- **Context:** Repo has both a FastAPI web tool and a Tauri desktop shell.
- **Options:** A) desktop is the product. B) web is the product. C) both.
- **Default used:** A. The Tauri desktop app is the product; the FastAPI app becomes a local dev harness and the basis for the relay service. The multi-device, offline-first, keychain design only makes sense on desktop.
- **Blast radius:** Very large. Answer this one first.
- **Answer:** Desktop only. Remove the web app entirely. IMPORTANT: `relay/` is also FastAPI and is NOT the web app - do not delete it. Before deleting `app/`, diff it against `sidecar/` and `src-tauri/` and confirm nothing unique remains (original Playwright selectors, ERI crypto work).
- **Resolved:** yes

### Q05 — Where does the relay run, and on what database?
- **Context:** `docs/03-sync-and-ledger.md`.
- **Options:** A) AWS Lightsail Mumbai + SQLite. B) Lightsail + Postgres. C) managed Postgres.
- **Default used:** A for v1. The relay stores opaque encrypted blobs and a little metadata; SQLite is sufficient until multiple firms are live. Migration path to Postgres documented.
- **Blast radius:** Deployment only. Reversible.
- **Answer:** Accepted as built.
- **Resolved:** yes

### Q06 — Collector lease length?
- **Default used:** 24 hours, renewed every 60 minutes while the collector is alive.
- **Blast radius:** Recovery time after a collector dies. One constant.
- **Answer:** Accepted as built. 24 hour lease, renewed hourly.
- **Resolved:** yes

### Q07 — Snapshot cadence for new-device onboarding?
- **Default used:** A compacted snapshot every 5,000 ledger entries or every 7 days, whichever comes first.
- **Blast radius:** Onboarding speed and relay storage. One constant.
- **Answer:** Accepted as built.
- **Resolved:** yes

### Q08 — Does a second portal login really kill the first session?
- **Context:** Claimed by the SBC document. Drives the entire ingestion design.
- **Default used:** Assumed true. Ingestion is strictly sequential with a per-client lock.
- **Blast radius:** Very large. If false, parallel ingestion becomes possible and throughput rises several-fold.
- **Answer:** UNTESTED - still an assumption. Keep sequential ingestion, but move concurrency to a single config constant defaulted to 1 so it can be raised without a rewrite. Two tests settle this: (1) same client in two browsers, does the first session die? (2) two DIFFERENT clients in two browsers, do both survive? The SBC document's heading claims one session per taxpayer; its body then claims sequence across all clients. Test 2 is the one that matters for throughput.
- **Resolved:** no

### Q09 — Is OTP required on every portal login, or only on a new device?
- **Default used:** Assumed every login. The queue pauses and waits for a human, indefinitely, without failing.
- **Blast radius:** Whether unattended overnight runs are possible at all.
- **Answer:** OTP is rare or never in practice. This reverses the central assumption of D-002. Keep the attended machinery - it is the correct fallback - and add a scheduler on top: run unattended on a schedule, pause and alert only if a challenge actually appears.
- **Resolved:** yes

### Q10 — Do all six e-Proceedings panels exist, and which holds the practitioner book?
- **Context:** Self / Of Other PAN or TAN / As Authorized Representative, each with "For your action" and "For your information".
- **Default used:** All six swept every run, zero counts recorded explicitly. `source_panel` stored on every proceeding.
- **Blast radius:** Scraper scope and run duration.
- **Answer:** Confirmed. All six panels exist. As built.
- **Resolved:** yes

### Q11 — What share of the client book is reachable through the AR view?
- **Context:** Determines whether per-client passwords are needed at all.
- **Default used:** Assumed most. Per-client credentials supported but optional; `clients.portal_login_ref` points at the login used.
- **Blast radius:** The whole credential handling story, and the security posture.
- **Answer:** STILL OPEN. Count how many clients appear in the 'As Authorised Representative' panel of the firm's own portal account, against a book of ~200. If most of the book is there, per-client passwords are largely unnecessary and the credential vault shrinks dramatically.
- **Resolved:** no

### Q12 — Sweep cadence per module?
- **Default used:** Proceedings daily, demands daily, returns weekly, forms weekly. Configurable per module in settings.
- **Blast radius:** Run duration. Config only.
- **Answer:** Accepted as built.
- **Resolved:** yes

### Q13 — Is offline litigation work in scope?
- **Context:** Hearing dates, adjournment diary, counsel notes, paper filings — data with no portal source.
- **Default used:** Out of scope for this build. The schema leaves room (`proceedings.hearing_date`, `notes` table) but no UI is built.
- **Blast radius:** Large if in scope. Adds a whole data-entry surface.
- **Answer:** Later phase, not now. Move it out of QUESTIONS.md into TASKS.md as a deferred phase so it is not lost. Schema room stays; no UI is built.
- **Resolved:** yes

### Q14 — Can a Manual Due Date override a portal-supplied due date, or only fill a blank?
- **Default used:** Only fills a blank, and is displayed distinctly. A portal-supplied date is never overwritten.
- **Blast radius:** One validation rule and one UI state.
- **Answer:** Allow override, show both. Manual due date may override a portal-supplied date; both are displayed, clearly labelled. FOLLOW-ON RULES: the manual date drives the Attention list and the overdue calculation; export column 13 still carries the portal date; a promoted AI suggestion writes `manual_due_date`, never `due_date`. The portal's own field is never overwritten.
- **Resolved:** yes

### Q15 — Does Excel export use live data or the last synced state?
- **Default used:** Whatever the device currently holds, with the export header stamping the device cursor and the collector's last run time so a stale export is self-evident.
- **Blast radius:** One header block.
- **Answer:** Accepted as built.
- **Resolved:** yes

### Q16 — When an admin removes a device, is its local copy wiped?
- **Default used:** No remote wipe. Removal revokes relay access only. A `REMOTE_WIPE` capability is stubbed but not implemented.
- **Blast radius:** Security posture on a lost laptop.
- **Answer:** Wipe the local copy as well as revoking access. BEST-EFFORT ONLY - it fires only if the device comes online and the app is launched; a disk image is unreachable. Say so in the admin confirmation dialog rather than implying a guarantee. Push pending ledger entries before wiping where possible, then show a plain 'this device was removed' screen.
- **Resolved:** yes

### Q17 — Who is alerted when the collector goes silent, and after how long?
- **Default used:** Every device shows a warning banner after one missed scheduled run. No email or push is sent.
- **Blast radius:** Notification surface. Small now, larger when sold externally.
- **Answer:** Banner on every device AND email to everyone, after one missed scheduled run. Needs email capability on the relay. Debounce: one email per missed run, at most one per day, plus a recovery email when the collector returns. Note that this means staff email addresses live on the relay.
- **Resolved:** yes

### Q18 — Is the Income-tax Act 2025 section mapping available as data?
- **Context:** `docs/02-data-model.md` stores sections as a 2025 / 1961 pair.
- **Default used:** Both columns exist. `section_2025` is populated from the portal where shown; `section_1961` from a seed mapping table that ships partially filled, with gaps flagged rather than guessed.
- **Blast radius:** Display strings and the seed table.
- **Answer:** Accepted as built.
- **Resolved:** yes

### Q19 — Product name for packaging and window title?
- **Default used:** `Draftax`. Trademark clearance is not complete; the name lives in one constant so it can be changed in a single place.
- **Answer:** Superseded by Q21. See Q21.
- **Resolved:** yes

### Q20 — Which Claude model and proxy for draft generation?
- **Default used:** `claude-sonnet-4-6` through the existing server-side proxy. Drafts cached per notice, never regenerated automatically.
- **Answer:** Accepted as built.
- **Resolved:** yes

### Q21 — Draftax or Litigation Command Center?
- **Context:** The spec says Draftax; the repo was renamed to Litigation Command Center (LLC) on 2026-09-08 at your request.
- **Options:** A) Draftax everywhere the user sees it. B) Litigation Command Center. C) Something else.
- **Default used:** A for what the user sees; the bundle identifier `in.llc.app` and package names stay (D-012).
- **Blast radius:** One constant in the frontend, one in `tauri.conf.json`, the export header.
- **Answer:** Litigation Command Center everywhere the user sees it. Surfaces to change: `productName` in `tauri.conf.json`, window title, frontend constant, export header block, installer filename, and the bundle extension (`.draftax` becomes `.lcc`). ALSO: the bundle identifier `in.llc.app` looks like a typo - the acronym is LCC, not LLC. Fix it now; bundle identifiers are painful to change after the first installer ships. Pick 'Center' or 'Centre' and use it consistently.
- **Resolved:** yes

### Q22 — What is the date on the proceeding card's status stepper?
- **Context:** Each proceeding card shows a vertical stepper: a date beside the status word (e.g. `18-Aug-2026 · Open`). The old scraper ignored it. The DOM captures show one step per card.
- **Options:** A) the date the proceeding was initiated (first step) and, for Closed, the closure date (last step). B) the date of the latest status change only. C) something else.
- **Default used:** A. Stored as `proceedings.initiated_on` (first step) and `closure_date` (last step when Closed), `verified_flag = 0`.
- **Blast radius:** Two date columns and the export's "Issued On" fallback.
- **Answer:** Ignore that date. Stop parsing the stepper. Leave `initiated_on` and `closure_date` nullable and unpopulated in case we learn what it means later. CONSEQUENCE: export column 'Issued On' now comes from the communication's `issued_on`; where there is no communication the cell is blank and gap-flagged, never guessed.
- **Resolved:** yes

### Q23 — Does the portal show a captcha at login, and where?
- **Context:** No capture shows one; the previous build never met one. The sidecar looks for an image/input whose id, name, placeholder, alt or class contains "captcha" on the user-id and password pages and relays it as a challenge.
- **Options:** A) never on this flow. B) sometimes, on the password page. C) sometimes, elsewhere (after OTP, on force-login).
- **Default used:** B-shaped detection at both Continue presses; a miss falls through to the OTP wait, so a captcha would surface as a login timeout with a debug screenshot.
- **Blast radius:** One selector pair in `sidecar/ingest/session.py`.
- **Answer:** Never seen a captcha on this flow. Keep the detection in `sidecar/ingest/session.py` as a safety net - it costs nothing and a miss surfaces as a login timeout with a debug screenshot.
- **Resolved:** yes

### Q24 — Windows release: updater, code signing, install mode
- **Context:** Phase 10.1 reuses `.github/workflows/release.yml`. Three decisions from the previous generation are still open there (see `docs/legacy/QUESTIONS-2026-09-08.md` Q2, Q3, Q9): no updater, per-user NSIS install, unsigned unless `WINDOWS_CERT` is set. The workflow cannot be run from this Linux box.
- **Options:** A) ship as is (manual installer, unsigned, per-user). B) add the Tauri updater before the first public installer. C) buy an Authenticode certificate and add the two secrets.
- **Default used:** A. Tag `v0.2.0` runs the job; the sidecar path is `src-tauri/resources/sidecar/draftax_sidecar.exe`.
- **Blast radius:** SmartScreen warnings on every install; no update path once installed.
- **Answer:** Ship unsigned for now. Azure Artifact Signing ($9.99/mo) is unavailable - it is limited to verified US, Canadian, EU and UK entities. EV no longer bypasses SmartScreen; Microsoft removed that behaviour in 2024, so EV is not worth its premium over OV. Buy an OV certificate (~$200-250/yr plus a hardware token or cloud HSM, mandatory since June 2023) at the point where a firm installs it themselves without you present. Reputation attaches to a certificate and resets on renewal or CA change.
- **Resolved:** yes
