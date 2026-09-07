/** Types the ported screens share. Nothing here talks to Tauri. */

/** The pace knob, with the web tool's own delays (`app/main.py` MODES).
 *  Seconds, because `portal_speed` takes seconds and the sidecar reads the
 *  value fresh before every browser action - so a click lands mid-sync. */
export type SpeedMode = "slow" | "fast" | "extreme";

export const SPEED_SECONDS: Record<SpeedMode, number> = {
  slow: 1.0, fast: 0.25, extreme: 0.0,
};

export const DEFAULT_SPEED: SpeedMode = "fast";

/** The five phases the portal login reports (`sidecar/app/portal/session.py`),
 *  plus the one the UI invents when it goes wrong. */
export type LoginPhase = "opening" | "credentials" | "force_login" | "otp" | "done" | "failed";

/** The pipeline stages the stepper draws. */
export type SyncStage = "login" | "list" | "walk" | "download" | "done";

export type StageCounts = Record<string, string | number | boolean | null | undefined>;
