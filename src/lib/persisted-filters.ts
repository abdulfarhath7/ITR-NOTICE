/** Filters that survive a restart (docs/16 §1.3), one JSON object per
 *  screen under `lcc.filters.<screen>`, following `lib/theme.ts`. Search
 *  text is never persisted: callers keep it in plain state. */
import { useCallback, useEffect, useState } from "react";

const key = (screen: string) => `lcc.filters.${screen}`;

/** A per-screen rewrite of an old stored shape, applied once on read and
 *  written straight back (docs/18 Q49). Returns whether it changed anything. */
export type Migrate = (raw: Record<string, unknown>) => boolean;

export function readFilters<T extends object>(screen: string, defaults: T, migrate?: Migrate): T {
  try {
    const raw = localStorage.getItem(key(screen));
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<T>;
    if (migrate && migrate(parsed as Record<string, unknown>)) {
      try { localStorage.setItem(key(screen), JSON.stringify(parsed)); } catch { /* read-only profile */ }
    }
    // Only known keys, only the default's type: a stale or hand-edited
    // object never puts a wrong shape into a select.
    const out = { ...defaults };
    for (const k of Object.keys(defaults) as (keyof T)[]) {
      const v = parsed[k];
      if (v !== undefined && (v === null || typeof v === typeof defaults[k] || defaults[k] === null)) out[k] = v as T[keyof T];
    }
    return out;
  } catch { return defaults; }
}

export function writeFilters<T extends object>(screen: string, value: T): void {
  try { localStorage.setItem(key(screen), JSON.stringify(value)); } catch { /* a locked-down profile is fine */ }
  window.dispatchEvent(new CustomEvent("lcc:filters", { detail: screen }));
}

/** State backed by the screen's key. Another screen writing the same key
 *  (the Calendar writes Attention's client and module) is picked up. */
export function usePersistedFilters<T extends object>(screen: string, defaults: T, migrate?: Migrate):
  [T, (patch: Partial<T> | ((cur: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => readFilters(screen, defaults, migrate));
  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent<string>).detail === screen) setValue(readFilters(screen, defaults, migrate));
    };
    window.addEventListener("lcc:filters", on);
    return () => window.removeEventListener("lcc:filters", on);
    // `defaults` is a constant per screen; only the key matters.
  }, [screen]);
  const update = useCallback((patch: Partial<T> | ((cur: T) => T)) => {
    setValue((cur) => {
      const next = typeof patch === "function" ? patch(cur) : { ...cur, ...patch };
      writeFilters(screen, next);
      return next;
    });
  }, [screen]);
  return [value, update];
}
