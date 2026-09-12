/** docs/12 "Date handling": the required cases, nothing broader. */
import { describe, expect, it } from "vitest";
import { daysBetween, parseDate, todayIst } from "./dates";
import { describeDue } from "./due";

const today = { y: 2026, m: 9, d: 12 };

describe("parseDate", () => {
  it("reads a numeric date day-first, with a day above 12", () => {
    expect(parseDate("25/09/2026")).toEqual({ y: 2026, m: 9, d: 25 });
    expect(parseDate("25-09-2026")).toEqual({ y: 2026, m: 9, d: 25 });
    // the ambiguous one is still 3 September, not 9 March
    expect(parseDate("03/09/2026")).toEqual({ y: 2026, m: 9, d: 3 });
  });

  it("reads the portal's month-name form and ISO", () => {
    expect(parseDate("17-Aug-2026")).toEqual({ y: 2026, m: 8, d: 17 });
    expect(parseDate("2026-08-17")).toEqual({ y: 2026, m: 8, d: 17 });
  });

  it("returns null for blank or junk, never today", () => {
    for (const junk of ["", " ", "-", "Not Available", "soon", "32/01/2026", "2026-02-30"]) {
      expect(parseDate(junk)).toBeNull();
    }
  });
});

describe("IST day arithmetic", () => {
  it("counts the Kolkata calendar day after 17:30 UTC", () => {
    // 19:00 UTC on 12 Sep is already 13 Sep in Kolkata.
    expect(todayIst(new Date("2026-09-12T19:00:00Z"))).toEqual({ y: 2026, m: 9, d: 13 });
    expect(todayIst(new Date("2026-09-12T17:00:00Z"))).toEqual({ y: 2026, m: 9, d: 12 });
    expect(daysBetween({ y: 2026, m: 9, d: 13 }, { y: 2026, m: 9, d: 13 })).toBe(0);
  });
});

describe("describeDue — every branch of the docs/09 table", () => {
  it("past, still open", () => {
    expect(describeDue("2026-09-09", "open", today)).toMatchObject({ text: "Overdue by 3 days", tone: "danger" });
    expect(describeDue("2026-09-11", "open", today).text).toBe("Overdue by 1 day");
  });
  it("today", () => {
    expect(describeDue("2026-09-12", "open", today)).toMatchObject({ text: "Due today", tone: "danger" });
  });
  it("within 7 days", () => {
    expect(describeDue("2026-09-17", "open", today)).toMatchObject({ text: "Due in 5 days", tone: "warning" });
  });
  it("beyond 7 days", () => {
    expect(describeDue("2026-09-22", "open", today)).toMatchObject({ text: "Due 22 Sep", tone: "normal" });
    expect(describeDue("2027-01-05", "open", today).text).toBe("Due 5 Jan 2027");
  });
  it("closed or submitted: status wins, never overdue", () => {
    expect(describeDue("2026-08-02", "closed", today)).toMatchObject({ text: "Closed · was due 2 Aug", tone: "muted" });
    expect(describeDue("2026-08-02", "response_submitted", today)).toMatchObject({ text: "Submitted · was due 2 Aug", tone: "muted" });
    expect(describeDue("2026-08-02", "closed", today).text).not.toMatch(/overdue/i);
  });
  it("NULL is Not stated with the unverified marker", () => {
    expect(describeDue(null, "open", today)).toMatchObject({ text: "Not stated", tone: "muted", unverified: true, days: null });
    expect(describeDue("", "open", today).text).toBe("Not stated");
  });
  it("never emits a raw negative number", () => {
    for (const d of ["2026-09-01", "2026-09-11", "2025-01-01"]) {
      expect(describeDue(d, "open", today).text).not.toMatch(/-\d/);
    }
  });
});
