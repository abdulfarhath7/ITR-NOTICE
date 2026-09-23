/** docs/thread-flow-context.md §11: the six pairing cases, nothing broader. */
import { describe, expect, it } from "vitest";
import { annotate, pairThread, type AdjournmentView, type PairRow, type RepeatRow } from "./thread-pairing";
import type { AdjournmentRow, CommunicationView, ProceedingDetail, ResponseRow } from "./types";

const today = { y: 2026, m: 9, d: 12 };

function comm(id: string, over: Partial<CommunicationView> = {}): CommunicationView {
  return {
    id, proceeding_id: "P", communication_type_id: `t-${id}`, reference_id: `REF-${id}`,
    din: null, section_2025: null, section_1961: null, description: null,
    issued_on: null, served_on: null, response_due_date: null, ao_viewed_on: null,
    status: "open", direction: "inbound", verified_flag: 0, gap_flags: null, row_hash: "",
    first_seen_at: "", last_seen_at: "", type_label: "Notice", documents: [], has_draft: false, gaps: [],
    ...over,
  };
}

function resp(id: string, over: Partial<ResponseRow> = {}): ResponseRow {
  return {
    id, proceeding_id: "P", in_reply_to: null, response_mode: "full", filed_on: null,
    filed_by: null, remarks: null, transaction_id: null, verified_flag: 0, gap_flags: null, ...over,
  };
}

function adj(id: string, over: Partial<AdjournmentRow> = {}): AdjournmentRow {
  return { id, proceeding_id: "P", sought_date: null, reason: null, outcome: null, filed_on: null, ...over };
}

function proceeding(over: Partial<ProceedingDetail>): ProceedingDetail {
  return { status: "open", communications: [], responses: [], adjournments: [], ...over } as ProceedingDetail;
}

const pairs = (p: ProceedingDetail) => pairThread(p, today).filter((r): r is PairRow => r.kind === "pair");

describe("pairThread", () => {
  it("pairs an answered notice by reference id", () => {
    const [row] = pairs(proceeding({
      communications: [comm("a", { issued_on: "2026-08-01", response_due_date: "2026-08-20" })],
      responses: [resp("r", { in_reply_to: "REF-a", filed_on: "2026-08-15" })],
    }));
    expect(row.responses.map((r) => r.id)).toEqual(["r"]);
    expect(row).toMatchObject({ state: "success", slot: false, ring: null });
  });

  it("branches an adjournment and merges it at the reissued notice", () => {
    const rows = annotate(pairThread(proceeding({
      communications: [
        comm("a", { issued_on: "2026-07-01", response_due_date: "2026-07-15" }),
        comm("b", { issued_on: "2026-08-10", response_due_date: "2026-09-30" }),
      ],
      adjournments: [adj("x", { filed_on: "2026-07-10", sought_date: "2026-08-05" })],
    }), today));
    expect(rows.map((r) => r.kind)).toEqual(["pair", "adjournment", "pair"]);
    const branch = rows[1] as AdjournmentView;
    expect(branch.pair).toBe(rows[0].key);
    expect(branch.mergeKey).toBe(rows[2].key);
    expect(rows[2].mergeIn).toBe(true);
  });

  it("marks an open notice past due as danger with a full ring", () => {
    const [row] = pairs(proceeding({
      communications: [comm("a", { issued_on: "2026-08-01", response_due_date: "2026-09-01" })],
    }));
    expect(row).toMatchObject({ state: "danger", slot: true, ring: 1 });
  });

  it("leaves an open notice with no due date idle, slotted, ringless", () => {
    const [row] = pairs(proceeding({ communications: [comm("a", { issued_on: "2026-08-01" })] }));
    expect(row).toMatchObject({ state: "idle", slot: true, ring: null });
  });

  it("gives a closed notice with no response no slot", () => {
    const [row] = pairs(proceeding({
      status: "closed",
      communications: [comm("a", { issued_on: "2026-08-01", response_due_date: "2026-08-20" })],
    }));
    expect(row).toMatchObject({ state: "idle", slot: false });
  });

  it("folds three unanswered reminders of one type into one row", () => {
    const reminder = { communication_type_id: "reminder", type_label: "Reminder" };
    const rows = pairThread(proceeding({
      communications: [
        comm("a", { ...reminder, issued_on: "2026-06-01" }),
        comm("b", { ...reminder, issued_on: "2026-07-01" }),
        comm("c", { ...reminder, issued_on: "2026-08-01" }),
      ],
    }), today);
    expect(rows).toHaveLength(1);
    expect((rows[0] as RepeatRow).members.map((m) => m.comm.id)).toEqual(["a", "b", "c"]);
  });
});
