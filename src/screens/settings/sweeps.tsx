/** Settings › Sweeps: per-module cadence (Q12), the unattended schedule
 *  (Q09) and the worker count (Q08, one constant, default 1). */
import { useState } from "react";
import { api, describeError } from "../../lib/api";
import { CADENCE_LABEL, MODULES, MODULE_LABEL } from "../../lib/labels";
import { invalidate, useQuery } from "../../lib/query";
import { toast, toastError } from "../../lib/toast";
import type { Cadence, Cadences, SweepSchedule } from "../../lib/types";
import { Row, Section } from "./ui";

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

function ScheduleSection() {
  const q = useQuery<SweepSchedule>("schedule", () => api.sweepSchedule());
  const [draft, setDraft] = useState<SweepSchedule | null>(null);
  const [busy, setBusy] = useState(false);
  const value = draft ?? q.data;
  const save = async () => {
    if (!draft) return;
    setBusy(true);
    try { await api.setSweepSchedule(draft); invalidate("schedule"); setDraft(null); toast("Schedule saved."); }
    catch (e) { toastError(describeError(e)); }
    finally { setBusy(false); }
  };
  if (!value) return <Section title="Unattended sweep"><Row label="Loading"><span /></Row></Section>;
  const toggleDay = (day: number, on: boolean) =>
    setDraft({ ...value, days: on ? [...value.days, day].sort((a, b) => a - b) : value.days.filter((d) => d !== day) });
  return (
    <Section title="Unattended sweep"
             description="At this time (IST) on these days the collector starts a sweep by itself. If the portal asks for an OTP or a captcha the run pauses and the app alerts; it never fails for want of a person. Under a relay only the nominated collector runs it."
             save={{ dirty: !!draft, busy, onSave: () => { void save(); }, onDiscard: () => setDraft(null) }}>
      <Row label="Enabled" hint={value.enabled ? "A run starts on schedule." : "Runs start only by hand."}>
        <label className="switch">
          <input type="checkbox" role="switch" checked={value.enabled} onChange={(e) => setDraft({ ...value, enabled: e.target.checked })} />
          <span className="track" />
        </label>
      </Row>
      <Row label="Time" hint="Indian Standard Time, whatever the machine's zone">
        <input className="input mono" type="time" value={value.time} onChange={(e) => setDraft({ ...value, time: e.target.value })} aria-label="Time" />
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
        <select className="select" value={value.scope} aria-label="Scope" onChange={(e) => setDraft({ ...value, scope: e.target.value as "due" | "all" })}>
          <option value="due">What is due by cadence</option>
          <option value="all">Every module</option>
        </select>
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
