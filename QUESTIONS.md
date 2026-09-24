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
- **Answer:** Later phase, not now. Move it out of QUESTIONS.md into TASKS.md as a deferred phase so it is not lost. Schema room stays; no UI is built. *(Moved: see TASKS.md Phase 13 — offline litigation, deferred; `proceedings.hearing_date` exists.)*
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

### Q25 — Countdown ring reads `describeDue().days` as a ratio
- **Context:** Thread flow redesign (`docs/thread-flow-context.md` §6). The empty-slot ring needs elapsed/total of the response window; `days` is documented as sort-only.
- **Options:** A) use `days` as a ratio, never print it. B) compute a second day count in the component. C) no ring.
- **Default used:** A, as the spec directs. `ringRatio()` in `src/lib/thread-pairing.ts`; the ring never shows a number. No ring when `issued_on` or `response_due_date` is missing.
- **Blast radius:** one function.
- **Answer:** Keep.
- **Resolved:** yes

### Q26 — Gap label "· N days ·" versus "no day count in the thread"
- **Context:** Spec §2 asks for a spine label "· N days ·" when two events are more than 14 days apart. Acceptance criterion 2 says no day count may appear except through `describeDue().text`.
- **Options:** A) show the label as §2 specifies. B) drop the label. C) show a month label ("· Jun 2026 ·") instead.
- **Default used:** A. The label is an interval between two past dates, not a countdown, so it cannot produce the negative-number bug the rule guards against. Its text comes from `describeGap()` in `src/lib/due.ts`, so all day wording still lives in one module.
- **Blast radius:** one line in `thread-flow.tsx`.
- **Answer:** Keep. Past-to-past interval, not a countdown.
- **Resolved:** yes

### Q27 — A folded group of repeats shows one empty slot
- **Context:** Spec §7 folds consecutive unanswered notices of one type into one card; §5 gives every unanswered draftable notice its own slot.
- **Options:** A) one slot, for the latest notice in the group. B) one slot per member, stacked.
- **Default used:** A. Reminders chase the same matter, so the reply goes to the latest. Opening the group shows every member with its own slot and Draft button.
- **Blast radius:** `RepeatRowView` only.
- **Answer:** Keep.
- **Resolved:** yes

### Q28 — A notice superseded by an adjournment and reissue still shows overdue
- **Context:** Pairing (§5) only counts responses. A show-cause notice that was adjourned and then reissued keeps its own empty slot, which goes red once its original due date passes.
- **Options:** A) as specified: overdue until a response is paired. B) treat a notice whose adjournment has merged into a reissue as settled (idle, no slot).
- **Default used:** A. The spec is explicit and B would hide a portal date behind an inference.
- **Blast radius:** `pairState` and the slot rule in `pairThread`.
- **Answer:** Fix. If a notice has an adjournment with a merge target (reissue arrived), the original is muted and loses its slot; overdue is judged only on the reissue. With no merge target yet, the original is warning until the sought date and danger after. Applied in TASKS 14.2.
- **Resolved:** yes

### Q29 — Spec names a `--muted` token and an `npm run lint` script; neither exists
- **Context:** Spec §2 lists `--muted`; §12 requires `npm run lint`.
- **Options:** A) use the existing `--text-muted` / `--border-strong`, skip lint. B) add the token and a linter.
- **Default used:** A. The idle state uses `--border-strong`, text uses `--text-muted`. No linter was added (no new dependencies, §13); `npm run typecheck`, `npm test` and `vite build` pass.
- **Blast radius:** none.
- **Answer:** Fine. Add `"lint": "eslint src --ext .ts,.tsx"` later (TASKS 14.3).
- **Resolved:** yes

### Q30 — Bucket windows: exclusive or cumulative
- **Context:** docs/16 §1.5. "Last 15 days" can mean days 8–15 (exclusive) or days 0–15 (cumulative, includes last 7).
- **Options:** A exclusive (8–15, 16–30) / B cumulative (last 15, last 30)
- **Default used:** A — counts add up and a notice sits in exactly one bucket.
- **Blast radius:** predicate table in `lib/buckets.ts` and six labels. No data change.
- **Answer:**
- **Resolved:** no

### Q31 — Bucket click: filter in place or jump to Notices
- **Context:** docs/16 §1.5 last paragraph.
- **Options:** A filter the list on the Attention screen / B navigate to module-items with the bucket applied
- **Default used:** A — matches how the existing rank counts behave.
- **Blast radius:** one click handler plus reading a bucket param in `module-items.tsx`.
- **Answer:**
- **Resolved:** no

### Q32 — Old rank-count row on Attention
- **Context:** docs/16 §1.2 replaces the five rank counts with the strip and lanes.
- **Options:** A remove the row from the UI, keep the ranking logic / B keep the row as a slim line above the strip
- **Default used:** A — the strip covers ranks 1, 3, 4 and the lanes cover the rest; rank 2 (limitation) stays on the row text.
- **Blast radius:** one JSX block.
- **Answer:**
- **Resolved:** no

### Q34 — Saved views storage
- **Context:** docs/16 §1.6. Views are per device in localStorage.
- **Options:** A per device, localStorage / B per firm, synced through the ledger
- **Default used:** A — no schema change; matches how theme and filters are stored.
- **Blast radius:** `lib/saved-views.ts` swaps its backing store; UI unchanged.
- **Answer:**
- **Resolved:** no

### Q33 — "Drafts to review" tile
- **Context:** docs/16 §1.2 and §2.3 add `drafts.reviewed_at`.
- **Options:** A include the tile and the Mark-reviewed button / B drop both, no schema change
- **Default used:** A — one nullable column, easy to remove.
- **Blast radius:** migration, one tile, one button in the draft drawer.
- **Answer:**
- **Resolved:** no

### Q35 — Build 2 phase numbers collide with the thread-flow phase
- **Context:** `TASKS.md` already has "Phase 14 — Thread flow redesign" (14.1–14.3). Build 2, from `docs/16-dashboard-v2.md`, also numbers its phases 14–22 and its tasks 14.1 onward.
- **Options:** A keep both and tell them apart by the "Build 2" heading / B renumber Build 2 to 15–23 / C renumber the thread-flow phase
- **Default used:** A. `docs/16` and QUESTIONS Q30–Q34 cite Build 2 task numbers (14.3, 21.1…), so renumbering would break every cross-reference. Commits for Build 2 name "Build 2" where a task number could be ambiguous.
- **Blast radius:** headings in `TASKS.md` only.
- **Answer:**
- **Resolved:** no

### Q36 — Saved views are specified and also listed as out of scope
- **Context:** `docs/16` §1.6 and task 15.5a specify saved views in full; §9 "Out of scope" lists "saved views". Q34 asks only where views are stored.
- **Options:** A build them per §1.6 / B skip them per §9
- **Default used:** A. The detailed section, the task and Q34 all assume they exist; §9 reads as a leftover from an earlier draft.
- **Blast radius:** `lib/saved-views.ts` and the views row in `screens/attention.tsx`; removing both leaves "All" as the only tab.
- **Answer:**
- **Resolved:** no

### Q37 — Spec names a `--radius` token that does not exist
- **Context:** `docs/16` §1.2 and §1.5 size tiles with `--radius`; `tokens.css` has `--radius-control` (6px) and `--radius-card` (10px).
- **Options:** A tiles use `--radius-control`, cards use `--radius-card` / B add `--radius`
- **Default used:** A. Same pattern as Q29: no new token for a value that already exists. Lane and list cards use the spec's literal 12px radius.
- **Blast radius:** a few CSS rules under `.att-*` in `base.css`.
- **Answer:**
- **Resolved:** no

### Q38 — Note tooltip shows "has a note", not the first 120 characters
- **Context:** docs/16 §1.7 wants the note icon's tooltip to show the note's first 120 characters; §2.2 has `list_work_items` return only `has_note`.
- **Options:** A tooltip says the item has a note / B also return `note_preview` (first 120 chars) on every row
- **Default used:** A. Keeps note text out of the list payload the shell and exports share; the full note is one click away.
- **Blast radius:** one column in the four list queries, one field in `WorkItemRow`, the `title` attribute in `attention.tsx`.
- **Answer:**
- **Resolved:** no

### Q39 — Updates only sees this device's ledger stream
- **Context:** docs/16 §4.1 diffs "the ledger". Locally, `ledger` holds only entries this device wrote; changes replayed from the collector are applied to rows but not re-logged.
- **Options:** A read the local ledger as is (complete on the collector) / B also record applied foreign entries in a local "received" table and diff that
- **Default used:** A. No schema change; the collector is the device that sweeps and the one a CA watches for new notices.
- **Blast radius:** B needs a migration, one insert in `ledger::apply`, and the query in `repo/updates.rs` reading both tables.
- **Answer:**
- **Resolved:** no

### Q40 — Detail thread: keep the two-lane flow or switch to a newest-first list
- **Context:** docs/16 §6 and task 19.1 describe the proceeding thread as one vertical list, newest at top, with a dot per entry. The detail screen already draws the thread as the two-lane `ThreadFlow` (D-037, Q25–Q29 answered 2026-09-23), which has dots, tones, the document list per entry and the Draft slot.
- **Options:** A keep `ThreadFlow` as it is / B replace it with the newest-first list / C add a "Newest first" list toggle beside the flow
- **Default used:** A. The flow was built and its questions answered the day before this spec; replacing it would undo that work (operating rule: never delete finished work). Everything §6 asks of an entry — dot tone, title, date line, documents — the flow already shows.
- **Blast radius:** B or C is one new component in `ui/` and a switch in `screens/work-item.tsx`; pairing logic is reusable.
- **Answer:**
- **Resolved:** no

### Q41 — Earlier-build tests that docs/12 does not name
- **Context:** Request "keep test fixtures only where docs/12 names them". Build 2's unnamed tests were removed. Older ones were each required by an accepted task (e.g. 14.2 "two vitest cases", 11.1/11.2 round trips, relay invariants run by `check.sh`) and use the allowlisted example PAN.
- **Options:** A keep them / B delete every test docs/12 does not name, and drop the relay step from `check.sh` if its tests go
- **Default used:** A. Deleting them removes accepted work the earlier answers asked for; one instruction away if wanted.
- **Blast radius:** B deletes about 20 Rust tests, 10 vitest cases and 9 relay tests.
- **Answer:**
- **Resolved:** no
