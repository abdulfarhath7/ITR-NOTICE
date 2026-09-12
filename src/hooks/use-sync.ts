import { useCallback, useState } from "react";
import { api, describeError } from "../lib/api";
import { invalidate, useQuery } from "../lib/query";
import { toast, toastError } from "../lib/toast";
import type { Roster, SyncState } from "../lib/types";

export function useSyncState() {
  return useQuery<SyncState>("sync:state", () => api.syncState());
}

export function useRoster(enabled: boolean) {
  return useQuery<Roster>(enabled ? "sync:roster" : null, () => api.roster());
}

export function useSyncNow() {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async () => {
    setBusy(true);
    try {
      const r = await api.syncNow();
      const parts = [`${r.pushed} sent`, `${r.pulled} received`, `${r.applied} applied`];
      if (r.sweep_waiting_for_lease) parts.push("sweep changes wait for the collector lease");
      toast(`Synced: ${parts.join(", ")}.`);
      if (r.errors.length) toastError(`${r.errors.length} entr${r.errors.length === 1 ? "y" : "ies"} could not be applied.`);
      invalidate("sync"); invalidate("clients"); invalidate("work_items"); invalidate("proceedings"); invalidate("device");
    } catch (e) {
      toastError(describeError(e));
      invalidate("sync");
    } finally { setBusy(false); }
  }, []);
  return { busy, run };
}
