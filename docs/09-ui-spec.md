# 09 — UI specification

Read `10-design-system.md` alongside this.

## Screens

| # | Screen | Purpose |
|---|---|---|
| 1 | Attention | Landing. Everything needing action, across all modules. |
| 2 | Clients | The client book. |
| 3 | Client detail | One client, years down the side, modules across. |
| 4 | Work item detail | One proceeding, demand, return or form with its documents. |
| 5 | Sweep | The nightly run and deep fetch of one client, the queue in tonight's order, operator challenges, pause and resume (Build 4; was Ingestion monitor, then Sync). |
| 6 | Devices | Roster, collector nomination, sync state. |
| 7 | Settings | Sectioned like a desktop app: General, Sweeps, Drafting, Notifications, Data, Firm and sync, About. |
| 8 | First-run wizard | Firm setup, admin, recovery code, collector. |

## 1 — Attention

The default landing screen. One ranked list across all four modules.

Ranking, in order:
1. Overdue, soonest first
2. Limitation date within 30 days
3. Due within 7 days
4. Open with no stated due date (gap) — these are the dangerous ones
5. Everything else open

Layout, top to bottom (Build 2, full detail in `16-dashboard-v2.md` §1):

- **Sync line** — "Synced 6:12 am · 200 clients · 3 failed · Retry"; Retry
  opens Ingestion with failed runs only. "Never synced" before any run.
- **Needs-action strip** — Overdue · Due in 48h · No due date · Drafts to
  review. Each tile filters the list and clears any lane bucket.
- **Filter bar** — client, AY, module, status, owner (Anyone / Mine / a
  name), search (client, code, PAN, title, reference, section; 150 ms
  debounce). Selects, owner, tile and buckets persist per device
  (`lcc.filters.attention`); search never does.
- **Active chips** — one per non-default filter with ×, then Clear all.
- **Lanes** — Issued (Last 7 d · 8–15 d · 16–30 d) and Due (Next 7 d ·
  8–15 d · 16–30 d · Later · Calendar → Open) in a 3fr/5fr grid, stacked
  under 900px. Windows are exclusive (Q30); counts are taken after the
  filter bar and before the tile/bucket selection. One bucket per lane;
  a bucket filters the list in place (Q31).
- **List card** — count and filter summary with the sort on the right;
  views row (All · saved views · + Save view, per device, Q34); columns
  Client · PAN, Section (tone pill), Issued, Due (date and "· 2 d" /
  "· overdue 3 d"), Owner (initials, click to assign), Stage (status pill,
  replaced on hover or focus by View · Draft · ✦ Date · Assign).

The ranking still orders the list; in the default order rows are grouped
under a header per rank. Inside a Due bucket rows sort by due date
ascending, inside an Issued bucket by issued date descending. The old
row of five rank counts is gone from the UI (Q32); rank 2 shows as the
"limitation …" line under the due date. Arrow keys move, Enter opens.

## 2 — Clients

Table: name, client code, PAN (masked), source chip (`portal` / `ERI`), open
count, last sync, status pill. Toolbar: Add, Import, Export, Sync.
Build 3 adds a **History** pill (`recent` / `partial` / `full`) and a
`weekly` pill for dormant clients. The add form also takes an optional
**Portal password** for portal clients. It is written to the OS keychain,
keyed by the login that reaches the client, right after the client is
created, and never enters the client record. The add form has one checkbox, off by
default: "Also fetch full history tonight". It queues an all-years,
index-only deep fetch.

**Client actions.** Each row on the Clients list and the Client 360 header
share one ⋯ menu:
- Edit details
- Sync now
- Fetch history
- Pause sync / Resume sync
- Keep syncing nightly
- Delete client

Delete opens a dialog that counts what goes (years, work items, notices,
documents) and says the delete reaches every device through sync. It
cannot be undone. You confirm by typing the client's name. The stored
portal password goes too, unless another client signs in with the same
login.

## 3 — Client detail

Client 360 (Build 2, `16-dashboard-v2.md` §7). Header: initials avatar,
name, `PAN · GSTIN · phone` as stored, a **Sync** switch (off keeps the client
out of whole-book and scheduled sweeps) and **Sync now**. Five tiles: Open
notices · Overdue · Demands total (₹) · Returns filed (years with a filed
return / years) · Last synced. Tabs: Profile · Returns · Forms · Demands ·
e-Proceedings (default) · Notes. A module tab shows that module's list with
the years down the left ("All years" first). Profile is the read view with
Edit and the portal-credentials card; Notes is one synced free-text note.
Export offers the rows on the current tab, or the whole client.

Build 3 (`17-scrape-scopes.md` §6.2):
- Under the identifiers: `History: recent only · Fetch history`,
  `History: full · fetched 12 Sep`, or `History: last 2 AYs, index only ·
  Fetch more`. The link opens the **deep fetch dialog**: how far back, which
  documents, which modules, an estimate, then Cancel · Run now · Queue for
  tonight.
- Turning Sync off asks for an optional reason, shown as `Paused · <reason>`.
- The Last synced tile shows the tier (`6:12 am · nightly`).
- The header overflow menu pins the client to nightly.

## 4 — Work item detail

Left: metadata including both statute references, rendered as
`Sec 268 (old 148)`. Right: documents list. Below: the communication and
response thread (the two-lane flow, Q40), then **Notes** — one textarea,
saved on blur. The page head shows the **owner** (avatar, name, Change).
The draft drawer has **Mark reviewed**; a regenerated draft is unreviewed
again. Owner and notes apply to all four modules.

Any field in `gap_flags` renders as `not stated` in muted type with a small
"unverified" marker. Never an empty cell.

When any document is still `pending` (indexed by a sweep, not fetched), a
banner under the header reads `Documents not fetched yet · Fetch`. Fetch
starts an item fetch with an inline progress line. If "Fetch documents when
I open an item" is on, the fetch starts on open. If a sweep holds the login,
the banner offers "Queue after sweep" instead.

**Pending documents in lists.** On Attention, module lists, Updates rows and
the Calendar day list, an item with any pending document shows a small
outline cloud-down icon after the section pill, with the tooltip "Documents
not fetched yet". There is no text badge.

## 8 — Updates

What changed since the previous sync, grouped: New notices · Due date
changed (`old → new`, old struck through) · Response filed on portal ·
Proceeding closed · Demand changed · Sync failed (always last, danger
border, reason masked, Retry or Fix). Group cards with count pills; empty
groups are not drawn. Head line "Compared with sync on <date time>" and
**Mark all seen**, which sets this device's watermark; older rows fold under
"Seen earlier". Export writes one sheet per group. The sidebar shows the
unread count. Detail in `16-dashboard-v2.md` §4.

Build 3: the first card is the **Last night** summary ("Last night: swept
187, skipped 12 unchanged, 3 failed"), and the badge counts it. A **History
fetched** group lists completed deep fetches: "History fetched · <client> ·
1,204 items".

## 9 — Calendar

Build 5 (`19-statutory-calendar.md`): the statutory calendar, two layers on
one grid. **Statutory** is the Income Tax Department's public tax calendar
(fetched without a login) plus the firm's own dates; **Notices** is Build 2's
layer — open items on their effective due (or issued) day, count pills per
day (danger past, warning today/tomorrow), client and module from the
Attention filters shown as chips.

**Minimized card** (the screen): head with the FY badge, scope All ·
Applies to us · Overdue, and Full screen; month line with clamped ‹ Today ›;
a six-row Monday-first grid (`role="grid"`, arrows/Home/End/Enter/Space,
`t`, `[` `]`, `F`) with up to three category dots and the Notices pill per
cell; the legend with this month's counts (click mutes, Shift-click solos,
Show all), then the Notices row with its Due/Issued toggle; the agenda for
the selected day or the month (today first), with status labels
(Overdue · Today · Tomorrow · n days · Upcoming), extensions as
`~old~ Extended to <date> · Circular n`, "applies to n clients" under
Applies to us, and Open on the Notices row (Attention's Due window within
30 days, else the day list). A grid click flash-scrolls the agenda group.
Empty states: "Nothing falls due in <month> for these filters · Show all",
"Calendar not fetched yet · Refresh", and the slim "Portal calendar
unavailable since <date>" warning.

**Full screen** (`ui/calendar-overlay.tsx`): a fixed overlay over the
content column; the sidebar collapses to icons and restores on close;
body scroll locked; Escape returns focus to the button. Top bar: view
Month · Year · Agenda (`1` `2` `3`), scope, category chips, ‹ month ›,
Today, `.ics`, Print month, Exit full screen (Esc). Month: trimmed weeks,
three pill slots and "+n more", a "n notices due" line, the selected day's
agenda in the right panel. Year: 4×3 mini-months with heat squares,
today outlined, hover tooltip, click to the month. Agenda: the FY grouped
by month and day, Today pinned, `j`/`k`. Mode, view, mutes, scope and the
Notices date persist per device (`lcc.calendar.prefs.v1`).

**Sidebar** "Next deadlines": the next three statutory rows (Applies to
us when any profile is set, else All); collapsed, a calendar icon with a
badge of deadlines in the next 7 days. **Attention strip** gains the fifth
tile "Next statutory".

**Settings → Calendar**: Portal calendar (last fetch, Refresh now),
Refresh (Weekly / Nightly), First day of week, Default scope, Sidebar
"Next deadlines", Firm dates (Manage: add, edit, delete), Export `.ics for
FY`. The client Profile tab gains a Calendar profile card: Entity type,
Books audited, Transfer pricing, TDS deductor.

## 5 — Sweep (was Ingestion monitor, then Sync)

Build 3, `17-scrape-scopes.md` §6.1, reworked by Build 4 (`18-build-4.md`
§7). The route stays `#/ingestion`; the nav label is **Sweep**.

Two cards under the run card:
- **Nightly sweep** (left): pill `This device · runs 01:00` or `Not this
  device`; Scope, Time budget, Last run; five stat rows (Clients checked,
  Skipped, New items indexed, AO-viewed flips, Failed → Clients filtered to
  failures); `Run now` and `Export run log` (one sheet, `Sweep runs`, one
  row per client for the run).
- **Deep fetch one client** (right): client picker; Scope **Everything /
  Last N AYs / Since date** (a stepper or a date field appears on
  selection); Fetch **Index only / Index + download PDFs**; the estimate
  line `AY <first> → <last> · ~n items · ~m min` once a listing probe has
  run, else `Estimate after probe`; `Start fetch`. Everything is the full
  history from the first AY the portal lists; it runs in the foreground
  with no time budget (Q57), and Stop cancels it.

- **Head:** `Sweep all now · ≈ 42 min` and `Pause`.
- **Run card:** "Tonight's run · started 01:00 · window ends 06:00" and
  "128 / 200 · 02:47 elapsed · 1:10 left", a progress bar, and a legend:
  Swept · Skipped unchanged · Failed · Deep queued. With no run active it
  shows the last summary and the next run.
- **Live session:** the current client, panel and counts, plus the captcha /
  OTP challenge card. The run does not fail while waiting.
- **Queue table** in tonight's frozen order, with columns Client · Scope ·
  Status · Changes · Last sweep · Next.
  - Scope pills: `Sweep`, `Deep · full`, `Deep · 2 AYs`,
    `Deep · since 1 Apr`, `Item`.
  - Status strings: `Running · 0:38`, `Done · 0:41`, `Skipped · unchanged`,
    `Failed · <reason>`, `Queued · after sweep`, `Dormant`,
    `Paused · <reason>`, `Awaiting you · OTP`.
  - Next: `Nightly`, `Weekly · Sun`, `Tonight`, `Fix credentials`.
- **Rows:** hover shows `Sync now` and, on failed rows, `Retry`. A row opens
  its client.
- **Filters:** All · Running · Failed · Queued · Dormant, persisted.
- **Sweep selected:** a checkbox per row, and a header box that selects every
  row shown. With any selected, the toolbar shows "n clients selected ·
  Clear · Sweep selected · ≈ n min". It sweeps those clients now, every
  module, in tonight's order. Paused or dormant clients picked by hand are
  swept too.

## 6 — Devices

Roster with radio control for the collector (admin only; read-only for
members). Per device: name, RAM, role chip, online state, cursor position,
how far behind.

## 7 — Settings

One section per concern, listed down the left, each built from the same
row vocabulary (label and hint left, control right) with a save bar that
appears only while something has changed. Sections: General (theme: dark,
light or system; the keyboard), Sweeps (cadence per module, the unattended
schedule, the worker count), Drafting (proxy URL and firm token),
Notifications (desktop moments, the collector-silent email), Data (folder,
archive size, bundle export and import), Firm and sync (firm, this device's
id and signing key, leave), About (version, the two guarantees). Adding a
setting is one row; adding a concern is one section file.

Sweeps, Build 3 (`17` §6.5), adds these rows:
- Run window (start / end)
- Look back for new items
- Re-check open items every night (read-only)
- Dormant after (days, or Never)
- Dormant cadence
- Per-client timeout
- Documents during sweep (Index only / Download within window)
- Warm cache after sweep (Off / 3 / 7 / 15 days)
- Fetch documents when I open an item
- Retry failed clients (read-only: "Next night, every night until fixed")

## Shell

A command palette on Ctrl+K / ⌘K reaches every screen, every client (by
name, code or masked PAN) and the two actions (sweep, sync). The Attention
entry in the navigation carries the overdue count in danger tone, or the
open count when nothing is overdue.

## Critical UI rules

### Due dates
Never render a raw signed number. Use:

| condition | text |
|---|---|
| past, still open | `Overdue by 3 days` (danger) |
| today | `Due today` (danger) |
| within 7 days | `Due in 5 days` (warning) |
| beyond 7 days | `Due 22 Sep` (normal) |
| closed or submitted | `Closed · was due 2 Aug` (muted) |
| NULL | `Not stated` (muted, unverified marker) |

When a manual due date exists it is the date rendered, marked `manual`, with
the portal's own date shown beside it (Q14).

Status wins over date. A closed item never shows as overdue.

### Sync state — two independent facts
Never collapse these into one indicator:

1. **Cursor freshness** — "1,210 changes behind", broken down by origin device.
2. **Collector health** — "Collector last reported 1:45 AM today".

A device can be fully up to date while the collector has been dead for four
days. Showing a single green tick in that situation is the worst bug this UI
could have. Show a warning whenever the collector has missed a scheduled run.

### Action buttons
Driven by the action matrix in `02-data-model.md`, implemented in exactly one
place. View and Save are available for every status. Only Draft is withheld.

### Suggested values
An AI-suggested due date renders visibly differently from a portal-supplied
one — muted, italic, with a "suggested" chip and a Promote action. It is never
styled to look confirmed.

## Copy rules

- Sentence case everywhere. Never Title Case.
- Short button labels: View, Save, Draft, Export, Sync, Add.
- Plain-language status pills, not coloured dots alone.
- Errors say what happened and what to do. No exception strings in the UI.
- Never the word "successfully".

## Empty and error states

Every list has a designed empty state. Every failure has a specific message.
"Something went wrong" is not acceptable anywhere in this app.

Sync screen (Build 3):
- **No clients:** "No clients to sync yet", with Add client.
- **No run yet:** the run card says "No run yet" and when the next run is.
- **All paused:** "Every client is paused". Paused clients are skipped.
- **Window closed mid-run:** "Stopped · window closed. The rest continues
  tonight at 01:00."
