import { useMemo } from "react";
import { api } from "../lib/api";
import { rankRows, type RankedItem } from "../lib/attention";
import { useQuery } from "../lib/query";
import type { WorkItemFilter, WorkItemRow } from "../lib/types";

/** One key per distinct filter, whatever the object's key order or which
 *  fields are null, so the shell and the screens share a cached fetch. */
function keyFor(filter: WorkItemFilter): string {
  const parts: string[] = [];
  for (const k of Object.keys(filter).sort() as (keyof WorkItemFilter)[]) {
    const v = filter[k];
    if (v === null || v === undefined || (Array.isArray(v) && !v.length)) continue;
    parts.push(`${k}=${Array.isArray(v) ? v.join(",") : v}`);
  }
  return `work_items:${parts.join("&")}`;
}

export function useWorkItems(filter: WorkItemFilter = {}) {
  return useQuery<WorkItemRow[]>(keyFor(filter), () => api.workItems(filter));
}

/** Rows ranked for the attention list; recomputed when the rows change. */
export function useAttention(rows: WorkItemRow[] | undefined): RankedItem[] {
  return useMemo(() => rankRows(rows ?? []), [rows]);
}

/** The two numbers the navigation shows: open items and how many are
 *  overdue. Same rows, same ranking, as the Attention screen. */
export function useAttentionCounts(): { open: number; overdue: number } {
  const q = useWorkItems();
  const ranked = useAttention(q.data);
  return useMemo(() => ({ open: ranked.length, overdue: ranked.filter((r) => r.rank === 1).length }), [ranked]);
}
