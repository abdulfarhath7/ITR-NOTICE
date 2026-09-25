# 19 — Statutory calendar: portal tax calendar, two modes, two layers

Read after `16-dashboard-v2.md` (§5 Calendar) and `17-scrape-scopes.md`.
This file is the specification for Phase 31 in `TASKS.md`.

The goal: replicate the **vcfo_suite** statutory calendar — its minimized
card and its full-screen mode, its legend, scopes, agenda and keyboard —
inside LCC, but feed it from the Income Tax Department's **public Tax
Calendar** (no login) instead of a hand-typed PDF, and draw LCC's own
notice due dates on the same grid as a second layer.

Reference implementation to read first (clone or open a checkout of
`github.com/abdulfarhath7/vcfo_suite`, read-only):

| vcfo file | What to replicate from it |
|---|---|
| `src/components/admin/StatutoryCalendar.tsx` | minimized card: header, scope, month nav, grid, legend with mute + counts, agenda, flash-scroll on day click, keyboard grid |
| `src/components/admin/StatutoryMaxiCalendar.tsx` | full-screen overlay: trimmed-week grid, 3 fixed pill slots per cell, right rail with scope + legend, Escape restores, body scroll locked |
| `src/components/admin/statutory-calendar-utils.ts` | grid builder, keyboard movement, status and labels, heat levels, pill label, prefs read/write |
| `src/components/shell/SidebarComplianceMini.tsx` | sidebar mini widget |
| `src/data/statutory-calendar-fy2627.ts` | the data shape (`id, date, act, title`) and the legend meta pattern — **not the data** (see §2.5) |

Copy behaviour and structure, not styling: vcfo is light Tailwind; LCC
follows `10-design-system.md`. Every `stat-cal-*` / `stat-max-*` class in
vcfo maps to a class in a new `styles/calendar.css` using LCC tokens.

---

## 0. Vocabulary

| Term | Meaning |
|---|---|
| statutory deadline | one dated row from the portal calendar: date, title, category, optional note |
| extension | a portal note "extended from A to B vide Circular n" attached to a deadline |
| notice due | an open work item's effective due date (Build 2 §0) |
| layer | Statutory or Notices; each can be shown or hidden |
| category | one of the seven in §2.3; the legend rows |
| scope | All · Applies to us · Overdue |
| mode | minimized (card) or maximized (overlay) |
| FY | Indian financial year, 1 Apr – 31 Mar; the calendar is clamped to the current FY and the next |

Dates are IST; `todayIst()` from `lib/dates.ts` is the only clock.

---

## 1. Where it lives

- **Calendar screen** (Build 2 route `calendar`) is rebuilt as the
  minimized card in §4. The Build 2 month grid, `Due`/`Issued` toggle and
  day list are absorbed into it: Notices become a layer; `Due`/`Issued`
  becomes a small toggle inside the Notices legend row.
- **Full screen** is an overlay over the content column (§5), reached
  from the card's "Full screen" button and `F` on the Calendar screen.
  Mode is remembered per device.
- **Sidebar mini** (§6) under the nav, on every screen.
- **Attention strip** gains a fifth tile "Next statutory" (§6).
- **Updates screen** gains a "Deadline extended" group (§3.4).

---

## 2. Data

### 2.1 Source

`https://incometaxindia.gov.in/Pages/yearly-deadlines.aspx?yfmv=<YYYY>`
lists every due date of a calendar year as server-rendered HTML: a
month heading, then for each deadline a weekday-date heading
("Wednesday, January 7, 2026") followed by one description paragraph,
sometimes followed by a note paragraph describing an extension with a
circular reference. `https://incometaxindia.gov.in/pages/deadline.aspx`
shows the current month as a grid with the same text.

Fetch with plain HTTPS GET from Rust (`reqwest`, no browser, no sidecar,
no cookies). Two years per fetch: the current FY's two calendar years
and the next FY's second year, i.e. `yfmv = Y, Y+1` where Y is the year
of the current FY start, plus `Y+2` when the current date is past 1 Jan.
Follow `05-ingestion.md` "Parsing discipline": write the parser from a
saved copy of the real page, commit that copy as a fixture (it contains
no PII), and re-fetch the fixture when the parser breaks.

### 2.2 Tables

```sql
CREATE TABLE statutory_deadlines (
    id            TEXT PRIMARY KEY,          -- sha256(source_date || normalised title)[:16]
    due_on        TEXT NOT NULL,             -- YYYY-MM-DD, the date currently in force
    original_on   TEXT,                      -- YYYY-MM-DD when extended, else NULL
    title         TEXT NOT NULL,             -- portal text, whitespace-normalised, no trailing period
    category      TEXT NOT NULL,             -- §2.3
    note          TEXT,                      -- extension / circular text, verbatim
    circular      TEXT,                      -- "15/2025" when parseable, else NULL
    applies       TEXT NOT NULL DEFAULT '[]',-- JSON array of §2.4 tags
    source_year   INTEGER NOT NULL,          -- the yfmv the row came from
    first_seen_at TEXT NOT NULL,
    last_seen_at  TEXT NOT NULL,
    removed_at    TEXT                       -- set when a row disappears from the source
);
CREATE INDEX idx_statutory_due ON statutory_deadlines(due_on);

CREATE TABLE statutory_fetches (
    id          TEXT PRIMARY KEY,
    source_year INTEGER NOT NULL,
    fetched_at  TEXT NOT NULL,
    status      TEXT NOT NULL CHECK (status IN ('ok','unchanged','failed')),
    page_hash   TEXT,
    rows        INTEGER,
    error       TEXT
);

CREATE TABLE firm_dates (                    -- user-authored, via the ledger
    id          TEXT PRIMARY KEY,
    due_on      TEXT NOT NULL,
    title       TEXT NOT NULL,
    category    TEXT NOT NULL DEFAULT 'firm',
    note        TEXT,
    created_by  TEXT,
    created_at  TEXT NOT NULL
);
```

`statutory_deadlines` and `statutory_fetches` are collector-owned and
travel to other devices through the existing changeset mechanism as
their own entity types (`statutory_deadline`, `statutory_fetch`) so every
device shows the same calendar. `firm_dates` is user-authored from any
device, like `work_item_meta`.

Client columns for §2.4:

```sql
ALTER TABLE clients ADD COLUMN entity_kind   TEXT CHECK (entity_kind IN ('individual','huf','firm','llp','company','trust','other'));
ALTER TABLE clients ADD COLUMN audit_case    INTEGER NOT NULL DEFAULT 0;   -- books required to be audited
ALTER TABLE clients ADD COLUMN tp_case       INTEGER NOT NULL DEFAULT 0;   -- international / specified domestic transactions
ALTER TABLE clients ADD COLUMN tds_deductor  INTEGER NOT NULL DEFAULT 0;   -- holds a TAN
```

All four are NULL/0 until a person sets them on the client Profile tab.
Never infer them from scraped data.

### 2.3 Categories

Assigned by the first matching rule on the lower-cased title, in this
order. Unmatched rows are `other`; never drop a row for failing to
classify.

| id | Legend label | Rule (any of) |
|---|---|---|
| `tds_deposit` | TDS/TCS deposit | "deposit of tax deducted", "deposit of tds", "tax collected", "challan", "form 24g" |
| `tds_returns` | Returns & certificates | "tds certificate", "tcs certificate", "form 16", "form 27", "statement of deduction", "quarterly statement", "form 26q", "form 24q", "form 27q" |
| `advance_tax` | Advance tax | "advance tax", "instalment" |
| `audit` | Audit & reports | "audit report", "form 3ca", "form 3cb", "form 3cd", "form 3ceb", "form 10b", "transfer pricing" (before ITR, Q67: an audit-report row names the return it precedes) |
| `itr` | ITR filing | "return of income", "belated", "revised return", "itr" |
| `forms` | Statements & forms | "form 15g", "form 15h", "form 27c", "form 61", "form 49", "form 3bb", "form 10", "declaration", "statement in form" |
| `other` | Other | everything else |
| `firm` | Firm dates | `firm_dates` rows only |
| `notices` | Notices due | the Notices layer, not a statutory category |

Legend order is the table order. Colours: one token per category from
`10-design-system.md` (accent, success, warning, danger, plus two neutral
tints and the border-strong grey for `other`); Notices uses the count
pill, not a dot.

### 2.4 Applicability tags

Assigned by rule on the title, stored in `applies`, used by the
"Applies to us" scope:

| Tag | Rule |
|---|---|
| `corporate` | "corporate-assessee", "company" |
| `audit` | "audited", "audit report", "partner of a firm whose accounts" |
| `tp` | "international or specified domestic transaction", "transfer pricing", "3ceb" |
| `tds_deductor` | any `tds_deposit` or `tds_returns` row |
| `individual` | "individual", "resident individuals" |
| `everyone` | no other tag matched |

A deadline **applies to a client** when: tag `everyone`, or `corporate`
and `entity_kind = 'company'`, or `audit` and `audit_case = 1`, or `tp`
and `tp_case = 1`, or `tds_deductor` and `tds_deductor = 1`, or
`individual` and `entity_kind = 'individual'`. "Applies to us" keeps a
deadline when at least one enabled client matches, and shows the match
count on the row ("applies to 41 clients"). A client with all four
fields unset matches only `everyone`.

### 2.5 Other acts (GST, MCA, Labour…)

Not fetched and not seeded in this build. The vcfo FY dataset is typed
from a PDF and would go stale silently. `Q61` asks whether to offer it
as an optional, clearly labelled import later; until answered, the
legend shows only income-tax categories, `firm`, and `notices`. Firm
dates are how a firm adds a GST date by hand meanwhile.

---

## 3. Fetch, diff, extensions

### 3.1 When

A `public` scope step runs at the **start** of the overnight pipeline
(before ordering, §2 of docs/17), and on demand from Settings →
Calendar "Refresh now". Cadence: weekly on the run window's first
enabled day, plus every night in the seven days before and after the
FY boundary (extensions cluster there). No credentials, no session lock,
no sidecar; it does not count against the client time budget.

### 3.2 Hash and diff

Per `yfmv` page: normalise (strip scripts, collapse whitespace), hash.
Equal to the last `statutory_fetches.page_hash` → write an `unchanged`
fetch row and stop. Otherwise parse every row, compute ids, and diff
against stored rows for that `source_year`:

| Case | Action |
|---|---|
| id not stored | insert; `first_seen_at = now`; ledger entry `statutory_added` |
| id stored, `due_on` unchanged, note unchanged | touch `last_seen_at` |
| id stored, note gained an extension | set `original_on = due_on`, `due_on = extended date`, `note`, `circular`; ledger entry `statutory_extended` |
| id stored, `due_on` changed without a note | treat as extension with `note = NULL`; ledger entry `statutory_extended` |
| id stored but missing from the page | set `removed_at`; keep the row; ledger entry `statutory_removed` |

Never delete a row. Never move a date without a ledger entry.

### 3.3 Extension parsing

Regex, case-insensitive, on the note paragraph:
`extended\s+(?:from\s+(?<from>[A-Za-z]+ \d{1,2}, \d{4})\s+)?to\s+(?<to>[A-Za-z]+ \d{1,2}, \d{4})`
and `circular\s+no\.?\s*(?<circ>[\d/]+)`. A note that mentions "extended"
but does not parse sets `note` and leaves `due_on` untouched, and files
a `statutory_unparsed` ledger entry so the Updates screen can show
"Extension note needs a look" — blank beats guessed.

### 3.4 Updates screen group

New group "Deadline extended", placed after "Due date changed": rows
`title · <old> → <new> · Circular n` with the old date struck through.
A second, rarer group "Calendar changed" holds `statutory_added`,
`statutory_removed`, `statutory_unparsed`. Both groups are collector
entries, so with Q39 = B they appear on every device.

---

## 4. Minimized card (Calendar screen)

Matches mockup `lcc_statutory_calendar_minimized_card`. Layout, top to
bottom:

**Header row.** Title "Calendar"; mono FY badge ("FY 2026-27", accent
tint); on the right a scope segmented control All · Applies to us ·
Overdue; then a "Full screen" button with the maximize icon.

**Body: two columns**, grid `1fr 150px`, 14px gap; stacked under 900px
with the legend first.

Left column:
- Month line: "September" + muted year; `‹` `Today` `›` on the right.
  Month is clamped to FY start of the current FY … FY end of the next
  FY; the arrows disable at the edges.
- Grid: Monday-first (LCC convention, not vcfo's Sunday-first), always
  six rows so the card height never changes. Cells: `--surface-1`,
  6px radius, min-height 52px, day number 11px top-left; out-of-month
  cells at 35% opacity and not focusable; today gets a 1px accent
  outline; the selected day gets the accent tint. Bottom-left: up to
  three 5px dots in legend order for the statutory categories present
  (fixed slot width so cells align). Bottom-right: the Notices count
  pill (Build 2 style; danger tint when the day is past and any item is
  open, warning for today/tomorrow).
- `role="grid"`, one `gridcell` per in-month cell with `aria-label`
  "Wednesday 30 September, 4 deadlines, 4 notices due"; keyboard:
  arrows move by day/week and skip out-of-month cells in the same
  direction, Home/End go to the row's first/last in-month cell,
  Enter/Space select, `t` jumps to today, `[` `]` change month, `F`
  opens full screen. Movement helpers are pure functions in
  `lib/calendar-grid.ts` (port `buildStatutoryMonthGrid`,
  `calendarCellIndexAfterKey`, `nextInMonthCellIndex` with Monday
  start).

Right column — Legend:
- 10px uppercase muted caption "Legend".
- One row per category with a dot, label, and this month's count
  (count is computed after scope, before mutes, so numbers never vanish
  when muted). Click toggles mute (row at 40% opacity, strike-through);
  Shift-click solos that category; a "Show all" link appears when
  anything is muted. Muted set persists per device.
- Hairline, then the Notices row: count pill icon, "Notices due",
  count, and a tiny `Due` / `Issued` toggle that switches which date the
  Notices layer uses (Build 2 §5). Muting Notices hides the pills.

**Agenda** (full width under both columns): the selected day's items,
grouped as vcfo does — a 40px weekday-day column, then rows. Statutory
rows: category dot, title (first clause; full title as tooltip),
"applies to n clients" when the scope is Applies to us, and a status
label on the right (`Overdue` danger, `Today`, `Tomorrow`, `n days`
warning within 7, `Upcoming` muted). Extended rows show the original
date struck through and "Extended to <date> · Circular n" in warning.
The Notices row: count pill, "Notices due · A 148, B 143(1), +n", and
"Open" which navigates to Attention with the Due bucket that contains
that day active, or to the day's items in the Build 2 day list when the
day is beyond 30 days. Clicking a grid day selects it and scrolls the
agenda into view with a 600 ms flash on the group (skip the animation
under `prefers-reduced-motion`). When nothing is selected, the agenda
shows the month's items grouped by day, today first.

Empty states: "Nothing falls due in September for these filters" with a
"Show all" link when mutes or scope hide everything; "Calendar not
fetched yet · Refresh" when `statutory_deadlines` is empty; "Portal
calendar unavailable since <date>" as a slim warning line when the
latest fetch failed, with the last good data still shown.

---

## 5. Full-screen overlay

Matches mockup `lcc_statutory_calendar_fullscreen_overlay`. Component
`ui/calendar-overlay.tsx`; state is shared with the card (same month,
scope, mutes, selected day) so switching modes never resets anything.

- Covers the content column (`position: fixed`, left edge at the
  sidebar's collapsed width), `--surface-2` background, above the
  shell header. The sidebar collapses to icons while open and restores
  on close if it was pinned open (vcfo `unpinSidebarForMax` /
  `restoreSidebarAfterMax`). `document.body` scroll is locked while
  open. Escape closes; focus returns to the "Full screen" button.
- Top bar: title "Calendar"; view segmented control **Month · Year ·
  Agenda**; scope segmented control; category chips (click mutes,
  muted at 40%, Notices chip last); right side `‹` month `›` `Today`
  `.ics` and a minimize button labelled "Exit full screen (Esc)".
- **Month view**: same grid as the card but trimmed to the weeks the
  month needs, cells min-height 74px, day number 12px, and up to three
  event pills per cell (category tint, 10px, first clause, ellipsis) in
  fixed slots; a fourth line "+n more" when needed; the Notices pill
  is a neutral "n notices due" line. Right panel (240px, hairline
  left border): the selected day's agenda exactly as in §4, plus the
  Notices list with the first two items and "+n more · open in
  Attention".
- **Year view**: twelve mini-months for the FY (Apr–Mar) in a 4×3
  grid; each day is a 10px square shaded by heat level (0 none, 1 one
  deadline, 2 two–three, 3 four+; port `statutoryHeatLevel`); today
  outlined; hover tooltip "30 Sep · 4 deadlines · 4 notices"; click
  switches to Month view on that day. Notices are shown as a small
  count in the month header, not as heat.
- **Agenda view**: the whole FY as a scrollable list grouped by month
  then day, same rows as §4, today's group pinned at the top with a
  "Today" label; `j`/`k` move between days.
- Keyboard: everything from §4 plus `1`/`2`/`3` for Month/Year/Agenda.
- Mode, view and mutes persist in `localStorage`
  `lcc.calendar.prefs.v1` `{ mode, view, muted[], scope, noticesDate }`
  with the same tolerant parse as vcfo (`parseCalendarViewPrefs`);
  a stored `maximized` mode reopens the overlay on the next visit to
  the Calendar screen only, never on other screens.

---

## 6. Sidebar mini and Attention tile

**Sidebar mini** (port `SidebarComplianceMini`): under the nav, a small
block "Next deadlines" listing the next three statutory rows in force
(scope Applies to us when any client has profile fields set, else All),
each as `dd Mon · first clause` with the status colour on the date.
Clicking opens the Calendar screen on that day. Hidden when the sidebar
is collapsed to icons; shows a single calendar icon with a badge count
of deadlines in the next 7 days instead.

**Attention strip**: a fifth tile "Next statutory" showing the nearest
in-force deadline's first clause and "n d" (danger when ≤ 2). Clicking
opens the Calendar screen on that day. When there are none within 30
days the tile reads "No statutory dates in 30 d". The strip grid becomes
`repeat(5, 1fr)`.

---

## 7. Export and print

- `.ics` button (overlay top bar and Settings → Calendar): exports the
  **statutory and firm layers only** for the FY, one all-day `VEVENT`
  per row, `UID` = row id, `SUMMARY` = title, `DESCRIPTION` = note and
  circular, `CATEGORIES` = category label. Notices are never exported
  here — they are client data.
- "Print month" (overlay `…` menu): opens the browser print dialog on a
  print stylesheet that renders the month grid with full titles and the
  legend, black on white, A4 landscape.

---

## 8. Settings → Calendar

| Row | Control | Default |
|---|---|---|
| Portal calendar | "Last fetched <date> · n deadlines" + `Refresh now` | — |
| Refresh | Weekly / Nightly | Weekly |
| First day of week | Monday / Sunday | Monday |
| Default scope | All / Applies to us / Overdue | All |
| Sidebar "Next deadlines" | toggle | on |
| Firm dates | `Manage` → a small list with Add (date, title, note), Edit, Delete | — |
| Export | `.ics for FY 2026-27` | — |

Client Profile tab gains four fields: Entity type (select), Books
audited (toggle), Transfer pricing (toggle), TDS deductor (toggle), with
the hint "Used only for the calendar's Applies-to-us scope".

---

## 9. Commands

| Command | Purpose |
|---|---|
| `list_statutory(from, to, scope)` | rows in force between dates, with `applies_count` per row when scope is `applies` |
| `refresh_statutory()` | run §3 now; returns the fetch row |
| `statutory_status()` | last fetch, row count, next scheduled |
| `list_firm_dates()` / `upsert_firm_date(...)` / `delete_firm_date(id)` | §2.2, via the ledger |
| `export_statutory_ics(fy_start_year)` | writes the file, returns the path for `present`/save dialog |
| `set_client_calendar_profile(client_id, entity_kind, audit_case, tp_case, tds_deductor)` | §2.4 |

---

## 10. Out of scope

Other acts (GST, MCA, Labour, FEMA) from any source; reminders or
notifications for statutory dates; week view; turning a deadline into a
task; two-way calendar sync. File a question, do not start.

---

## 11. Reference mockups

| Mockup id | What it fixes |
|---|---|
| `lcc_statutory_calendar_minimized_card` | card layout, legend, scope, agenda rows, Notices row |
| `lcc_statutory_calendar_fullscreen_overlay` | overlay top bar, Month/Year/Agenda, category chips, extension rendering, right panel |
| `lcc_deadline_calendar_month_view` (Build 2) | the Notices count pill style, kept |

## 12. Copy

Exact strings: "Calendar", "Full screen", "Exit full screen (Esc)",
"All", "Applies to us", "Overdue", "Month", "Year", "Agenda", "Legend",
"Show all", "Notices due", "Next deadlines", "Next statutory",
"Deadline extended", "Calendar changed", "Extended to <date> · Circular
n", "applies to n clients", "Refresh now", "Print month". Status labels:
"Overdue", "Today", "Tomorrow", "n days", "Upcoming".
