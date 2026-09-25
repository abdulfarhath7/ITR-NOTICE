# 11 — Exports

## Excel workbook

One workbook, one sheet per module. The proceedings sheet is fixed by the
firm's existing format and must match exactly, in this order.

### Sheet 1 — Proceedings (16 columns, then 17–20)

| # | Column | Source |
|---|---|---|
| 1 | S.No | generated at export |
| 2 | Client ID | `clients.client_code` (user-entered, Q02) |
| 3 | Client Name | `clients.name` |
| 4 | PAN | `clients.pan`, unmasked in the export |
| 5 | Self/Other | derived from `proceedings.source_panel` |
| 6 | AY | `year_contexts.assessment_year` |
| 7 | Type | proceeding type label from the registry |
| 8 | Assessee Name | name on the proceeding; differs from client name for AR cases |
| 9 | Section | `section_2025`, with `section_1961` in brackets |
| 10 | Proceeding Name | `proceedings` display name |
| 11 | DIN | `din_reference` |
| 12 | Issued On | earliest `communications.issued_on`; blank and gap-flagged with none (Q22) |
| 13 | Response Due Date | `due_date` |
| 14 | Manual Due Date | `manual_due_date` (user-entered) |
| 15 | Response Submitted On | `responses.filed_on`, latest |
| 16 | Client File # | `clients.client_file_no` (user-entered) |

Build 4 (docs/18 §4.4) adds after the 16:

| # | Column | Source |
|---|---|---|
| 17 | Viewed by AO | latest inbound `communications.ao_viewed_on` on the proceeding: `Yes (dd-mm-yyyy)`; `No` when the latest notice has a filed reply and no date; blank when the proceeding is not an assessment proceeding (`type_registry.is_assessment`, Q50) or no reply is filed (D-064). One text column (Q51) |
| 18 | Limitation Date | `proceedings.limitation_date` as a real Excel date, blank when null or not an assessment proceeding |

Build 2's **19 Owner** (`work_item_meta.assignee`) and **20 Note**
(`work_item_meta.note`) come last. The 16 keep their positions.

The columns are one declarative table in `src-tauri/src/export.rs`
(`PROCEEDING_SHEET`: header, cell function). The export dialog's column
picker chooses from it; every column but Note is ticked by default and the
choice is remembered per device (Q54).

`Created Mode` was dropped from the sheet (Q01); `proceedings.created_mode` stays in the database as provenance.

Columns 2, 14 and 16 never come from the portal. They are firm knowledge,
written on any device, and they sync upward like drafts do.

### Other sheets

- **Demands** — client, AY, demand reference, raised on, demand amount,
  current outstanding, section, stance, disputed amount, filed on, challan CIN,
  paid on, amount, status.
- **Returns** — client, AY, acknowledgement number, return type, filing type,
  filed on, verification status, processing status, supersedes.
- **Forms** — client, AY, form type, acknowledgement number, filed on,
  filing type, status, filed by.

## Rules

**Blank means blank.** A gap-flagged field exports as an empty cell, never as
a guess, never as a placeholder date, never as "N/A".

**Every status is exported.** Closed and submitted rows appear. The export is
a record, not a worklist. Only the Attention view filters by status.

**Dates as real dates.** Write Excel date values, not strings, formatted
`dd-mmm-yyyy`. A CA will sort and filter on them.

**Numbers as numbers.** Amounts are numeric with two decimals and no currency
symbol inside the cell.

**Identifiers as text.** PAN, DIN and acknowledgement numbers are text cells
so Excel does not mangle leading zeros or apply scientific notation.

## Header block

Rows 1 to 4 of every sheet (docs/18 §4.2), row 5 blank, the column headers
on row 6:

```
Row 1  Litigation Command Center — <sheet title>
Row 2  Filter: <filter line>
Row 3  Client: <client scope> · Module: <module> · Status: <status>
Row 4  Exported: <dd Mon yyyy HH:mm IST> · Rows: <n> · Last sweep: <dd Mon yyyy HH:mm>[ · Unverified: <n>]
```

Filter line grammar: a window chip reads `Issued in last 15 days (11 Sep
2026 – 25 Sep 2026)` or `Due in next 30 days (…)`; no window chip reads
`All open items`; every other chip is appended with ` · ` (`… · Not viewed
by AO · Type: 143(2), 148`). The `All` scope reads `All proceedings, every
status`; the `Client` scope `Client <name>, every status`. The screen builds
the line from its chips and passes it as the view's `label`; the Rust side
writes it unchanged. Row 3's client and status are read from the rows the
sheet holds. `Unverified` appears only when the count is above zero.

The column header row (row 6) is bold on a light fill, frozen, with an
autofilter; column widths follow the longest cell, capped at 60. The
suggested filename is `LCC_<slug>_<yyyy-mm-dd>.xlsx` with slug
`issued-15d`, `due-30d`, `all`, `client-<client_code or pan>`, or `view`
when the filter has no window chip (docs/18 §4.3); the save dialog still
asks. Every list with an Export button (Attention, a Client 360 module tab,
Updates, the Calendar day) exports exactly what it shows: the whole result
set, not the page on screen. The Updates export has one sheet per group
instead of the module sheets.

The export dialog shows the header lines and the first three rows as the
sheet will carry them, from the `preview_export_sheet` command, so the
preview and the workbook can never disagree.

A stale export must be self-evident on its face (Q15). Someone will email this
workbook to a partner; it has to carry its own provenance.

## Scope selector

Current filtered view · all clients · one client. Default is the current view,
with the row count shown on the control before the user commits.

## Implementation notes

Generate the workbook in the Rust core, not the frontend — the frontend may
hold only a page of rows. Stream rows rather than materialising everything for
a 1,800-row export. Freeze the header row, auto-fit column widths, and set the
print area to landscape and fit-to-width.
