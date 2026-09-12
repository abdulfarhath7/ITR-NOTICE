# 11 — Exports

## Excel workbook

One workbook, one sheet per module. The proceedings sheet is fixed by the
firm's existing format and must match exactly, in this order.

### Sheet 1 — Proceedings (the 17 columns)

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
| 12 | Issued On | `communications.issued_on` or `initiated_on` |
| 13 | Response Due Date | `due_date` |
| 14 | Manual Due Date | `manual_due_date` (user-entered) |
| 15 | Response Submitted On | `responses.filed_on`, latest |
| 16 | Created Mode | `created_mode` (Q01) |
| 17 | Client File # | `clients.client_file_no` (user-entered) |

Columns 2, 14 and 17 never come from the portal. They are firm knowledge,
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

Rows 1 to 3 of every sheet, above the column headers:

```
Draftax export · <scope> · generated <timestamp IST>
Data as of: collector last run <timestamp>, this device cursor <summary>
Unverified fields in this export: <count>
```

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
