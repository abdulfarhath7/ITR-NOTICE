/** Live sync state, in one place.
 *
 * Every screen reads the same store: the header's dot, the pipeline stepper,
 * the viewport, the log, the OTP freeze and the credential gate are all
 * projections of the messages app/main.py's EventHub pushes.
 */
import type { SpeedMode, SyncState } from "@/lib/api";
import type { ConnectionState, HubMessage, LoginPhase, StageCounts, SyncStage } from "@/lib/ws";
import { hub } from "@/lib/ws";

export type HubState = {
  connection: ConnectionState;
  /** The sidecar's own state, or "disconnected" when the socket is down. */
  state: SyncState | "disconnected";
  logLines: string[];
  /** The last log line, shown under the viewport as a caption. */
  caption: string;
  stage: SyncStage | string | null;
  counts: StageCounts;
  loginPhase: LoginPhase | null;
  /** base64 JPEG of the live browser, or null when no frame has arrived. */
  frame: string | null;
  speed: SpeedMode;
  delayMs: number;
  otpRequired: boolean;
  credentialsRequired: boolean;
  credentialsError: string | null;
  /** Bumped when a notice is committed, so the table can refetch, throttled. */
  noticeRevision: number;
  /** Bumped when a run ends, whatever the outcome. */
  finishedRevision: number;
  lastFinishStatus: string | null;
};

const LOG_LIMIT = 500;

const initial: HubState = {
  connection: "closed",
  state: "idle",
  logLines: ["Ready."],
  caption: "",
  stage: null,
  counts: {},
  loginPhase: null,
  frame: null,
  speed: "fast",
  delayMs: 250,
  otpRequired: false,
  credentialsRequired: false,
  credentialsError: null,
  noticeRevision: 0,
  finishedRevision: 0,
  lastFinishStatus: null,
};

let current: HubState = initial;
const subscribers = new Set<() => void>();

function set(patch: Partial<HubState>): void {
  current = { ...current, ...patch };
  for (const notify of subscribers) notify();
}

function appendLog(line: string): string[] {
  const next = current.logLines.concat(line);
  return next.length > LOG_LIMIT ? next.slice(next.length - LOG_LIMIT) : next;
}

function apply(message: HubMessage): void {
  switch (message.type) {
    case "log":
      set({ logLines: appendLog(message.msg), caption: message.msg.trim() });
      return;
    case "state":
      set({
        state: message.state,
        credentialsRequired: message.state === "credentials_required",
        otpRequired: message.state === "otp_required",
      });
      return;
    case "credentials_required":
      set({
        state: "credentials_required",
        credentialsRequired: true,
        credentialsError: message.error ?? null,
        loginPhase: current.loginPhase && current.loginPhase !== "done" ? "failed" : current.loginPhase,
      });
      return;
    case "otp_required":
      // No frame is sent while an OTP is on screen; the viewport says why
      // rather than leaving a frozen picture under a pulsing REC light.
      set({ state: "otp_required", otpRequired: true });
      return;
    case "progress":
      set({ stage: message.stage, counts: message.counts ?? {} });
      return;
    case "notice_added":
      set({ noticeRevision: current.noticeRevision + 1 });
      return;
    case "speed":
      set({ speed: message.mode, delayMs: message.delay_ms });
      return;
    case "login_phase":
      set({ loginPhase: message.phase, frame: null });
      return;
    case "viewport":
      // The first real frame is what ends the login stage.
      set({ frame: message.img, loginPhase: null });
      return;
    case "sync_finished":
      set({
        state: message.status === "done" ? "idle" : "failed",
        stage: message.status === "done" ? "done" : current.stage,
        loginPhase: current.loginPhase && message.status !== "done" ? "failed" : null,
        frame: null,
        lastFinishStatus: message.status,
        finishedRevision: current.finishedRevision + 1,
        otpRequired: false,
      });
      return;
    default:
      return;
  }
}

let started = false;

/** Called once by the app shell. Safe to call twice. */
export function startHub(): void {
  if (started) return;
  started = true;
  hub.on(apply);
  hub.onStatus((connection) => {
    // Coming back from a drop means every push in between was missed, so the
    // table and the report are told to re-read rather than sit on stale rows
    // under a green light.
    const reconnected = connection === "open" && current.connection === "closed";
    set({
      connection,
      state: connection === "closed" ? "disconnected" : current.state,
      finishedRevision: reconnected ? current.finishedRevision + 1 : current.finishedRevision,
    });
  });
  void hub.start();
}

export function subscribeHub(notify: () => void): () => void {
  subscribers.add(notify);
  return () => subscribers.delete(notify);
}

export function hubSnapshot(): HubState {
  return current;
}

/* -- local echoes ---------------------------------------------------------
   A few actions are known to have succeeded before the server pushes the
   matching message; reflecting them at once keeps the UI from lagging a
   round trip behind the click. */

export function clearOtpGate(): void {
  set({ otpRequired: false, state: "running" });
}

export function clearCredentialsGate(): void {
  set({ credentialsRequired: false, credentialsError: null, state: "running" });
}

export function openCredentialsGate(error: string | null = null): void {
  set({ credentialsRequired: true, credentialsError: error, state: "credentials_required" });
}

export function markRunning(): void {
  set({ state: "running", stage: current.stage ?? "login" });
}

export function setSpeedLocal(mode: SpeedMode, delayMs: number): void {
  set({ speed: mode, delayMs });
}

export function pushLog(line: string): void {
  set({ logLines: appendLog(line), caption: line });
}
