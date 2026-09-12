import { useMemo } from "react";
import { api } from "../lib/api";
import { rankRows, type RankedItem } from "../lib/attention";
import { useQuery } from "../lib/query";
import type { WorkItemFilter, WorkItemRow } from "../lib/types";

export function useWorkItems(filter: WorkItemFilter) {
  const key = `work_items:${JSON.stringify(filter)}`;
  return useQuery<WorkItemRow[]>(key, () => api.workItems(filter));
}

/** Rows ranked for the attention list; recomputed when the rows change. */
export function useAttention(rows: WorkItemRow[] | undefined): RankedItem[] {
  return useMemo(() => rankRows(rows ?? []), [rows]);
}
