import { useEffect, useRef, useState } from "react";
import { api, pdfUrl } from "../lib/api";
import { describe, type Item } from "../lib/buckets";
import type { Draft } from "../lib/types";

interface Props {
  item: Item | null;
  onClose: () => void;
  onChanged: () => void;   // ask the app to reload rows after a write
}

export default function Drawer({ item, onClose, onChanged }: Props) {
  const [pdf, setPdf] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"" | "date" | "draft" | "save">("");
  const [err, setErr] = useState("");
  const saveTimer = useRef<number | undefined>(undefined);

  // Load PDF + draft whenever the selection changes; revoke the old blob URL.
  useEffect(() => {
    let url: string | null = null;
    setPdf(null); setDraft(null); setText(""); setErr("");
    if (!item) return;
    if (item.has_pdf) {
      api.pdf(item.ref_id).then((b64) => { url = pdfUrl(b64); setPdf(url); }).catch(() => setPdf(null));
    }
    api.draft(item.ref_id).then((d) => { setDraft(d); setText(d?.draft_text ?? ""); });
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [item?.ref_id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!item) return <aside className="drawer drawer-empty" aria-hidden="true" />;

  const askDate = async () => {
    setBusy("date"); setErr("");
    try { await api.askDueDate(item.ref_id); onChanged(); }
    catch (e) { setErr(String(e)); }
    finally { setBusy(""); }
  };

  const makeDraft = async (regenerate: boolean) => {
    setBusy("draft"); setErr("");
    try {
      const d = await api.draftResponse(item.ref_id, regenerate);
      setDraft(d); setText(d.draft_text); onChanged();
    } catch (e) { setErr(String(e)); }
    finally { setBusy(""); }
  };

  // Edits save themselves, a beat after typing stops.
  const edit = (v: string) => {
    setText(v);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      setBusy("save");
      try { await api.saveDraftText(item.ref_id, v); } catch (e) { setErr(String(e)); }
      finally { setBusy(""); }
    }, 600);
  };

  const copy = () => navigator.clipboard.writeText(text);

  return (
    <aside className="drawer" aria-label="Notice detail">
      <div className="drawer-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3>{describe(item)}</h3>
          <div className="sub">{item.ref_id}</div>
        </div>
        <button className="btn btn-quiet" onClick={onClose} aria-label="Close">Close</button>
      </div>

      <div className="drawer-body">
        <dl className="facts">
          {item.assessee_name && <><dt>Assessee</dt><dd>{item.assessee_name}</dd></>}
          {item.pan && <><dt>PAN</dt><dd>{item.pan}</dd></>}
          {item.assessment_year && <><dt>Assessment year</dt><dd>{item.assessment_year}</dd></>}
          {item.notice_us && <><dt>Section</dt><dd>{item.notice_us}</dd></>}
          <dt>Issued</dt><dd>{item.issued_on ?? "—"}</dd>
          <dt>Served</dt><dd>{item.served_on ?? "—"}</dd>
          <dt>Due</dt>
          <dd>
            {item.due_date ? (
              <>
                {item.due_date}
                {item.due_date_source === "claude" && <> <span className="tag">from Claude</span></>}
                {item.due_date_basis && <div className="basis">{item.due_date_basis}</div>}
              </>
            ) : (
              <button className="btn" onClick={askDate} disabled={!item.has_pdf || busy === "date"}>
                {busy === "date" ? "Reading the notice…" : "Ask Claude for the due date"}
              </button>
            )}
          </dd>
          <dt>Status</dt><dd>{item.status ?? "—"}{item.responded ? " · reply filed" : ""}</dd>
        </dl>

        <div className="section">
          <h4>Notice</h4>
          {pdf ? <iframe className="pdf" src={pdf} title="Notice PDF" />
               : <p className="note">{item.has_pdf ? "Opening…" : "No PDF stored for this notice yet."}</p>}
        </div>

        <div className="section">
          <h4>Draft reply</h4>
          {!draft ? (
            <>
              <p className="note">Claude reads the notice and writes a summary, a document checklist and a reply for you to edit. Nothing is filed.</p>
              <button className="btn btn-primary" onClick={() => makeDraft(false)} disabled={!item.has_pdf || busy === "draft"}>
                {busy === "draft" ? "Writing…" : "Draft a reply"}
              </button>
            </>
          ) : (
            <>
              <p>{draft.summary}</p>
              {draft.checklist.length > 0 && (
                <>
                  <h4>Documents the notice asks for</h4>
                  <ul className="checklist">{draft.checklist.map((c, i) => <li key={i}>{c}</li>)}</ul>
                </>
              )}
              <h4 style={{ marginTop: 12 }}>Reply</h4>
              <textarea className="draft" value={text} onChange={(e) => edit(e.target.value)} spellCheck />
              <div className="btn-row" style={{ marginTop: 8 }}>
                <button className="btn" onClick={copy}>Copy reply</button>
                <button className="btn btn-quiet" onClick={() => makeDraft(true)} disabled={busy === "draft"}>
                  {busy === "draft" ? "Writing…" : "Regenerate"}
                </button>
                <span className="note">{busy === "save" ? "Saving…" : draft.generated_at ? `Drafted ${draft.generated_at}` : ""}</span>
              </div>
              <p className="note" style={{ marginTop: 10 }}>Draft for review. Square brackets mark facts you must fill in.</p>
            </>
          )}
        </div>

        {err && <p className="err">{err}</p>}
      </div>
    </aside>
  );
}
