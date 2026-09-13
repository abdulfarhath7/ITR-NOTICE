/** Settings › Notifications: the collector-silent email (Q17) and what
 *  the desktop notifies about. */
import { useState } from "react";
import { useSyncState } from "../../hooks/use-sync";
import { api, describeError } from "../../lib/api";
import { invalidate, useQuery } from "../../lib/query";
import { href } from "../../lib/router";
import { toast, toastError } from "../../lib/toast";
import { Row, Section } from "./ui";

function AlertEmail() {
  const q = useQuery<string | null>("sync:alert-email", () => api.alertEmail());
  const [value, setValue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const shown = value ?? q.data ?? "";
  const dirty = value !== null && value !== (q.data ?? "");
  const save = async () => {
    setBusy(true);
    try { await api.setAlertEmail(shown.trim() || null); invalidate("sync:alert-email"); setValue(null); toast("Alert email saved."); }
    catch (e) { toastError(describeError(e)); }
    finally { setBusy(false); }
  };
  return (
    <Section title="Collector-silent alerts"
             description="After one missed scheduled run the relay emails every user who gave an address, at most once a day, and once more when the collector returns. The address is stored on the relay (docs/07)."
             save={{ dirty, busy, onSave: () => { void save(); }, onDiscard: () => setValue(null) }}>
      <Row label="Your email" hint="leave blank to receive no email; the in-app banner shows regardless" stacked>
        <input className="input" type="email" value={shown} onChange={(e) => setValue(e.target.value)} aria-label="Alert email" placeholder="you@firm.in" />
      </Row>
    </Section>
  );
}

export default function Notifications() {
  const sync = useSyncState();
  return (
    <>
      <Section title="Desktop" description="The operating system shows a notification at the moments a person is needed. Nothing is configurable here yet; the system's own notification settings apply.">
        <Row label="Run needs you" hint="an OTP or captcha is waiting on the Ingestion screen"><span className="pill success">on</span></Row>
        <Row label="Run finished" hint="a sweep completed, with its counts"><span className="pill success">on</span></Row>
      </Section>
      {sync.data?.configured
        ? <AlertEmail />
        : (
          <Section title="Collector-silent alerts" description="Email alerts need a relay. This device is on its own.">
            <Row label="Relay"><a className="btn small" href={href({ name: "devices" })}>Set up sync</a></Row>
          </Section>
        )}
    </>
  );
}
