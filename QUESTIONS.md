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

## Seeded questions — answer these first

### Q01 — What does the Excel column "Created Mode" mean?
- **Context:** `docs/11-exports.md`, 17-column proceedings sheet.
- **Options:** A) the portal's own field (system-generated vs manually initiated proceeding). B) our field (auto-scraped vs hand-added in our tool).
- **Default used:** B. Stored as `proceedings.created_mode` enum `auto|manual`, populated by the ingestion service.
- **Blast radius:** One column mapping and one enum. Small.
- **Answer:**
- **Resolved:** no

### Q02 — What is "Client ID" in the Excel sheet?
- **Context:** Same sheet.
- **Options:** A) the firm's own internal client code. B) something the portal displays.
- **Default used:** A. `clients.client_code`, free text, unique per firm, user-entered, editable.
- **Blast radius:** One column, one uniqueness constraint.
- **Answer:**
- **Resolved:** no

### Q03 — Where does a pre-deposit payment on appeal hang?
- **Context:** Open point raised by the SBC architecture document.
- **Options:** A) under `DemandResponse`. B) under the appeal `Proceeding`. C) under `YearContext` with optional links to both.
- **Default used:** C. `payments.year_context_id` is the real parent; `demand_response_id` and `proceeding_id` are both nullable; `purpose` enum is `demand_settlement|pre_deposit|self_assessment|other`.
- **Blast radius:** Reconciliation reporting shape. Medium.
- **Answer:**
- **Resolved:** no

### Q04 — Which surface is the product?
- **Context:** Repo has both a FastAPI web tool and a Tauri desktop shell.
- **Options:** A) desktop is the product. B) web is the product. C) both.
- **Default used:** A. The Tauri desktop app is the product; the FastAPI app becomes a local dev harness and the basis for the relay service. The multi-device, offline-first, keychain design only makes sense on desktop.
- **Blast radius:** Very large. Answer this one first.
- **Answer:**
- **Resolved:** no

### Q05 — Where does the relay run, and on what database?
- **Context:** `docs/03-sync-and-ledger.md`.
- **Options:** A) AWS Lightsail Mumbai + SQLite. B) Lightsail + Postgres. C) managed Postgres.
- **Default used:** A for v1. The relay stores opaque encrypted blobs and a little metadata; SQLite is sufficient until multiple firms are live. Migration path to Postgres documented.
- **Blast radius:** Deployment only. Reversible.
- **Answer:**
- **Resolved:** no

### Q06 — Collector lease length?
- **Default used:** 24 hours, renewed every 60 minutes while the collector is alive.
- **Blast radius:** Recovery time after a collector dies. One constant.
- **Answer:**
- **Resolved:** no

### Q07 — Snapshot cadence for new-device onboarding?
- **Default used:** A compacted snapshot every 5,000 ledger entries or every 7 days, whichever comes first.
- **Blast radius:** Onboarding speed and relay storage. One constant.
- **Answer:**
- **Resolved:** no

### Q08 — Does a second portal login really kill the first session?
- **Context:** Claimed by the SBC document. Drives the entire ingestion design.
- **Default used:** Assumed true. Ingestion is strictly sequential with a per-client lock.
- **Blast radius:** Very large. If false, parallel ingestion becomes possible and throughput rises several-fold.
- **Answer:**
- **Resolved:** no

### Q09 — Is OTP required on every portal login, or only on a new device?
- **Default used:** Assumed every login. The queue pauses and waits for a human, indefinitely, without failing.
- **Blast radius:** Whether unattended overnight runs are possible at all.
- **Answer:**
- **Resolved:** no

### Q10 — Do all six e-Proceedings panels exist, and which holds the practitioner book?
- **Context:** Self / Of Other PAN or TAN / As Authorized Representative, each with "For your action" and "For your information".
- **Default used:** All six swept every run, zero counts recorded explicitly. `source_panel` stored on every proceeding.
- **Blast radius:** Scraper scope and run duration.
- **Answer:**
- **Resolved:** no

### Q11 — What share of the client book is reachable through the AR view?
- **Context:** Determines whether per-client passwords are needed at all.
- **Default used:** Assumed most. Per-client credentials supported but optional; `clients.portal_login_ref` points at the login used.
- **Blast radius:** The whole credential handling story, and the security posture.
- **Answer:**
- **Resolved:** no

### Q12 — Sweep cadence per module?
- **Default used:** Proceedings daily, demands daily, returns weekly, forms weekly. Configurable per module in settings.
- **Blast radius:** Run duration. Config only.
- **Answer:**
- **Resolved:** no

### Q13 — Is offline litigation work in scope?
- **Context:** Hearing dates, adjournment diary, counsel notes, paper filings — data with no portal source.
- **Default used:** Out of scope for this build. The schema leaves room (`proceedings.hearing_date`, `notes` table) but no UI is built.
- **Blast radius:** Large if in scope. Adds a whole data-entry surface.
- **Answer:**
- **Resolved:** no

### Q14 — Can a Manual Due Date override a portal-supplied due date, or only fill a blank?
- **Default used:** Only fills a blank, and is displayed distinctly. A portal-supplied date is never overwritten.
- **Blast radius:** One validation rule and one UI state.
- **Answer:**
- **Resolved:** no

### Q15 — Does Excel export use live data or the last synced state?
- **Default used:** Whatever the device currently holds, with the export header stamping the device cursor and the collector's last run time so a stale export is self-evident.
- **Blast radius:** One header block.
- **Answer:**
- **Resolved:** no

### Q16 — When an admin removes a device, is its local copy wiped?
- **Default used:** No remote wipe. Removal revokes relay access only. A `REMOTE_WIPE` capability is stubbed but not implemented.
- **Blast radius:** Security posture on a lost laptop.
- **Answer:**
- **Resolved:** no

### Q17 — Who is alerted when the collector goes silent, and after how long?
- **Default used:** Every device shows a warning banner after one missed scheduled run. No email or push is sent.
- **Blast radius:** Notification surface. Small now, larger when sold externally.
- **Answer:**
- **Resolved:** no

### Q18 — Is the Income-tax Act 2025 section mapping available as data?
- **Context:** `docs/02-data-model.md` stores sections as a 2025 / 1961 pair.
- **Default used:** Both columns exist. `section_2025` is populated from the portal where shown; `section_1961` from a seed mapping table that ships partially filled, with gaps flagged rather than guessed.
- **Blast radius:** Display strings and the seed table.
- **Answer:**
- **Resolved:** no

### Q19 — Product name for packaging and window title?
- **Default used:** `Draftax`. Trademark clearance is not complete; the name lives in one constant so it can be changed in a single place.
- **Answer:**
- **Resolved:** no

### Q20 — Which Claude model and proxy for draft generation?
- **Default used:** `claude-sonnet-4-6` through the existing server-side proxy. Drafts cached per notice, never regenerated automatically.
- **Answer:**
- **Resolved:** no

### Q21 — Draftax or Litigation Command Center?
- **Context:** The spec says Draftax; the repo was renamed to Litigation Command Center (LLC) on 2026-09-08 at your request.
- **Options:** A) Draftax everywhere the user sees it. B) Litigation Command Center. C) Something else.
- **Default used:** A for what the user sees; the bundle identifier `in.llc.app` and package names stay (D-012).
- **Blast radius:** One constant in the frontend, one in `tauri.conf.json`, the export header.
- **Answer:**
- **Resolved:** no
