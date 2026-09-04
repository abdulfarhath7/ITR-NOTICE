/** The one websocket client (docs/03-api-contract.md).
 *
 * The sidecar only ever pushes; nothing is sent up the socket. Message shapes
 * are exactly what app/main.py's EventHub broadcasts.
 */
import type { SpeedMode, SyncState } from "@/lib/api";
import { wsUrl } from "@/lib/runtime";

/** The five phases the login reports before any frame is safe to send. */
export type LoginPhase = "opening" | "credentials" | "force_login" | "otp" | "done" | "failed";

/** The pipeline stages the stepper draws. */
export type SyncStage = "login" | "list" | "walk" | "download" | "done";

export type StageCounts = Record<string, string | number | boolean | null>;

export type HubMessage =
  | { type: "log"; msg: string }
  | { type: "state"; state: SyncState }
  | { type: "credentials_required"; error: string | null }
  | { type: "otp_required" }
  | { type: "progress"; stage: SyncStage | string; counts: StageCounts }
  | { type: "notice_added"; ref_id: string }
  | { type: "speed"; mode: SpeedMode; delay_ms: number }
  | { type: "login_phase"; phase: LoginPhase }
  | { type: "viewport"; img: string }
  | { type: "sync_finished"; status: string };

export type ConnectionState = "connecting" | "open" | "closed";

type Listener = (message: HubMessage) => void;
type StatusListener = (state: ConnectionState) => void;

const RECONNECT_MS = [500, 1000, 2000, 4000, 8000] as const;

/** A single long-lived socket, shared by every screen. It reconnects on its
 *  own, because the sidecar restarts faster than a person can notice. */
class HubClient {
  private socket: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private statusListeners = new Set<StatusListener>();
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private status: ConnectionState = "closed";

  async start(): Promise<void> {
    this.stopped = false;
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) return;
    this.setStatus("connecting");
    let url: string;
    try {
      url = await wsUrl();
    } catch {
      this.retry();
      return;
    }
    if (this.stopped) return;

    const socket = new WebSocket(url);
    this.socket = socket;

    socket.onopen = () => {
      this.attempt = 0;
      this.setStatus("open");
    };
    socket.onmessage = (event: MessageEvent<string>) => {
      let parsed: HubMessage;
      try {
        parsed = JSON.parse(event.data) as HubMessage;
      } catch {
        return; // a malformed frame is not worth tearing the socket down for
      }
      for (const listener of this.listeners) listener(parsed);
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      this.socket = null;
      this.setStatus("closed");
      this.retry();
    };
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.socket?.close();
    this.socket = null;
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  private setStatus(next: ConnectionState): void {
    this.status = next;
    for (const listener of this.statusListeners) listener(next);
  }

  private retry(): void {
    if (this.stopped || this.timer) return;
    const wait = RECONNECT_MS[Math.min(this.attempt, RECONNECT_MS.length - 1)] ?? 8000;
    this.attempt += 1;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.start();
    }, wait);
  }
}

export const hub = new HubClient();
