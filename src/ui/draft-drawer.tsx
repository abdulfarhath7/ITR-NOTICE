/** The draft review drawer: what the notice asks, the checklist, and the
 *  reply text to edit before use. */
import { useEffect, useState } from "react";
import type { Draft } from "../lib/types";
import { Dialog } from "../ui/dialog";

export default function DraftDrawer({ draft, busy, onClose, onSave, onRegenerate }: {
  draft: Draft; busy: boolean; onClose: () => void;
  onSave: (text: string) => void; onRegenerate: () => void;
}) {
  const [text, setText] = useState(draft.draft_text);
  useEffect(() => setText(draft.draft_text), [draft.draft_text, draft.ref_id]);
  const dirty = text !== draft.draft_text;

  const copy = async () => {
    try { await navigator.clipboard.writeText(text); } catch { /* clipboard denied: the text is still on screen */ }
  };

  return (
    <Dialog drawer title={`Draft reply · ${draft.ref_id}`} onClose={onClose} footer={
      <>
        <button className="btn quiet" onClick={onRegenerate} disabled={busy}>Regenerate</button>
        <button className="btn" onClick={() => { void copy(); }}>Copy</button>
        <button className="btn accent" disabled={!dirty || busy} onClick={() => onSave(text)}>Save</button>
      </>
    }>
      <div className="banner warning">A draft for a chartered accountant to review. Never invent facts; fill every [bracket].</div>
      <h3>What the notice asks</h3>
      <p>{draft.summary || <span className="muted">No summary.</span>}</p>
      {draft.checklist.length ? (
        <>
          <h3>Documents and explanations wanted</h3>
          <ul>{draft.checklist.map((c, i) => <li key={i}>{c}</li>)}</ul>
        </>
      ) : null}
      <h3>Reply</h3>
      <textarea className="textarea" rows={18} value={text} onChange={(e) => setText(e.target.value)} />
      <span className="meta">{draft.generated_at ? `Generated ${draft.generated_at}` : ""}</span>
    </Dialog>
  );
}
