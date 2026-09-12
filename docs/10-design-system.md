# 10 — Design system

Dark-first, dense, quiet. References: Linear, Vercel, Stripe, Attio.
The user will supply their own `DESIGN.md`; if one appears in the repo, it
overrides this file. Until then, build to this.

## Principles

1. **Quiet by default.** Colour means something. If everything is coloured,
   nothing is.
2. **Dense but breathing.** This is a professional tool used all day. Fit more
   rows on screen than a consumer app would, without crowding.
3. **Flat.** No gradients, no glow, no drop shadows except on true overlays.
4. **Hairlines.** Borders are 1px at low contrast. Structure comes from
   spacing and alignment, not from boxes.
5. **Type carries hierarchy**, not weight and size alone.

## Colour

Dark mode is the default. Both modes must work.

| Token | Dark | Light |
|---|---|---|
| `--bg` | `#0E0E0D` | `#FAFAF7` |
| `--surface-1` | `#161615` | `#FFFFFF` |
| `--surface-2` | `#1E1E1C` | `#F4F3EF` |
| `--border` | `#2A2A27` | `#E2E0D8` |
| `--border-strong` | `#3A3A36` | `#CFCDC3` |
| `--text` | `#EDEBE4` | `#1C1C1A` |
| `--text-muted` | `#9A988F` | `#6B6A63` |
| `--text-faint` | `#6B6A63` | `#94938C` |
| `--accent` | `#3B9E7E` | `#0F6E56` |
| `--danger` | `#E06A5E` | `#B23A2C` |
| `--warning` | `#D9A03C` | `#8A5B12` |
| `--success` | `#4FA97F` | `#1D7A54` |

Semantic use only:
- **danger** — overdue, failed, credential problems
- **warning** — due soon, unverified, collector silent
- **success** — submitted, synced, healthy
- **accent** — the single primary action on a screen. One per view.

## Type

System UI stack. `ui-sans-serif, -apple-system, "Segoe UI", Inter, sans-serif`.
Tabular numerals for every number in a table.

| Role | Size | Weight | Line |
|---|---|---|---|
| Page title | 20px | 500 | 28px |
| Section | 15px | 500 | 22px |
| Body | 13px | 400 | 20px |
| Table cell | 13px | 400 | 18px |
| Label / meta | 11px | 400 | 16px |

Two weights only: 400 and 500. Never 600 or 700.
Monospace (`ui-monospace, "JetBrains Mono", monospace`) for PAN, DIN,
acknowledgement numbers, hashes and amounts.

## Spacing and shape

4px base. Use 4, 8, 12, 16, 24, 32, 48.
Radius: 6px controls, 10px cards, 999px pills.
Table row height 40px. Control height 32px.

## Components

**Status pill.** Text, not a bare dot. Tinted background at ~12% of the
semantic colour, text at full. Sentence case.

**Table.** Hairline row separators, no vertical rules, no zebra striping.
Sticky header. Right-align numbers and dates. Masked PAN in mono.

**Button.** Transparent with a 1px border by default. One accent-filled button
per screen at most. Destructive actions are text-only in danger colour and
always confirm.

**Empty state.** One line naming the space, one line explaining, one action.
Never "Nothing here yet".

**Toast.** Bottom-right, auto-dismiss for success, sticky with a Dismiss for
errors.

## Motion

150ms ease-out for state changes, 200ms for overlays. Nothing else moves.
No skeleton shimmer — use a quiet "Loading" label. Respect
`prefers-reduced-motion`.

## Accessibility

- Contrast ratio 4.5:1 minimum for body text in both modes.
- Every interactive element reachable by keyboard, with a visible focus ring.
- Colour is never the only signal — always pair with text or an icon.
- Full keyboard navigation for the Attention table: arrows, Enter to open.

## Icons

Single outline set, 16px in rows, 20px in toolbars, 1.5px stroke. Inherit
current colour. Never decorative — if an icon has no meaning, remove it.
