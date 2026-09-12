import { api } from "../lib/api";
import { useQuery } from "../lib/query";
import type { ProceedingDetail } from "../lib/types";

export function useProceeding(id: string | null) {
  return useQuery<ProceedingDetail>(id ? `proceedings:${id}` : null, () => api.proceeding(id ?? ""));
}
