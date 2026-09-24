/** Updates since the previous sync (docs/16 §4) and this device's seen
 *  watermark, `lcc.updates.seen_until` in localStorage. */
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { useQuery } from "../lib/query";
import type { UpdatesReport } from "../lib/types";

const KEY = "lcc.updates.seen_until";

function readSeen(): string {
  try { return localStorage.getItem(KEY) ?? ""; } catch { return ""; }
}

export function useSeenUntil(): [string, (iso: string) => void] {
  const [seen, setSeen] = useState(readSeen);
  useEffect(() => {
    const on = () => setSeen(readSeen());
    window.addEventListener("lcc:updates-seen", on);
    return () => window.removeEventListener("lcc:updates-seen", on);
  }, []);
  const mark = useCallback((iso: string) => {
    try { localStorage.setItem(KEY, iso); } catch { /* a locked-down profile is fine */ }
    window.dispatchEvent(new Event("lcc:updates-seen"));
  }, []);
  return [seen, mark];
}

/** Keyed under work_items so ingestion events (which invalidate that
 *  prefix) recompute it, as does opening the screen. */
export function useUpdates() {
  return useQuery<UpdatesReport>("work_items:updates", () => api.updates());
}

/** Entries newer than the watermark, for the sidebar badge. */
export function useUnreadUpdates(): number {
  const q = useUpdates();
  const [seen] = useSeenUntil();
  return useMemo(() => (q.data?.entries ?? []).filter((e) => e.at > seen).length, [q.data, seen]);
}
