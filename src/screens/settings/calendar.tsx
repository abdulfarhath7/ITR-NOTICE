/** Settings › Calendar (docs/19 §8): the portal calendar's fetch, the
 *  cadence, first day of week, default scope, the sidebar mini, the firm
 *  dates manager and the .ics export. Rows persist as they change. */
import { useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { api, describeError } from "../../lib/api";
import { fyLabel, fyStartYear } from "../../lib/calendar-grid";
import { todayIst } from "../../lib/dates";
import { plural } from "../../lib/labels";
import { invalidate, useQuery } from "../../lib/query";
import { toast, toastError } from "../../lib/toast";
import type { CalendarSettings, FirmDate, StatutoryStatus } from "../../lib/types";
import { stamp } from "../../ui/dates";
import { Confirm, Dialog } from "../../ui/dialog";
import Field from "../../ui/field";
import Icon from "../../ui/icons";
import { Row, Section, Segmented } from "./ui";

function FirmDateDialog({ existing, onClose }: { existing: FirmDate | null; onClose: () => void }) {
  const [dueOn, setDueOn] = useState(existing?.due_on ?? "");
  const [title, setTitle] = useState(existing?.title ?? "");
  const [note, setNote] = useState(existing?.note ?? "");
  const [busy, setBusy] = useState(false);
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(dueOn) && title.trim().length > 0;
  const submit = async () => {
    setBusy(true);
    try {
      await api.upsertFirmDate(existing?.id ?? null, dueOn, title.trim(), note.trim() || null);
      invalidate("firm_dates");
      invalidate("statutory");
      toast(existing ? "Firm date saved." : "Firm date added.");
      onClose();
    } catch (e) { toastError(describeError(e)); }
    finally { setBusy(false); }
  };
  return (
    <Dialog title={existing ? "Edit firm date" : "Add firm date"} onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn accent" disabled={!ok || busy} onClick={() => { void submit(); }}>{existing ? "Save" : "Add"}</button>
      </>
    }>
      <div className="form-grid">
        <Field label="Date"><input className="input mono" type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} aria-label="Date" /></Field>
        <Field label="Title" wide><input className="input" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} aria-label="Title" /></Field>
        <Field label="Note" hint="optional; shown on the agenda row's tooltip" wide>
          <input className="input" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} aria-label="Note" />
        </Field>
      </div>
    </Dialog>
  );
}

function FirmDates() {
  const q = useQuery<FirmDate[]>("firm_dates", () => api.firmDates());
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<FirmDate | null | "new">(null);
  const [deleting, setDeleting] = useState<FirmDate | null>(null);
  const remove = async (f: FirmDate) => {
    try { await api.deleteFirmDate(f.id); invalidate("firm_dates"); invalidate("statutory"); toast("Firm date deleted."); }
    catch (e) { toastError(describeError(e)); }
    finally { setDeleting(null); }
  };
  return (
    <>
      <div className="row">
        <button className="btn small" onClick={() => setOpen((o) => !o)} aria-expanded={open}>Manage</button>
        <span className="meta">{q.data ? plural(q.data.length, "firm date") : "…"}</span>
      </div>
      {open ? (
        <div className="stack" style={{ marginTop: "0.5rem" }}>
          {q.data?.length ? (
            <table className="table">
              <tbody>
                {q.data.map((f) => (
                  <tr key={f.id}>
                    <td className="num">{f.due_on}</td>
                    <td className="wrap">{f.title}{f.note ? <div className="sub">{f.note}</div> : null}</td>
                    <td className="right">
                      <span className="actions">
                        <button className="btn small" onClick={() => setEditing(f)}>Edit</button>
                        <button className="btn small danger" onClick={() => setDeleting(f)}>Delete</button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="muted">No firm dates yet. A GST or MCA date the portal calendar does not carry goes here.</p>}
          <div><button className="btn small accent" onClick={() => setEditing("new")}><Icon name="plus" /><span>Add</span></button></div>
        </div>
      ) : null}
      {editing ? <FirmDateDialog existing={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
      {deleting ? <Confirm title="Delete firm date" body={`Delete "${deleting.title}" on ${deleting.due_on}? Every device drops it on its next sync.`}
                           confirmLabel="Delete" danger onClose={() => setDeleting(null)} onConfirm={() => { void remove(deleting); }} /> : null}
    </>
  );
}

export default function Calendar() {
  const settings = useQuery<CalendarSettings>("calendar:settings", () => api.calendarSettings());
  const status = useQuery<StatutoryStatus>("statutory:status", () => api.statutoryStatus());
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const fy = fyStartYear(todayIst());

  const patch = async (p: Partial<CalendarSettings>) => {
    if (!settings.data) return;
    try { await api.setCalendarSettings({ ...settings.data, ...p }); invalidate("calendar:settings"); }
    catch (e) { toastError(describeError(e)); }
  };
  const refresh = async () => {
    setRefreshing(true);
    try {
      const out = await api.refreshStatutory();
      const failed = out.filter((o) => o.status === "failed");
      if (failed.length === out.length) toastError(`Portal calendar unavailable: ${failed[0]?.error ?? "no answer"}`);
      else toast(`Refreshed: ${out.reduce((n, o) => n + o.added, 0)} added, ${out.reduce((n, o) => n + o.extended, 0)} extended, ${out.reduce((n, o) => n + o.removed, 0)} removed.`);
      invalidate("statutory");
      invalidate("updates");
    } catch (e) { toastError(describeError(e)); }
    finally { setRefreshing(false); }
  };
  const exportIcs = async () => {
    try {
      const path = await save({ defaultPath: `LCC_calendar_${fyLabel(fy).replace(/\s+/g, "_")}.ics`, filters: [{ name: "Calendar", extensions: ["ics"] }] });
      if (!path) return;
      setExporting(true);
      await api.exportStatutoryIcs(fy, path);
      toast("Calendar file written. Statutory and firm dates only; notices are never exported here.");
    } catch (e) { toastError(describeError(e)); }
    finally { setExporting(false); }
  };

  const s = settings.data;
  const st = status.data;
  return (
    <>
      <Section title="Portal calendar" description="The Income Tax Department's public tax calendar, fetched without a login. Extensions move a date and show on Updates.">
        <Row label="Portal calendar" hint={st?.last_status === "failed" ? `Last attempt failed: ${st.last_error ?? "no answer"}` : st?.next_due ? `Next refresh ${st.next_due}` : undefined}>
          <div className="row">
            <span className="meta">
              {st ? (st.last_fetched_at ? `Last fetched ${stamp(st.last_fetched_at)} · ${plural(st.deadlines, "deadline")}` : "Not fetched yet") : "…"}
            </span>
            <button className="btn small" disabled={refreshing} onClick={() => { void refresh(); }}><Icon name="refresh" /><span>Refresh now</span></button>
          </div>
        </Row>
        <Row label="Refresh" hint="Weekly on the run window's first day; nightly around the FY boundary either way.">
          {s ? <Segmented label="Refresh" value={s.refresh} onChange={(v) => { void patch({ refresh: v }); }} options={[{ value: "weekly", label: "Weekly" }, { value: "nightly", label: "Nightly" }]} /> : null}
        </Row>
      </Section>
      <Section title="Calendar screen">
        <Row label="First day of week">
          {s ? <Segmented label="First day of week" value={s.first_day} onChange={(v) => { void patch({ first_day: v }); }} options={[{ value: "monday", label: "Monday" }, { value: "sunday", label: "Sunday" }]} /> : null}
        </Row>
        <Row label="Default scope" hint="Applies to us reads each client's calendar profile.">
          {s ? <Segmented label="Default scope" value={s.default_scope} onChange={(v) => { void patch({ default_scope: v }); }}
                          options={[{ value: "all", label: "All" }, { value: "applies", label: "Applies to us" }, { value: "overdue", label: "Overdue" }]} /> : null}
        </Row>
        <Row label={"Sidebar “Next deadlines”"}>
          {s ? (
            <label className="switch"><input type="checkbox" checked={s.sidebar_mini} onChange={(e) => { void patch({ sidebar_mini: e.target.checked }); }} aria-label="Show next deadlines in the sidebar" /><span className="track" /></label>
          ) : null}
        </Row>
      </Section>
      <Section title="Firm dates" description="Your own dates on the same grid: a GST return, an MCA filing, a hearing. Synced to every device.">
        <Row label="Firm dates" stacked><FirmDates /></Row>
      </Section>
      <Section title="Export">
        <Row label={`.ics for ${fyLabel(fy)}`} hint="Statutory and firm dates as all-day events. Notices are client data and are never exported here.">
          <button className="btn small" disabled={exporting} onClick={() => { void exportIcs(); }}><Icon name="upload" /><span>Export .ics</span></button>
        </Row>
      </Section>
    </>
  );
}
