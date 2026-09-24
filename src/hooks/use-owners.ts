/** Owner names for the owner select and the "Mine" filter (docs/16 §1.3):
 *  every name already used in `work_item_meta`, plus this device's user. */
import { useMemo } from "react";
import { api } from "../lib/api";
import { useQuery } from "../lib/query";
import type { Settings } from "../lib/types";
import { useRoster, useSyncState } from "./use-sync";

export function useSettings() {
  return useQuery<Settings>("settings", () => api.settings());
}

/** The local user's display name: the name signed in with last, else this
 *  device's name on the firm roster. Null when neither is known. */
export function useLocalUserName(): string | null {
  const settings = useSettings();
  const sync = useSyncState();
  const roster = useRoster(!!sync.data?.configured);
  const own = settings.data?.last_user_id?.trim();
  if (own) return own;
  const me = sync.data?.device_id;
  return roster.data?.devices.find((d) => d.id === me)?.name ?? null;
}

export function useOwners(): { names: string[]; me: string | null } {
  const q = useQuery<string[]>("work_items:assignees", () => api.assignees());
  const me = useLocalUserName();
  const names = useMemo(() => {
    const all = new Map<string, string>();
    for (const n of [...(q.data ?? []), ...(me ? [me] : [])]) all.set(n.toLowerCase(), n);
    return [...all.values()].sort((a, b) => a.localeCompare(b));
  }, [q.data, me]);
  return { names, me };
}

/** Two letters for an avatar: first and last word, else the first two. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}
