import { api } from "../lib/api";
import { useQuery } from "../lib/query";
import type { DemandDetail, FiledFormDetail, ProceedingDetail, ReturnDetail } from "../lib/types";

export function useProceeding(id: string | null) {
  return useQuery<ProceedingDetail>(id ? `proceedings:${id}` : null, () => api.proceeding(id ?? ""));
}

export function useDemand(id: string | null) {
  return useQuery<DemandDetail>(id ? `demands:${id}` : null, () => api.demand(id ?? ""));
}
export function useReturn(id: string | null) {
  return useQuery<ReturnDetail>(id ? `returns:${id}` : null, () => api.return_(id ?? ""));
}
export function useFiledForm(id: string | null) {
  return useQuery<FiledFormDetail>(id ? `forms:${id}` : null, () => api.filedForm(id ?? ""));
}
