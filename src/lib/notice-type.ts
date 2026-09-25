/** The notice-type pill (docs/18 §3.5). Data, not code paths: add a row to
 *  `NOTICE_TYPES` and the pill, the Type chip and the export follow. The
 *  section text is read from `section_1961`, falling back to
 *  `section_2025`; the first row whose pattern matches wins. Anything else
 *  shows the section text as-is in grey. Display only — no column. */
import type { WorkItemRow } from "./types";

/** Mockup colours map onto the design system's semantic tones (docs/10):
 *  purple → accent, red → danger, amber → warning, grey → muted. */
export type NoticeTone = "accent" | "danger" | "warning" | "muted";

export interface NoticeType {
  /** Stable key for chips and saved views. */
  key: string;
  /** What the pill says. */
  label: string;
  tone: NoticeTone;
  /** Matches against the section tokens; case-insensitive, anchored at the start. */
  match: RegExp;
}

export const NOTICE_TYPES: NoticeType[] = [
  { key: "143(2)", label: "143(2) scrutiny", tone: "accent", match: /^143\(2\)/i },
  { key: "142(1)", label: "142(1) inquiry", tone: "accent", match: /^142\(1\)/i },
  { key: "148", label: "148 reassessment", tone: "danger", match: /^148A?\b/i },
  { key: "271", label: "271 penalty", tone: "warning", match: /^(271[A-Z]*(\(\w+\))*|270A)\b/i },
  { key: "156", label: "156 demand", tone: "muted", match: /^156\b/ },
  { key: "143(1)", label: "143(1) intimation", tone: "muted", match: /^143\(1\)/ },
];

function tokens(text: string | null | undefined): string[] {
  return (text ?? "").match(/\d+[A-Za-z]*(?:\(\w+\))*/g) ?? [];
}

/** The pill for a row: a mapped type, or the section text itself in grey,
 *  or null when the row states no section. */
export function noticeType(row: Pick<WorkItemRow, "section_1961" | "section_2025">): { key: string; label: string; tone: NoticeTone } | null {
  const text = row.section_1961 || row.section_2025 || null;
  if (!text) return null;
  for (const tok of tokens(text)) {
    const hit = NOTICE_TYPES.find((t) => t.match.test(tok));
    if (hit) return { key: hit.key, label: hit.label, tone: hit.tone };
  }
  return { key: text, label: text, tone: "muted" };
}

/** Distinct types present in a result set, mapped ones first, for the Type ▾ chip. */
export function noticeTypesIn(rows: Pick<WorkItemRow, "section_1961" | "section_2025">[]): { key: string; label: string; tone: NoticeTone }[] {
  const seen = new Map<string, { key: string; label: string; tone: NoticeTone }>();
  for (const r of rows) {
    const t = noticeType(r);
    if (t && !seen.has(t.key)) seen.set(t.key, t);
  }
  const order = new Map(NOTICE_TYPES.map((t, i) => [t.key, i]));
  return [...seen.values()].sort((a, b) => (order.get(a.key) ?? 99) - (order.get(b.key) ?? 99) || a.label.localeCompare(b.label));
}
