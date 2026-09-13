/** The document rows every work-item screen shows. View, Open and Save
 *  are on for every status (docs/02 action matrix); a pending or failed
 *  fetch says so instead of hiding the row. */
import type { useDocuments } from "../hooks/use-documents";
import type { Document } from "../lib/types";
import DocumentPreview from "./document-preview";
import Icon from "./icons";

type Docs = ReturnType<typeof useDocuments>;

function size(bytes: number | null): string {
  if (!bytes) return "";
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function DocRow({ doc, docs }: { doc: Document; docs: Docs }) {
  const stored = doc.state === "stored";
  const note = [doc.doc_kind, size(doc.byte_size), doc.state === "pending" ? "awaited" : doc.state === "failed" ? "fetch failed" : ""]
    .filter(Boolean).join(" · ");
  return (
    <tr>
      <td className="wrap">
        <span className="row"><Icon name="file" className="faint" />{doc.filename ?? doc.doc_kind}</span>
        <div className="sub">{note}</div>
      </td>
      <td className="right">
        <div className="actions">
          <button className="btn small" disabled={!stored} onClick={() => { void docs.view(doc); }}>View</button>
          <button className="btn small" disabled={!stored} onClick={() => { void docs.openExternal(doc); }}>Open</button>
          <button className="btn small" disabled={!stored} onClick={() => { void docs.saveAs(doc); }}>Save</button>
        </div>
      </td>
    </tr>
  );
}

export function DocList({ items, docs, empty = "No documents fetched yet." }: { items: Document[]; docs: Docs; empty?: string }) {
  if (!items.length) return <div className="card-body muted">{empty}</div>;
  return (
    <table className="table"><tbody>
      {items.map((d) => <DocRow key={d.id} doc={d} docs={docs} />)}
    </tbody></table>
  );
}

/** The preview dialog for whichever document is open, or nothing. */
export function DocPreview({ docs }: { docs: Docs }) {
  const p = docs.preview;
  if (!p) return null;
  return (
    <DocumentPreview preview={p} onClose={docs.closePreview}
                     onOpen={() => { void docs.openExternal(p.doc); }}
                     onSave={() => { void docs.saveAs(p.doc); }} />
  );
}
