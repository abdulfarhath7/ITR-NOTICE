/** Ctrl+K / ⌘K: jump to a screen, a client, or an action from anywhere.
 *  Clients are matched on name, code and masked PAN; nothing here reaches
 *  the portal. */
import { useEffect, useMemo, useRef, useState } from "react";
import { useClients } from "../hooks/use-clients";
import { useSyncNow, useSyncState } from "../hooks/use-sync";
import { navigate, type Route } from "../lib/router";
import Icon, { type IconName } from "./icons";

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: IconName;
  group: "Go to" | "Clients" | "Actions";
  run: () => void;
}

const SCREENS: { route: Route; label: string; icon: IconName }[] = [
  { route: { name: "attention" }, label: "Attention", icon: "inbox" },
  { route: { name: "clients" }, label: "Clients", icon: "users" },
  { route: { name: "ingestion" }, label: "Ingestion", icon: "download" },
  { route: { name: "devices" }, label: "Devices", icon: "monitor" },
  { route: { name: "settings" }, label: "Settings", icon: "sliders" },
];

function matches(text: string, q: string): boolean {
  return text.toLowerCase().includes(q);
}

export function useCommandPalette(): { open: boolean; setOpen: (v: boolean) => void } {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((v) => !v); }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);
  return { open, setOpen };
}

export default function CommandPalette({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const clients = useClients("");
  const sync = useSyncState();
  const syncNow = useSyncNow();

  const commands = useMemo<Command[]>(() => {
    const go = (route: Route) => () => { navigate(route); onClose(); };
    const list: Command[] = SCREENS.map((s) => ({ id: `go:${s.label}`, label: s.label, icon: s.icon, group: "Go to", run: go(s.route) }));
    for (const c of clients.data ?? []) {
      list.push({
        id: `client:${c.id}`, label: c.name, group: "Clients", icon: "users",
        hint: [c.client_code, c.pan_masked].filter(Boolean).join(" · "),
        run: go({ name: "client", id: c.id }),
      });
    }
    list.push({ id: "act:sweep", label: "Start a sweep", group: "Actions", icon: "refresh", run: go({ name: "ingestion" }) });
    if (sync.data?.configured) {
      list.push({ id: "act:sync", label: "Sync now", group: "Actions", icon: "refresh", hint: "push and pull through the relay",
                  run: () => { void syncNow.run(); onClose(); } });
    }
    list.push({ id: "act:add", label: "Add a client", group: "Actions", icon: "plus", run: () => { navigate({ name: "clients" }); onClose(); } });
    return list;
  }, [clients.data, sync.data?.configured, syncNow, onClose]);

  const query = q.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!query) return commands.filter((c) => c.group !== "Clients").concat(commands.filter((c) => c.group === "Clients").slice(0, 6));
    return commands.filter((c) => matches(c.label, query) || (c.hint ? matches(c.hint, query) : false)).slice(0, 40);
  }, [commands, query]);

  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => { setActive(0); }, [query]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(visible.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); visible[active]?.run(); }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  };

  let lastGroup: Command["group"] | null = null;
  return (
    <div className="overlay top" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={onKey}>
        <div className="palette-input">
          <Icon name="search" size={20} className="faint" />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Go to a screen, find a client, run an action"
                 aria-label="Search" aria-activedescendant={visible[active] ? `cmd-${visible[active].id}` : undefined} />
          <kbd>Esc</kbd>
        </div>
        <div className="palette-list" role="listbox">
          {visible.length ? visible.map((c, i) => {
            const head = c.group !== lastGroup ? <div className="palette-group" key={`g:${c.group}`}>{c.group}</div> : null;
            lastGroup = c.group;
            return (
              <div key={c.id}>
                {head}
                <div id={`cmd-${c.id}`} role="option" aria-selected={i === active}
                     className={`palette-item${i === active ? " active" : ""}`}
                     onMouseEnter={() => setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={c.run}>
                  <Icon name={c.icon} className="faint" />
                  <span className="label">{c.label}</span>
                  {c.hint ? <span className="hint mono">{c.hint}</span> : null}
                </div>
              </div>
            );
          }) : <div className="palette-empty">No screen, client or action matches that.</div>}
        </div>
      </div>
    </div>
  );
}
