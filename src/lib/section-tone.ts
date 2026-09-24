/** Which sections read as dangerous on a list (docs/16 §1.7). Data, one
 *  object: edit the map, not the code. Keys are Income-tax Act 1961
 *  section numbers; a key ending in `*` covers the whole family. */
import type { WorkItemRow } from "./types";

export type SectionTone = "danger" | "warning" | "normal";

export const SECTION_TONE: Record<string, SectionTone> = {
  "147": "danger", "148": "danger", "148A": "danger", "263": "danger", "271*": "danger",
  "139(9)": "warning", "142(1)": "warning", "143(2)": "warning", "144": "warning",
  "143(1)": "normal", "245": "normal", "154": "normal",
};

const RANK: Record<SectionTone, number> = { danger: 2, warning: 1, normal: 0 };

/** `143(1)(a)` → `143(1)(a)`, `143(1)`, `143`: the most specific key wins. */
function lookup(token: string): SectionTone | null {
  let t = token.toUpperCase();
  for (;;) {
    if (t in SECTION_TONE) return SECTION_TONE[t];
    const cut = t.lastIndexOf("(");
    if (cut <= 0) break;
    t = t.slice(0, cut);
  }
  for (const [k, tone] of Object.entries(SECTION_TONE)) {
    if (k.endsWith("*") && t.startsWith(k.slice(0, -1))) return tone;
  }
  return null;
}

function tokens(text: string | null | undefined): string[] {
  return (text ?? "").match(/\d+[A-Za-z]*(?:\(\w+\))*/g) ?? [];
}

/** The most severe tone among the section numbers the row carries. The
 *  1961 number is read first, since the map is keyed on it. */
export function sectionTone(row: Pick<WorkItemRow, "section" | "section_1961" | "section_2025" | "type_label">): SectionTone {
  const sources = row.section_1961 ? [row.section_1961] : [row.section, row.type_label];
  let best: SectionTone = "normal";
  for (const src of sources) {
    for (const tok of tokens(src)) {
      const t = lookup(tok);
      if (t && RANK[t] > RANK[best]) best = t;
    }
  }
  return best;
}

/** What the section pill says: section, then the 2025 or 1961 number,
 *  then the type label. */
export function sectionLabel(row: Pick<WorkItemRow, "section" | "section_1961" | "section_2025" | "type_label">): string {
  return row.section ?? (row.section_2025 ? `Sec ${row.section_2025}` : row.section_1961 ? `Sec ${row.section_1961}` : row.type_label);
}
