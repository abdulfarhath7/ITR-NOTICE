/** One actions menu for a client, used on the Clients list rows and in the
 *  Client 360 header: edit, sync now, fetch history, pause or resume sync,
 *  the nightly pin, and delete. It owns its dialogs so both places behave
 *  the same. */
import { useEffect, useState } from "react";
import { api, describeError } from "../lib/api";
import { invalidate } from "../lib/query";
import { toast, toastError } from "../lib/toast";
import type { CadenceTier, ClientDetail, DeletePreview } from "../lib/types";
import DeepFetchDialog from "../ui/deep-fetch-dialog";
import { Dialog } from "../ui/dialog";
import Field from "../ui/field";
import Icon from "../ui/icons";
import ClientForm from "./client-form";

export interface MenuClient {
  id: string;
  name: string;
  source: "portal" | "eri";
  syncEnabled: boolean;
  pinned: boolean;
  tier: CadenceTier;
  historyNote: string | null;
}

function refresh(id: string) {
  invalidate(`clients:${id}`);
  invalidate("clients");
  invalidate("work_items");
}

/** Turning sync off asks for an optional reason (docs/17 §6.2). */
export function PauseDialog({ onPause, onClose }: { onPause: (reason: string | null) => void; onClose: () => void }) {
  const [reason, setReason] = useState("");
  return (
    <Dialog title="Pause sync for this client" onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn accent" onClick={() => onPause(reason.trim() || null)}>Pause</button>
      </>
    }>
      <Field label="Reason (optional)" hint="whole-book and scheduled sweeps skip this client; Sync now still works">
        <input className="input" value={reason} maxLength={120} aria-label="Reason (optional)" onChange={(e) => setReason(e.target.value)}
               onKeyDown={(e) => { if (e.key === "Enter") onPause(reason.trim() || null); }} />
      </Field>
    </Dialog>
  );
}

/** Deleting is permanent and reaches every device, so the dialog says what
 *  goes and asks for the client's name. */
function DeleteDialog({ client, onDeleted, onClose }: { client: MenuClient; onDeleted: () => void; onClose: () => void }) {
  const [preview, setPreview] = useState<DeletePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    api.clientDeletePreview(client.id).then((p) => { if (live) setPreview(p); })
      .catch((e) => { if (live) setError(describeError(e)); });
    return () => { live = false; };
  }, [client.id]);
  const matches = typed.trim().toLowerCase() === client.name.trim().toLowerCase();
  const remove = async () => {
    setBusy(true); setError(null);
    try {
      await api.deleteClient(client.id);
      refresh(client.id);
      invalidate("ingestion");
      toast(`${client.name} deleted.`);
      onDeleted();
    } catch (e) { setError(describeError(e)); }
    finally { setBusy(false); }
  };
  const n = (v: number, one: string, many = `${one}s`) => `${v.toLocaleString()} ${v === 1 ? one : many}`;
  return (
    <Dialog title={`Delete ${client.name}`} onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn danger" disabled={!matches || busy || !preview} onClick={() => { void remove(); }}>Delete client</button>
      </>
    }>
      {error ? <div className="banner danger" role="alert">{error}</div> : null}
      <p>
        {preview
          ? <>This removes the client, {n(preview.years, "assessment year")}, {n(preview.work_items, "work item")}, {n(preview.communications, "notice")} and {n(preview.documents, "document")} from this device and, when it syncs, from every device of the firm. It cannot be undone.</>
          : "Counting what goes with this client…"}
      </p>
      {preview ? (
        <p className="muted">
          {client.source === "portal"
            ? preview.login_shared
              ? "Another client signs in with the same login, so the stored portal password stays."
              : "The stored portal password for this client's login is deleted from the keychain too."
            : "ERI client: nothing is stored in the keychain for it."}
          {" "}Export the client first if you may need its records.
        </p>
      ) : null}
      <Field label="Type the client's name to confirm" wide>
        <input className="input" value={typed} autoFocus aria-label="Client name" onChange={(e) => setTyped(e.target.value)}
               onKeyDown={(e) => { if (e.key === "Enter" && matches && preview && !busy) void remove(); }} />
      </Field>
    </Dialog>
  );
}

type Open = null | "edit" | "history" | "pause" | "delete";

export default function ClientMenu({ client, onDeleted, label = "More" }: {
  client: MenuClient;
  /** After a delete; the Client 360 page leaves for the list. */
  onDeleted?: () => void;
  label?: string;
}) {
  const [menu, setMenu] = useState(false);
  // Fixed to the viewport so a scrolling table never clips it; flips up
  // when there is no room below.
  const [at, setAt] = useState<React.CSSProperties>({});
  const [open, setOpen] = useState<Open>(null);
  const [detail, setDetail] = useState<ClientDetail | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(false);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(false); };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("click", close); window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close);
    };
  }, [menu]);
  const toggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const below = window.innerHeight - r.bottom > 260;
    setAt({ position: "fixed", zIndex: 50, right: Math.max(8, window.innerWidth - r.right),
            ...(below ? { top: r.bottom + 4, bottom: "auto" } : { top: "auto", bottom: window.innerHeight - r.top + 4 }) });
    setMenu((m) => !m);
  };

  const run = async (f: () => Promise<unknown>, done: string) => {
    try { await f(); toast(done); refresh(client.id); }
    catch (e) { toastError(describeError(e)); }
  };
  const edit = async () => {
    try { setDetail(await api.client(client.id)); setOpen("edit"); }
    catch (e) { toastError(describeError(e)); }
  };
  const item = (icon: Parameters<typeof Icon>[0]["name"], text: string, f: () => void, danger = false) => (
    <button type="button" role="menuitem" className={danger ? "danger" : undefined}
            onClick={(e) => { e.stopPropagation(); setMenu(false); f(); }}>
      <Icon name={icon} /><span>{text}</span>
    </button>
  );
  const portal = client.source === "portal";

  return (
    <span className="c360-more" onClick={(e) => e.stopPropagation()}>
      <button type="button" className="btn icon" aria-label={`${label}: ${client.name}`} title={label} aria-haspopup="menu" aria-expanded={menu}
              onClick={toggle}><Icon name="more" /></button>
      {menu ? (
        <span className="c360-menu" role="menu" style={at}>
          {item("file", "Edit details", () => { void edit(); })}
          {portal ? item("refresh", "Sync now", () => { void run(() => api.refreshClient(client.id), "Sync queued for this client. Watch it on the Sync screen."); }) : null}
          {portal ? item("cloud-down", "Fetch history", () => setOpen("history")) : null}
          {portal ? (client.syncEnabled
            ? item("pause", "Pause sync", () => setOpen("pause"))
            : item("refresh", "Resume sync", () => { void run(() => api.setClientSync(client.id, true, null), "Included in sweeps again."); }))
            : null}
          {portal ? item("pin", client.pinned ? "Allow weekly when dormant" : "Keep syncing nightly",
            () => { void run(() => api.pinClientCadence(client.id, !client.pinned), client.pinned ? "Moves to weekly when dormant." : "Kept on the nightly sweep."); }) : null}
          <span className="menu-sep" role="separator" />
          {item("x", "Delete client", () => setOpen("delete"), true)}
        </span>
      ) : null}

      {open === "edit" && detail ? (
        <ClientForm existing={detail} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); refresh(client.id); }} />
      ) : null}
      {open === "history" ? (
        <DeepFetchDialog clientId={client.id} clientName={client.name} historyNote={client.historyNote}
                         tier={client.tier} onClose={() => setOpen(null)} />
      ) : null}
      {open === "pause" ? (
        <PauseDialog onClose={() => setOpen(null)}
                     onPause={(reason) => { setOpen(null); void run(() => api.setClientSync(client.id, false, reason), "Left out of whole-book and scheduled sweeps. Sync now still works."); }} />
      ) : null}
      {open === "delete" ? (
        <DeleteDialog client={client} onClose={() => setOpen(null)} onDeleted={() => { setOpen(null); onDeleted?.(); }} />
      ) : null}
    </span>
  );
}
