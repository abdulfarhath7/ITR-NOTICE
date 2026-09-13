/** Settings › Firm and sync: this device's identity on the relay and the
 *  firm it belongs to. The roster and the collector control stay on the
 *  Devices screen. */
import { useState } from "react";
import { useRoster, useSyncState } from "../../hooks/use-sync";
import { api, describeError } from "../../lib/api";
import { plural } from "../../lib/labels";
import { invalidate, useQuery } from "../../lib/query";
import { href } from "../../lib/router";
import { toast, toastError } from "../../lib/toast";
import type { DeviceInfo } from "../../lib/types";
import { stamp } from "../../ui/dates";
import { Confirm } from "../../ui/dialog";
import FirmSetup from "../firm-setup";
import { Row, Section } from "./ui";

export default function Firm() {
  const sync = useSyncState();
  const s = sync.data;
  const roster = useRoster(!!s?.configured);
  const info = useQuery<DeviceInfo>("device:info", () => api.deviceInfo());
  const [setup, setSetup] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const leave = async () => {
    try { await api.leaveFirm(); toast("Left the firm on this device."); invalidate("sync"); invalidate("device"); }
    catch (e) { toastError(describeError(e)); }
    finally { setLeaving(false); }
  };
  const me = roster.data?.devices.find((d) => d.id === s?.device_id);

  return (
    <>
      {s?.configured ? (
        <Section title="Firm" description="Sync shares the book through a relay that stores only sealed blobs. Who collects, who is admin and who is behind are on the Devices screen."
                 footer={<button className="btn small danger" onClick={() => setLeaving(true)}>Leave the firm on this device</button>}>
          <Row label="Firm"><span>{roster.data?.firm.name ?? s.firm_name ?? "—"}</span></Row>
          <Row label="Firm id"><span className="mono">{s.firm_id}</span></Row>
          <Row label="This device" hint={me ? `enrolled ${stamp(me.enrolled_at)}` : undefined}>
            <span className="row">{me?.name ?? "—"}
              {s.permission ? <span className={`pill ${s.permission === "admin" ? "accent" : ""}`}>{s.permission}</span> : null}
              {s.collector_device_id === s.device_id ? <span className="pill success">collector</span> : null}
            </span>
          </Row>
          <Row label="Roster"><a className="btn small" href={href({ name: "devices" })}>Open Devices</a></Row>
        </Section>
      ) : (
        <Section title="Firm" description="This device is on its own. Set up sync to share the book with the firm's other devices; until then, bundles move it (Settings › Data).">
          <Row label="Relay"><button className="btn small accent" onClick={() => setSetup(true)}>Set up sync</button></Row>
        </Section>
      )}
      <Section title="This device" description="The device id and signing key identify this machine's ledger stream. Neither is secret; the private key never leaves the keychain.">
        <Row label="Device id"><span className="mono">{info.data?.device_id ?? "…"}</span></Row>
        <Row label="Signing key" stacked><code className="path">{info.data?.public_key ?? "…"}</code></Row>
        <Row label="Own ledger entries"><span className="mono">{info.data ? info.data.own_entries.toLocaleString("en-IN") : "…"}</span></Row>
        <Row label="Last snapshot" hint={info.data?.snapshot_due ? "a snapshot is due at the next sync" : undefined}>
          <span className="mono">{info.data ? stamp(info.data.last_snapshot_at) : "…"}</span>
        </Row>
        {info.data && Object.keys(info.data.entries_by_device).length > 1 ? (
          <Row label="Entries held by origin" stacked>
            <table className="table compact"><tbody>
              {Object.entries(info.data.entries_by_device).map(([dev, n]) => (
                <tr key={dev}>
                  <td>{roster.data?.devices.find((d) => d.id === dev)?.name ?? <span className="mono">{dev}</span>}</td>
                  <td className="num">{plural(n, "entry", "entries")}</td>
                </tr>
              ))}
            </tbody></table>
          </Row>
        ) : null}
      </Section>
      {setup ? <FirmSetup onClose={() => { setSetup(false); invalidate("sync"); invalidate("device"); invalidate("setup"); }} /> : null}
      {leaving ? (
        <Confirm title="Leave the firm on this device?" danger confirmLabel="Leave"
                 body="This device forgets the relay and the firm key; the archive stays. The admin still has to remove it from the roster."
                 onConfirm={() => { void leave(); }} onClose={() => setLeaving(false)} />
      ) : null}
    </>
  );
}
