/** Owner and notes on a work item's detail screen (docs/16 §6). Both
 *  write through `set_work_item_meta`; the note saves on blur. */
import { useEffect, useState } from "react";
import { api, describeError } from "../lib/api";
import { invalidate, useQuery } from "../lib/query";
import { toast, toastError } from "../lib/toast";
import type { Module, WorkItemMeta } from "../lib/types";
import OwnerSelect, { Avatar } from "./owner-select";

export function useItemMeta(module: Module, id: string) {
  return useQuery<WorkItemMeta | null>(`meta:${module}:${id}`, () => api.workItemMeta(module, id));
}

/** Avatar, name and Change, for the page head. */
export function OwnerRow({ module, id }: { module: Module; id: string }) {
  const q = useItemMeta(module, id);
  const [editing, setEditing] = useState(false);
  const owner = q.data?.assignee ?? null;
  if (editing) return <OwnerSelect module={module} id={id} current={owner} onDone={() => setEditing(false)} />;
  return (
    <span className="owner-row">
      <Avatar name={owner} />
      <span className={owner ? undefined : "muted"}>{owner ?? "Unassigned"}</span>
      <button className="btn small quiet" onClick={() => setEditing(true)}>{owner ? "Change" : "Assign"}</button>
    </span>
  );
}

export function NotesCard({ module, id }: { module: Module; id: string }) {
  const q = useItemMeta(module, id);
  const saved = q.data?.note ?? "";
  const [text, setText] = useState(saved);
  useEffect(() => setText(saved), [saved]);
  const save = async () => {
    if (text === saved) return;
    try {
      await api.setWorkItemMeta(module, id, { note: text });
      toast("Saved");
      invalidate(`meta:${module}:${id}`);
      invalidate("work_items");
    } catch (e) { toastError(describeError(e)); }
  };
  return (
    <div className="card">
      <div className="card-head"><h2>Notes</h2><span className="meta">plain text · saves when you leave the box</span></div>
      <div className="card-body">
        <textarea className="textarea notes" rows={4} value={text} disabled={q.loading && !q.data && q.data !== null}
                  placeholder="Who is handling it, what the client said, what is pending…"
                  aria-label="Notes" onChange={(e) => setText(e.target.value)} onBlur={() => { void save(); }} />
      </div>
    </div>
  );
}
