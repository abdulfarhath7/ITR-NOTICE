import { api } from "../lib/api";
import { useQuery } from "../lib/query";
import type { ClientDetail, ClientSummary } from "../lib/types";

export function useClients(search: string) {
  return useQuery<ClientSummary[]>(`clients:list:${search}`, () => api.clients(search));
}

export function useClient(id: string | null) {
  return useQuery<ClientDetail>(id ? `clients:${id}` : null, () => api.client(id ?? ""));
}
