# 16 — Dashboard v2, Updates, Calendar, Client 360

Read after `00-overview.md`, `09-ui-spec.md` and `10-design-system.md`.
This file is the specification for Phases 14–22 in `TASKS.md`. Where it
conflicts with `09-ui-spec.md` screen 1, this file wins; update `09` at
the end (task 21.1).

Reference product for behaviour, not for looks: Atom Pro (Vider). Copy the
behaviour listed here; do not copy its Material-UI appearance. Looks follow
`10-design-system.md` — dark-first, dense, quiet, hairlines.

---

## 0. Vocabulary used below

| Term | Meaning |
|---|---|
| work item | a row from `list_work_items` (`WorkItemRow`), any module |
| notice | a work item whose module is `proceedings` |
| issued date | latest inbound `communications.issued_on` for the item's parent; NULL when no communication has an `issued_on` |
| effective due | `manual_due_date ?? due_date` (Q14 rule, already in `attention.ts`) |
| today | `todayIst()` from `lib/dates.ts` |
| open | `!isSettled(status)` from `lib/status.ts` |
| bucket | a time window over issued date or effective due |

Never invent a date. A NULL issued date or due date goes to the "No date"
bucket, never to a guessed one. This is the constraint in `CLAUDE.md` §4
and it applies to every count on the dashboard.

---

## 1. Attention screen (screen 1) — new layout

The screen keeps its route (`attention`), its title, its hook
(`useWorkItems` + `useAttention`), its row component, its keyboard row
navigation, its export button, and every existing filter. Nothing that
exists today is removed. The change is what sits between the filter bar
and the list.

Top to bottom:

```
┌ PageHead: "Attention" · meta "n open items" · [Export] ─────────────┐
│ Sync line: "Synced 6:12 am · 200 clients · 3 failed · Retry"         │
├ Needs-action strip (4 tiles) ────────────────────────────────────────┤
│ Overdue · Due in 48h · No due date · Drafts to review                │
├ Filter bar (existing: client · AY · module · status) + owner · search┤
│ Active chips: [Open ×] [Due next 7 d ×]  Clear all                   │
├ Lanes ───────────────────────────────────────────────────────────────┤
│ Issued              │ Due                                             │
│ last7 · 8–15 · 16–30│ next7 · 8–15 · 16–30 · Later · [Calendar →]     │
├ Views: All · <saved views…> · + Save view ───────────────────────────┤
├ List (existing table + Owner column + note icon + hover actions) ────┤
```

### 1.1 Sync line

One line under the head, `muted` text. Reads from `ingestion_runs`:
the most recent `run_at` across all clients, count of distinct
`client_id` swept in that run window, and count of runs with
`status='failed'` or `credentials_parked` in the same window. "Retry"
navigates to the Ingestion screen with the failed filter preselected
(add that filter if the screen lacks it). If no runs exist, the line
reads "Never synced".

### 1.2 Needs-action strip

Four tiles in a `repeat(4, 1fr)` grid, 8px gap, 12px below the sync
line. Each tile: radius `--radius`, padding 8px 12px, label 12px on the
left and the number 18px/500 on the right, in one row (`display:flex;
justify-content:space-between; align-items:center`). Tinted per tone:
Overdue uses the danger tint background with danger text; Due in 48h the
warning tint; the other two `--surface-1` with `--text-muted`. Tiles are
clickable and act as filters on the list (like the existing rank
counts); an active tile gets a 1px border in its tone colour. Each tile
clears any lane bucket selection when clicked.

| Tile | Definition | Tone (docs/10) |
|---|---|---|
| Overdue | open, effective due < today | danger |
| Due in 48h | open, 0 ≤ days to effective due ≤ 2 | warning |
| No due date | open, effective due NULL | muted |
| Drafts to review | rows in `drafts` whose communication's parent is open and `reviewed_at IS NULL` | normal |

`drafts.reviewed_at` does not exist yet — migration in task 14.3. The
existing rank counts (ranks 1–5 in `attention.ts`) are replaced in the UI
by this strip plus the lanes; keep `rankRows` because it still drives
sort order and the work-item detail's "why is this here" text.
Limitation-within-30-days (rank 2) is not a tile; it stays visible as the
existing warning text on the row and in the detail screen.

### 1.3 Filter bar

Keep client, assessment year, module, status exactly as they are. Add:

- **Owner** select: "Anyone" / "Mine" / one entry per known owner name.
  Owner names come from `work_item_meta.assignee` distinct values plus
  the current user's display name (`settings.last_user_id` resolved
  through whatever the Devices screen uses for the local user). "Mine"
  matches the current user's name.
- **Search** input: case-insensitive substring over `client_name`,
  `client_code`, `pan_masked`, `title`, `reference`, `section`. Client-side
  over the loaded rows. Debounce 150 ms.

Filters persist per screen across app restarts (task 14.5). Follow the
`lib/theme.ts` pattern: one `localStorage` key per screen,
`lcc.filters.attention`, JSON, read on mount, written on change, wrapped
in try/catch. Never persist the search text — only the selects, the
active tile, and the active buckets.

### 1.4 Active chips

Under the filter bar, one chip per active filter that is not the default,
in this order: client, AY, module, status, owner, tile, issued bucket,
due bucket. Each chip has a × that clears only that filter. "Clear all"
resets everything including the search box. Chips use the `pill` class
with the accent tint. When nothing is active the row is not rendered.

### 1.5 Lanes

Two cards side by side in a `3fr 5fr` grid, 12px gap. Each card:
`--surface-1`, 1px `--border`, 12px radius, padding 12px 14px, a 12px
muted lane label ("Issued" / "Due") with an icon (calendar / clock), then
the tiles in a grid with 6px gaps — 3 columns for Issued, 5 for Due. On
viewports under 900px the cards stack. This is the layout of the mockup
`lcc_recommended_command_center_dashboard`; build that.

A bucket tile: `--surface-1`, radius `--radius`, padding 8px 10px, 1px
transparent border, label 11px muted on its own line, number 18px/500 on
the next line, left-aligned. Active: border `--accent`, background the
accent tint, label and number in `--accent`. Next 7 d, when its count is
above zero and it is not active, uses the warning tint like the strip. Clicking a bucket toggles it. At most one Issued
bucket and one Due bucket may be active; clicking a second in the same
lane replaces the first. An active bucket gets the accent border and
accent-tinted background. Clicking a bucket clears the strip tile.

Bucket counts are computed **after** the filter bar (client, AY, module,
status, owner, search) and **before** the tile/bucket selection, so a
CA who picks a client sees that client's numbers, and the numbers do not
shrink to zero when one bucket is selected.

**Issued lane** (over issued date, open items only):

| Bucket | Days ago (`d = daysBetween(issued, today)`) |
|---|---|
| Last 7 d | 0 ≤ d ≤ 7 |
| 8–15 d | 8 ≤ d ≤ 15 |
| 16–30 d | 16 ≤ d ≤ 30 |

Items issued more than 30 days ago, or with NULL issued date, are in no
Issued bucket. They are still in the list when no Issued bucket is
selected.

**Due lane** (over effective due, open items only):

| Bucket | Days ahead (`d = daysBetween(today, due)`) | Tone |
|---|---|---|
| Next 7 d | 0 ≤ d ≤ 7 | warning if count > 0 |
| 8–15 d | 8 ≤ d ≤ 15 | normal |
| 16–30 d | 16 ≤ d ≤ 30 | normal |
| Later | d > 30 | normal |
| Calendar → | not a bucket; a tile-shaped link that navigates to the Calendar screen | label muted, "Open" in accent |

The fifth Due tile is the Calendar link: same tile chrome as the others,
label row `[calendar icon] Calendar`, and where the number would be, the
word "Open" in 12px accent. It never shows a count and never becomes
active. Overdue (d < 0) and NULL due are not Due-lane buckets; they are
strip tiles so they are never hidden inside a lane.

Buckets are **exclusive** (a notice is in exactly one Due bucket and at
most one Issued bucket). This is Q30 in `QUESTIONS.md`; if the answer is
"cumulative", the change is confined to the predicate table in
`lib/buckets.ts` and the labels ("Last 15 d" instead of "8–15 d").

Selecting a bucket **filters the list in place** on this screen; it does
not navigate to `module-items`. This is Q31. If the answer is "jump", the
change is one `navigate()` call in the bucket click handler plus reading
the bucket from the route in `module-items.tsx`.

### 1.6 Views row

Directly above the table, inside the list card, a row of text tabs:
"All", then one tab per saved view, then "+ Save view" in muted text.
Tabs are 12px; the active one is `--text` with a 2px accent underline,
the rest `--text-muted`. This is the row in the mockup
`lcc_recommended_command_center_dashboard` reading
"All · Rao – scrutiny · Mine – this week · + Save view".

A saved view is a named copy of the current filter object (selects,
owner, tile, buckets — never the search text). "+ Save view" opens a
small dialog asking for a name; the view is stored in
`localStorage` key `lcc.views.attention` as an array of
`{ id, name, filters }`, per device, following `lib/theme.ts`. Clicking a
tab replaces the current filters with the view's. Right-click or a `…`
on hover offers Rename and Delete. "All" clears every filter. Maximum
12 views; the row scrolls horizontally beyond the card width.

### 1.7 List

The existing table, with these additions:

- **Card.** The table sits inside a card with the same chrome as the
  lanes (`--surface-1`, hairline, 12px radius). Its first line, 12px
  muted, reads the count and the active filter summary on the left
  ("6 notices · Open · Due next 7 days") and the sort on the right
  ("Sort: due date ↑").
- **Columns**, in this order, matching the mockup: Client · PAN (client
  name, then `code · pan_masked` in mono under it), Section, Issued, Due,
  Owner, Stage (the status pill; replaced by the hover actions on hover).
  Grid proportions `1.5fr 0.7fr 0.7fr 0.9fr 0.6fr 1fr`. Column header
  row 11px muted.
- **Section pill.** The `section` column (falling back to `section_2025`,
  then `section_1961`, then `type_label`) renders as a `pill` with a tone
  from `lib/section-tone.ts` (new): danger for 148, 148A, 263, 271 family,
  147; warning for 139(9), 142(1), 143(2), 144; normal for 143(1), 245,
  154 and anything unlisted. The map is data, one object, easy to edit.
- **Owner column.** Initials avatar (two letters, accent tint, 22px)
  from `work_item_meta.assignee`; an em dash when unassigned. Clicking
  the avatar opens an inline select of known owners plus "Unassigned";
  saving writes through `set_work_item_meta`.
- **Note icon.** A small `note` icon after the client name when
  `work_item_meta.note` is non-empty; hovering shows the first 120
  characters in a title tooltip.
- **Hover actions.** On row hover (and on keyboard focus), the last cell
  shows `View`, `Draft`, `✦ Date`, `Assign`. `View` and `Draft` do what
  the detail screen's buttons do; `✦ Date` opens the existing Ask-Claude
  date flow; `Assign` opens the owner select. Off hover the cell shows the
  status pill as today. Labels stay these four words.
- **Due cell** shows the effective date and a relative suffix
  ("· 2 d", "· overdue 3 d") using `describeDue`; both dates are shown in
  the detail screen only, as today.

Default sort is unchanged (rank, then sort key). When a bucket is active,
sort inside it by effective due ascending (Due lane) or issued date
descending (Issued lane).

---

## 2. Data additions

### 2.1 `issued_on` on work-item rows

`list_work_items` (Rust, `commands/work_items.rs`) gains `issued_on`: for
`proceedings`, the MAX `issued_on` over that proceeding's inbound
communications; for other modules the row's own date if it has one
(demand raised date, return filed date, form filed date), else NULL.
Add `issued_on: string | null` to `WorkItemRow` in `lib/types.ts`. Export
column mapping in `11-exports.md` is not affected.

### 2.2 `work_item_meta` table

Module-agnostic per-item metadata authored by a person, never by the
scraper. One row per (module, item_id).

```sql
CREATE TABLE work_item_meta (
    module      TEXT NOT NULL CHECK (module IN ('proceedings','demands','returns','forms')),
    item_id     TEXT NOT NULL,
    assignee    TEXT,                 -- display name, free text, no user table
    note        TEXT,
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_by  TEXT,                 -- device id or user id, masked in logs
    PRIMARY KEY (module, item_id)
);
```

Writes go through the ledger exactly like `manual_due_date` does today
(user-authored edits from any device are allowed; see
`03-sync-and-ledger.md`). Entity type `work_item_meta`, entity id
`module:item_id`. Commands: `get_work_item_meta(module, id)`,
`set_work_item_meta(module, id, assignee?, note?)`. `list_work_items`
LEFT JOINs the table and returns `assignee` and `has_note` on the row.

There are no roles: every user can assign anyone, including themselves.
An assignee name is free text chosen from a datalist of names already
used plus the local user's name.

### 2.3 `drafts.reviewed_at`

Nullable TEXT. Set by a "Mark reviewed" button in the draft drawer;
cleared if the draft is regenerated. Drives the "Drafts to review" tile.

### 2.4 `ui_scale` in settings

`Settings` struct in `commands/settings.rs` gains
`#[serde(default = "default_scale")] pub ui_scale: u8` with default 100.
Allowed values: 85, 92, 100, 112, 125. Anything else is clamped to the
nearest allowed value on read.

---

## 3. Settings — Text size

In the settings "General" section (`screens/settings/general.tsx`), add
one `Row`:

- label "Text size", hint "Scales the whole app. Ctrl + / Ctrl − / Ctrl 0
  to reset."
- control: `A−` button · five dots (active one accent) · `A+` button ·
  percentage readout. Reuse `Segmented` if it fits; otherwise a small
  stepper component in `ui/stepper.tsx`.
- Applying: on app start and on change, set
  `document.documentElement.style.fontSize = (ui_scale / 100) * 16 + "px"`.
  Every size in `styles/base.css` and `styles/tokens.css` that is in `px`
  and refers to text or spacing-that-scales-with-text must move to `rem`
  (task 14.4 audits this; borders, radii and icon strokes stay in px).
- Persist immediately through `write_settings`; no save bar for this row.
- Keyboard: `Ctrl`/`Cmd` `+`, `−`, `0` anywhere in the app, registered in
  the shell, ignored when focus is in a text input.

---

## 4. Updates screen (new, screen 8)

Route `updates`, nav label "Updates", placed after "Attention" in the
sidebar. Answers "what changed since I last looked?" — the Atom Pro
"Updates" behaviour.

### 4.1 Source of truth

The `ledger` table already records every upsert/delete with the full row
payload and `created_at`. The Updates screen diffs ledger entries against
the previous ingestion run, not against the previous app open:

- `since` = `run_at` of the latest **completed** run before the most
  recent one (i.e. the second-newest distinct `run_at`). If only one run
  exists, `since` = that run's `run_at` and the screen shows everything
  it produced.
- A **seen** watermark per device, `lcc.updates.seen_until` in
  `localStorage`, set by "Mark all seen". Entries older than the watermark
  are shown collapsed under "Seen earlier"; newer ones are shown open.

### 4.2 Classification

For each ledger entry with `created_at > since`, classify into one group
by comparing payload against the previous payload for the same entity
(previous ledger entry, or NULL if first sight):

| Group | Rule | Row content |
|---|---|---|
| New notices | entity `communications`, direction inbound, no previous entry | client, section pill, AY, due (or "No due date" warning), `View` `Draft` / `✦ Date` |
| Due date changed | entity `proceedings`, `due_date` differs from previous | client, section pill, `old → new` with old struck through, `View` |
| Response filed on portal | entity `responses`, no previous entry | client, section pill, filed date and reference, `Open` |
| Proceeding closed | entity `proceedings`, status moved to a settled value | client, section pill, closing date, `View` |
| Demand changed | entity `demands`, amount or status differs | client, AY, `old → new`, `View` |
| Sync failed | `ingestion_runs` rows with status `failed` or `credentials_parked` since `since` | client, reason from `notes` (masked), `Retry` or `Fix` (Fix opens client credentials) |

Anything that does not match a rule is dropped from the screen, not shown
as "other". Groups with zero entries are not rendered. Group order is the
table order above, except Sync failed is always last and gets the danger
border.

### 4.3 Layout

One card per group, group header with icon, name, and a count pill.
Rows are hairline-separated, same grid as the Attention list but four
columns. The head line reads "Compared with sync on <date time>" and a
"Mark all seen" link. No filters on this screen in this build.

---

## 5. Calendar screen (new, screen 9)

Route `calendar`, nav label "Calendar", after "Updates".

- Month grid, Monday-first, IST. Header: month name, `‹` `Today` `›`.
- Each day cell shows the date and, when non-zero, a count pill of open
  items whose effective due is that day. Tone: danger if the day is
  before today and any item is still open, warning if the day is today
  or tomorrow, normal otherwise.
- Clicking a day selects it; a list under the grid shows that day's
  items (client, section pill, owner, status) with `View` on hover.
  Selecting today by default.
- A second toggle above the grid, `Due` / `Issued`, switches the date
  field the counts use. Default `Due`.
- The client and module filters from the Attention screen apply here
  too, read from the same persisted filter object so the two screens
  agree. Show them as chips only; no filter bar on this screen.
- Items with NULL effective due never appear on the calendar. Their count
  is shown once, top right, as "n without a due date →" linking to the
  Attention screen with the No-date bucket active.
- No events table, no reminders, no email in this build. The calendar is
  a projection of `list_work_items`, not stored data.

---

## 6. Work item detail — thread and notes

In `screens/work-item.tsx`:

- **Timeline.** Communications and responses for the proceeding render
  as one vertical thread, newest at top: a dot (danger for an open
  inbound notice, success for a response, `--border-strong` for a settled
  inbound), title ("Notice u/s 148 issued", "Response filed"), the date
  line ("22 Sep · due 26 Sep" / "14 Aug · ack 77120391"), and the
  document actions that exist today for that row. Keep the existing
  document list component for each entry; only the wrapper changes.
- **Owner.** A row in the detail header: avatar + name + "Change" opening
  the same owner select as the list.
- **Notes.** A "Notes" section with one textarea, saved on blur through
  `set_work_item_meta`, with "Saved" toast. Plain text, no formatting.
- **Mark reviewed** button in the draft drawer (`ui/draft-drawer.tsx`)
  when a draft exists; sets `reviewed_at`.

---

## 7. Client detail — Client 360

In `screens/client-detail.tsx`, restructure into:

- **Header:** 38px initials avatar (accent tint), name 15px/500, and
  under it a 12px muted line `PAN · GSTIN · phone` shown exactly as the
  existing client detail shows them today (do not add masking the
  current screen does not have; do not remove masking it has);
  right side: a "Sync" toggle bound to whatever per-client sync enable
  flag exists (if none exists, add `clients.sync_enabled INTEGER NOT NULL
  DEFAULT 1` and have the ingestion queue skip disabled clients) and a
  `Sync now` button that enqueues this client only.
- **Summary tiles:** Open notices · Overdue (danger) · Demands total (₹,
  from the demands module) · Returns filed "n / m" (filed count over
  year contexts) · Last synced (time).
- **Tabs:** Profile · Returns · Forms · Demands · e-Proceedings · Notes.
  Each tab is the existing per-module list for this client
  (`module-items` filtered to the client) rendered inline; Profile is the
  existing client form in read mode with an Edit button; Notes is a
  client-level free-text note (add `clients.note TEXT`).
- Default tab: e-Proceedings.

Outstanding-demand interest, "Know your CA", legal-heir notices are out of
scope for this build. Do not start them.

---

## 8. Export polish

In `src-tauri/src/export.rs` (`rust_xlsxwriter`):

- Filename: `LCC-<sheet>-<YYYY-MM-DD>-<HHMM>.xlsx` in IST.
- Header row: bold, `--surface-2`-equivalent fill, frozen (`set_freeze_panes(1,0)`), autofilter on.
- Column widths set from the longest cell in the column, capped at 60.
- Add `Owner` and `Note` columns at the end of the work-items sheet. The
  existing 16 columns keep their positions (Q01).
- Every list screen that has an Export button (Attention, module-items,
  Updates, Calendar day list) exports what is currently filtered and
  visible, with the active filters written into the provenance block.

---

## 9. Out of scope for this build

Do not implement, even if it looks easy: saved views, bulk select,
response stage pipeline, notice→task with reminder, per-client health
tiles, desktop notifications, email/WhatsApp, density toggle, default
landing bucket, credential bulk import, PDF password unlock, outstanding
demand interest, Know your CA, legal heir, Chrome extension. If a task
seems to need one of these, file a question and work around it.

---

## 10. Reference mockups

These are the agreed pictures. Every screen below must match its mockup
in structure, order and labels; colours come from `10-design-system.md`
tokens, not from the mockup's palette.

| Mockup id | Screen | What it fixes |
|---|---|---|
| `lcc_recommended_command_center_dashboard` | Attention | sync line → strip → filter bar → lanes (3fr/5fr) → views row → list card with the six columns and hover actions |
| `lcc_dashboard_filters_plus_buckets` | Attention | chips row under the filter bar; count line in the list card |
| `lcc_bucket_timeline_logic` | — | the exclusive windows either side of today |
| `lcc_settings_text_size_stepper` | Settings | A− · five dots · A+ · % · live preview line |
| `lcc_updates_since_last_sync_view` | Updates | group cards, count pills, `old → new` with strike-through, danger-bordered Sync failed with reason and Retry/Fix |
| `lcc_deadline_calendar_month_view` | Calendar | month header with ‹ Today ›, count pills bottom-right of each day, selected day tinted, day list under the grid |
| `lcc_client_360_tabbed_view` | Client detail | avatar header with sync toggle and Sync now, five tiles, six tabs, thread with dots |

The Settings row also shows a one-line live preview under the control
("AABCV••••K · Notice u/s 143(1) · Due 30 Sep · Reply pending") that
rescales as the stepper moves; build that too.

## 11. Copy

Sentence case. Labels stay short: View, Draft, ✦ Date, Assign, Open,
Retry, Fix, Export, Sync now, Mark all seen, Mark reviewed, Clear all.
Bucket labels exactly: "Last 7 d", "8–15 d", "16–30 d", "Next 7 d",
"Later", "No date". Strip labels exactly: "Overdue", "Due in 48h",
"No due date", "Drafts to review".
