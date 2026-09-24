/** Text size (docs/16 §2.4, §3). The whole app is sized in `rem`, so
 *  scaling is one assignment to the root font size. The saved value lives
 *  in `settings.json`; a copy in localStorage lets boot apply it before
 *  the first paint instead of after the settings call returns. */

export const SCALES = [85, 92, 100, 112, 125] as const;
export type Scale = (typeof SCALES)[number];

const KEY = "lcc.ui_scale";

/** The allowed scale nearest to `v`; ties go to the smaller. */
export function clampScale(v: number | null | undefined): Scale {
  if (typeof v !== "number" || !Number.isFinite(v)) return 100;
  let best: Scale = SCALES[0];
  for (const s of SCALES) if (Math.abs(s - v) < Math.abs(best - v)) best = s;
  return best;
}

export function applyScale(v: number): Scale {
  const s = clampScale(v);
  document.documentElement.style.fontSize = `${(s / 100) * 16}px`;
  try { localStorage.setItem(KEY, String(s)); } catch { /* a locked-down profile is fine */ }
  window.dispatchEvent(new CustomEvent<Scale>("lcc:scale", { detail: s }));
  return s;
}

/** The last applied scale, from this device's cache. */
export function cachedScale(): Scale {
  try { return clampScale(Number(localStorage.getItem(KEY) ?? 100)); } catch { return 100; }
}

/** One step up or down the allowed list; stays put at either end. */
export function stepScale(current: number, dir: 1 | -1): Scale {
  const i = SCALES.indexOf(clampScale(current));
  return SCALES[Math.min(SCALES.length - 1, Math.max(0, i + dir))];
}
