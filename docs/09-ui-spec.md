# 09 — UI specification

Read `10-design-system.md` alongside this.

## Screens

| # | Screen | Purpose |
|---|---|---|
| 1 | Attention | Landing. Everything needing action, across all modules. |
| 2 | Clients | The client book. |
| 3 | Client detail | One client, years down the side, modules across. |
| 4 | Work item detail | One proceeding, demand, return or form with its documents. |
| 5 | Ingestion monitor | Live run state, operator challenges, pause and resume. |
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

## 3 — Client detail

Years listed down the left. Selecting a year shows four module panes side by
side for that year. This is the view a partner uses in a meeting.

## 4 — Work item detail

Left: metadata including both statute references, rendered as
`Sec 268 (old 148)`. Right: documents list. Below: the communication and
response thread in date order.

Any field in `gap_flags` renders as `not stated` in muted type with a small
"unverified" marker. Never an empty cell.

## 5 — Ingestion monitor

Current client, queue position, panel being swept, counts so far. When the run
needs a human it shows a prominent challenge card for captcha or OTP. The run
does not fail while waiting.

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
