/** Screen 6 — Devices. This device, its ledger position, bundles in and
 *  out. The roster, collector nomination and relay sync state arrive with
 *  Phase 7. */
import { useState } from "react";
import { api } from "../lib/api";
import { useQuery } from "../lib/query";
import type { DeviceInfo } from "../lib/types";
import { stamp } from "../ui/dates";
import { ExportBundle, ImportBundle } from "./bundles";

export default function DevicesScreen() {
  const q = useQuery<DeviceInfo>("device:info", () => api.deviceInfo());
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const d = q.data;
  return (
    <div className="page">
      <div className="page-head">
        <h1>Devices</h1>
        <button className="btn" onClick={() => setImporting(true)}>Import bundle</button>
        <button className="btn" onClick={() => setExporting(true)}>Export bundle</button>
      </div>
      <div className="page-body">
        <div className="grid-2">
          <div className="card">
            <div className="card-head"><h2>This device</h2></div>
            <div className="card-body">
              {d ? (
                <dl className="kv">
                  <dt>Device id</dt><dd className="mono">{d.device_id}</dd>
                  <dt>Signing key</dt><dd className="mono" style={{ overflowWrap: "anywhere" }}>{d.public_key}</dd>
                  <dt>Own ledger entries</dt><dd className="num">{d.own_entries}</dd>
                  <dt>Last snapshot</dt><dd className="num">{stamp(d.last_snapshot_at)}{d.snapshot_due ? <span className="pill warning" style={{ marginLeft: 8 }}>due</span> : null}</dd>
                </dl>
              ) : <span className="muted">Loading</span>}
            </div>
          </div>
          <div className="card">
            <div className="card-head"><h2>Cursor</h2><span className="meta">last applied seq per device</span></div>
            <div className="card-body">
              {d && Object.keys(d.cursor).length ? (
                <table className="table"><thead><tr><th>Device</th><th className="num">Applied</th><th className="num">Held</th></tr></thead>
                  <tbody>{Object.entries(d.cursor).map(([dev, seq]) => (
                    <tr key={dev}><td className="mono">{dev}{dev === d.device_id ? <span className="sub">this device</span> : null}</td>
                      <td className="num">{seq}</td><td className="num">{d.entries_by_device[dev] ?? 0}</td></tr>
                  ))}</tbody></table>
              ) : <span className="muted">No streams yet.</span>}
            </div>
          </div>
        </div>
        <div className="banner">
          Relay sync, the device roster and the collector lease are not configured. Until then, bundles move the book between devices: export here, import there.
        </div>
      </div>
      {exporting ? <ExportBundle onClose={() => setExporting(false)} /> : null}
      {importing ? <ImportBundle onClose={() => setImporting(false)} /> : null}
    </div>
  );
}
