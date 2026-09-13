/** Display labels that more than one screen needs, defined once. Sentence
 *  case throughout (docs/09 copy rules). */
import type { Cadence, Module } from "./types";

export const MODULES: Module[] = ["proceedings", "demands", "returns", "forms"];

/** The module's full name, as on the portal's own menu. */
export const MODULE_LABEL: Record<Module, string> = {
  proceedings: "e-Proceedings",
  demands: "Outstanding demands",
  returns: "e-Returns filed",
  forms: "e-Forms filed",
};

/** One item of the module, for chips and row subtitles. */
export const MODULE_NOUN: Record<Module, string> = {
  proceedings: "Proceeding",
  demands: "Demand",
  returns: "Return",
  forms: "Form",
};

export function isModule(value: string): value is Module {
  return (MODULES as string[]).includes(value);
}

/** The six e-Proceedings panels (docs/05). */
export const PANEL_LABEL: Record<string, string> = {
  "self:action": "Self · for your action",
  "self:information": "Self · for your information",
  "other_pan:action": "Other PAN/TAN · for your action",
  "other_pan:information": "Other PAN/TAN · for your information",
  "auth_rep:action": "As AR · for your action",
  "auth_rep:information": "As AR · for your information",
};

export function panelLabel(panel: string | null | undefined): string {
  return panel ? (PANEL_LABEL[panel] ?? panel) : "—";
}

export const CADENCE_LABEL: Record<Cadence, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  manual: "Manual only",
};

export type Tone = "" | "danger" | "warning" | "success" | "accent" | "normal";

export const JOB_STATUS: Record<string, { label: string; tone: Tone }> = {
  queued: { label: "Queued", tone: "" },
  running: { label: "Running", tone: "accent" },
  awaiting_operator: { label: "Waiting for you", tone: "warning" },
  done: { label: "Done", tone: "success" },
  incomplete: { label: "Incomplete", tone: "warning" },
  failed: { label: "Failed", tone: "danger" },
  parked: { label: "Credentials need attention", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "" },
};

export function runTone(status: string): Tone {
  if (status === "ok") return "success";
  if (status === "failed" || status === "credentials_parked") return "danger";
  return "warning";
}

/** `1 day` / `3 days`, and so on — for the few places that count. */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;
}
