/** `LCC-<sheet>-<YYYY-MM-DD>-<HHMM>.xlsx` in IST (docs/16 §8). */
export function exportFileName(sheet: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const safe = sheet.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "Export";
  return `LCC-${safe}-${get("year")}-${get("month")}-${get("day")}-${get("hour")}${get("minute")}.xlsx`;
}
