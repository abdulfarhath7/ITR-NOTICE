/** The Sync button's three states (docs/09): up to date, N behind, cannot
 *  reach the relay. Collector health is shown beside it, never folded in. */
import { useSyncNow, useSyncState } from "../hooks/use-sync";
import { stamp } from "./dates";

export default function SyncButton() {
  const q = useSyncState();
  const sync = useSyncNow();
  const s = q.data;
  if (!s || !s.configured) return null;
  const label = sync.busy ? "Syncing"
    : s.status === "unreachable" ? "Cannot reach relay"
    : s.status === "behind" ? `${s.behind_total.toLocaleString("en-IN")} change${s.behind_total === 1 ? "" : "s"} behind`
    : "Up to date";
  const cls = s.status === "unreachable" ? "btn danger" : s.status === "behind" ? "btn" : "btn quiet";
  return (
    <span className="row">
      <button className={cls} disabled={sync.busy} onClick={() => { void sync.run(); }}
              title={`last sync ${stamp(s.last_sync_at)}${s.unpublished ? ` · ${s.unpublished} local change(s) to send` : ""}`}>
        Sync · {label}
      </button>
      {s.collector_silent
        ? <span className="pill warning" title="the collector has missed a scheduled run">Collector silent</span>
        : <span className="meta">Collector reported {stamp(s.collector_last_seen)}</span>}
    </span>
  );
}
