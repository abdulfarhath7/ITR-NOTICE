/** Settings › Sweeps: per-module cadence (Q12), the unattended schedule
 *  (Q09) and the worker count (Q08, one constant, default 1). */
import { useState } from "react";
import { api, describeError } from "../../lib/api";
import { CADENCE_LABEL, MODULES, MODULE_LABEL } from "../../lib/labels";
import { invalidate, useQuery } from "../../lib/query";
import { toast, toastError } from "../../lib/toast";
import type { Cadence, Cadences, SweepSchedule } from "../../lib/types";
import { Row, Section, Segmented } from "./ui";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const CADENCES = Object.keys(CADENCE_LABEL) as Cadence[];

function CadenceSection() {
  const q = useQuery<Cadences>("cadence", () => api.sweepCadence());
  const [draft, setDraft] = useState<Cadences | null>(null);
  const [busy, setBusy] = useState(false);
  const value = draft ?? q.data;
  const save = async () => {
    if (!draft) return;
    setBusy(true);
    try { await api.setSweepCadence(draft); invalidate("cadence"); setDraft(null); toast("Cadence saved."); }
    catch (e) { toastError(describeError(e)); }
    finally { setBusy(false); }
  };
  return (
    <Section title="Cadence" description="“Sweep what is due” on the Ingestion screen runs the modules whose cadence has elapsed since their last successful sweep on this device."
             save={{ dirty: !!draft, busy, onSave: () => { void save(); }, onDiscard: () => setDraft(null) }}>
      {MODULES.map((m) => (
        <Row key={m} label={MODULE_LABEL[m]}>
          {value ? (
            <select className="select" value={value[m]} aria-label={`${MODULE_LABEL[m]} cadence`}
                    onChange={(e) => setDraft({ ...value, [m]: e.target.value as Cadence })}>
              {CADENCES.map((c) => <option key={c} value={c}>{CADENCE_LABEL[c]}</option>)}
            </select>
          ) : <span className="muted">Loading</span>}
        </Row>
      ))}
    </Section>
  );
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const WARM_OPTIONS = [
  { value: "0", label: "Off" }, { value: "3", label: "3 days" }, { value: "7", label: "7 days" }, { value: "15", label: "15 days" },
];

/** A whole number of at least `min`, or null while the field is mid-edit. */
function wholeNumber(raw: string, min: number): number | null {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= min ? n : null;
}

function Switch({ checked, label, onChange }: { checked: boolean; label: string; onChange: (on: boolean) => void }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" aria-label={label} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" />
    </label>
  );
}

function ScheduleSection() {
  const q = useQuery<SweepSchedule>("schedule", () => api.sweepSchedule());
  const [draft, setDraft] = useState<SweepSchedule | null>(null);
  const [busy, setBusy] = useState(false);
  const value = draft ?? q.data;
  const save = async () => {
    if (!draft) return;
    if (draft.run_window_start === draft.run_window_end) { toastError("The run window needs a different start and end."); return; }
    setBusy(true);
    try { await api.setSweepSchedule(draft); invalidate("schedule"); invalidate("sync"); setDraft(null); toast("Schedule saved."); }
    catch (e) { toastError(describeError(e)); }
    finally { setBusy(false); }
  };
  if (!value) return <Section title="Unattended sweep"><Row label={q.error ? "Schedule unavailable" : "Loading"}><span /></Row></Section>;
  const set = (patch: Partial<SweepSchedule>) => setDraft({ ...value, ...patch });
  const toggleDay = (day: number, on: boolean) =>
    set({ days: on ? [...value.days, day].sort((a, b) => a - b) : value.days.filter((d) => d !== day) });
  const never = value.dormant_after_days === null;
  return (
    <Section title="Unattended sweep"
             description="Within this window (IST) on these days the collector sweeps by itself and stops at the window's end, carrying the rest to the next night. If the portal asks for an OTP or a captcha the run pauses and the app alerts; it never fails for want of a person. Under a relay only the nominated collector runs it."
             save={{ dirty: !!draft, busy, onSave: () => { void save(); }, onDiscard: () => setDraft(null) }}>
      <Row label="Enabled" hint={value.enabled ? "A run starts on schedule." : "Runs start only by hand."}>
        <Switch checked={value.enabled} label="Enabled" onChange={(on) => set({ enabled: on })} />
      </Row>
      <Row label="Run window" hint="Indian Standard Time, whatever the machine's zone. An end before the start runs past midnight.">
        <span className="settings-inline">
          <input className="input mono" type="time" value={value.run_window_start} aria-label="Run window start"
                 onChange={(e) => { if (e.target.value) set({ run_window_start: e.target.value }); }} />
          <span className="muted">to</span>
          <input className="input mono" type="time" value={value.run_window_end} aria-label="Run window end"
                 onChange={(e) => { if (e.target.value) set({ run_window_end: e.target.value }); }} />
        </span>
      </Row>
      <Row label="Days">
        <div className="chips" role="group" aria-label="Days">
          {DAYS.map((d, i) => {
            const on = value.days.includes(i + 1);
            return (
              <button key={d} type="button" className={`chip${on ? " on" : ""}`} aria-pressed={on} onClick={() => toggleDay(i + 1, !on)}>{d}</button>
            );
          })}
        </div>
      </Row>
      <Row label="What to sweep">
        <select className="select" value={value.scope} aria-label="Scope" onChange={(e) => set({ scope: e.target.value as "due" | "all" })}>
          <option value="due">What is due by cadence</option>
          <option value="all">Every module</option>
        </select>
      </Row>
      <Row label="Look back for new items" hint="Notices issued within this many days are read each night.">
        <span className="settings-inline">
          <input className="input mono num-short" type="number" min={1} value={value.lookback_days} aria-label="Look back, days"
                 onChange={(e) => { const n = wholeNumber(e.target.value, 1); if (n !== null) set({ lookback_days: n }); }} />
          <span className="muted">days</span>
        </span>
      </Row>
      <Row label="Re-check open items every night" hint="Every open item is read again each night, however old. This is fixed.">
        <span className="settings-readonly">On</span>
      </Row>
      <Row label="Dormant after" hint={never ? "No client goes dormant." : "A client with no open item and no change for this long is swept on the dormant cadence."}>
        <span className="settings-inline">
          <input className="input mono num-short" type="number" min={1} disabled={never} value={value.dormant_after_days ?? 90}
                 aria-label="Dormant after, days"
                 onChange={(e) => { const n = wholeNumber(e.target.value, 1); if (n !== null) set({ dormant_after_days: n }); }} />
          <span className="muted">days</span>
          <label className="settings-inline">
            <Switch checked={never} label="Never dormant" onChange={(on) => set({ dormant_after_days: on ? null : 90 })} />
            <span>Never</span>
          </label>
        </span>
      </Row>
      <Row label="Dormant cadence" hint="Dormant clients are swept on this day.">
        <span className="settings-inline">
          <Segmented label="Dormant cadence" value={value.dormant_cadence}
                     options={[{ value: "weekly", label: "Weekly" }, { value: "fortnightly", label: "Fortnightly" }]}
                     onChange={(v) => set({ dormant_cadence: v })} />
          <select className="select" value={value.dormant_weekday} aria-label="Dormant sweep day"
                  onChange={(e) => set({ dormant_weekday: Number(e.target.value) })}>
            {WEEKDAYS.map((w, i) => <option key={w} value={i + 1}>{w}</option>)}
          </select>
        </span>
      </Row>
      <Row label="Per-client timeout" hint="A client that takes longer is stopped and retried the next night.">
        <span className="settings-inline">
          <input className="input mono num-short" type="number" min={1} value={value.client_timeout_min} aria-label="Per-client timeout, minutes"
                 onChange={(e) => { const n = wholeNumber(e.target.value, 1); if (n !== null) set({ client_timeout_min: n }); }} />
          <span className="muted">minutes</span>
        </span>
      </Row>
      <Row label="Documents during sweep" hint={value.docs_policy === "index" ? "The sweep records notices; documents are fetched when you open an item or by warm cache." : "Documents are downloaded while the window lasts."}>
        <Segmented label="Documents during sweep" value={value.docs_policy}
                   options={[{ value: "index", label: "Index only" }, { value: "download", label: "Download within window" }]}
                   onChange={(v) => set({ docs_policy: v })} />
      </Row>
      <Row label="Warm cache after sweep" hint="Time left in the window fetches documents of items issued or due within this many days.">
        <Segmented label="Warm cache after sweep" value={String(value.warm_cache_days)} options={WARM_OPTIONS}
                   onChange={(v) => set({ warm_cache_days: Number(v) })} />
      </Row>
      <Row label="Fetch documents when I open an item" hint="Opening an item with documents not fetched yet starts the fetch.">
        <Switch checked={value.auto_item_fetch} label="Fetch documents when I open an item" onChange={(on) => set({ auto_item_fetch: on })} />
      </Row>
      <Row label="Retry failed clients" hint="This is fixed.">
        <span className="settings-readonly">Next night, every night until fixed</span>
      </Row>
    </Section>
  );
}

export default function Sweeps() {
  return (
    <>
      <CadenceSection />
      <ScheduleSection />
      <Section title="Workers" description="Ingestion concurrency is one constant in the core (Q08). The portal allows one live session per taxpayer, and a second login evicts the first, so the sweep is sequential until two live tests justify more.">
        <Row label="Concurrent logins"><span className="mono">1</span></Row>
      </Section>
    </>
  );
}
