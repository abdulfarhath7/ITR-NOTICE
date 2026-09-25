# 18 — Build 4: cumulative windows, exports, client export, AO-viewed and limitation everywhere

Read this after `docs/16-dashboard-v2.md` and `docs/17-scrape-scopes.md`. It
adds to them; it does not replace them. Where this document and an older one
disagree, this one wins.

Mode is the usual one (`CLAUDE.md`): fully autonomous, no questions
mid-build, no manual or smoke testing. Farhath tests after the whole build.

How decisions work in this build:

1. **Decide, build, log.** Whenever the spec is silent or ambiguous, pick the
   option you judge best, build it, and file it in `QUESTIONS.md` using the
   existing template. Q49–Q57 are seeded with defaults (renumbered from the
   install notes' Q46–Q54, already taken by Build 3); keep using them and
   add Q58 onward for anything new. Never stop, never leave a stub, never
   build two variants.
2. **Answers come later and must land as small diffs.** Farhath answers the
   questions after testing. Phase 30 then applies only the answers that
   differ. An answer must never force a rewrite: every decision you take is
   built behind one seam — a single constant, one SQL statement, one map
   file, one function — so changing it later touches one place. § 10 lists
   the required seam for every seeded question; give every new question the
   same treatment and name the seam in its `Blast radius` line.
3. **Code is reframed, not replaced.** When Phase 30 arrives, edit in place.
   No deleting a module to build it again, no renaming for taste, no
   reworking neighbours the answer does not touch.

Progress goes in `TASKS.md` Phases 25–30; anything pushed through with a
gap goes in `NOTES.md` as a TODO.

The UI must match the Build 4 mockups exactly. They are exported as PNGs
under `docs/mockups/build-4/`:

| File | Screen |
|---|---|
| `attention.png` | Attention dashboard — risk strip, cumulative chips, export button, new columns |
| `export-dialog.png` | Export current view dialog with sheet preview |
| `clients.png` | Clients page with Export all clients and sync-health columns |
| `sweep.png` | Sweep screen — nightly card plus deep fetch one client |
| `work-item.png` | Work item detail — AO viewed and limitation in the header and thread; Updates entry |

Same rule as Build 2: reproduce layout, copy, pill colours and spacing from
the mockup. Placeholder client names and PANs in the mockups are not data.

---

## 1. What is being built, in one table

| # | Change | Where | Phase |
|---|---|---|---|
| 1 | Issued and Due windows are cumulative: Last 7 ⊂ Last 15 ⊂ Last 30 | Attention, Calendar, export scope | 25 |
| 2 | Disjoint bucket lanes removed; one meaning of "15 days" everywhere | Attention | 25 |
| 3 | Risk strip: Overdue · Due in 3 days · Reply not yet viewed by AO · Limitation within 60 days | Attention | 25 |
| 4 | `Export · N rows` button on Attention, reading every active chip | Attention | 27 |
| 5 | Export dialog: what will be exported, column picker, sheet preview | Attention, Client 360 | 27 |
| 6 | Header block gains a filter line and a row count; filename encodes the filter | Rust export | 27 |
| 7 | Two new proceedings-sheet columns: Viewed by AO, Limitation Date | Rust export | 27 |
| 8 | Export all clients: every registration field, blanks blank, never credentials | Clients, Rust export | 28 |
| 9 | Sync-health columns on the clients table and in the clients export | Clients | 28 |
| 10 | Viewed by AO and Limitation as Attention columns (assessment only, — otherwise) | Attention | 26 |
| 11 | Chips: Not viewed by AO · Limitation ≤ 30/60/90d | Attention | 26 |
| 12 | Both fields in Client 360 tables and the Calendar (limitation as a date item) | Client 360, Calendar | 26 |
| 13 | AO-viewed first-seen timestamp; AO-viewed flip and limitation change as ledger events shown on Updates | Ledger, Updates | 26 |
| 14 | Sweep screen: deep fetch one client with Everything / Last N AYs / Since date, Index only / with PDFs | Sweep | 29 |
| 15 | Sweep run log export | Sweep, Rust export | 29 |
| 16 | Notice-type pill on Attention rows (143(2), 148, 142(1), 271, 156, 143(1)) | Attention | 26 |

Deferred, not in this build (unchanged from Build 2's deferred list): alerts
of any kind, owner SLA reporting, monthly firm report, client portal,
mobile, bulk credential import, anything beyond e-Proceedings.

---

## 2. Cumulative windows

### The bug

Build 2 drew Issued and Due as bucket *lanes*: 0–7, 8–15, 16–30. Clicking
"Last 15" showed days 8–15 only. That is wrong. A CA asking for the last 15
days wants days 1–15.

### The rule

Every window is measured from today (device local date, IST) and includes
everything up to today:

```
Issued  Last 7   = issued_on ∈ [today-6,  today]
        Last 15  = issued_on ∈ [today-14, today]
        Last 30  = issued_on ∈ [today-29, today]
Due     Next 7   = due ∈ [today, today+6]
        Next 15  = due ∈ [today, today+14]
        Next 30  = due ∈ [today, today+29]
```

Counts overlap by design. The Last 7 count is always ≤ the Last 15 count.

`due` here is the effective due date already defined in
`docs/09-ui-spec.md` § Due dates: manual due date when set, else portal due
date. Rows with no due date at all are not in any Due window; they stay in
the "open with no stated due date" gap rank.

### What replaces the lanes

The lanes go. The Attention screen becomes: risk strip → chip bar → hint
line → one ranked table. Ranking inside the table stays exactly as
`docs/09-ui-spec.md` § 1 lists it (overdue, limitation ≤ 30d, due ≤ 7d,
gap, everything else). The chip bar is the only place a window is chosen.

The hint line under the chips is literal copy from the mockup:

```
[Days 1–15]  Showing notices issued 11 Sep – 25 Sep 2026. Last 7 is inside Last 15, which is inside Last 30.
```

with the pill and the two dates computed. When no window chip is active the
line reads `Showing all open items.`

Saved views (Build 2) that stored a lane bucket are migrated: a saved
`bucket=8-15` becomes `window=issued-15`; `bucket=16-30` becomes
`window=issued-30`; `bucket=0-7` becomes `window=issued-7`. Same for due.
See Q49.

The Calendar screen uses the same window definitions for its "next N days"
strip.

---

## 3. Viewed by AO and Limitation date — surfacing existing fields

### Where the data already is

| Field | Table | Populated by | Shown today |
|---|---|---|---|
| `ao_viewed_on` | `communications` | `sidecar/ingest/parse.py` from the card label "Response viewed by AO on" (`sidecar/app/portal/scraper.py`) | Work item detail only |
| `limitation_date` | `proceedings` | nothing from the portal today; `docs/02-data-model.md` calls it the statutory clock | Attention rank 2, export not at all |

Do not add new columns for these two values. Do add:

- `communications.ao_viewed_first_seen_at TEXT NULL` — the sweep timestamp
  at which this device first saw `ao_viewed_on` non-null. Set once, never
  overwritten. This is what the thread event and the Updates entry show as
  "first seen".

### Assessment-only rule

Both values are meaningful only for proceedings whose registry category is
an assessment proceeding (the `type_registry` rows for scrutiny, reassessment,
inquiry, penalty and any other row flagged as assessment — see Q50 for the
flag). For every other proceeding:

- table cells show `—` in the muted colour, never blank and never "N/A";
- the Attention columns auto-hide when no row in the current result set is
  an assessment proceeding;
- the export cells are empty (blank means blank, `docs/11-exports.md`);
- the chips in § 3.3 do not match.

### Display, everywhere

| Place | Viewed by AO | Limitation |
|---|---|---|
| Attention table column | pill `Yes · 22 Sep` (green) or `No` (grey) | `31 Mar 2027 · 187d`, mono; red when ≤ 30d, amber when ≤ 60d |
| Work item header | same pill | same, plus days left |
| Work item thread | event "Reply viewed by AO" dated `ao_viewed_on`, subline "detected by sweep, first seen <ao_viewed_first_seen_at>" | shown on the trailing grey event "Awaiting order or next notice" |
| Client 360 proceedings tab | column | column |
| Calendar | — | limitation dates appear as items, distinct pill from due dates |
| Proceedings export | column 17, `Yes (dd-mm-yyyy)` / `No` / blank | column 18, real Excel date / blank |
| Updates screen | "AO viewed" entry on flip null → non-null | "Limitation" entry on any change |
| Risk strip | tile "Reply not yet viewed by AO" = assessment proceedings with a submitted response and `ao_viewed_on` null | tile "Limitation within 60 days" |

Copy: the label is **Viewed by AO** in table headers and **Reply viewed by
AO** in prose and tiles. Never "Response viewed by AO on :" with the colon —
that is the portal's label, not ours.

### Chips

Three new chips in the chip bar, after Type:

- `Not viewed by AO` — assessment proceedings, latest response filed,
  `ao_viewed_on` null.
- `Limitation ≤ 90d` — a chip with a menu: 30 / 60 / 90 days. Default 90.
- `Type ▾` — multi-select over the notice-type pills in § 3.5.

Chips compose with everything else (AND). Saved views store them.

### Ledger events

Two new ledger entry kinds (see `docs/03-sync-and-ledger.md` for the entry
shape):

- `ao_viewed` — entity `communication`, payload `{ao_viewed_on,
  first_seen_at}`. Written by the sweep when a re-checked communication goes
  from null to a date. Written once.
- `limitation_changed` — entity `proceeding`, payload `{from, to, source}`
  where source is `portal` or `manual`.

The Updates screen (Build 2) shows both, pill colours as the mockup: green
"AO viewed", amber "Limitation", purple "New". The sweep run summary on the
Sweep screen counts `ao_viewed` entries as "AO-viewed flips".

### Notice-type pill

A pill on each Attention row derived from `section_1961` (fallback
`section_2025`), mapped through a small table in `src/lib/notice-type.ts`:

| Section match | Pill text | Colour |
|---|---|---|
| 143(2) | 143(2) scrutiny | purple |
| 142(1) | 142(1) inquiry | purple |
| 148, 148A | 148 reassessment | red |
| 271* , 270A | 271 penalty | amber |
| 156 | 156 demand | grey |
| 143(1) | 143(1) intimation | grey |
| anything else | the section text as-is | grey |

The map is data, not code paths: adding a row must not require touching
the component. This pill is display only; it is not a new column in the
database.

---

## 4. Exports

### Attention export

The `Export · N rows` button on Attention opens the dialog in
`export-dialog.png`. N is the row count of the current result set, computed
before the user clicks (`docs/11-exports.md` § Scope selector already asks
for this).

The dialog:

- Left: Filter, Range, Client, Module, Status, Rows, File. Each is the
  human form of the active chips. Filter reads e.g. `Issued · Last 15 days`;
  with no window chip it reads `All open items`.
- Left, below: column picker. All proceedings-sheet columns checked by
  default; Notes unchecked. Order is the sheet order. The choice is
  remembered per device in settings.
- Right: sheet preview showing rows 1–6 and the first three data rows. This
  is a static rendering built from the same header-block strings the Rust
  side will write — pass them back from a `preview_export` command rather
  than duplicating the formatting in TypeScript.
- Footer copy is literal from the mockup.
- Cancel / Export .xlsx. Export runs the existing `export_workbook` with a
  `View` scope whose `label` is the filter line (§ 4.2) and whose items are
  the full result set, not the page the table holds.

### Header block

`docs/11-exports.md` § Header block defines rows 1–3. Build 4 makes it rows
1–4 on every sheet and changes the wording to the mockup's:

```
Row 1  Litigation Command Center — <sheet title>
Row 2  Filter: <filter line>
Row 3  Client: <client scope> · Module: <module> · Status: <status>
Row 4  Exported: <dd Mon yyyy HH:mm IST> · Rows: <n> · Last sweep: <dd Mon yyyy HH:mm>
Row 5  (blank)
Row 6  column headers — frozen, autofilter on
```

Filter line grammar:

- window chip only: `Issued in last 15 days (11 Sep 2026 – 25 Sep 2026)`
  or `Due in next 30 days (25 Sep 2026 – 24 Oct 2026)`
- no window chip: `All open items`
- extra chips are appended with ` · `: `Issued in last 15 days (…) · Not
  viewed by AO · Type: 143(2), 148`
- `All` scope: `All proceedings, every status`
- `Client` scope: `Client <name>, every status`

The "Unverified fields in this export" count from the old row 3 moves into
row 4 after Rows, as ` · Unverified: <n>`, only when n > 0.

`ExportScope::View` gains no new fields; the frontend passes the filter line
as `label`. `scope_label()` returns it unchanged for `View` and the two
fixed strings above for `All` and `Client`.

### Filename

`LCC_<slug>_<yyyy-mm-dd>.xlsx` where slug is `issued-15d`, `due-30d`,
`all`, `client-<client_code or pan>`, or `view` when the filter has no
window chip. The date is the export date. The user still gets the save
dialog; this is the suggested name.

### New columns

The proceedings sheet grows from 16 to 18 columns:

| # | Column | Source |
|---|---|---|
| 17 | Viewed by AO | latest inbound `communications.ao_viewed_on` on the proceeding: `Yes (dd-mm-yyyy)` text, `No` when the proceeding has a filed response and null, blank when not an assessment proceeding or no response filed |
| 18 | Limitation Date | `proceedings.limitation_date` as a real Excel date, blank when null |

Update `docs/11-exports.md` § Sheet 1 in the same commit. Q51 asks whether
column 17 should be split into two.

### Client 360 export

The Export button on Client 360 uses `ExportScope::Client` and the same
dialog with Client fixed. Nothing else changes.

---

## 5. Clients export

Button `Export all clients` on the Clients screen, left of Add client. No
dialog: it writes immediately with the save-as prompt, filename
`LCC_clients_<yyyy-mm-dd>.xlsx`. One sheet, `Clients`, same four-row header
block (`Filter: All clients`).

Columns, in this order, one per `clients` field as entered at registration:

| # | Column | Source |
|---|---|---|
| 1 | S.No | generated |
| 2 | Client ID | `client_code` |
| 3 | Client Name | `name` |
| 4 | PAN | `pan`, text cell |
| 5 | Entity Type | `entity_type` label |
| 6 | Group | `client_group` |
| 7 | Phone | `phone_cc` + space + `phone`, text cell; blank when `phone` is null even though `phone_cc` defaults to +91 |
| 8 | Email | `email` |
| 9 | GSTIN | `gstin`, text cell |
| 10 | Client File # | `client_file_no` |
| 11 | Tags | `tags` |
| 12 | Login | `Own` when `portal_login_ref` is null, else the AR/other reference |
| 13 | Source | `source` (portal / eri) |
| 14 | Added On | `created_at` as Excel date |
| 15 | Last Sync | latest `ingestion_runs.run_at` for this client |
| 16 | Last Result | the run's outcome label as the Clients screen shows it (OK · 2 new / Login failed / OTP needed / Unchanged) |
| 17 | Open Items | count of open proceedings |

Blank means blank. **Portal passwords, OTP secrets and anything held in the
OS keychain are never read by the export code path** — the export module
must not import `keychain.rs`. This is the security rule from
`docs/07-security.md` applied to a new surface; it is not negotiable and is
not a question.

Columns 15–17 come from the local device's view of the ledger, same caveat
as the Updates screen (Q37).

---

## 6. Clients screen

The table gains three columns after Email: Last sync, Result, Open. Result
is the pill from the mockup (green OK, red Login failed, amber OTP needed,
grey Unchanged). The footer line is literal copy:

```
Export all clients writes every registration field as entered; empty fields are left empty. Portal passwords are never exported.
```

Search matches name, PAN and GSTIN. The header count reads
`<n> registered · <m> with sync failures`.

---

## 7. Sweep screen

`docs/17-scrape-scopes.md` specifies the sweep engine, including deep fetch
of one client. Phase 23 may already have shipped a Sync screen with
per-client health. Build 4 does not change the engine; it fixes the screen
to `sweep.png`:

- Nav tab is **Sweep** (rename from Sync if Phase 23 called it that).
- Left card, Nightly sweep: pill `This device · runs 02:00` (or `Not this
  device` when another device holds the overnight role), Scope / Time
  budget / Last run, then the five stat rows (Clients checked, Skipped,
  New items indexed, AO-viewed flips, Failed → link to Clients filtered to
  failures). Buttons Run now, Export run log.
- Right card, Deep fetch one client: client picker, Scope radios
  **Everything / Last 3 AYs / Since date**, Fetch radios **Index only /
  Index + download PDFs**, Estimate line, Start fetch. "Everything" is the
  full-history scrape from the first AY the portal lists to the current one;
  it is the only way a client's full data is ever pulled. Last N AYs shows
  a number stepper on selection; Since date shows a date field.
- Estimate line: `AY <first> → <last> · ~<n> items · ~<m> min`, from the
  listing probe defined in docs/17. When no probe has run, `Estimate after
  probe`.

Run log export: one sheet, `Sweep runs`, one row per client per run for the
selected run: client, PAN, started, finished, result, new items, AO-viewed
flips, failure reason. Same four-row header block, `Filter: Sweep run <dd
Mon yyyy HH:mm>`.

---

## 8. Data changes

Migrations continue the local sequence (Build 2 ended at 0020; docs/17
reserves the next numbers for Phase 23 — take the next free number):

1. `communications.ao_viewed_first_seen_at TEXT NULL`
2. `type_registry.is_assessment INTEGER NOT NULL DEFAULT 0` plus an UPDATE
   seeding it for the assessment rows (Q50)
3. Ledger kinds `ao_viewed` and `limitation_changed` — no schema change if
   `ledger.kind` is free text; add them to the kind enum if it is a CHECK
4. Saved-view migration from lane buckets to windows (a data migration in
   SQL, not application code)

No table is dropped. No existing column changes meaning.

---

## 9. Out of scope, explicitly

- Any change to the scraper's card parser. If the limitation date is not
  on the card today it stays manual (Q52); do not go hunting in the DOM.
- Alerts, reminders, WhatsApp, email.
- Bulk select on Attention.
- Anything the ERI API would do.
- Tests, smoke runs, screenshots, Playwright. `./scripts/check.sh` must
  still pass; that is the only gate.

---

## 10. Seams — where each answer will land

Build each decision so the later answer is one edit. This table is a
contract: the file and shape named here is where Phase 30 will look.

| Q | Decision | Seam | Shape |
|---|---|---|---|
| Q49 | Saved-view bucket migration | the one data migration file | a `CASE` mapping bucket → window; editable per row |
| Q50 | Which registry rows are assessment | the seed `UPDATE type_registry SET is_assessment = 1 WHERE …` in its migration | the `WHERE` list only; UI and export read the flag, never section strings |
| Q51 | AO column as one or two | `src-tauri/src/export.rs` column table for the proceedings sheet | one row in a declarative column list `(header, width, cell_fn)`; splitting = adding a row |
| Q52 | Limitation date source | `src-tauri/src/intake.rs` proceeding mapping | `limitation_date` currently maps from nothing; the parser field name and this one mapping line are the only change when confirmed |
| Q53 | Not-viewed-by-AO predicate | one SQL fragment constant `NOT_VIEWED_BY_AO_WHERE` in the Rust repo layer | used by the chip and the tile; change the fragment, both follow |
| Q54 | Column-picker persistence | one settings key `export.columns` read in the dialog | scope (device / view / none) is a single read/write site |
| Q55 | Sync-health columns in clients export | the clients-sheet column list in `export.rs` | three rows at the end of the list; delete to drop |
| Q56 | Limitation dates on Calendar | one item-source function in the Calendar screen | a function returning items; remove the call to drop |
| Q57 | Deep-fetch budget | one `FetchBudget` argument on the deep-fetch runner | `None` today; an answer sets it |
| Q58 | Mockups absent | each Build 4 screen file | layout and spacing only; copy and colours already follow the spec |
| Q59 | Which tiles the strip shows | `RISK_TILES` in `src/lib/windows.ts` | a list; add or remove an entry and its predicate |
| Q60 | Event kinds as a synced table | `repo/events.rs` + migration 0023 | writers in one file; the table is the storage |

Two general rules that make this hold:

- Anything that could plausibly be answered differently is data, not a
  branch: column lists, pill maps, chip predicates, seed lists. Adding,
  removing or reordering a row must never require touching a component.
- Copy is literal in the markup where the mockup shows it, in one place.
  Do not centralise strings into a dictionary and do not scatter the same
  string across files.

When you file a new question, add its row to this table in the same commit.
