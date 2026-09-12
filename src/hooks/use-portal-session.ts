/** The single-account portal run (the pre-build flow), until the
 *  ingestion service replaces it in Phase 4. One hook owns the sidecar
 *  event stream; the screen only renders. */
import { useCallback, useEffect, useRef, useState } from "react";
import { api, describeError, onScraper } from "../lib/api";
import { invalidate } from "../lib/query";
import { toastError } from "../lib/toast";
import type { ScraperEvent } from "../lib/types";

export type SessionState = "credentials_required" | "otp_required" | "running" | "done" | "failed" | "disconnected";

export interface Progress { kind: string; [k: string]: unknown }

export interface PortalSession {
  state: SessionState;
  loggedIn: boolean;
  error: string;
  log: string[];
  frame: string | null;
  progress: Progress | null;
  loginPhase: string | null;
  login: (userId: string, password: string | null, remember: boolean) => Promise<void>;
  otp: (code: string) => Promise<void>;
  sync: (limit: number | null) => Promise<void>;
  speed: (seconds: number) => Promise<void>;
  stop: () => Promise<void>;
}

const REFRESH_EVERY = 2000;

export function usePortalSession(): PortalSession {
  const [state, setState] = useState<SessionState>("credentials_required");
  const [loggedIn, setLoggedIn] = useState(false);
  const [error, setError] = useState("");
  const [log, setLog] = useState<string[]>(["Ready."]);
  const [frame, setFrame] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [loginPhase, setLoginPhase] = useState<string | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const push = useCallback((line: string) => setLog((l) => [...l.slice(-399), line]), []);

  // A sync commits a notice at a time; refreshes collapse to one every 2s
  // with a trailing one so the last notice is never left off a list.
  const refreshSoon = useCallback(() => {
    if (refreshTimer.current) return;
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      invalidate("work_items");
      invalidate("clients");
      invalidate("proceedings");
    }, REFRESH_EVERY);
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let dropped = false;
    const handler = (ev: ScraperEvent) => {
      switch (ev.ev) {
        case "ready": push("Sidecar ready."); break;
        case "log": push(ev.msg); break;
        case "stderr": push(`! ${ev.msg}`); break;
        case "progress": { const { ev: _e, ...rest } = ev; setProgress(rest as Progress); setLoginPhase(null); break; }
        case "login_phase": setLoginPhase(ev.phase); break;
        case "otp_required": setState("otp_required"); setLoginPhase("otp"); setFrame(null); break;
        case "login_ok": setLoggedIn(true); setError(""); setState("running"); setLoginPhase("done"); break;
        case "viewport": setFrame(ev.img); setLoginPhase(null); break;
        case "notice": refreshSoon(); break;
        case "sync_done": setState("done"); setProgress({ kind: "done", ...(ev.stats ?? {}) }); refreshSoon(); break;
        case "error":
          push(`Error: ${ev.msg}`);
          if (ev.kind === "wrong_password" || ev.kind === "login") {
            setLoggedIn(false); setState("failed"); setError(ev.msg); setLoginPhase("failed"); setFrame(null);
          } else if (ev.kind === "not_logged_in") {
            setLoggedIn(false); setState("credentials_required");
          } else {
            toastError(ev.msg); setState("failed");
          }
          break;
        case "exited":
          setLoggedIn(false); setFrame(null); setLoginPhase(null); setState("disconnected"); push("Portal session ended.");
          break;
      }
    };
    // Outside the shell (plain `npm run dev`) there is no event bridge.
    let p: Promise<(() => void) | undefined>;
    try { p = onScraper(handler); } catch { p = Promise.resolve(undefined); }
    p.then((u) => { if (dropped) u?.(); else unlisten = u; });
    return () => { dropped = true; unlisten?.(); if (refreshTimer.current) clearTimeout(refreshTimer.current); };
  }, [push, refreshSoon]);

  const login = useCallback(async (userId: string, password: string | null, remember: boolean) => {
    setError(""); setState("running"); setLoginPhase("opening");
    try { await api.login(userId, password, remember); }
    catch (e) { setError(describeError(e)); setState("failed"); }
  }, []);
  const otp = useCallback(async (code: string) => {
    try { await api.otp(code); setState("running"); }
    catch (e) { toastError(describeError(e)); }
  }, []);
  const sync = useCallback(async (limit: number | null) => {
    try { setState("running"); await api.sync(limit); }
    catch (e) { toastError(describeError(e)); setState("failed"); }
  }, []);
  const speed = useCallback(async (seconds: number) => { await api.speed(seconds).catch(() => undefined); }, []);
  const stop = useCallback(async () => {
    try { await api.stop(); } catch { /* nothing to stop is not a failure */ }
    setLoggedIn(false); setState("credentials_required"); setFrame(null); setProgress(null);
  }, []);

  return { state, loggedIn, error, log, frame, progress, loginPhase, login, otp, sync, speed, stop };
}
