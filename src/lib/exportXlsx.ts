import * as XLSX from "xlsx";
import { BUCKETS, TO_RESPOND, counts, describe, type Item } from "./buckets";
import { STATUS_LABEL } from "./status";
import { ATTENTION_BUCKETS } from "./summary";

function yes(v: unknown): string { return v ? "Yes" : "No"; }

export function exportWorkbook(items: Item[]): void {
  const today = new Date().toISOString().slice(0, 10);
  const c = counts(items);
  const wb = XLSX.utils.book_new();

  const summary: (string | number)[][] = [
    ["Litigation Command Center — summary"], ["Run date", today], ["Notices held", items.length], [],
    ["Draft for review — verify every figure against the portal."], [], ["Position at a glance"],
    ["To respond", c.to_respond],
    ...BUCKETS.map((b) => [b.label, c[b.key]] as (string | number)[]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), "Summary");

  const attention = items
    .filter((i) => ATTENTION_BUCKETS.includes(i.bucket))
    .sort((a, b) => (a.days ?? 9e9) - (b.days ?? 9e9))
    .map((i) => ({
      "Client / Description": describe(i), PAN: i.pan ?? "", AY: i.assessment_year ?? "",
      Section: i.notice_us ?? "", "Due date": i.due_date ?? "", Due: i.due.text,
      Status: STATUS_LABEL[i.machineStatus], "PDF saved": yes(i.has_pdf), "Draft ready": yes(i.has_draft),
    }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(attention), "Attention");

  const register = items.map((i) => ({
    "Reference ID": i.ref_id, "Client / Description": describe(i),
    Proceeding: i.proceeding_name ?? "", PAN: i.pan ?? "", AY: i.assessment_year ?? "",
    Section: i.notice_us ?? "", "Issued on": i.issued_on ?? "", "Due date": i.due_date ?? "",
    "Suggested due date": i.suggested_due_date ?? "", "Manual due date": i.manual_due_date ?? "",
    Due: i.due.text,
    Position: BUCKETS.find((b) => b.key === i.bucket)?.label ?? "",
    "To respond": TO_RESPOND.includes(i.bucket) ? "Yes" : "No",
    Status: STATUS_LABEL[i.machineStatus],
    "PDF saved": yes(i.has_pdf), "Draft ready": yes(i.has_draft),
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(register), "All notices");

  XLSX.writeFile(wb, `llc-${today}.xlsx`);
}
