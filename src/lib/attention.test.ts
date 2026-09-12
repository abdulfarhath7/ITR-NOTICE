/** Q14: the manual due date drives the ranking when set; the portal's date
 *  is still there, labelled. */
import { describe, expect, it } from "vitest";
import { rankRows } from "./attention";
import type { WorkItemRow } from "./types";

const base: WorkItemRow = {
  module: "proceedings", id: "p", client_id: "c", client_name: "Example", client_code: null, pan_masked: "ABCDE••••F",
  year_context_id: "y", assessment_year: "2024-25", title: "Notice", type_label: "Penalty", reference: null,
  section: null, section_2025: null, section_1961: null, due_date: "2026-10-30", manual_due_date: null,
  suggested_due_date: null, limitation_date: null, status: "open", source_panel: null, verified_flag: 0,
  gap_flags: [], document_count: 0, open_communications: 1, last_seen_at: "2026-09-12T00:00:00Z",
};
const today = { y: 2026, m: 9, d: 12 };

describe("manual due date", () => {
  it("overrides the portal date in the ranking", () => {
    const portalOnly = rankRows([base], today)[0];
    expect(portalOnly.effectiveDue).toBe("2026-10-30");
    expect(portalOnly.rank).toBe(5);
    const manual = rankRows([{ ...base, manual_due_date: "2026-09-10" }], today)[0];
    expect(manual.effectiveDue).toBe("2026-09-10");
    expect(manual.rank).toBe(1);
    expect(manual.due.text).toBe("Overdue by 2 days");
    expect(manual.row.due_date).toBe("2026-10-30");
  });
  it("never uses a suggestion", () => {
    const r = rankRows([{ ...base, due_date: null, suggested_due_date: "2026-09-01" }], today)[0];
    expect(r.rank).toBe(4);
  });
});
