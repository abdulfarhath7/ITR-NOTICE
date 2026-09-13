/** The Sync button's three states (docs/09): up to date, N behind, cannot
 *  reach the relay. Collector health is shown beside it, never folded in. */
import { useEffect } from "react";
import { useSyncNow, useSyncState } from "../hooks/use-sync";
import { api } from "../lib/api";
import { plural } from "../lib/labels";
import { invalidate, useQuery } from "../lib/query";
import { href } from "../lib/router";
import type { IngestionState } from "../lib/types";
import { stamp } from "./dates";
import Icon from "./icons";

export default function SyncButton() {
  const q = useSyncState();
  const sync = useSyncNow();
  const s = q.data;
  if (!s || !s.configured) return null;
  const label = sync.busy ? "Syncing"
    : s.status === "unreachable" ? "Cannot reach relay"
    : s.status === "behind" ? `${plural(s.behind_total, "change")} behind`
    : "Up to date";
  const tone = s.status === "unreachable" ? "danger" : s.status === "behind" ? "" : "quiet";
  return (
    <div className="nav-sync">
      <button className={`btn ${tone}`} disabled={sync.busy} onClick={() => { void sync.run(); }}
              title={`last sync ${stamp(s.last_sync_at)}${s.unpublished ? ` · ${plural(s.unpublished, "local change")} to send` : ""}`}>
        <Icon name="refresh" className={sync.busy ? "spin" : undefined} />
        <span>{label}</span>
      </button>
      {s.collector_silent
        ? <a className="nav-fact warning" href={href({ name: "devices" })} title="the collector has missed a scheduled run">
            <Icon name="alert" /><span>Collector silent</span>
          </a>
        : <span className="nav-fact"><Icon name="clock" /><span>Collector {stamp(s.collector_last_seen)}</span></span>}
    </div>
  );
}

/** The run's state, wherever you are: paused for a person, or running. */
export function RunIndicator() {
  const q = useQuery<IngestionState>("ingestion:indicator", () => api.ingestionState());
  useEffect(() => {
    const t = setInterval(() => invalidate("ingestion:indicator"), 5000);
    return () => clearInterval(t);
  }, []);
  const s = q.data;
  if (!s?.running) return null;
  return s.awaiting_operator
    ? <a className="btn danger" href={href({ name: "ingestion" })}><Icon name="alert" /><span>Run waiting for you</span></a>
    : <a className="btn quiet" href={href({ name: "ingestion" })}><Icon name="download" /><span>{s.paused ? "Run paused" : "Sweep running"}</span></a>;
}
