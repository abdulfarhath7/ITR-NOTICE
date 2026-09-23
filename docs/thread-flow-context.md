# Thread flow redesign — context for Claude Code

Scope: the `Thread` component in `src/screens/work-item.tsx` and its styles in `src/styles/base.css` (`.thread`, `.msg`). Nothing else on the work-item screen changes. No backend, API, or type changes.

## 1. Goal

Replace the flat stack of bordered cards with a two-lane flowchart. A user must be able to tell, without reading any text, which notices are answered, which are open, which are overdue, and where an adjournment pushed a deadline.

Reference feel: Linear activity feed, GitHub PR timeline, git graph (Fork/GitKraken). Premium, dark-first, flat. No gradients, no glow, no drop shadows.

## 2. Visual grammar (the contract)

Every rule below is load-bearing. Do not add a status word where a shape or colour already says it.

| Signal | Encodes | Values |
|---|---|---|
| Lane | Who acted | Left lane = Department (all `communications`). Right lane = Firm (all `responses`, `adjournments`). Nothing outbound ever renders on the left. |
| Node shape | Event type | Circle = communication or response. Diamond = adjournment. Hollow dashed ring = a response slot that is still empty. |
| Node colour | State | success = answered/closed pair. warning = open, in time. danger = open, past due. muted/border-strong = closed with no response, or `unknown`. |
| Connector style | Answered or not | Solid = a response exists for this communication. Dashed = no response yet. Connector colour matches the pair's state colour. |
| Branch and merge | Adjournment | An adjournment leaves the spine as a curve into the right lane and merges back at the next communication issued on or after its `sought_date`. |
| Countdown ring | Time pressure on an empty slot | Arc around the hollow ring fills as today approaches `response_due_date`. Full and danger-coloured past due. |
| Ticks | AO read state on a response | One tick = filed. Two ticks (accent colour) = the paired communication has `ao_viewed_on` set. |
| Vertical distance | Time | Compressed. Gaps over 14 days between consecutive nodes render as a centred spine label "· N days ·". |

Colour tokens: use existing `--success`, `--warning`, `--danger`, `--accent`, `--border`, `--border-strong`, `--muted` from `src/styles/tokens.css`. Do not introduce new colours.

## 3. Layout

```
Department               spine               Firm
┌──────────────┐           │
│ Notice card  ├───────────●
└──────────────┘           │
                           ●──────────┐ ┌──────────────┐
                           │          └─┤ Response card│
                           │            └──────────────┘
                     · 41 days ·
┌──────────────┐           │
│ Notice card  ├───────────●
└──────────────┘           │ ╲  (branch)
                           │  ◆──────────┐ ┌──────────────┐
                           │ ╱           └─┤ Adjournment  │
                           ●  (merge)      └──────────────┘
┌──────────────┐           │
│ Notice card  ├───────────●
└──────────────┘           ┆ (dashed)
                           ◌──────────┐ ┌ ─ ─ ─ ─ ─ ─ ─ ┐
                       (countdown)    └─  Empty slot     
                                        └ ─ ─ ─ ─ ─ ─ ─ ┘
```

- CSS grid, three columns: `1fr 56px 1fr`. Middle column is the spine column.
- Spine is a single vertical line drawn once (absolute-positioned element in the middle column), not per row.
- Connectors and nodes are inline SVG per row, sized to the row height via `ResizeObserver` or by rendering the SVG at row height with `viewBox` preserved. Prefer the simpler approach: each row's SVG is `height: 100%` with `preserveAspectRatio="none"` on straight segments and a fixed-size overlay for nodes. If this proves fragile, fall back to one absolutely-positioned SVG overlay for the whole thread, positioned from measured row offsets.
- Right-lane cards sit lower than their paired left-lane card by ~36px so the connector reads as an L, not a straight bar.
- Thread ends with a small filled dot on the spine (terminal cap). When `p.status === "closed"`, the cap is a filled square.

### Mini-map (top of thread)

A horizontal strip above the lanes: one small node per communication in issued order, connected by a line. Same shape and colour grammar as the main flow. To the right of the strip, one short summary from `describeDue()` for the earliest open communication (e.g. "1 open · due in 6 days"). The strip is not clickable in this pass.

## 4. Cards

Collapsed by default. Click the card head to expand. Expanded state is local component state, not persisted.

Communication card (left lane):
- Collapsed: `description ?? type_label`, `issued_on` via `<DateCell>`, and document chips (file icon + name) for each `documents[]` entry.
- Expanded: the existing `<dl class="kv">` block (Reference, DIN, Section, Served on, Response due, Viewed by AO) and the existing Draft / Suggest a due date buttons. Keep all existing gap handling (`Gap`, `unverified`).

Response card (right lane):
- Collapsed: "Response filed" plus `response_mode` if `partial` ("Partial response filed"), `filed_on`, tick glyph.
- Expanded: Filed by, Transaction, Remarks — as today.

Adjournment card (right lane):
- Collapsed: "Adjournment sought", `filed_on`, `sought_date`, `outcome` if present.
- Expanded: Reason.

Empty slot (right lane): dashed border, no fill. Text "Response not yet filed". Below it, the due description from `describeDue()` and the Draft button (`has_draft ? "Open draft" : "Draft"`). This replaces the Draft button that currently sits inside the communication card, so the action lives where the gap is.

Card style: reuse `.card` tokens (`--radius-card`, `--border`). Border colour of a card takes the pair's state colour at low emphasis (border only, never fill).

## 5. Pairing logic

All pairing is derived in the component. No new fields.

1. Response → communication: `response.in_reply_to` matches `communication.reference_id` or `communication.id`. Check both. If neither matches, attach the response to the latest communication whose `issued_on <= response.filed_on`.
2. Adjournment → communication: `AdjournmentRow` has no `in_reply_to`. Attach to the latest communication whose `issued_on <= adjournment.filed_on`.
3. Merge target for an adjournment: the earliest communication with `issued_on >= adjournment.sought_date`. If none exists, the branch curves back to the spine and ends in a hollow ring (the reissue has not arrived yet).
4. Empty slot: rendered for every communication with no paired response, where `actionsFor(status).draft` is true. Communications with status `closed` or `response_submitted` never get a slot.
5. Pair state colour: if paired response exists → success. Else if `describeDue(c.response_due_date, effective).tone === "danger"` → danger. Else if tone is `warning` or `normal` → warning. Else (settled, muted, unknown) → border-strong.

`effective` status per communication is computed exactly as today: `c.status === "response_submitted" ? "response_submitted" : p.status`.

## 6. Countdown ring

The ring needs a ratio of elapsed to total window. `describeDue().days` is documented as sort-only, never rendered. Using it as a ratio does not print a number, which is inside the spirit of the rule, but the ring must never show a numeric day count itself. Compute:

- `total = daysBetween(issued_on, response_due_date)`, floor at 1.
- `elapsed = total - days` (days from `describeDue`), clamped 0..total.
- Arc = `elapsed / total` of the circumference via `stroke-dasharray`.
- Missing `issued_on` or missing `response_due_date`: no ring, plain hollow node.

Log this decision in `QUESTIONS.md`.

## 7. Collapse repeats

If two or more consecutive communications share the same `communication_type_id` and none of them has a paired response or adjournment, render them as one left-lane card: "N × {type_label}" with a chevron. Expanding shows each as a normal card. Nodes on the spine remain one per communication (small, 5px radius), so the mini-map and spine stay truthful.

## 8. Interactions

- Hover a node or card: the paired card and its connector get full opacity; every other row drops to 0.55 opacity. CSS only, via a `data-pair` attribute and `:has()`.
- Click card head: toggle expand. Icon chevron rotates.
- Keyboard: cards are `<button>` heads with `aria-expanded`. Nodes are decorative (`aria-hidden`). State is also conveyed by the existing `<StatusPill>` inside the expanded view, so no information is colour-only.

## 9. Motion

One animation only: the empty slot's hollow ring pulses opacity 1 → 0.6 → 1 over 2.4 s, infinite, when its state is warning or danger. Respect `prefers-reduced-motion: reduce` (no animation). No draw-in on load, no transitions on connectors.

## 10. Empty state

When `communications`, `responses`, and `adjournments` are all empty: still draw the spine with one hollow dashed ring at the top and the existing `<EmptyState>` copy to the left of it. Do not render the mini-map.

## 11. Files

- `src/screens/work-item.tsx`: replace `Thread`. Extract to `src/ui/thread-flow.tsx` with subcomponents `ThreadMiniMap`, `ThreadRow`, `SpineNode`, `Connector`, `EmptySlot`. `work-item.tsx` imports `ThreadFlow` and passes the same props `Thread` receives today.
- `src/styles/base.css`: remove `.thread .msg*` rules. Add `.thread-flow*` rules. Keep under ~120 lines of CSS.
- `src/lib/thread-pairing.ts`: pure functions for section 5 (`pairThread(p: ProceedingDetail)` returning ordered rows). Unit-test with vitest: one answered, one adjourned with merge, one open past due, one open with no due date, one closed with no response, collapse of three reminders.

## 12. Acceptance criteria

1. Screenshot test: a proceeding with one answered notice, one adjournment, one open notice reads correctly with all text removed (set `color: transparent` in devtools). Shapes and colours alone tell the story.
2. No day count appears anywhere in the thread except through `describeDue().text`.
3. All existing actions (Draft, Open draft, Suggest a due date, document rows via `DocRow`) still work and call the same handlers.
4. Dark and light themes both pass: no hardcoded hex in the new CSS or SVG.
5. Thread with 25 communications renders without horizontal scroll at 1100px width.
6. `npm run typecheck`, `npm run lint`, `npm test` pass.

## 13. Non-goals

- No changes to the mini-map being interactive.
- No backend or scraper changes to add `in_reply_to` for adjournments.
- No changes to other screens that render communications (`module-items.tsx` demand/return/form screens).
- No new dependencies. Inline SVG only.

## 14. Working rules for this task

Autonomous mode as usual: no questions mid-build, no stopping for review. Defaults chosen go to `QUESTIONS.md`, progress to `TASKS.md`, unresolved issues to `NOTES.md` with TODOs. Farhath tests.
