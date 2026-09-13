/** Settings › Data: where the book lives, how big it is, and the sealed
 *  bundles that move it between machines (tasks 6.6 to 6.8). */
import { useState } from "react";
import { api, describeError } from "../../lib/api";
import { useQuery } from "../../lib/query";
import { toastError } from "../../lib/toast";
import type { DataDirInfo } from "../../lib/types";
import Icon from "../../ui/icons";
import { ExportBundle, ImportBundle } from "../bundles";
import { Row, Section } from "./ui";

function mb(bytes: number): string {
  return bytes >= 1073741824 ? `${(bytes / 1073741824).toFixed(2)} GB` : `${Math.max(1, Math.round(bytes / 1048576))} MB`;
}

export default function Data() {
  const q = useQuery<DataDirInfo>("settings:datadir", () => api.dataDir());
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  return (
    <>
      <Section title="Storage" description="One SQLCipher-encrypted archive plus a content-addressed document store. The archive key is in the OS keychain, never on disk.">
        <Row label="Data folder" stacked>
          <div className="row">
            <code className="path">{q.data?.path ?? "…"}</code>
            <button className="btn small" onClick={() => { void api.openDataDir().catch((e) => toastError(describeError(e))); }}>
              <Icon name="external" /><span>Open</span>
            </button>
          </div>
        </Row>
        <Row label="Archive size"><span className="mono">{q.data ? mb(q.data.archive_bytes) : "…"}</span></Row>
      </Section>
      <Section title="Backup and transfer" description="A bundle is the whole book sealed under a passphrase. Import is a merge, never an overwrite: clients match on PAN, the newer row wins, documents deduplicate by hash.">
        <Row label="Export a bundle" hint="portal passwords are left out unless you ask twice">
          <button className="btn small" onClick={() => setExporting(true)}><Icon name="upload" /><span>Export</span></button>
        </Row>
        <Row label="Import a bundle" hint="previews the manifest before anything is written">
          <button className="btn small" onClick={() => setImporting(true)}><Icon name="download" /><span>Import</span></button>
        </Row>
      </Section>
      {exporting ? <ExportBundle onClose={() => setExporting(false)} /> : null}
      {importing ? <ImportBundle onClose={() => setImporting(false)} /> : null}
    </>
  );
}
