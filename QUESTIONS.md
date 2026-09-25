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
- **Answer:** A — exclusive. The mockup and labels approved.
- **Resolved:** yes

### Q31 — Bucket click: filter in place or jump to Notices
- **Context:** docs/16 §1.5 last paragraph.
- **Options:** A filter the list on the Attention screen / B navigate to module-items with the bucket applied
- **Default used:** A — matches how the existing rank counts behave.
- **Blast radius:** one click handler plus reading a bucket param in `module-items.tsx`.
- **Answer:** A — in place. As drawn.
- **Resolved:** yes

### Q32 — Old rank-count row on Attention
- **Context:** docs/16 §1.2 replaces the five rank counts with the strip and lanes.
- **Options:** A remove the row from the UI, keep the ranking logic / B keep the row as a slim line above the strip
- **Default used:** A — the strip covers ranks 1, 3, 4 and the lanes cover the rest; rank 2 (limitation) stays on the row text.
- **Blast radius:** one JSX block.
- **Answer:** A — remove the row. Strip + lanes cover it.
- **Resolved:** yes

### Q34 — Saved views storage
- **Context:** docs/16 §1.6. Views are per device in localStorage.
- **Options:** A per device, localStorage / B per firm, synced through the ledger
- **Default used:** A — no schema change; matches how theme and filters are stored.
- **Blast radius:** `lib/saved-views.ts` swaps its backing store; UI unchanged.
- **Answer:** A — per device. Fine for now; revisit with Q39.
- **Resolved:** yes

### Q33 — "Drafts to review" tile
- **Context:** docs/16 §1.2 and §2.3 add `drafts.reviewed_at`.
- **Options:** A include the tile and the Mark-reviewed button / B drop both, no schema change
- **Default used:** A — one nullable column, easy to remove.
- **Blast radius:** migration, one tile, one button in the draft drawer.
- **Answer:** A — keep the tile. Small, already built.
- **Resolved:** yes

### Q35 — Build 2 phase numbers collide with the thread-flow phase
- **Context:** `TASKS.md` already has "Phase 14 — Thread flow redesign" (14.1–14.3). Build 2, from `docs/16-dashboard-v2.md`, also numbers its phases 14–22 and its tasks 14.1 onward.
- **Options:** A keep both and tell them apart by the "Build 2" heading / B renumber Build 2 to 15–23 / C renumber the thread-flow phase
- **Default used:** A. `docs/16` and QUESTIONS Q30–Q34 cite Build 2 task numbers (14.3, 21.1…), so renumbering would break every cross-reference. Commits for Build 2 name "Build 2" where a task number could be ambiguous.
- **Blast radius:** headings in `TASKS.md` only.
- **Answer:** A — keep numbering. Renumbering breaks every cross-ref.
- **Resolved:** yes

### Q36 — Saved views are specified and also listed as out of scope
- **Context:** `docs/16` §1.6 and task 15.5a specify saved views in full; §9 "Out of scope" lists "saved views". Q34 asks only where views are stored.
- **Options:** A build them per §1.6 / B skip them per §9
- **Default used:** A. The detailed section, the task and Q34 all assume they exist; §9 reads as a leftover from an earlier draft.
- **Blast radius:** `lib/saved-views.ts` and the views row in `screens/attention.tsx`; removing both leaves "All" as the only tab.
- **Answer:** A — build them. §9 line was a leftover.
- **Resolved:** yes

### Q37 — Spec names a `--radius` token that does not exist
- **Context:** `docs/16` §1.2 and §1.5 size tiles with `--radius`; `tokens.css` has `--radius-control` (6px) and `--radius-card` (10px).
- **Options:** A tiles use `--radius-control`, cards use `--radius-card` / B add `--radius`
- **Default used:** A. Same pattern as Q29: no new token for a value that already exists. Lane and list cards use the spec's literal 12px radius.
- **Blast radius:** a few CSS rules under `.att-*` in `base.css`.
- **Answer:** A — existing tokens.
- **Resolved:** yes

### Q38 — Note tooltip shows "has a note", not the first 120 characters
- **Context:** docs/16 §1.7 wants the note icon's tooltip to show the note's first 120 characters; §2.2 has `list_work_items` return only `has_note`.
- **Options:** A tooltip says the item has a note / B also return `note_preview` (first 120 chars) on every row
- **Default used:** A. Keeps note text out of the list payload the shell and exports share; the full note is one click away.
- **Blast radius:** one column in the four list queries, one field in `WorkItemRow`, the `title` attribute in `attention.tsx`.
- **Answer:** B — return note_preview. Spec wanted it; one column. Applied in TASKS 22.1.
- **Resolved:** yes

### Q39 — Updates only sees this device's ledger stream
- **Context:** docs/16 §4.1 diffs "the ledger". Locally, `ledger` holds only entries this device wrote; changes replayed from the collector are applied to rows but not re-logged.
- **Options:** A read the local ledger as is (complete on the collector) / B also record applied foreign entries in a local "received" table and diff that
- **Default used:** A. No schema change; the collector is the device that sweeps and the one a CA watches for new notices.
- **Blast radius:** B needs a migration, one insert in `ledger::apply`, and the query in `repo/updates.rs` reading both tables.
- **Answer:** B — received table. Otherwise Updates is empty on every non-collector device, which is most of the firm. Applied in TASKS 22.2.
- **Resolved:** yes

### Q40 — Detail thread: keep the two-lane flow or switch to a newest-first list
- **Context:** docs/16 §6 and task 19.1 describe the proceeding thread as one vertical list, newest at top, with a dot per entry. The detail screen already draws the thread as the two-lane `ThreadFlow` (D-037, Q25–Q29 answered 2026-09-23), which has dots, tones, the document list per entry and the Draft slot.
- **Options:** A keep `ThreadFlow` as it is / B replace it with the newest-first list / C add a "Newest first" list toggle beside the flow
- **Default used:** A. The flow was built and its questions answered the day before this spec; replacing it would undo that work (operating rule: never delete finished work). Everything §6 asks of an entry — dot tone, title, date line, documents — the flow already shows.
- **Blast radius:** B or C is one new component in `ui/` and a switch in `screens/work-item.tsx`; pairing logic is reusable.
- **Answer:** A — keep ThreadFlow. Switch to C only if the newest-first list is missed after use.
- **Resolved:** yes

### Q41 — Earlier-build tests that docs/12 does not name
- **Context:** Request "keep test fixtures only where docs/12 names them". Build 2's unnamed tests were removed. Older ones were each required by an accepted task (e.g. 14.2 "two vitest cases", 11.1/11.2 round trips, relay invariants run by `check.sh`) and use the allowlisted example PAN.
- **Options:** A keep them / B delete every test docs/12 does not name, and drop the relay step from `check.sh` if its tests go
- **Default used:** A. Deleting them removes accepted work the earlier answers asked for; one instruction away if wanted.
- **Blast radius:** B deletes about 20 Rust tests, 10 vitest cases and 9 relay tests.
- **Answer:**
- **Resolved:** no

### Q42 — Probe depth: two pages or the whole listing
- **Context:** docs/17 §2.2 hashes the first two pages of each panel. (Seeded as "Q41" in the Build 3 install notes; renumbered because Q41 was already taken.)
- **Options:** A two pages / B whole listing
- **Default used:** A — new and changed rows appear at the top; two pages cover a month of activity for any client and keep the probe near 5 s.
- **Blast radius:** one constant in the probe command.
- **Answer:**
- **Resolved:** no

### Q43 — Lookback window default
- **Context:** docs/17 §2.3, `lookback_days`. The dashboard's widest Issued bucket is 30 days.
- **Options:** A 30 / B 90 as a safety margin
- **Default used:** A — matches the lanes; open items are re-checked regardless, so nothing actionable is missed.
- **Blast radius:** one default in settings.
- **Answer:**
- **Resolved:** no

### Q44 — New client: sweep only or deep fetch by default
- **Context:** docs/17 §4.
- **Options:** A sweep only, checkbox for full / B deep fetch always
- **Default used:** A — fast first picture; history on request.
- **Blast radius:** the add-client form default.
- **Answer:**
- **Resolved:** no

### Q45 — Deep fetch document policy default
- **Context:** docs/17 §6.3.
- **Options:** A index only, download on click / B download every PDF
- **Default used:** A — 200 clients × full history is gigabytes on the collector; item fetch and warm cache cover the ones that matter.
- **Blast radius:** the dialog default.
- **Answer:**
- **Resolved:** no

### Q46 — Warm cache on by default
- **Context:** docs/17 §2.6.
- **Options:** A on, due ≤ 7 days / B off
- **Default used:** A — morning previews of urgent notices are instant; runs only with spare budget.
- **Blast radius:** one settings default.
- **Answer:**
- **Resolved:** no

### Q47 — Probe: skip clients with open items, or only clients without
- **Context:** docs/17 §2.2 assumes listing rows carry a notice's DIN, due date and reply state. On the portal those sit on the notice cards one level down. Hashing only the listing would miss a moved due date.
- **Options:** A probe and skip only logins with no open items; always walk logins with open items / B also drill into each open proceeding's notices during the probe (slower probe, more skips)
- **Default used:** A. It can never hide a change on an open item, and open items are re-read nightly anyway (§2.3).
- **Blast radius:** one condition in `Runner::probe`; B also adds a notice-level pass to `sidecar/ingest/probe.py`.
- **Answer:**
- **Resolved:** no

### Q48 — "Last N assessment years" counting
- **Context:** docs/17 §2.4 and §6.3. "Latest N AYs" needs a starting AY.
- **Options:** A count back from the AY filed this financial year (Sept 2026: AY 2026-27, 2025-26 for N = 2) / B count back from the newest AY the client already has stored
- **Default used:** A. It is stable and does not depend on what an earlier sweep happened to store.
- **Blast radius:** `decide::latest_ay_start`.
- **Answer:**
- **Resolved:** no

### Q49 — Saved views that stored a lane bucket
- **Context:** Build 2 saved views persist `bucket=8-15` style filters. Build 4 removes lanes.
- **Options:** A: migrate each bucket to the cumulative window of its upper bound (8–15 → Last 15) / B: drop the bucket from the saved view and leave the rest / C: delete affected saved views
- **Default used:** A — the user who saved "8–15" most likely wanted "this fortnight", and nothing is lost.
- **Blast radius:** one SQL data migration; B or C is a smaller change.
- **Answer:**
- **Resolved:** no

### Q50 — Which type_registry rows count as assessment proceedings
- **Context:** Viewed by AO and Limitation are assessment-only. The registry has no flag for it.
- **Options:** A: seed `is_assessment=1` for scrutiny (143(2)/142(1)), reassessment (148/147), penalty (270A/271*), best-judgement (144) / B: A plus rectification (154) and revision (263/264) / C: only rows whose portal panel is "Assessment Proceedings"
- **Default used:** A — matches what the portal shows "Response viewed by AO on" for, as far as the existing parser has seen it.
- **Blast radius:** an UPDATE statement; the flag is data, so any answer is a one-line change.
- **Answer:**
- **Resolved:** no

### Q51 — Viewed by AO as one export column or two
- **Context:** Column 17 is `Yes (dd-mm-yyyy)` / `No` / blank in one text cell.
- **Options:** A: one text column as specified / B: two columns, `Viewed by AO` (Yes/No/blank) and `Viewed On` (real date)
- **Default used:** A — keeps the sheet at 18 columns and matches the dialog preview in the mockup.
- **Blast radius:** export column list and `docs/11-exports.md`; B is a better sort/filter experience for a CA.
- **Answer:**
- **Resolved:** no

### Q52 — Where the limitation date comes from
- **Context:** `proceedings.limitation_date` exists but nothing in the sidecar parses it; Farhath believes the portal shows a "limitation date or something" on assessment proceedings.
- **Options:** A: manual only, entered on the work item, until a HAR capture confirms the portal label / B: derive from statute (e.g. AY end + N months by section) / C: parse a guessed label from the card
- **Default used:** A — B invents a statutory date (forbidden, D-007 spirit) and C repeats the screenshot-parser mistake from `docs/15-known-bugs.md`.
- **Blast radius:** none in code; when the label is confirmed, one parser field and one intake mapping.
- **Answer:**
- **Resolved:** no

### Q53 — Not-viewed-by-AO chip: which response counts
- **Context:** "Reply not yet viewed by AO" needs a filed response to be meaningful.
- **Options:** A: latest response on the proceeding filed and `ao_viewed_on` null / B: any response filed / C: ignore responses; null `ao_viewed_on` on any assessment proceeding
- **Default used:** A — a proceeding with no reply yet is "needs action", not "awaiting AO".
- **Blast radius:** one SQL predicate shared by the chip and the risk-strip tile.
- **Answer:**
- **Resolved:** no

### Q54 — Export column picker persistence
- **Context:** The dialog lets the user untick columns.
- **Options:** A: remember per device in settings / B: remember per saved view / C: never remember, always all columns
- **Default used:** A — cheapest; the mockup shows no per-view control.
- **Blast radius:** one settings key.
- **Answer:**
- **Resolved:** no

### Q55 — Clients export: include the sync-health columns
- **Context:** Columns 15–17 (Last Sync, Last Result, Open Items) are not registration fields; the request was "all the fields filled when the client was added".
- **Options:** A: include them at the end / B: registration fields only (14 columns)
- **Default used:** A — the ideation table listed them and they cost nothing to drop later.
- **Blast radius:** three columns.
- **Answer:**
- **Resolved:** no

### Q56 — Limitation date on the Calendar
- **Context:** §3.3 puts limitation dates on the Calendar as items.
- **Options:** A: show as items with their own pill / B: show only as a count in the risk strip, not on the Calendar
- **Default used:** A.
- **Blast radius:** one Calendar item source.
- **Answer:**
- **Resolved:** no

### Q57 — "Everything" deep fetch and the time budget
- **Context:** docs/17 gives the nightly sweep a run window and time budget. A user-requested full-history fetch of one client can be long.
- **Options:** A: no budget, runs to completion with a cancel button / B: same budget as nightly, resumes next night / C: budget prompt before starting
- **Default used:** A — the user asked for it explicitly and is watching.
- **Blast radius:** one branch in the fetch runner.
- **Answer:**
- **Resolved:** no

### Q58 — Build 4 mockups are not in the tree
- **Context:** docs/18 says the UI must match `docs/mockups/build-4/*.png` exactly. The zip carried only the three markdown files; no PNG arrived.
- **Options:** A build from the spec's prose (§2–§7 name every element, the copy and the pill colours) and refit once the PNGs land / B stop Build 4 until they arrive
- **Default used:** A — the text is specific enough for layout, copy and colours; spacing follows the design system.
- **Blast radius:** layout polish only, per screen, once the PNGs are added; no data or command changes.
- **Answer:**
- **Resolved:** no

### Q59 — Risk strip replaces the "No due date" and "Drafts to review" tiles
- **Context:** docs/18 §2 makes the strip the four risk tiles. Build 2's strip had Overdue · Due in 48h · No due date · Drafts to review (Q33 kept the drafts tile).
- **Options:** A the four risk tiles only; "No due date" stays reachable as rank 4 in the table and through the Calendar link; drafts to review stays in the draft drawer / B six tiles / C four tiles plus a small "n drafts to review" line under the strip
- **Default used:** A — docs/18 wins where it disagrees with docs/16, and the strip is one row.
- **Blast radius:** `RISK_TILES` in `src/lib/windows.ts` (a list); the old tile predicates are two lines away.
- **Answer:**
- **Resolved:** no

### Q60 — Ledger event kinds are rows of a synced table
- **Context:** docs/18 §3.4 asks for ledger entry kinds `ao_viewed` and `limitation_changed`. A ledger entry here is a table upsert (docs/03), and `apply` rejects an unknown entity type, so a bare "kind" would break sync on every other device.
- **Options:** A a synced `proceeding_events` table (one immutable row per change; entity type `proceeding_events`) / B widen the ledger with a free-text `kind` and teach `apply` to store non-table entries
- **Default used:** A — nothing in sync, snapshots or bundles changes; Updates reads the rows like any other table.
- **Blast radius:** `repo/events.rs` (writers), migration 0023 (the table); B would touch `ledger.rs`, `merge.rs`, `snapshot.rs`, the relay.
- **Answer:**
- **Resolved:** no

### Q61 — Other acts (GST, MCA, Labour) as an optional import
- **Context:** docs/19 §2.5. vcfo's FY 2026-27 dataset is typed from an SBC PDF; it would go stale silently.
- **Options:** A income tax only from the portal, firm dates by hand / B offer a one-click import of the vcfo dataset, labelled "typed from PDF, not live", as extra legend acts
- **Default used:** A.
- **Blast radius:** a seed file, two legend acts, an import button in Settings → Calendar.
- **Answer:**
- **Resolved:** no

### Q62 — Applies-to-us profile fields now
- **Context:** docs/19 §2.4 adds entity type, audit, TP and TDS-deductor fields to the client profile.
- **Options:** A build now (fields blank until set; scope falls back to `everyone`) / B defer; scope shows only All and Overdue
- **Default used:** A — the scope is the main reason a CA opens the calendar.
- **Blast radius:** four columns, four form fields, one scope option.
- **Answer:**
- **Resolved:** no

### Q63 — First day of week
- **Context:** docs/19 §4. vcfo is Sunday-first; Build 2's calendar and the mockups are Monday-first.
- **Options:** A Monday, with a setting / B Sunday to match vcfo exactly
- **Default used:** A.
- **Blast radius:** one constant in `lib/calendar-grid.ts` and the setting.
- **Answer:**
- **Resolved:** no

### Q64 — Where the Notices "Open" action lands
- **Context:** docs/19 §4 agenda. Clicking "Open" on a day's notices goes to Attention with the matching Due bucket, or to the Build 2 day list beyond 30 days.
- **Options:** A as specified / B always the day list, inside the calendar
- **Default used:** A.
- **Blast radius:** one navigate() call.
- **Answer:**
- **Resolved:** no

### Q65 — Portal fetch cadence
- **Context:** docs/19 §3.1. Weekly, nightly around the FY boundary.
- **Options:** A as specified / B nightly always (one cheap GET)
- **Default used:** A.
- **Blast radius:** the cadence rule in the `public` step.
- **Answer:**
- **Resolved:** no

### Q66 — The portal calendar cannot be fetched from the build machine
- **Context:** docs/19 §2.1 and task 31.2 ask for the real `yearly-deadlines.aspx` page as the fixture. incometaxindia.gov.in answered HTTP 403 "Access Denied" (Akamai edge) to curl with browser headers and to headless Chromium alike, for every URL tried.
- **Options:** A a synthetic fixture in the described structure, clearly labelled, and the parser and fetcher built against it; swap in the real page when a machine can reach the portal / B wait for the real page before any of Build 5
- **Default used:** A. The parser walks headings and paragraphs in order and never drops a dated row, so a wording difference on the real page degrades to `other`, not to a miss. The fetcher's failure path (a `failed` fetch row, rows untouched, a warning line on the screen) is what the app will show until the portal answers.
- **Blast radius:** `sidecar/tests/fixtures/statutory/yearly-deadlines-2026.html` (replace the file; the three parser tests then pin the real structure) and, if the real markup differs, the heading/paragraph walk in `statutory/parse.rs`. TODO(blocked) on 31.2.
- **Answer:**
- **Resolved:** no

### Q67 — Audit rows before ITR rows in the category table
- **Context:** docs/19 §2.3 orders the rules tds_deposit, tds_returns, advance_tax, itr, audit, forms with "first match wins". An audit-report row names the return it precedes ("… required to submit his return of income on October 31") and so matched `itr`.
- **Options:** A move `audit` above `itr` (legend order follows) / B keep the order and add "audit report" as an exclusion on the ITR rule
- **Default used:** A — one row moved, no new rule shape.
- **Blast radius:** one row in `CATEGORIES` in `statutory/rules.rs`; the legend shows Audit before ITR.
- **Answer:**
- **Resolved:** no
