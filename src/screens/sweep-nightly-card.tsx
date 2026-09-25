/** The left card of the Sweep screen (docs/18 §7): where the overnight
 *  role sits, the window, the last run's five stat rows, Run now and the
 *  run-log export. Numbers come from the last sweep summary (docs/17 §2.8,
 *  extended with `indexed` and `ao_viewed_flips`). */
import { useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { api, describeError } from "../lib/api";
import { plural } from "../lib/labels";
import { href } from "../lib/router";
import { estimateLabel, lastSweepShort, nextRunLine } from "../lib/sync-format";
import { toast, toastError } from "../lib/toast";
import type { SyncOverview } from "../lib/types";
import Icon from "../ui/icons";

function Stat({ label, value, tone, link }: { label: string; value: number | string; tone?: "danger" | "warning" | "success"; link?: string }) {
  const v = typeof value === "number" ? value.toLocaleString("en-IN") : value;
  return (
    <div className="sweep-stat">
      <span>{label}</span>
      {link ? <a className={`num sweep-stat-value ${tone ?? ""}`} href={link}>{v} →</a>
            : <span className={`num sweep-stat-value ${tone ?? ""}`}>{v}</span>}
    </div>
  );
}

export default function NightlyCard({ o, running, now, onRunNow }: {
  o: SyncOverview; running: boolean; now: number; onRunNow: () => void;
}) {
  const [exporting, setExporting] = useState(false);
  const sum = o.last_summary?.summary ?? null;
  const last = o.last_summary;
  const checked = sum ? sum.swept + sum.skipped_unchanged : null;
  const rolePill = o.collector === "other"
    ? <span className="pill warning">Not this device</span>
    : <span className="pill success">This device · runs {o.window_start}</span>;

  const exportLog = async () => {
    const sweepId = o.run?.sweep_id ?? last?.sweep_id;
    if (!sweepId) { toast("No sweep to export yet."); return; }
    try {
      const path = await save({ defaultPath: await api.sweepRunExportName(sweepId), filters: [{ name: "Excel workbook", extensions: ["xlsx"] }] });
      if (!path) return;
      setExporting(true);
      const n = await api.exportSweepRun(sweepId, path);
      toast(`Wrote ${plural(n, "row")} to the run log.`);
    } catch (e) { toastError(describeError(e)); }
    finally { setExporting(false); }
  };

  return (
    <section className="card sweep-card" aria-label="Nightly sweep">
      <div className="card-head">
        <h2>Nightly sweep</h2>
        {rolePill}
      </div>
      <div className="card-body stack">
        <dl className="kv sweep-kv">
          <dt>Scope</dt><dd>Open items, plus new items issued in the lookback window; index only</dd>
          <dt>Time budget</dt><dd className="num">{o.window_start} – {o.window_end} IST{o.estimate_all_s ? ` · ${estimateLabel(o.estimate_all_s)} for the book` : ""}</dd>
          <dt>Last run</dt>
          <dd>{last ? <span title={last.finished_at ?? last.started_at}>{lastSweepShort(last.finished_at ?? last.started_at, now)}{sum?.window_closed ? " · window closed" : ""}</span> : <span className="muted">none yet</span>}
              {!running ? <span className="muted"> · {nextRunLine(o, now) ?? "no scheduled run"}</span> : null}</dd>
        </dl>
        <div className="sweep-stats">
          <Stat label="Clients checked" value={checked ?? "—"} />
          <Stat label="Skipped" value={sum ? sum.skipped_unchanged : "—"} />
          <Stat label="New items indexed" value={sum ? (sum.indexed ?? 0) : "—"} tone={sum?.indexed ? "success" : undefined} />
          <Stat label="AO-viewed flips" value={sum ? (sum.ao_viewed_flips ?? 0) : "—"} />
          <Stat label="Failed" value={sum ? sum.failed + sum.parked : "—"} tone={sum && sum.failed + sum.parked ? "danger" : undefined}
                link={sum && sum.failed + sum.parked ? href({ name: "clients", filter: "failures" }) : undefined} />
        </div>
        <div className="row">
          <button className="btn accent" disabled={running} title={running ? "A run is in progress" : undefined} onClick={onRunNow}>
            <Icon name="refresh" /><span>Run now</span>
          </button>
          <button className="btn" disabled={exporting || (!o.run && !last)} onClick={() => { void exportLog(); }}>
            <Icon name="upload" /><span>Export run log</span>
          </button>
        </div>
      </div>
    </section>
  );
}
