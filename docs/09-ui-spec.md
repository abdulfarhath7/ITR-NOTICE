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
| 7 | Settings | Cadence, data folder, firm, about. |
| 8 | First-run wizard | Firm setup, admin, recovery code, collector. |

## 1 — Attention

The default landing screen. One ranked list across all four modules.

Ranking, in order:
1. Overdue, soonest first
2. Limitation date within 30 days
3. Due within 7 days
4. Open with no stated due date (gap) — these are the dangerous ones
5. Everything else open

Each row: client, module chip, what it is, AY, due, status pill, actions.

Filters: client (multi-select), AY, module, status, due window.

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
