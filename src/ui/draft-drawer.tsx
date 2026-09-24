/** The draft review screen (docs/09, task 9.3): the source notice on one
 *  side, the draft on the other, edited before use. There is no
 *  regenerate: a draft is made once per notice. */
import { useEffect, useState } from "react";
import { api, blobUrl } from "../lib/api";
import type { Draft } from "../lib/types";
import { Dialog } from "../ui/dialog";

export default function DraftDrawer({ draft, busy, sourceDocumentId, onClose, onSave, onReviewed }: {
  draft: Draft; busy: boolean; sourceDocumentId: string | null; onClose: () => void;
  onSave: (text: string) => void;
  /** Set or clear `reviewed_at` (docs/16 §6). */
  onReviewed?: (reviewed: boolean) => void;
}) {
  const [text, setText] = useState(draft.draft_text);
  const [source, setSource] = useState<string | null>(null);
  useEffect(() => setText(draft.draft_text), [draft.draft_text, draft.ref_id]);
  useEffect(() => {
    let url: string | null = null;
    if (sourceDocumentId) {
      api.documentBase64(sourceDocumentId).then((b64) => { url = blobUrl(b64); setSource(url); }).catch(() => setSource(null));
    }
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [sourceDocumentId]);
  const dirty = text !== draft.draft_text;

  const copy = async () => {
    try { await navigator.clipboard.writeText(text); } catch { /* clipboard denied: the text is still on screen */ }
  };

  return (
    <Dialog wide title={`Draft reply · ${draft.ref_id}`} onClose={onClose} footer={
      <>
        {onReviewed ? (draft.reviewed_at
          ? <button className="btn quiet" disabled={busy} onClick={() => onReviewed(false)} title={`Reviewed ${draft.reviewed_at}`}><span className="pill success">Reviewed</span><span>Clear</span></button>
          : <button className="btn" disabled={busy || dirty} onClick={() => onReviewed(true)} title={dirty ? "Save your edits first" : undefined}>Mark reviewed</button>) : null}
        <span className="grow" />
        <button className="btn" onClick={() => { void copy(); }}>Copy</button>
        <button className="btn accent" disabled={!dirty || busy} onClick={() => onSave(text)}>Save</button>
      </>
    }>
      <div className="banner warning">A draft for a chartered accountant to review against the notice. Nothing in it is verified; fill every [bracket] before use.</div>
      <div className="grid-2 pane">
        <div className="pane">
          {source ? <iframe className="preview" src={source} title="Source notice" />
            : <div className="frame tall"><span>{sourceDocumentId ? "Loading the notice" : "No PDF is stored for this notice."}</span></div>}
        </div>
        <div className="stack">
          <h3>What the notice asks</h3>
          <p>{draft.summary || <span className="muted">No summary.</span>}</p>
          {draft.checklist.length ? (
            <>
              <h3>Documents and explanations wanted</h3>
              <ul className="list">{draft.checklist.map((c, i) => <li key={i}>{c}</li>)}</ul>
            </>
          ) : null}
          <h3>Reply</h3>
          <textarea className="textarea" rows={16} value={text} onChange={(e) => setText(e.target.value)} />
          <span className="meta">{draft.generated_at ? `Generated ${draft.generated_at}` : ""}</span>
        </div>
      </div>
    </Dialog>
  );
}
