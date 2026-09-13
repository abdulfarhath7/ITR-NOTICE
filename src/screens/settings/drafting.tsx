/** Settings › Drafting: where the AI proxy is and the firm's bearer token
 *  for it. The token lives in the OS keychain; only its presence is read
 *  back (docs/07). */
import { useEffect, useState } from "react";
import { api, describeError } from "../../lib/api";
import { invalidate, useQuery } from "../../lib/query";
import { toast, toastError } from "../../lib/toast";
import type { Settings } from "../../lib/types";
import { Row, Section } from "./ui";

export default function Drafting() {
  const q = useQuery<Settings>("settings", () => api.settings());
  const [proxyUrl, setProxyUrl] = useState<string | null>(null);
  const [firmToken, setFirmToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setProxyUrl(null); setFirmToken(null); }, [q.data]);

  const url = proxyUrl ?? q.data?.proxy_url ?? "";
  const token = firmToken ?? q.data?.firm_token ?? "";
  const dirty = !!q.data && (url !== q.data.proxy_url || token !== q.data.firm_token);

  const save = async () => {
    if (!q.data) return;
    setBusy(true);
    try {
      await api.saveSettings({ ...q.data, proxy_url: url.trim(), firm_token: token.trim() });
      invalidate("settings");
      toast("Drafting settings saved.");
    } catch (e) { toastError(describeError(e)); }
    finally { setBusy(false); }
  };

  return (
    <Section title="Drafting proxy"
             description="Drafts and suggested due dates come from a proxy the firm runs. The proxy holds the AI key; this app holds only its address and the firm's bearer token, in the OS keychain. A draft is made once per notice and never sent anywhere else."
             save={{ dirty, busy, onSave: () => { void save(); }, onDiscard: () => { setProxyUrl(null); setFirmToken(null); } }}>
      <Row label="Proxy URL" hint="http or https; the firm's own host" stacked>
        <input className="input mono" value={url} onChange={(e) => setProxyUrl(e.target.value)} aria-label="Proxy URL" placeholder="http://localhost:8787" />
      </Row>
      <Row label="Firm token" hint={q.data?.firm_token ? "A token is stored in the keychain." : "No token stored; drafting is off."} stacked>
        <input className="input mono" type="password" autoComplete="off" value={token} onChange={(e) => setFirmToken(e.target.value)} aria-label="Firm token" />
      </Row>
    </Section>
  );
}
