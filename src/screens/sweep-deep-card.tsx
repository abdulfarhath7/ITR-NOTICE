/** The right card of the Sweep screen (docs/18 §7): deep fetch one client.
 *  Everything is the full-history scrape, the only way a client's whole
 *  data is ever pulled. Runs in the foreground through the docs/17
 *  deep-fetch command; no time budget, the run's Stop button cancels
 *  (Q57). */
import { useEffect, useMemo, useState } from "react";
import { useClients } from "../hooks/use-clients";
import { api, describeError } from "../lib/api";
import { MODULES } from "../lib/labels";
import { invalidate } from "../lib/query";
import { toast, toastError } from "../lib/toast";
import type { DeepDepth, DeepProbeInfo, DocsPolicy } from "../lib/types";
import Field from "../ui/field";
import Icon from "../ui/icons";

export default function DeepFetchCard({ running }: { running: boolean }) {
  const clients = useClients("");
  const portal = useMemo(() => (clients.data ?? []).filter((c) => c.source === "portal"), [clients.data]);
  const [clientId, setClientId] = useState("");
  const [depth, setDepth] = useState<DeepDepth>("all");
  const [years, setYears] = useState(3);
  const [since, setSince] = useState("");
  const [docs, setDocs] = useState<DocsPolicy>("index");
  const [info, setInfo] = useState<DeepProbeInfo | null>(null);
  const [busy, setBusy] = useState(false);

  const depthValue = depth === "years" ? String(years) : depth === "since" ? since : null;
  const valid = !!clientId && (depth !== "years" || (years >= 1 && years <= 10)) && (depth !== "since" || /^\d{4}-\d{2}-\d{2}$/.test(since));

  // The estimate line: from the listing probe when one has run (docs/17
  // §2.2), else "Estimate after probe". Never blocks Start.
  useEffect(() => {
    if (!clientId || !valid) { setInfo(null); return; }
    let live = true;
    const t = setTimeout(() => {
      api.deepProbeInfo(clientId, depth, depthValue).then((i) => { if (live) setInfo(i); }).catch(() => { if (live) setInfo(null); });
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [clientId, depth, depthValue, valid]);

  const start = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const r = await api.requestDeepFetch(clientId, depth, depthValue, MODULES, docs, "now");
      toast(r.status === "started" ? "History fetch started." : "A sweep is running, queued for after it.");
      invalidate("sync:overview");
      invalidate("ingestion");
    } catch (e) { toastError(describeError(e)); }
    finally { setBusy(false); }
  };

  return (
    <section className="card sweep-card" aria-label="Deep fetch one client">
      <div className="card-head">
        <h2>Deep fetch one client</h2>
        <span className="meta">full history, on request</span>
      </div>
      <div className="card-body stack">
        <Field label="Client">
          <select className="select" value={clientId} onChange={(e) => setClientId(e.target.value)} aria-label="Client">
            <option value="">Choose a client</option>
            {portal.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <fieldset className="sweep-radios">
          <legend>Scope</legend>
          <label className="check"><input type="radio" name="deep-scope" checked={depth === "all"} onChange={() => setDepth("all")} /> Everything</label>
          <label className="check"><input type="radio" name="deep-scope" checked={depth === "years"} onChange={() => setDepth("years")} /> Last
            {depth === "years" ? (
              <input className="input mono sweep-stepper" type="number" min={1} max={10} value={years} aria-label="Assessment years"
                     onChange={(e) => setYears(Math.max(1, Math.min(10, Number(e.target.value) || 1)))} onClick={(e) => e.stopPropagation()} />
            ) : ` ${years}`} AYs</label>
          <label className="check"><input type="radio" name="deep-scope" checked={depth === "since"} onChange={() => setDepth("since")} /> Since date
            {depth === "since" ? <input className="input mono sweep-date" type="date" value={since} aria-label="Since date" onChange={(e) => setSince(e.target.value)} /> : null}</label>
        </fieldset>
        <fieldset className="sweep-radios">
          <legend>Fetch</legend>
          <label className="check"><input type="radio" name="deep-docs" checked={docs === "index"} onChange={() => setDocs("index")} /> Index only</label>
          <label className="check"><input type="radio" name="deep-docs" checked={docs === "download"} onChange={() => setDocs("download")} /> Index + download PDFs</label>
        </fieldset>
        <p className="meta num sweep-estimate">
          {!clientId ? "Choose a client for an estimate."
            : !info ? "Estimate after probe"
            : info.probe_rows === null ? "Estimate after probe"
            : `AY ${info.first_ay ?? "?"} → ${info.last_ay ?? "?"} · ~${info.probe_rows.toLocaleString("en-IN")} items · ~${Math.max(1, Math.round(info.seconds / 60))} min`}
        </p>
        <div className="row">
          <button className="btn accent" disabled={!valid || busy || running} title={running ? "A run is in progress; it will queue after it" : undefined}
                  onClick={() => { void start(); }}><Icon name="cloud-down" /><span>Start fetch</span></button>
          <span className="meta">Runs in the foreground; Stop after this client cancels it.</span>
        </div>
      </div>
    </section>
  );
}
