/** Litigation Command Center — the dashboard, rebuilt on the Tauri command layer.
 *
 * This is `app/static/app.js` with the fetch/websocket half replaced: every
 * button calls an `invoke()` command in `src-tauri/src/lib.rs`, and the one
 * `scraper` event channel does what the websocket used to. The behaviour it
 * drives — the state labels, the pipeline, the login stage, the 2s trailing
 * table refresh, the chips, the filters, the palette — is the old file's.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api, describeError, onScraper } from "./lib/api";
import { classify } from "./lib/buckets";
import { exportWorkbook } from "./lib/exportXlsx";
import {
  buildSummary, inChip, loadLastRun, saveLastRun, stampNow,
  type ChipKey, type LastRun,
} from "./lib/summary";
import type { Draft, NoticeRow, ScraperEvent, Settings } from "./lib/types";

import DraftDrawer from "./ui/DraftDrawer";
import Header from "./ui/Header";
import { CredsGate, OtpGate } from "./ui/Gates";
import Notices from "./ui/Notices";
import Overview from "./ui/Overview";
import Palette, { type Command } from "./ui/Palette";
import Report from "./ui/Report";
import SettingsModal from "./ui/Settings";
import Toast from "./ui/Toast";
import Viewer from "./ui/Viewer";
import Watch from "./ui/Watch";
import { b64Blob, saveBlob } from "./ui/download";
import {
  DEFAULT_SPEED, SPEED_SECONDS,
  type LoginPhase, type SpeedMode, type StageCounts, type SyncStage,
} from "./ui/types";

/** A sync commits a notice at a time and says so. Refreshing on every one of
 *  them would be dozens of round trips a minute, so they collapse into at most
 *  one refresh every 2s — always with a trailing one, so the last notice of a
 *  run is never left off the table. */
const REFRESH_EVERY = 2000;

/** Theme lived in a cookie because the web tool's server might have wanted it.
 *  There is no server now, so it lives where a desktop preference belongs. */
const THEME_KEY = "llc.theme";

type ViewerState = { label: string; url: string; blob: Blob; filename: string };

export default function App() {
  /* ------------------------------------------------------------- archive */
  const [rows, setRows] = useState<NoticeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [lastRun, setLastRun] = useState<LastRun | null>(loadLastRun);

  /* --------------------------------------------------------------- run */
  // The web tool's server booted in `credentials_required`, so the login card
  // was on screen the moment the dashboard loaded. Nothing is logged in here
  // either, so the app opens the same way.
  const [state, setState] = useState("credentials_required");
  const [logLines, setLogLines] = useState<string[]>(["Ready."]);
  const [caption, setCaption] = useState("");
  const [stage, setStage] = useState<SyncStage | null>(null);
  const [counts, setCounts] = useState<StageCounts>({});
  const [loginPhase, setLoginPhase] = useState<LoginPhase | null>(null);
  const [phaseWaiting, setPhaseWaiting] = useState(false);
  const [frame, setFrame] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [monitorOpen, setMonitorOpen] = useState(false);
  const [monHint, setMonHint] = useState("idle — expands when a sync starts");
  const [loggedIn, setLoggedIn] = useState(false);

  /* ------------------------------------------------------------- header */
  const [limit, setLimit] = useState("");
  const [speed, setSpeed] = useState<SpeedMode>(DEFAULT_SPEED);
  const [theme, setTheme] = useState<"dark" | "light">(
    () => (localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark"));

  /* -------------------------------------------------------------- gates */
  const [credsShow, setCredsShow] = useState(true);
  const [credsErr, setCredsErr] = useState("");
  const [otpShow, setOtpShow] = useState(false);
  const [remember, setRemember] = useState(false);

  /* ------------------------------------------------------------ filters */
  const [ay, setAy] = useState("");
  const [nameQuery, setNameQuery] = useState("");
  const [noDue, setNoDue] = useState(false);
  const [bucket, setBucket] = useState<ChipKey | "">("");

  /* ----------------------------------------------------------- surfaces */
  const [toastMsg, setToastMsg] = useState("");
  const [viewer, setViewer] = useState<ViewerState | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftCached, setDraftCached] = useState(false);
  const [draftBusy, setDraftBusy] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [noDateStated, setNoDateStated] = useState<Record<string, string>>({});
  const [paletteShow, setPaletteShow] = useState(false);
  const [settingsShow, setSettingsShow] = useState(false);

  const nameRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshedAt = useRef(0);
  const pendingSync = useRef(false);
  const limitRef = useRef(limit);
  const speedRef = useRef(speed);
  const loggedInRef = useRef(loggedIn);
  const syncRef = useRef<() => void>(() => undefined);
  limitRef.current = limit;
  speedRef.current = speed;
  loggedInRef.current = loggedIn;

  /* --------------------------------------------------------- primitives */
  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(""), 3600);
  }, []);

  const push = useCallback((msg: string) => {
    setLogLines((l) => [...l.slice(-399), msg]);
    setCaption(msg.trim());
  }, []);

  const reload = useCallback(async () => {
    try {
      const next = await api.notices();
      setRows(next);
    } catch (e) {
      push(`Error: ${describeError(e)}`);
    } finally {
      setLoading(false);
    }
  }, [push]);

  const refreshSoon = useCallback(() => {
    if (refreshTimer.current) return;
    const wait = Math.max(0, REFRESH_EVERY - (Date.now() - refreshedAt.current));
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      refreshedAt.current = Date.now();
      void reload();
    }, wait);
  }, [reload]);

  /* ------------------------------------------------------------- effects */
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    void reload();
    api.settings().then((s) => { setSettings(s); setRemember(s.remember_password); })
      .catch(() => undefined);
    return () => { if (refreshTimer.current) clearTimeout(refreshTimer.current); };
  }, [reload]);

  // One channel from the sidecar; everything the old websocket drove.
  useEffect(() => {
    // `listen()` resolves a tick or two after this effect returns, so under
    // StrictMode the cleanup fires while `unlisten` is still undefined and the
    // first listener survives - which is why every log line arrived twice.
    let unlisten: (() => void) | undefined;
    let dropped = false;
    let phaseTimer: ReturnType<typeof setTimeout> | undefined;

    // Outside the shell (a plain `npm run dev` in a browser) there is no event
    // bridge at all; the page still renders, it just never hears a sidecar.
    const subscribe = (handler: (ev: ScraperEvent) => void) => {
      try { return onScraper(handler); } catch { return Promise.resolve(undefined); }
    };

    subscribe((ev: ScraperEvent) => {
      switch (ev.ev) {
        case "ready":
          push("Sidecar ready.");
          break;
        case "log":
          push(ev.msg);
          break;
        case "stderr":
          push(`! ${ev.msg}`);
          break;
        case "progress": {
          const { ev: _kind, kind, ...rest } = ev as { ev: string; kind: string } & StageCounts;
          setStage(kind as SyncStage);
          setCounts(rest as StageCounts);
          setMonitorOpen(true);          // a run started: show the viewport
          // Past login: the stage card steps aside for the frames that would
          // be arriving here. TODO: none do - see Watch's `frame` prop.
          setLoginPhase(null);
          setPhaseWaiting(false);
          // Progress and frames race; once frames are arriving they own the hint.
          setMonHint((h) => (h === "live" ? h : "running"));
          break;
        }
        case "login_phase":
          setStage("login");
          setMonitorOpen(true);
          setLoginPhase(ev.phase as LoginPhase);
          setPhaseWaiting(false);
          setMonHint("signing in");
          // "Logged in" is a beat, not a state: hold it briefly, then wait for
          // the first frame to replace it.
          if (ev.phase === "done") {
            clearTimeout(phaseTimer);
            phaseTimer = setTimeout(() => setPhaseWaiting(true), 600);
          }
          break;
        case "otp_required":
          setOtpShow(true);
          setState("otp_required");
          setLoginPhase("otp");
          setMonitorOpen(true);
          // No frames come while the OTP is on screen — say why, rather than
          // leaving a frozen picture under a pulsing REC light.
          setLive(false);
          setMonHint("paused - OTP on screen");
          break;
        case "login_ok":
          // The ref only catches up on the next render, and the sync queued
          // below reads it now - so say it here too, or the run aborts back
          // to the login card.
          loggedInRef.current = true;
          setLoggedIn(true);
          setOtpShow(false);
          setCredsShow(false);
          setCredsErr("");
          setState("running");
          setLoginPhase("done");
          // No log line here: session.py already writes "Logged in".
          // The pace is read fresh before every browser action, but only by a
          // sidecar that exists — so the header's choice is (re)sent here.
          api.speed(SPEED_SECONDS[speedRef.current]).catch(() => undefined);
          if (pendingSync.current) {
            pendingSync.current = false;
            syncRef.current();
          }
          break;
        case "viewport":
          // The first real frame is what turns the REC light on - never the
          // login, which is drawn by the stage card instead.
          setFrame(ev.img);
          setLive(true);
          setLoginPhase(null);
          setPhaseWaiting(false);
          setMonitorOpen(true);
          setMonHint("live");
          break;
        case "notice":
          refreshSoon();
          break;
        case "sync_done": {
          const s = (ev.stats ?? {}) as Record<string, number | undefined>;
          setState("done");
          setStage("done");
          setCounts({ notices: s.notices ?? null, downloaded: s.downloaded ?? null });
          setMonHint("run finished");
          setLive(false);          // the last frame stays up; the light goes out
          setLoginPhase(null);
          const run: LastRun = {
            finished: stampNow(), status: "done",
            notices_new: s.new_notices ?? 0,
            pdfs_saved: s.downloaded ?? 0,
            skipped_cached: s.skipped_cached ?? 0,
          };
          setLastRun(run);
          saveLastRun(run);
          void reload();
          break;
        }
        case "error": {
          push(`Error: ${ev.msg}`);
          if (ev.kind === "wrong_password" || ev.kind === "login") {
            setLoggedIn(false);
            setState("failed");
            setCredsShow(true);
            setCredsErr(ev.msg);
            setLoginPhase("failed");
            setMonHint("login failed");
            setLive(false);
            setFrame(null);
            break;
          }
          if (ev.kind === "not_logged_in") {
            setLoggedIn(false);
            setState("credentials_required");
            setCredsShow(true);
            break;
          }
          toast(ev.msg);
          setState("failed");
          if (ev.kind === "sync") {
            const run: LastRun = {
              finished: stampNow(), status: "failed", message: ev.msg,
              notices_new: 0, pdfs_saved: 0, skipped_cached: 0,
            };
            setLastRun(run);
            saveLastRun(run);
          }
          break;
        }
        case "exited":
          setLoggedIn(false);
          setLive(false);
          setFrame(null);
          setLoginPhase(null);
          setState("disconnected");
          push("Portal session ended.");
          break;
      }
    }).then((u) => { if (dropped) u?.(); else unlisten = u; });

    return () => { dropped = true; unlisten?.(); clearTimeout(phaseTimer); };
  }, [push, refreshSoon, reload, toast]);

  /* ------------------------------------------------------------- derived */
  const items = useMemo(() => classify(rows), [rows]);
  const summary = useMemo(() => buildSummary(items), [items]);
  const years = useMemo(
    () => [...new Set(rows.map((r) => r.assessment_year).filter(Boolean))].sort() as string[],
    [rows]);
  const visible = useMemo(() => {
    const needle = nameQuery.trim().toLowerCase();
    return items.filter((n) =>
      (!ay || n.assessment_year === ay)
      && (!needle || (n.proceeding_name || "").toLowerCase().includes(needle))
      && (!noDue || !n.due_date)
      && (!bucket || inChip(n, bucket)));
  }, [items, ay, nameQuery, noDue, bucket]);

  /* ------------------------------------------------------------- actions */
  const parseLimit = (): number | null => {
    const v = parseInt(limitRef.current, 10);
    return Number.isFinite(v) && v > 0 ? v : null;
  };

  const startSync = useCallback(() => {
    if (!loggedInRef.current) {
      setState("credentials_required");
      setCredsShow(true);
      return;
    }
    const lim = parseLimit();
    setState("running");
    setMonitorOpen(true);
    push(lim ? `Sync started (at most ${lim} new PDFs)` : "Sync started (all notices)");
    api.sync(lim).catch((e) => { toast(describeError(e)); setState("failed"); });
  }, [push, toast]);
  syncRef.current = startSync;

  const submitCreds = async (userId: string, password: string) => {
    if (!userId) { setCredsErr("Enter both the user ID and the password."); return; }
    let pw: string | null = password || null;
    if (!pw) {
      const saved = await api.hasSavedPassword(userId).catch(() => false);
      if (!saved) { setCredsErr("Enter both the user ID and the password."); return; }
    }
    setCredsErr("");
    setFrame(null);
    setLive(false);
    setState("running");
    setMonitorOpen(true);
    pendingSync.current = true;
    push("Login sent. The sync starts as soon as the portal lets us in");
    try {
      await api.login(userId, pw, remember);
      setCredsShow(false);       // the card goes as soon as the login is away
    } catch (e) {
      pendingSync.current = false;
      setCredsErr(describeError(e));
      setCredsShow(true);
      setState("failed");
    }
  };

  const sendOtp = async (code: string) => {
    setOtpShow(false);
    setState("running");
    setMonHint("signing in");
    try { await api.otp(code); } catch (e) { toast(describeError(e)); }
  };

  const changeSpeed = (mode: SpeedMode) => {
    setSpeed(mode);
    const seconds = SPEED_SECONDS[mode];
    api.speed(seconds)
      .then(() => toast(`Speed: ${mode} (${Math.round(seconds * 1000)}ms per action)`))
      .catch((e) => toast(describeError(e)));
  };

  const signOut = async () => {
    try { await api.stop(); } catch { /* nothing to stop is not a failure */ }
    loggedInRef.current = false;
    setLoggedIn(false);
    setFrame(null);
    setLive(false);
    setLoginPhase(null);
    setStage(null);
    setState("idle");
    setOtpShow(false);
    setCredsShow(true);
    setMonHint("idle — expands when a sync starts");
    push("Logged out of the portal.");
  };

  const openViewer = (label: string, blob: Blob, filename: string) => {
    setViewer((old) => {
      if (old) URL.revokeObjectURL(old.url);
      return { label, url: URL.createObjectURL(blob), blob, filename };
    });
  };

  const closeViewer = () => {
    setViewer((old) => { if (old) URL.revokeObjectURL(old.url); return null; });
  };

  const mark = (refId: string, action: string | null) =>
    setBusy((b) => {
      const next = { ...b };
      if (action) next[refId] = action; else delete next[refId];
      return next;
    });

  const viewPdf = async (refId: string) => {
    try {
      openViewer(refId, b64Blob(await api.pdf(refId), "application/pdf"), `${refId}.pdf`);
    } catch (e) { toast(describeError(e)); }
  };

  const savePdf = async (refId: string) => {
    try {
      saveBlob(b64Blob(await api.pdf(refId), "application/pdf"), `${refId}.pdf`);
    } catch (e) { toast(describeError(e)); }
  };

  const askClaude = async (refId: string) => {
    mark(refId, "date");
    try {
      const answer = await api.askDueDate(refId);
      if (answer.due_date) {
        // A suggestion, shown as one. The stated column stays empty.
        setRows((all) => all.map((r) => r.ref_id === refId
          ? { ...r, suggested_due_date: answer.due_date, due_date_basis: answer.basis }
          : r));
        toast(`Suggested ${answer.due_date}${answer.basis ? " — " + answer.basis : ""}`);
      } else {
        // Plenty of letters genuinely set no deadline: say so quietly.
        setNoDateStated((m) => ({
          ...m, [refId]: answer.basis || "Claude found no deadline in this notice",
        }));
      }
    } catch (e) { toast(describeError(e)); }
    finally { mark(refId, null); }
  };

  const generateDraft = async (refId: string, regenerate = false) => {
    const had = rows.find((r) => r.ref_id === refId)?.has_draft ?? false;
    mark(refId, "draft");
    setDraftBusy(true);
    try {
      const d = await api.draftResponse(refId, regenerate);
      setDraft(d);
      setDraftCached(had && !regenerate);
      setDraftSavedAt(null);
      // the row's draft tick, without a refetch
      if (!had) setRows((all) => all.map((r) => r.ref_id === refId ? { ...r, has_draft: true } : r));
    } catch (e) { toast(describeError(e)); }
    finally { mark(refId, null); setDraftBusy(false); }
  };

  const openStoredDraft = async (refId: string) => {
    try {
      const d = await api.draft(refId);
      if (d) { setDraft(d); setDraftCached(true); setDraftSavedAt(null); }
      else await generateDraft(refId);
    } catch (e) { toast(describeError(e)); }
  };

  const saveDraftText = async (text: string) => {
    if (!draft) return;
    setDraftBusy(true);
    try {
      await api.saveDraftText(draft.ref_id, text);
      setDraft({ ...draft, draft_text: text });
      setDraftSavedAt(stampNow());
      toast("Edits saved.");
    } catch (e) { toast(describeError(e)); }
    finally { setDraftBusy(false); }
  };

  const copyDraft = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast("Draft copied."); }
    catch { toast("Press Ctrl+C to copy."); }
  };

  const exportXlsx = () => {
    try { exportWorkbook(items); } catch (e) { toast(describeError(e)); }
  };

  const saveSettings = async (s: Settings) => {
    try { await api.saveSettings(s); setSettings(s); setSettingsShow(false); toast("Settings saved."); }
    catch (e) { toast(describeError(e)); }
  };

  const clearFilters = () => { setAy(""); setNameQuery(""); setNoDue(false); setBucket(""); };

  /* ------------------------------------------------------------- palette */
  const commands = useMemo<Command[]>(() => {
    const base: Command[] = [
      { label: "Run sync", hint: "s", run: startSync },
      { label: "Toggle theme", run: () => setTheme((t) => (t === "dark" ? "light" : "dark")) },
      { label: "Speed: slow", run: () => changeSpeed("slow") },
      { label: "Speed: fast", run: () => changeSpeed("fast") },
      { label: "Speed: extreme (testing only)", run: () => changeSpeed("extreme") },
      { label: "Filter: missing due date", run: () => setNoDue(true) },
      { label: "Clear filters", run: clearFilters },
      { label: "Export summary to Excel", run: exportXlsx },
      { label: "Toggle live viewport", run: () => setMonitorOpen((o) => !o) },
      { label: "Settings: proxy URL and firm token", run: () => setSettingsShow(true) },
      { label: "Log out of the portal", run: () => { void signOut(); } },
    ];
    const notices: Command[] = rows.filter((n) => n.has_pdf).map((n) => ({
      label: `Open notice ${n.ref_id}`,
      hint: (n.description || n.proceeding_name || "").slice(0, 40),
      haystack: `${n.ref_id} ${n.description || ""} ${n.proceeding_name || ""}`,
      run: () => { void viewPdf(n.ref_id); },
    }));
    const drafts: Command[] = rows.filter((n) => n.has_draft).map((n) => ({
      label: `Open draft ${n.ref_id}`,
      hint: (n.description || n.proceeding_name || "").slice(0, 40),
      haystack: `draft ${n.ref_id} ${n.description || ""} ${n.proceeding_name || ""}`,
      run: () => { void openStoredDraft(n.ref_id); },
    }));
    return [...base, ...notices, ...drafts];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, startSync]);

  /* ------------------------------------------------------------ keyboard */
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const el = document.activeElement;
      const typing = !!el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "k") {
        ev.preventDefault(); setPaletteShow(true); return;
      }
      if (ev.key === "Escape") {
        setPaletteShow(false); closeViewer(); setDraft(null); setSettingsShow(false); return;
      }
      if (typing) return;
      if (ev.key === "s") { ev.preventDefault(); startSync(); }
      if (ev.key === "/") { ev.preventDefault(); nameRef.current?.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [startSync]);

  /* ---------------------------------------------------------------- view */
  return (
    <>
      <Header
        state={state} limit={limit} onLimit={setLimit}
        speed={speed} onSpeed={changeSpeed}
        theme={theme} onTheme={() => setTheme(theme === "dark" ? "light" : "dark")}
        onPalette={() => setPaletteShow(true)}
        onSignOut={() => { void signOut(); }}
        onExport={exportXlsx} onSync={startSync} />

      <main>
        <CredsGate show={credsShow} error={credsErr} userId={settings?.last_user_id ?? ""}
                   remember={remember} onRemember={setRemember}
                   onSubmit={(u, pw) => { void submitCreds(u, pw); }} />
        <OtpGate show={otpShow} onSend={(c) => { void sendOtp(c); }}
                 onBadCode={() => toast("Enter the numeric OTP first.")} />

        <Overview rows={rows} loading={loading} run={lastRun} />

        <Watch open={monitorOpen} onOpen={setMonitorOpen} hint={monHint}
               loginPhase={loginPhase} phaseWaiting={phaseWaiting} frame={frame} live={live}
               stage={stage} counts={counts} caption={caption} log={logLines} />

        <Report summary={summary} run={lastRun} bucket={bucket} onBucket={setBucket} />

        <Notices
          rows={rows} visible={visible} loading={loading} years={years}
          ay={ay} onAy={setAy} name={nameQuery} onName={setNameQuery}
          noDue={noDue} onNoDue={setNoDue} nameRef={nameRef}
          busy={busy} noDateStated={noDateStated}
          onView={(r) => { void viewPdf(r); }}
          onSave={(r) => { void savePdf(r); }}
          onAskClaude={(r) => { void askClaude(r); }}
          onDraft={(r) => { void generateDraft(r); }}
          onFirstSync={startSync} />
      </main>

      <Viewer show={!!viewer} label={viewer?.label ?? ""} src={viewer?.url ?? ""}
              onSave={() => { if (viewer) saveBlob(viewer.blob, viewer.filename); }}
              onClose={closeViewer} />

      <DraftDrawer
        draft={draft} cached={draftCached} busy={draftBusy} savedAt={draftSavedAt}
        onClose={() => setDraft(null)}
        onSave={(t) => { void saveDraftText(t); }}
        onView={(t) => {
          if (!draft) return;
          // TODO: the web tool rendered a draft PDF server-side
          // (`app/response_pdf.py`). Nothing in the desktop core does, so the
          // text itself is what opens.
          openViewer(`draft ${draft.ref_id}`, new Blob([t], { type: "text/plain" }),
                     `${draft.ref_id}-draft.txt`);
        }}
        onDownload={(t) => {
          if (draft) saveBlob(new Blob([t], { type: "text/plain" }), `${draft.ref_id}-draft.txt`);
        }}
        onCopy={(t) => { void copyDraft(t); }}
        onRegenerate={() => { if (draft) void generateDraft(draft.ref_id, true); }} />

      <Palette show={paletteShow} commands={commands} onClose={() => setPaletteShow(false)} />
      <SettingsModal show={settingsShow} settings={settings}
                     onSave={(s) => { void saveSettings(s); }}
                     onClose={() => setSettingsShow(false)} />
      <Toast message={toastMsg} />
    </>
  );
}
