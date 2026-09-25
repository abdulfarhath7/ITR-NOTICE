/** Deep fetch dialog (docs/17 §6.3): how far back, documents, modules,
 *  an estimate that is only ever a label, and three buttons. */
import { useEffect, useMemo, useState } from "react";
import { api, describeError } from "../lib/api";
import { MODULES, MODULE_LABEL } from "../lib/labels";
import { invalidate, useQuery } from "../lib/query";
import { toast, toastError } from "../lib/toast";
import type { CadenceTier, DeepDepth, DeepFetchRequest, DocsPolicy, Module } from "../lib/types";
import { Dialog } from "./dialog";

/** Seconds as the estimate label: `≈ 11 min`, `≈ 1 h 10 min`. */
export function approxDuration(seconds: number): string {
  const min = Math.max(1, Math.round(seconds / 60));
  if (min < 60) return `≈ ${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `≈ ${h} h ${m} min` : `≈ ${h} h`;
}

function depthLabel(r: DeepFetchRequest): string {
  if (r.depth === "all") return "everything";
  if (r.depth === "years") return `last ${r.depth_value ?? "?"} assessment years`;
  return `since ${r.depth_value ?? "?"}`;
}

export default function DeepFetchDialog({ clientId, clientName, historyNote, tier, onClose }: {
  clientId: string; clientName: string;
  historyNote: string | null | undefined; tier: CadenceTier | null | undefined;
  onClose: () => void;
}) {
  const [depth, setDepth] = useState<DeepDepth>("all");
  const [years, setYears] = useState("2");
  const [since, setSince] = useState("");
  const [docs, setDocs] = useState<DocsPolicy>("index");
  const [modules, setModules] = useState<Module[]>(() => [...MODULES]);
  const [busy, setBusy] = useState(false);
  const [estimate, setEstimate] = useState<number | null>(null);
  const [estimating, setEstimating] = useState(false);

  const requests = useQuery<DeepFetchRequest[]>("ingestion:deep_requests", () => api.deepFetchRequests());
  const existing = useMemo(
    () => (requests.data ?? []).find((r) => r.client_id === clientId && r.status === "queued") ?? null,
    [requests.data, clientId],
  );

  const yearsN = Number(years);
  const yearsOk = Number.isInteger(yearsN) && yearsN >= 1 && yearsN <= 10;
  const sinceOk = /^\d{4}-\d{2}-\d{2}$/.test(since);
  const depthValue: string | null = depth === "years" ? String(yearsN) : depth === "since" ? since : null;
  const depthOk = depth === "all" || (depth === "years" ? yearsOk : sinceOk);
  const modulesOk = modules.length > 0;
  const ready = depthOk && modulesOk && !busy;

  // Debounced; a failed or slow estimate never blocks the buttons.
  useEffect(() => {
    if (!depthOk) { setEstimate(null); setEstimating(false); return; }
    let live = true;
    setEstimating(true);
    const t = setTimeout(() => {
      api.deepEstimate(clientId, depth, depthValue)
        .then((s) => { if (live) setEstimate(s); })
        .catch(() => { if (live) setEstimate(null); })
        .finally(() => { if (live) setEstimating(false); });
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [clientId, depth, depthValue, depthOk]);

  const toggleModule = (m: Module, on: boolean) =>
    setModules((cur) => (on ? MODULES.filter((x) => x === m || cur.includes(x)) : cur.filter((x) => x !== m)));

  const run = async (mode: "tonight" | "now") => {
    if (!ready) return;
    setBusy(true);
    try {
      const res = await api.requestDeepFetch(clientId, depth, depthValue, modules, docs, mode);
      toast(res.status === "started" ? "History fetch started"
        : mode === "now" ? "A sweep is running, queued for after it"
        : "Queued for tonight");
      invalidate("ingestion");
      invalidate(`clients:${clientId}`);
      onClose();
    } catch (e) { toastError(describeError(e)); }
    finally { setBusy(false); }
  };

  const estimateText = estimating ? "≈ …" : estimate !== null ? approxDuration(estimate) : "≈ —";

  return (
    <Dialog title={`Fetch history · ${clientName}`} onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={!ready} onClick={() => { void run("now"); }}>Run now</button>
        <button className="btn accent" disabled={!ready} onClick={() => { void run("tonight"); }}>Queue for tonight</button>
      </>
    }>
      <p className="muted deep-sub">Currently: {historyNote || "recent only"} · swept {tier ?? "nightly"}</p>

      <fieldset className="deep-group">
        <legend>How far back</legend>
        <label className="check">
          <input type="radio" name="deep-depth" checked={depth === "all"} onChange={() => setDepth("all")} />
          Everything, all assessment years
        </label>
        <label className="check">
          <input type="radio" name="deep-depth" checked={depth === "years"} onChange={() => setDepth("years")} />
          Last
          <input className="input deep-num num" type="number" min={1} max={10} value={years} aria-label="Number of assessment years"
                 onFocus={() => setDepth("years")} onChange={(e) => { setYears(e.target.value); setDepth("years"); }} />
          assessment years
        </label>
        {depth === "years" && !yearsOk ? <span className="deep-hint error">Between 1 and 10</span> : null}
        <label className="check">
          <input type="radio" name="deep-depth" checked={depth === "since"} onChange={() => setDepth("since")} />
          Since
          <input className="input deep-date" type="date" value={since} aria-label="Since date"
                 onFocus={() => setDepth("since")} onChange={(e) => { setSince(e.target.value); setDepth("since"); }} />
        </label>
        {depth === "since" && !sinceOk ? <span className="deep-hint">Pick a date</span> : null}
      </fieldset>

      <fieldset className="deep-group">
        <legend>Documents</legend>
        <label className="check">
          <input type="radio" name="deep-docs" checked={docs === "index"} onChange={() => setDocs("index")} />
          Index only, download on click
        </label>
        <label className="check">
          <input type="radio" name="deep-docs" checked={docs === "download"} onChange={() => setDocs("download")} />
          Download every PDF now
        </label>
      </fieldset>

      <fieldset className="deep-group">
        <legend>Modules</legend>
        <div className="deep-modules">
          {MODULES.map((m) => (
            <label key={m} className="check">
              <input type="checkbox" checked={modules.includes(m)} onChange={(e) => toggleModule(m, e.target.checked)} />
              {MODULE_LABEL[m]}
            </label>
          ))}
        </div>
        {!modulesOk ? <span className="deep-hint error">Pick at least one module</span> : null}
      </fieldset>

      <p className="deep-estimate">
        <span className="num">{estimateText}</span> · runs tonight after the sweep · or run now in the foreground
      </p>
      {existing ? (
        <p className="deep-hint">
          A request is already queued for this client ({depthLabel(existing)}). Queueing replaces it.
        </p>
      ) : null}
    </Dialog>
  );
}
