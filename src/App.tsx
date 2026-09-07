import { useCallback, useEffect, useMemo, useState } from "react";
import Drawer from "./components/Drawer";
import { ConnectModal, SettingsModal } from "./components/Modals";
import NoticeList from "./components/NoticeList";
import Rail, { type Connection, type Filter } from "./components/Rail";
import { api, onScraper } from "./lib/api";
import { classify, counts } from "./lib/buckets";
import { exportWorkbook } from "./lib/exportXlsx";
import type { NoticeRow, ScraperEvent, Settings } from "./lib/types";

export default function App() {
  const [rows, setRows] = useState<NoticeRow[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [filter, setFilter] = useState<Filter>("to_respond");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const [connection, setConnection] = useState<Connection>("offline");
  const [connectOpen, setConnectOpen] = useState(false);
  const [phase, setPhase] = useState<"idle" | "connecting" | "otp" | "done">("idle");
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);

  const reload = useCallback(() => { api.notices().then(setRows).catch((e) => setError(String(e))); }, []);

  useEffect(() => {
    reload();
    api.settings().then(setSettings).catch(() => undefined);
  }, [reload]);

  // One channel from the sidecar; the app reacts to the few events that change state.
  useEffect(() => {
    const push = (m: string) => setLog((l) => [...l.slice(-199), m]);
    let unlisten: (() => void) | undefined;
    onScraper((ev: ScraperEvent) => {
      switch (ev.ev) {
        case "log": push(ev.msg); break;
        case "stderr": push(`! ${ev.msg}`); break;
        case "progress": push(`… ${ev.kind}${"tab" in ev ? ` ${ev.tab}` : ""}`); break;
        case "login_phase": if (ev.phase === "done") setPhase("done"); break;
        case "otp_required": setPhase("otp"); break;
        case "login_ok":
          setPhase("done"); setConnection("ready"); setConnectOpen(false); setError("");
          push("Logged in. Fetch notices when ready.");
          break;
        case "notice": reload(); break;
        case "sync_done": setConnection("ready"); reload(); push("Fetch finished."); break;
        case "error":
          setError(ev.msg);
          if (ev.kind === "wrong_password" || ev.kind === "login") { setPhase("idle"); setConnection("offline"); }
          if (ev.kind === "sync") setConnection("ready");
          push(`Error: ${ev.msg}`);
          break;
        case "exited": setConnection("offline"); setPhase("idle"); push("Portal session ended."); break;
      }
    }).then((u) => { unlisten = u; });
    return () => unlisten?.();
  }, [reload]);

  const items = useMemo(() => classify(rows), [rows]);
  const c = useMemo(() => counts(items), [items]);
  const current = items.find((i) => i.ref_id === selected) ?? null;

  const login = async (userId: string, password: string | null, remember: boolean) => {
    setError(""); setLog([]); setPhase("connecting"); setConnection("connecting");
    try { await api.login(userId, password, remember); }
    catch (e) { setError(String(e)); setPhase("idle"); setConnection("offline"); }
  };

  const otp = async (code: string) => {
    setPhase("connecting");
    try { await api.otp(code); } catch (e) { setError(String(e)); }
  };

  const sync = async () => {
    setConnection("syncing"); setError("");
    try { await api.sync(null); } catch (e) { setError(String(e)); setConnection("ready"); }
  };

  const saveSettings = async (s: Settings) => {
    try { await api.saveSettings(s); setSettings(s); setSettingsOpen(false); }
    catch (e) { setError(String(e)); }
  };

  return (
    <div className="shell">
      <Rail counts={c} total={items.length} filter={filter} onFilter={setFilter}
            connection={connection} userId={settings?.last_user_id ?? ""}
            onConnect={() => setConnectOpen(true)} onSync={sync}
            onExport={() => exportWorkbook(items)} onSettings={() => setSettingsOpen(true)} />

      <NoticeList items={items} filter={filter} query={query} onQuery={setQuery}
                  selected={selected} onSelect={setSelected} />

      <Drawer item={current} onClose={() => setSelected(null)} onChanged={reload} />

      <ConnectModal open={connectOpen} phase={phase} initialUserId={settings?.last_user_id ?? ""}
                    log={log} error={error} onLogin={login} onOtp={otp}
                    onClose={() => { setConnectOpen(false); if (phase !== "done") { api.stop(); setPhase("idle"); setConnection("offline"); } }} />

      <SettingsModal open={settingsOpen} settings={settings} onSave={saveSettings} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
