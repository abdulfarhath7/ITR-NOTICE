/** Build 2 lane buckets → Build 4 cumulative windows (docs/18 §2, Q49).
 *
 *  Saved views and the persisted Attention filters live in localStorage,
 *  so this is the data migration, applied once as each object is read and
 *  written straight back. `BUCKET_TO_WINDOW` is the whole decision: edit a
 *  row to change what an old bucket becomes. */

/** Old bucket value → new window value. `""` drops the bucket. */
export const BUCKET_TO_WINDOW: Record<string, "" | "7" | "15" | "30"> = {
  // Issued lanes
  last7: "7", i8_15: "15", i16_30: "30",
  // Due lanes
  next7: "7", d8_15: "15", d16_30: "30", later: "",
};

/** Old strip tiles → Build 4 tiles. Missing = dropped. */
export const TILE_TO_TILE: Record<string, "" | "overdue" | "due3" | "nodate"> = {
  overdue: "overdue", due48: "due3", nodate: "nodate", drafts: "",
};

const WINDOWS = new Set(["", "7", "15", "30"]);

/** Rewrite one filter object in place. Returns whether anything changed. */
export function migrateAttentionFilters(raw: Record<string, unknown>): boolean {
  let changed = false;
  for (const k of ["issued", "due"] as const) {
    const v = raw[k];
    if (typeof v === "string" && !WINDOWS.has(v)) { raw[k] = BUCKET_TO_WINDOW[v] ?? ""; changed = true; }
  }
  const t = raw.tile;
  if (typeof t === "string" && t !== "" && !(t in TILE_TO_TILE && TILE_TO_TILE[t] === t)) {
    raw.tile = TILE_TO_TILE[t] ?? ""; changed = true;
  }
  return changed;
}
