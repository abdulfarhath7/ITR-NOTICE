/** Saved views on the Attention screen (docs/16 §1.6): a named copy of the
 *  filter object, never the search text. Per device, in localStorage
 *  under `lcc.views.<screen>`, following `lib/theme.ts` (Q34). */
import { useCallback, useState } from "react";

export const MAX_VIEWS = 12;

export interface SavedView<F> { id: string; name: string; filters: F }

const key = (screen: string) => `lcc.views.${screen}`;

function read<F>(screen: string): SavedView<F>[] {
  try {
    const raw = localStorage.getItem(key(screen));
    const v = raw ? JSON.parse(raw) as unknown : [];
    return Array.isArray(v)
      ? (v as SavedView<F>[]).filter((x) => x && typeof x.id === "string" && typeof x.name === "string" && x.filters)
      : [];
  } catch { return []; }
}

function write<F>(screen: string, views: SavedView<F>[]): void {
  try { localStorage.setItem(key(screen), JSON.stringify(views)); } catch { /* a locked-down profile is fine */ }
}

export function useSavedViews<F>(screen: string) {
  const [views, setViews] = useState<SavedView<F>[]>(() => read<F>(screen));
  const commit = useCallback((next: SavedView<F>[]) => { write(screen, next); setViews(next); }, [screen]);

  const save = useCallback((name: string, filters: F): SavedView<F> | null => {
    const cur = read<F>(screen);
    if (cur.length >= MAX_VIEWS) return null;
    const view = { id: `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: name.trim(), filters };
    commit([...cur, view]);
    return view;
  }, [screen, commit]);
  const rename = useCallback((id: string, name: string) => {
    commit(read<F>(screen).map((v) => (v.id === id ? { ...v, name: name.trim() } : v)));
  }, [screen, commit]);
  const remove = useCallback((id: string) => {
    commit(read<F>(screen).filter((v) => v.id !== id));
  }, [screen, commit]);

  return { views, save, rename, remove, full: views.length >= MAX_VIEWS };
}
