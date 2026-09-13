/** Theme preference: dark, light, or follow the operating system. The
 *  resolved mode is stamped on <html data-theme> for the tokens. */
import { useEffect, useState } from "react";

export type ThemePreference = "dark" | "light" | "system";
export type ThemeMode = "dark" | "light";

const KEY = "lcc.theme";
const query = () => window.matchMedia("(prefers-color-scheme: light)");

export function readPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "system" ? v : "dark";
  } catch { return "dark"; }
}

export function resolve(pref: ThemePreference): ThemeMode {
  if (pref === "system") return query().matches ? "light" : "dark";
  return pref;
}

export function useTheme(): { preference: ThemePreference; mode: ThemeMode; setPreference: (p: ThemePreference) => void } {
  const [preference, setPreference] = useState<ThemePreference>(readPreference);
  const [mode, setMode] = useState<ThemeMode>(() => resolve(preference));

  useEffect(() => {
    try { localStorage.setItem(KEY, preference); } catch { /* a locked-down profile is fine */ }
    setMode(resolve(preference));
    if (preference !== "system") return;
    const mq = query();
    const on = () => setMode(resolve("system"));
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [preference]);

  useEffect(() => { document.documentElement.dataset.theme = mode; }, [mode]);

  return { preference, mode, setPreference };
}
