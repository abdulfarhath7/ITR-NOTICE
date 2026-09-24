/** Choose who owns a work item (docs/16 §1.7, §6). Free text with the
 *  names already used offered as suggestions; "Unassigned" clears it.
 *  Writes through `set_work_item_meta`; the list refetches. */
import { useEffect, useId, useRef, useState } from "react";
import { initials, useOwners } from "../hooks/use-owners";
import { api, describeError } from "../lib/api";
import { invalidate } from "../lib/query";
import { toast, toastError } from "../lib/toast";
import type { Module } from "../lib/types";

export function Avatar({ name, size = 22 }: { name: string | null; size?: 22 | 38 }) {
  if (!name) return <span className="muted" aria-label="Unassigned">—</span>;
  return <span className={`avatar${size === 38 ? " big" : ""}`} title={name} aria-label={name}>{initials(name)}</span>;
}

export async function saveOwner(module: Module, id: string, name: string): Promise<boolean> {
  try {
    await api.setWorkItemMeta(module, id, { assignee: name });
    toast(name ? `Assigned to ${name}.` : "Unassigned.");
    invalidate("work_items");
    invalidate(`meta:${module}:${id}`);
    return true;
  } catch (e) {
    toastError(describeError(e));
    return false;
  }
}

/** The inline editor: an input with suggestions, Save and Unassigned.
 *  Enter saves, Escape cancels. */
export default function OwnerSelect({ module, id, current, onDone }: {
  module: Module; id: string; current: string | null; onDone: () => void;
}) {
  const { names, me } = useOwners();
  const [value, setValue] = useState(current ?? "");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);

  const commit = async (name: string) => {
    if (name.trim() === (current ?? "")) { onDone(); return; }
    setBusy(true);
    if (await saveOwner(module, id, name.trim())) onDone();
    setBusy(false);
  };

  return (
    <span className="owner-select" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => {
      e.stopPropagation();
      if (e.key === "Escape") onDone();
      if (e.key === "Enter") { e.preventDefault(); void commit(value); }
    }}>
      <input ref={input} className="input" list={listId} value={value} disabled={busy} aria-label="Owner"
             placeholder={me ?? "Name"} onChange={(e) => setValue(e.target.value)} />
      <datalist id={listId}>{names.map((n) => <option key={n} value={n} />)}</datalist>
      <button className="btn small accent" disabled={busy} onClick={() => { void commit(value); }}>Save</button>
      {current ? <button className="btn small quiet" disabled={busy} onClick={() => { void commit(""); }}>Unassigned</button> : null}
    </span>
  );
}
