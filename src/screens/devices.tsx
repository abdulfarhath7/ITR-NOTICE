/** Screen 6 — Devices (docs/09). Roster with the collector radio control
 *  (admin only; read-only for members), sync state as two independent
 *  facts, "changes behind" by originating device, bundles in and out. */
import { useState } from "react";
import { useRoster, useSyncNow, useSyncState } from "../hooks/use-sync";
import { api, describeError } from "../lib/api";
import { invalidate, useQuery } from "../lib/query";
import { toast, toastError } from "../lib/toast";
import type { DeviceInfo, RosterDevice } from "../lib/types";
import { stamp } from "../ui/dates";
import { Confirm, Dialog } from "../ui/dialog";
import { ExportBundle, ImportBundle } from "./bundles";
import FirmSetup from "./firm-setup";

const ONLINE_MINUTES = 10;

function online(lastSeen: string | null): boolean {
  if (!lastSeen) return false;
  return Date.now() - new Date(lastSeen).getTime() < ONLINE_MINUTES * 60_000;
}

function ram(mb: number | null): string {
  if (!mb) return "—";
  return `${(mb / 1024).toFixed(mb >= 10240 ? 0 : 1)} GB`;
}

export default function DevicesScreen() {
  const sync = useSyncState();
  const s = sync.data;
  const roster = useRoster(!!s?.configured);
  const syncNow = useSyncNow();
  const info = useQuery<DeviceInfo>("device:info", () => api.deviceInfo());
  const [setup, setSetup] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [invite, setInvite] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "remove" | "transfer" | "leave"; device?: RosterDevice } | null>(null);
  const [busy, setBusy] = useState(false);

  const admin = roster.data?.you.permission === "admin";
  const me = s?.device_id;

  const act = async (f: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try { await f(); toast(done); invalidate("sync"); }
    catch (e) { toastError(describeError(e)); }
    finally { setBusy(false); setConfirm(null); }
  };

  const nominate = (d: RosterDevice) => act(() => api.setCollector(d.id), `${d.name} nominated as collector. The current holder finishes its client, then hands over.`);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Devices</h1>
        {s?.configured ? (
          <button className={`btn ${s.status === "unreachable" ? "danger" : s.status === "behind" ? "accent" : ""}`}
                  disabled={syncNow.busy} onClick={() => { void syncNow.run(); }}>
            {syncNow.busy ? "Syncing" : s.status === "unreachable" ? "Cannot reach relay · retry"
              : s.status === "behind" ? `Sync · ${s.behind_total.toLocaleString("en-IN")} behind` : "Sync · up to date"}
          </button>
        ) : <button className="btn accent" onClick={() => setSetup(true)}>Set up sync</button>}
        <button className="btn" onClick={() => setImporting(true)}>Import bundle</button>
        <button className="btn" onClick={() => setExporting(true)}>Export bundle</button>
      </div>
      <div className="page-body">
        {s?.configured && s.collector_silent ? (
          <div className="banner warning">
            <span><b>The collector has not reported</b> since {stamp(s.collector_last_seen)}. Being up to date with the relay does not mean the book is current — nothing new has been swept.</span>
          </div>
        ) : null}
        {s?.last_error ? <div className="banner danger">{s.last_error}</div> : null}

        {s?.configured ? (
          <div className="grid-2">
            <div className="card">
              <div className="card-head"><h2>Cursor freshness</h2><span className="meta">fact one</span></div>
              <div className="card-body">
                {s.behind_total === 0 ? <p>Every change the relay holds has been applied here.</p>
                  : <p><b className="num">{s.behind_total.toLocaleString("en-IN")}</b> change{s.behind_total === 1 ? "" : "s"} not yet applied on this device.</p>}
                {Object.keys(s.behind_by_device).length ? (
                  <table className="table" style={{ marginTop: 8 }}><tbody>
                    {Object.entries(s.behind_by_device).map(([dev, n]) => (
                      <tr key={dev}><td>{roster.data?.devices.find((d) => d.id === dev)?.name ?? <span className="mono">{dev}</span>}</td><td className="num">{n.toLocaleString("en-IN")}</td></tr>
                    ))}
                  </tbody></table>
                ) : null}
                <p className="meta" style={{ marginTop: 8 }}>Last sync {stamp(s.last_sync_at)} · {s.unpublished} local change{s.unpublished === 1 ? "" : "s"} to send{s.unpublished_sweep_waiting ? " · sweep changes wait for the collector lease" : ""}</p>
              </div>
            </div>
            <div className="card">
              <div className="card-head"><h2>Collector health</h2><span className="meta">fact two</span></div>
              <div className="card-body">
                {s.collector_device_id ? (
                  <>
                    <p>{roster.data?.devices.find((d) => d.id === s.collector_device_id)?.name ?? <span className="mono">{s.collector_device_id}</span>}
                      {s.collector_device_id === me ? " (this device)" : ""}</p>
                    <p className={s.collector_silent ? "due danger" : "muted"}>Last reported {stamp(s.collector_last_seen)}</p>
                  </>
                ) : <p className="muted">No collector is nominated. Nothing sweeps the portal until the admin nominates one below.</p>}
              </div>
            </div>
          </div>
        ) : null}

        {s?.configured ? (
          <div className="card">
            <div className="card-head">
              <h2>{roster.data?.firm.name ?? s.firm_name ?? "Firm"}</h2>
              <span className="meta mono">{s.firm_id}</span>
              {admin ? <button className="btn small" disabled={busy} onClick={() => { void act(async () => setInvite(await api.createInvite()), "Invite created."); }}>Invite a device</button> : null}
              <button className="btn small danger" onClick={() => setConfirm({ kind: "leave" })}>Leave firm on this device</button>
            </div>
            {roster.error ? <div className="card-body"><div className="banner danger">{roster.error}</div></div>
            : !roster.data ? <div className="loading">Loading</div> : (
              <table className="table">
                <thead><tr>
                  <th>Collector</th><th>Name</th><th>RAM</th><th>Role</th><th>Online</th><th className="num">Position</th><th className="num">Behind here</th><th className="right">Actions</th>
                </tr></thead>
                <tbody>
                  {roster.data.devices.filter((d) => !d.removed_at).map((d) => {
                    const behind = Math.max(0, d.head - (s.cursor[d.id] ?? 0));
                    return (
                      <tr key={d.id}>
                        <td>
                          <input type="radio" name="collector" aria-label={`Make ${d.name} the collector`}
                                 checked={roster.data?.nominee_id === d.id || (roster.data?.nominee_id == null && d.role === "collector")}
                                 disabled={!admin || busy} onChange={() => { void nominate(d); }} />
                        </td>
                        <td className="wrap">{d.name}{d.id === me ? <span className="sub">this device</span> : null}</td>
                        <td className="num">{ram(d.ram_mb)}</td>
                        <td>
                          <span className={`pill ${d.permission === "admin" ? "accent" : ""}`}>{d.permission}</span>{" "}
                          {d.role === "collector" ? <span className="pill success">collector</span> : null}
                          {roster.data?.lease?.device_id === d.id ? <span className="pill normal">lease held</span> : null}
                        </td>
                        <td>{online(d.last_seen) ? <span className="pill success">online</span> : <span className="muted num">{stamp(d.last_seen)}</span>}</td>
                        <td className="num">{d.head.toLocaleString("en-IN")}</td>
                        <td className="num">{d.id === me ? "—" : behind.toLocaleString("en-IN")}</td>
                        <td className="right">
                          {admin && d.id !== me ? (
                            <div className="actions">
                              <button className="btn small" disabled={busy} onClick={() => setConfirm({ kind: "transfer", device: d })}>Make admin</button>
                              <button className="btn small danger" disabled={busy} onClick={() => setConfirm({ kind: "remove", device: d })}>Remove</button>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {!admin && roster.data ? <div className="card-body meta">Only the admin can nominate the collector, remove a device or transfer the admin role. You see the same list.</div> : null}
          </div>
        ) : (
          <div className="card">
            <div className="card-body stack">
              <h3>This device is on its own.</h3>
              <p className="muted">Set up sync to share the book with the firm's other devices through a relay that stores only sealed blobs. Until then, bundles move the book: export here, import there.</p>
              <div className="row"><button className="btn accent" onClick={() => setSetup(true)}>Set up sync</button></div>
            </div>
          </div>
        )}

        <div className="card">
          <div className="card-head"><h2>This device</h2></div>
          <div className="card-body">
            {info.data ? (
              <dl className="kv">
                <dt>Device id</dt><dd className="mono">{info.data.device_id}</dd>
                <dt>Signing key</dt><dd className="mono" style={{ overflowWrap: "anywhere" }}>{info.data.public_key}</dd>
                <dt>Own ledger entries</dt><dd className="num">{info.data.own_entries.toLocaleString("en-IN")}</dd>
                <dt>Last snapshot</dt><dd className="num">{stamp(info.data.last_snapshot_at)}{info.data.snapshot_due ? <span className="pill warning" style={{ marginLeft: 8 }}>due</span> : null}</dd>
              </dl>
            ) : <span className="muted">Loading</span>}
          </div>
        </div>
      </div>

      {setup ? <FirmSetup onClose={() => { setSetup(false); invalidate("sync"); invalidate("device"); }} /> : null}
      {exporting ? <ExportBundle onClose={() => setExporting(false)} /> : null}
      {importing ? <ImportBundle onClose={() => setImporting(false)} /> : null}
      {invite ? (
        <Dialog title="Invite" onClose={() => setInvite(null)} footer={<button className="btn accent" onClick={() => setInvite(null)}>Done</button>}>
          <div className="banner warning">This invite carries the firm key. Send it over a channel you trust and delete it afterwards. It works once.</div>
          <textarea className="textarea mono" rows={4} readOnly value={invite} onFocus={(e) => e.currentTarget.select()} />
          <p className="muted">On the other device: Devices → Set up sync → Join with an invite.</p>
        </Dialog>
      ) : null}
      {confirm?.kind === "remove" && confirm.device ? (
        <Confirm title={`Remove ${confirm.device.name}?`} danger confirmLabel="Remove"
                 body="Its relay access is revoked; the archive on that machine is not wiped (Q16). It can be re-enrolled with a new invite."
                 onConfirm={() => { if (confirm.device) void act(() => api.removeDevice(confirm.device!.id), "Device removed."); }} onClose={() => setConfirm(null)} />
      ) : null}
      {confirm?.kind === "transfer" && confirm.device ? (
        <Confirm title={`Make ${confirm.device.name} the admin?`} confirmLabel="Transfer"
                 body="You become a member in the same step. Only the new admin can nominate the collector, remove devices or transfer the role back."
                 onConfirm={() => { if (confirm.device) void act(() => api.transferAdmin(confirm.device!.id), "Admin transferred."); }} onClose={() => setConfirm(null)} />
      ) : null}
      {confirm?.kind === "leave" ? (
        <Confirm title="Leave the firm on this device?" danger confirmLabel="Leave"
                 body="This device forgets the relay and the firm key; the archive stays. The admin still has to remove it from the roster."
                 onConfirm={() => { void act(() => api.leaveFirm(), "Left the firm on this device."); }} onClose={() => setConfirm(null)} />
      ) : null}
    </div>
  );
}
