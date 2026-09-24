/** Change the text size from anywhere: the settings stepper and the
 *  Ctrl/Cmd + − 0 shortcuts. Applies at once, then persists through
 *  `save_settings` — no save bar for this one (docs/16 §3). */
import { useCallback, useEffect, useState } from "react";
import { api, describeError } from "../lib/api";
import { invalidate } from "../lib/query";
import { applyScale, cachedScale, stepScale, type Scale } from "../lib/scale";
import { toast, toastError } from "../lib/toast";

let saving: Promise<void> = Promise.resolve();

export async function setTextSize(scale: number): Promise<Scale> {
  const s = applyScale(scale);
  // Serialise writes so fast key repeats land in order.
  saving = saving.then(async () => {
    try {
      const cur = await api.settings();
      if (cur.ui_scale !== s) await api.saveSettings({ ...cur, ui_scale: s });
      invalidate("settings");
    } catch (e) { toastError(`Text size not saved: ${describeError(e)}`); }
  });
  await saving;
  return s;
}

/** The scale on screen now, updated when anything changes it. */
export function useTextSize(): [Scale, (s: number) => void] {
  const [scale, setScale] = useState<Scale>(cachedScale);
  useEffect(() => {
    const on = (e: Event) => setScale((e as CustomEvent<Scale>).detail);
    window.addEventListener("lcc:scale", on);
    return () => window.removeEventListener("lcc:scale", on);
  }, []);
  const set = useCallback((s: number) => { void setTextSize(s); }, []);
  return [scale, set];
}

function typing(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName);
}

/** Ctrl/Cmd `+` `−` `0`, registered once in the shell. Ignored while the
 *  focus is in a text field so the keys still work there as usual. */
export function useTextSizeShortcuts(): void {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || typing(e.target)) return;
      let next: number | null = null;
      const cur = cachedScale();
      if (e.key === "+" || e.key === "=") next = stepScale(cur, 1);
      else if (e.key === "-" || e.key === "_") next = stepScale(cur, -1);
      else if (e.key === "0") next = 100;
      if (next === null) return;
      e.preventDefault();
      if (next === cur) return;
      void setTextSize(next).then((s) => toast(`Text size ${s}%`));
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);
}
