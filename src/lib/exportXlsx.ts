import * as XLSX from "xlsx";
import { BUCKETS, TO_RESPOND, counts, describe, type Item } from "./buckets";

function yes(v: unknown): string { return v ? "Yes" : "No"; }
function replied(v: number | null): string { return v === null ? "Unknown" : v ? "Yes" : "No"; }

export function exportWorkbook(items: Item[]): void {
  const today = new Date().toISOString().slice(0, 10);
  const c = counts(items);
  const wb = XLSX.utils.book_new();

  const summary: (string | number)[][] = [
    ["Notice Desk — summary"], ["Run date", today], ["Notices held", items.length], [],
    ["Draft for review — verify every figure against the portal."], [], ["Position at a glance"],
    ["To respond", c.to_respond],
    ...BUCKETS.map((b) => [b.label, c[b.key]] as (string | number)[]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), "Summary");

  const attention = items
    .filter((i) => i.bucket === "overdue" || i.bucket === "due_3" || i.bucket === "no_due_date")
    .sort((a, b) => (a.days ?? 9e9) - (b.days ?? 9e9))
    .map((i) => ({
      "Client / Description": describe(i), PAN: i.pan ?? "", AY: i.assessment_year ?? "",
      Section: i.notice_us ?? "", "Due date": i.due_date ?? "", "Days left": i.days ?? "",
      Responded: replied(i.responded), "PDF saved": yes(i.has_pdf), "Draft ready": yes(i.has_draft),
    }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(attention), "Attention");

  const register = items.map((i) => ({
    "Reference ID": i.ref_id, "Client / Description": describe(i),
    Proceeding: i.proceeding_name ?? "", PAN: i.pan ?? "", AY: i.assessment_year ?? "",
    Section: i.notice_us ?? "", "Issued on": i.issued_on ?? "", "Due date": i.due_date ?? "",
    "Due date from": i.due_date_source ?? "", "Days left": i.days ?? "",
    Position: BUCKETS.find((b) => b.key === i.bucket)?.label ?? "",
    "To respond": TO_RESPOND.includes(i.bucket) ? "Yes" : "No",
    Responded: replied(i.responded), "Proceeding status": i.status ?? "",
    "PDF saved": yes(i.has_pdf), "Draft ready": yes(i.has_draft),
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(register), "All notices");

  XLSX.writeFile(wb, `notice-desk-${today}.xlsx`);
}
