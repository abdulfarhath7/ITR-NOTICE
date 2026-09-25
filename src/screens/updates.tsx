/** Screen 8 — Updates (docs/16 §4): what changed since the previous sync,
 *  grouped. Rows newer than this device's "seen" watermark are shown open;
 *  older ones fold under "Seen earlier". No filters in this build. */
import { save } from "@tauri-apps/plugin-dialog";
import { useMemo, useState } from "react";
import { useDraft } from "../hooks/use-draft";
import { summaryAt, useLastSweepSummary, useSeenUntil, useUpdates } from "../hooks/use-updates";
import { api, describeError } from "../lib/api";
import { shortDateOf } from "../lib/due";
import { exportFileName } from "../lib/export-name";
import { plural } from "../lib/labels";
import { invalidate } from "../lib/query";
import { href, navigate } from "../lib/router";
import { sectionTone } from "../lib/section-tone";
import { toast, toastError } from "../lib/toast";
import type { SummaryCard, UpdateEntry, UpdateGroup } from "../lib/types";
import { stamp } from "../ui/dates";
import DraftDrawer from "../ui/draft-drawer";
import EmptyState from "../ui/empty-state";
import Icon, { type IconName } from "../ui/icons";
import { ErrorPage, LoadingPage, Page, PageBody, PageHead } from "../ui/page";
import PendingDocs from "../ui/pending-docs";

const GROUPS: { key: UpdateGroup; label: string; icon: IconName }[] = [
  { key: "new_notice", label: "New notices", icon: "inbox" },
  { key: "due_changed", label: "Due date changed", icon: "clock" },
  { key: "deadline_extended", label: "Deadline extended", icon: "calendar" },
  { key: "response_filed", label: "Response filed on portal", icon: "check" },
  { key: "closed", label: "Proceeding closed", icon: "shield" },
  { key: "demand_changed", label: "Demand changed", icon: "activity" },
  { key: "ao_viewed", label: "AO viewed", icon: "check" },
  { key: "limitation_changed", label: "Limitation", icon: "clock" },
  { key: "sync_failed", label: "Sync failed", icon: "alert" },
  { key: "history_fetched", label: "History fetched", icon: "cloud-down" },
  { key: "calendar_changed", label: "Calendar changed", icon: "calendar" },
];

/** Count-pill colours per the Build 4 mockup: purple "New" (accent here,
 *  docs/10 has one accent), green "AO viewed", amber "Limitation". */
const GROUP_TONE: Partial<Record<UpdateGroup, string>> = {
  new_notice: "accent", ao_viewed: "success", limitation_changed: "warning", sync_failed: "danger", deadline_extended: "warning",
};

/** A finished sweep within this many hours reads "Last night"; anything
 *  older, or a daytime run, reads "Last run". */
const LAST_NIGHT_HOURS = 20;

function istHour(iso: string): number | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Number(d.toLocaleString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false })) % 24;
}

function summaryTitle(card: SummaryCard, finishedAt: string): string {
  const age = Date.now() - new Date(finishedAt).getTime();
  const h = istHour(card.started_at);
  const overnight = h !== null && (h >= 18 || h < 9);
  return overnight && age >= 0 && age <= LAST_NIGHT_HOURS * 3_600_000 ? "Last night" : "Last run";
}

/** "Last night: swept 187, skipped 12 unchanged, 3 failed" (docs/17 §2.8). */
function SummaryCardView({ card, unread }: { card: SummaryCard; unread: boolean }) {
  const s = card.summary;
  const at = summaryAt(card);
  if (!s || !at) return null;
  const n = (v: number) => v.toLocaleString("en-IN");
  const parts = [`swept ${n(s.swept)}`, `skipped ${n(s.skipped_unchanged)} unchanged`, `${n(s.failed)} failed`];
  if (s.parked) parts.push(`${n(s.parked)} parked`);
  if (s.deep_done) parts.push(`${n(s.deep_done)} deep fetched`);
  if (s.warm_cached) parts.push(`${n(s.warm_cached)} warm cached`);
  return (
    <section className={`card upd-summary${unread ? " unread" : ""}`} aria-label="Last sweep summary">
      <div className="card-body">
        <Icon name="activity" />
        <span className="num">
          {summaryTitle(card, at)}: {parts.join(", ")}{s.window_closed ? " · window closed" : ""}
        </span>
        <span className="grow" />
        <span className="meta">{stamp(at)}</span>
      </div>
    </section>
  );
}

function SectionPill({ e }: { e: UpdateEntry }) {
  if (!e.section) return null;
  const tone = sectionTone({ section: e.section, section_1961: e.section_1961, section_2025: null, type_label: "" });
  return <span className={`pill ${tone}`}>{e.section}</span>;
}

function Detail({ e }: { e: UpdateEntry }) {
  const d = (iso: string | null) => shortDateOf(iso) ?? iso;
  switch (e.group) {
    case "new_notice":
      return e.due_date ? <span className="num">Due {d(e.due_date)}</span>
        : <span className="due warning">No due date<span className="unverified">unverified</span></span>;
    case "due_changed":
      return <span className="num"><s className="muted">{d(e.old_value) ?? "Not stated"}</s> → {d(e.new_value) ?? "Not stated"}</span>;
    case "response_filed":
      return <span className="num">Filed {d(e.filed_on) ?? "(date not stated)"}{e.reference ? <span className="mono muted"> · {e.reference}</span> : null}</span>;
    case "closed":
      return <span className="num">{e.filed_on ? `Closed ${d(e.filed_on)}` : "Closed"}</span>;
    case "demand_changed":
      return <span className="num"><s className="muted">{e.old_value ?? "—"}</s> → {e.new_value ?? "—"}</span>;
    case "sync_failed":
      return <span className="wrap">{e.reason ?? (e.run_status === "credentials_parked" ? "Credentials need attention" : "The run failed")}</span>;
    case "history_fetched":
      return null;
    case "ao_viewed":
      return <span className="num">Reply viewed by AO {d(e.filed_on) ?? ""}{e.reason ? <span className="muted"> · first seen {stamp(e.reason)}</span> : null}</span>;
    case "limitation_changed":
      return <span className="num"><s className="muted">{d(e.old_value) ?? "Not stated"}</s> → {d(e.new_value) ?? "Not stated"}{e.reason ? <span className="muted"> · {e.reason}</span> : null}</span>;
    case "deadline_extended":
      return <span className="num"><s className="muted">{d(e.old_value) ?? "?"}</s> → {d(e.new_value) ?? "?"}{e.reference ? ` · Circular ${e.reference}` : ""}</span>;
    case "calendar_changed":
      return <span>{e.status === "statutory_added" ? `New deadline${e.new_value ? ` · ${d(e.new_value)}` : ""}`
        : e.status === "statutory_removed" ? "Removed from the portal calendar"
        : "Extension note needs a look"}{e.reason ? <span className="muted"> · {e.reason}</span> : null}</span>;
  }
}

function Actions({ e, onDraft, onDate }: { e: UpdateEntry; onDraft: () => void; onDate: () => void }) {
  const view = e.module && e.item_id ? href({ name: "item", module: e.module, id: e.item_id }) : null;
  const retry = async () => {
    if (!e.client_id) return;
    try { await api.refreshClient(e.client_id); toast("Queued a sweep for this client."); invalidate("work_items"); }
    catch (err) { toastError(describeError(err)); }
  };
  switch (e.group) {
    case "new_notice":
      return <span className="actions">
        {view ? <a className="btn small" href={view}>View</a> : null}
        {e.reference ? (e.due_date
          ? <button className="btn small" onClick={onDraft}>Draft</button>
          : <button className="btn small" onClick={onDate}>✦ Date</button>) : null}
      </span>;
    case "response_filed":
      return view ? <a className="btn small" href={view}>Open</a> : null;
    case "history_fetched":
      return e.client_id ? <a className="btn small" href={href({ name: "client", id: e.client_id })}>View</a> : null;
    case "deadline_extended":
    case "calendar_changed":
      return e.due_date ? <a className="btn small" href={href({ name: "calendar", day: e.due_date })}>Open</a> : null;
    case "sync_failed":
      return e.client_id ? (e.run_status === "credentials_parked"
        ? <button className="btn small" onClick={() => navigate({ name: "client", id: e.client_id!, tab: "credentials" })}>Fix</button>
        : <button className="btn small" onClick={() => { void retry(); }}>Retry</button>) : null;
    default:
      return view ? <a className="btn small" href={view}>View</a> : null;
  }
}

/** "History fetched · <client> · 1,204 items", the depth note beneath. */
function HistoryLine({ e }: { e: UpdateEntry }) {
  const count = Number.parseInt(e.new_value ?? "", 10);
  const items = Number.isFinite(count) ? `${count.toLocaleString("en-IN")} ${count === 1 ? "item" : "items"}` : null;
  return (
    <div className="upd-client upd-span">
      <span>{["History fetched", e.client_name ?? "Client not in the book", items].filter(Boolean).join(" · ")}</span>
      {e.reason ? <span className="upd-history-note">{e.reason}</span> : null}
    </div>
  );
}

function GroupCard({ group, entries, onDraft, onDate }: {
  group: (typeof GROUPS)[number]; entries: UpdateEntry[];
  onDraft: (e: UpdateEntry) => void; onDate: (e: UpdateEntry) => void;
}) {
  return (
    <section className={`card upd-card${group.key === "sync_failed" ? " danger" : ""}`}>
      <div className="card-head">
        <Icon name={group.icon} />
        <h2>{group.label}</h2>
        <span className={`pill ${GROUP_TONE[group.key] ?? ""}`}>{entries.length}</span>
      </div>
      <div className="upd-rows">
        {entries.map((e, i) => e.group === "deadline_extended" || e.group === "calendar_changed" ? (
          <div key={`${e.group}:${e.item_id}:${e.at}:${i}`} className="upd-row">
            <div className="upd-client upd-span"><span>{e.section ?? "Statutory deadline"}</span><span className="sub"><Detail e={e} /></span></div>
            <div className="upd-actions"><Actions e={e} onDraft={() => onDraft(e)} onDate={() => onDate(e)} /></div>
          </div>
        ) : e.group === "history_fetched" ? (
          <div key={`${e.group}:${e.client_id}:${e.at}:${i}`} className="upd-row">
            <HistoryLine e={e} />
            <div className="upd-actions"><Actions e={e} onDraft={() => onDraft(e)} onDate={() => onDate(e)} /></div>
          </div>
        ) : (
          <div key={`${e.group}:${e.item_id ?? e.client_id}:${e.at}:${i}`} className="upd-row">
            <div className="upd-client">
              <span>{e.client_name ?? <span className="muted">Client not in the book</span>}</span>
              <span className="sub mono">{[e.pan_masked, e.assessment_year ? `AY ${e.assessment_year}` : null].filter(Boolean).join(" · ")}</span>
            </div>
            <div><SectionPill e={e} /><PendingDocs count={e.pending_documents} /></div>
            <div><Detail e={e} /></div>
            <div className="upd-actions"><Actions e={e} onDraft={() => onDraft(e)} onDate={() => onDate(e)} /></div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Groups({ entries, onDraft, onDate }: { entries: UpdateEntry[]; onDraft: (e: UpdateEntry) => void; onDate: (e: UpdateEntry) => void }) {
  return (
    <>
      {GROUPS.map((g) => {
        const rows = entries.filter((e) => e.group === g.key);
        return rows.length ? <GroupCard key={g.key} group={g} entries={rows} onDraft={onDraft} onDate={onDate} /> : null;
      })}
    </>
  );
}

export default function UpdatesScreen() {
  const q = useUpdates();
  const last = useLastSweepSummary();
  const [seen, markSeen] = useSeenUntil();
  const [showSeen, setShowSeen] = useState(false);
  const draft = useDraft();
  const entries = useMemo(() => q.data?.entries ?? [], [q.data]);
  const fresh = entries.filter((e) => e.at > seen);
  const card = last.data ?? null;
  const cardAt = summaryAt(card);
  const cardUnread = !!cardAt && cardAt > seen;
  const old = entries.filter((e) => e.at <= seen);

  if (q.error) return <ErrorPage message={q.error} />;
  if (!q.data) return <LoadingPage />;

  const markAll = () => {
    const newest = [...entries.map((e) => e.at), cardAt ?? ""].reduce((m, at) => (at > m ? at : m), new Date().toISOString());
    markSeen(newest);
    toast("All updates marked seen.");
  };
  const exportAll = async () => {
    try {
      const path = await save({ defaultPath: exportFileName("Updates"), filters: [{ name: "Excel", extensions: ["xlsx"] }] });
      if (!path) return;
      const n = await api.exportUpdates(path, q.data?.since ?? undefined);
      toast(`Exported ${plural(n, "update")}.`);
    } catch (e) { toastError(describeError(e)); }
  };
  const onDate = async (e: UpdateEntry) => {
    if (!e.reference) return;
    try {
      const a = await api.suggestDueDate(e.reference);
      toast(a.due_date ? `Suggested ${a.due_date}${a.basis ? `: ${a.basis}` : ""}` : (a.basis ?? "No deadline was found in this notice."));
      invalidate("work_items");
    } catch (err) { toastError(describeError(err)); }
  };

  return (
    <Page>
      <PageHead title="Updates" meta={q.data.since ? `Compared with sync on ${stamp(q.data.since)}` : "Nothing synced yet"}>
        {fresh.length || cardUnread ? <button className="btn quiet" onClick={markAll}>Mark all seen</button> : null}
        <button className="btn" onClick={() => { void exportAll(); }} disabled={!entries.length}><Icon name="upload" /><span>Export</span></button>
      </PageHead>
      <PageBody>
        {card ? <SummaryCardView card={card} unread={cardUnread} /> : null}
        {!entries.length ? (
          <div className="card">
            <EmptyState title={q.data.since ? "Nothing changed since the last sync." : "No sync has run yet."}
                        body={q.data.since ? "New notices, date changes, filed responses, closures, demand changes and failed runs appear here after each sweep."
                          : "Once a sweep has run, what it found new or changed shows here."}
                        action={q.data.since ? undefined : <a className="btn" href={href({ name: "ingestion" })}>Go to ingestion</a>} />
          </div>
        ) : (
          <>
            {fresh.length ? <Groups entries={fresh} onDraft={(e) => { if (e.reference) void draft.open(e.reference); }} onDate={(e) => { void onDate(e); }} />
              : <p className="muted">Everything here has been seen.</p>}
            {old.length ? (
              <div className="stack">
                <button className="btn quiet upd-seen-toggle" onClick={() => setShowSeen((v) => !v)} aria-expanded={showSeen}>
                  <Icon name={showSeen ? "chevron-down" : "chevron-right"} /><span>Seen earlier</span><span className="count">{old.length}</span>
                </button>
                {showSeen ? <Groups entries={old} onDraft={(e) => { if (e.reference) void draft.open(e.reference); }} onDate={(e) => { void onDate(e); }} /> : null}
              </div>
            ) : null}
          </>
        )}
      </PageBody>
      {draft.draft ? <DraftDrawer draft={draft.draft} busy={draft.busy} sourceDocumentId={null} onClose={draft.close}
                                  onSave={(t) => { void draft.saveText(t); }} onReviewed={(r) => { void draft.setReviewed(r); }} /> : null}
    </Page>
  );
}
