/** The proceeding thread as a two-lane flow (docs/thread-flow-context.md).
 *
 *  Department on the left, firm on the right, one spine between. Shape says
 *  what happened, colour says where it stands, a dashed line says nobody has
 *  answered yet. Pairing lives in lib/thread-pairing; this file only draws. */
import { useMemo, useState, type CSSProperties } from "react";
import type { useDocuments } from "../hooks/use-documents";
import { describeGap, type DueDescription } from "../lib/due";
import { actionsFor } from "../lib/status";
import {
  annotate, communicationsOf, openSummary, pairThread, unfold,
  type AdjournmentView, type FlowRow, type PairRow, type PairState, type RepeatRow,
} from "../lib/thread-pairing";
import type { AdjournmentRow, CommunicationView, ProceedingDetail, ResponseRow } from "../lib/types";
import { DateCell } from "./dates";
import { DocRow } from "./doc-list";
import DueText from "./due-text";
import EmptyState from "./empty-state";
import Gap from "./gap";
import Icon from "./icons";
import { StatusPill } from "./pill";

type Docs = ReturnType<typeof useDocuments>;

interface Handlers {
  p: ProceedingDetail;
  docs: Docs;
  onDraft: (c: CommunicationView) => void;
  onSuggest: (c: CommunicationView) => void;
}

// Spine geometry, in px from the row top and the spine column's left edge.
const NODE_Y = 18;
const RESP_DROP = 36;
const REPEAT_STEP = 12;
const SPINE_X = 28;
const BRANCH_X = 44;
const DIAMOND_Y = 30;

/** `Sec 268 (old 148)` when both statutes are known (docs/09). */
function sectionText(s2025: string | null, s1961: string | null): string | null {
  if (s2025 && s1961) return `Sec ${s2025} (old ${s1961})`;
  if (s1961) return `Sec ${s1961}`;
  if (s2025) return `Sec ${s2025}`;
  return null;
}

type Shape = "circle" | "small" | "diamond" | "ring" | "cap" | "square";

export function SpineNode({ shape, x = SPINE_X, y, tone, ring = null, pulse = false }: {
  shape: Shape; x?: number; y: number; tone?: PairState; ring?: number | null; pulse?: boolean;
}) {
  const style: CSSProperties = { left: x - 8, top: y - 8 };
  const cls = `tf-node${tone ? ` tf-${tone}` : ""}${pulse ? " pulse" : ""}`;
  const c = 2 * Math.PI * 6;
  return (
    <svg className={cls} style={style} width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      {shape === "circle" ? <circle cx="8" cy="8" r="5" className="fill" /> : null}
      {shape === "small" ? <circle cx="8" cy="8" r="3.5" className="fill" /> : null}
      {shape === "cap" ? <circle cx="8" cy="8" r="3" className="fill" /> : null}
      {shape === "square" ? <rect x="5" y="5" width="6" height="6" className="fill" /> : null}
      {shape === "diamond" ? <polygon points="8,2.5 13.5,8 8,13.5 2.5,8" className="fill" /> : null}
      {shape === "ring" ? (
        <>
          <circle cx="8" cy="8" r="6" className="hollow" />
          {ring !== null ? (
            <circle cx="8" cy="8" r="6" className="arc" transform="rotate(-90 8 8)"
                    strokeDasharray={`${(ring * c).toFixed(2)} ${c.toFixed(2)}`} />
          ) : null}
        </>
      ) : null}
    </svg>
  );
}

/** A straight connector piece; `v` runs down the spine, `h` across to a card. */
function Connector({ dir, x, y, to, dashed = false, branch = false }: {
  dir: "h" | "v"; x: number; y: number; to?: number; dashed?: boolean; branch?: boolean;
}) {
  const style: CSSProperties = dir === "h"
    ? { left: x, top: y - 1, width: to === undefined ? undefined : to - x, right: to === undefined ? 0 : undefined }
    : { left: x - 1, top: y, height: to === undefined ? undefined : to - y, bottom: to === undefined ? 0 : undefined };
  return <span className={`tf-line ${dir}${dashed ? " dashed" : ""}${branch ? " branch" : ""}`} style={style} />;
}

/** A curve between the spine and the branch lane, `fromX,fromY` to `toX,toY`. */
function Curve({ fromX, fromY, toX, toY }: { fromX: number; fromY: number; toX: number; toY: number }) {
  const left = Math.min(fromX, toX) - 1, top = Math.min(fromY, toY);
  const w = Math.abs(toX - fromX) + 2, h = Math.abs(toY - fromY);
  const x1 = fromX - left, y1 = fromY - top, x2 = toX - left, y2 = toY - top;
  const mid = (y1 + y2) / 2;
  return (
    <svg className="tf-curve" style={{ left, top }} width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path d={`M${x1} ${y1} C${x1} ${mid} ${x2} ${mid} ${x2} ${y2}`} />
    </svg>
  );
}

function Chevron({ open }: { open: boolean }) {
  return <Icon name="chevron-right" className={`tf-chev${open ? " open" : ""}`} />;
}

function Ticks({ seen }: { seen: boolean }) {
  return (
    <span className={`tf-ticks${seen ? " seen" : ""}`} role="img" aria-label={seen ? "filed, viewed by the AO" : "filed"}>
      <Icon name="check" />{seen ? <Icon name="check" /> : null}
    </span>
  );
}

function CardHead({ open, onToggle, children }: { open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className="tf-head" aria-expanded={open} onClick={onToggle}>
      <Chevron open={open} />{children}
    </button>
  );
}

function CommCard({ c, effective, due, h }: { c: CommunicationView; effective: string; due: DueDescription; h: Handlers }) {
  const [open, setOpen] = useState(false);
  const can = actionsFor(effective);
  return (
    <article className="tf-card">
      <CardHead open={open} onToggle={() => setOpen(!open)}>
        <b>{c.description ?? c.type_label}</b>
        <span className="meta num">issued <DateCell iso={c.issued_on} gap={c.gaps.includes("issued_on")} /></span>
      </CardHead>
      {!open && c.documents.length ? (
        <div className="tf-chips">
          {c.documents.map((d) => <span key={d.id} className="tf-chip"><Icon name="file" className="faint" />{d.filename ?? d.doc_kind}</span>)}
        </div>
      ) : null}
      {open ? (
        <div className="tf-body">
          <span className="row"><span className="pill">{c.type_label}</span><StatusPill status={c.status} /></span>
          <dl className="kv">
            <dt>Reference</dt><dd className="mono">{c.reference_id}</dd>
            <dt>DIN</dt><dd><Gap value={c.din} gaps={c.gaps} column="din" mono /></dd>
            <dt>Section</dt><dd><Gap value={sectionText(c.section_2025, c.section_1961)} gaps={c.gaps} column="section" /></dd>
            <dt>Served on</dt><dd><DateCell iso={c.served_on} gap={c.gaps.includes("served_on")} /></dd>
            <dt>Response due</dt><dd><DueText due={due} /></dd>
            <dt>Viewed by AO</dt><dd><DateCell iso={c.ao_viewed_on} /></dd>
          </dl>
          {c.documents.length ? (
            <table className="table"><tbody>
              {c.documents.map((d) => <DocRow key={d.id} doc={d} docs={h.docs} />)}
            </tbody></table>
          ) : <span className="meta">No document fetched for this communication.</span>}
          {can.draft && !c.response_due_date && !h.p.suggested_due_date && c.documents.some((d) => d.state === "stored") ? (
            <div className="row">
              <button className="btn small quiet" onClick={() => h.onSuggest(c)} title="asks the proxy once; the answer is a suggestion, never a stated date">Suggest a due date</button>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function ResponseCard({ r, seen }: { r: ResponseRow; seen: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <article className="tf-card">
      <CardHead open={open} onToggle={() => setOpen(!open)}>
        <b>{r.response_mode === "partial" ? "Partial response filed" : "Response filed"}</b>
        <span className="meta num"><DateCell iso={r.filed_on} /></span>
        <Ticks seen={seen} />
      </CardHead>
      {open ? (
        <div className="tf-body">
          <dl className="kv">
            <dt>Filed by</dt><dd>{r.filed_by ?? <span className="muted">Not stated</span>}</dd>
            <dt>Transaction</dt><dd className="mono">{r.transaction_id ?? <span className="muted">Not stated</span>}</dd>
            <dt>Remarks</dt><dd>{r.remarks ?? <span className="muted">none</span>}</dd>
          </dl>
        </div>
      ) : null}
    </article>
  );
}

function AdjournmentCard({ a }: { a: AdjournmentRow }) {
  const [open, setOpen] = useState(false);
  return (
    <article className="tf-card">
      <CardHead open={open} onToggle={() => setOpen(!open)}>
        <b>Adjournment sought</b>
        <span className="meta num"><DateCell iso={a.filed_on} /></span>
      </CardHead>
      <div className="tf-sub meta">
        <span>to <DateCell iso={a.sought_date} /></span>
        {a.outcome ? <span>{a.outcome}</span> : null}
      </div>
      {open ? (
        <div className="tf-body">
          <dl className="kv">
            <dt>Reason</dt><dd>{a.reason ?? <span className="muted">Not stated</span>}</dd>
          </dl>
        </div>
      ) : null}
    </article>
  );
}

export function EmptySlot({ row, h }: { row: PairRow; h: Handlers }) {
  return (
    <div className="tf-card tf-slot">
      <span className="tf-slot-title">Response not yet filed</span>
      <DueText due={row.due} unverified={row.comm.gaps.includes("response_due_date")} />
      <div className="row">
        <button className="btn small" onClick={() => h.onDraft(row.comm)}>
          <Icon name="sparkles" /><span>{row.comm.has_draft ? "Open draft" : "Draft"}</span>
        </button>
      </div>
    </div>
  );
}

/** Branch-lane pieces a row carries for an adjournment passing by or merging in. */
function BranchPassing({ row }: { row: FlowRow }) {
  if (row.mergeIn) {
    return <><Connector dir="v" x={BRANCH_X} y={0} to={2} branch /><Curve fromX={BRANCH_X} fromY={2} toX={SPINE_X} toY={NODE_Y} /></>;
  }
  if (row.through) return <Connector dir="v" x={BRANCH_X} y={0} branch />;
  return null;
}

/** The right-lane half of a communication: its responses, or the empty slot. */
function RightHalf({ row, h }: { row: PairRow; h: Handlers }) {
  if (row.responses.length) {
    const seen = !!row.comm.ao_viewed_on;
    return <>{row.responses.map((r) => <ResponseCard key={r.id} r={r} seen={seen} />)}</>;
  }
  return row.slot ? <EmptySlot row={row} h={h} /> : null;
}

function PairSpine({ row, respY, nodes }: { row: PairRow; respY: number; nodes: React.ReactNode }) {
  const answered = row.responses.length > 0;
  const right = answered || row.slot;
  return (
    <>
      <BranchPassing row={row} />
      <Connector dir="h" x={0} y={NODE_Y} to={SPINE_X} />
      {right ? <Connector dir="v" x={SPINE_X} y={NODE_Y} to={respY} dashed={!answered} /> : null}
      {right ? <Connector dir="h" x={SPINE_X} y={respY} dashed={!answered} /> : null}
      {nodes}
      {answered ? <SpineNode shape="circle" y={respY} tone={row.state} /> : null}
      {row.slot ? (
        <SpineNode shape="ring" y={respY} tone={row.state} ring={row.ring}
                   pulse={row.state === "warning" || row.state === "danger"} />
      ) : null}
    </>
  );
}

export function ThreadRow({ row, h, fold, onToggleRepeat }: {
  row: FlowRow; h: Handlers; fold?: { key: string; count: number }; onToggleRepeat: (key: string) => void;
}) {
  if (row.kind === "pair") return <PairRowView row={row} h={h} fold={fold} onToggleRepeat={onToggleRepeat} />;
  if (row.kind === "repeat") return <RepeatRowView row={row} h={h} onToggleRepeat={onToggleRepeat} />;
  if (row.kind === "adjournment") return <AdjournmentRowView row={row} />;
  return (
    <Row row={row} tone="success" respY={NODE_Y}
         spine={<><BranchPassing row={row} /><Connector dir="h" x={SPINE_X} y={NODE_Y} /><SpineNode shape="circle" y={NODE_Y} tone="success" /></>}
         right={<ResponseCard r={row.response} seen={false} />} />
  );
}

function Row({ row, tone, respY, left, spine, right, minHeight }: {
  row: FlowRow; tone: PairState; respY: number; left?: React.ReactNode; spine: React.ReactNode;
  right?: React.ReactNode; minHeight?: number;
}) {
  const style = { "--resp-y": `${respY}px`, minHeight } as CSSProperties;
  return (
    <>
      {row.gapBefore !== null ? (
        <div className="tf-gap">
          {row.through || row.mergeIn ? <span className="tf-gap-branch"><Connector dir="v" x={BRANCH_X} y={0} branch /></span> : null}
          <span className="meta num">{describeGap(row.gapBefore)}</span>
        </div>
      ) : null}
      <div className={`tf-row tf-${tone}`} data-pair={row.pair} style={style}>
        <div className="tf-left">{left}</div>
        <div className="tf-spine" aria-hidden="true">{spine}</div>
        <div className="tf-right">{right}</div>
      </div>
    </>
  );
}

function PairRowView({ row, h, fold, onToggleRepeat }: {
  row: PairRow; h: Handlers; fold?: { key: string; count: number }; onToggleRepeat: (key: string) => void;
}) {
  const respY = NODE_Y + RESP_DROP;
  return (
    <Row row={row} tone={row.state} respY={respY}
         left={<>
           <CommCard c={row.comm} effective={row.effective} due={row.due} h={h} />
           {/* Below the card, so the card head stays level with its node. */}
           {fold ? (
             <button type="button" className="btn small quiet tf-fold" aria-expanded="true" onClick={() => onToggleRepeat(fold.key)}>
               <Chevron open /><span>Fold {fold.count} × {row.comm.type_label}</span>
             </button>
           ) : null}
         </>}
         spine={<PairSpine row={row} respY={respY} nodes={<SpineNode shape="circle" y={NODE_Y} tone={row.state} />} />}
         right={<RightHalf row={row} h={h} />} />
  );
}

function RepeatRowView({ row, h, onToggleRepeat }: { row: RepeatRow; h: Handlers; onToggleRepeat: (key: string) => void }) {
  const last = row.members[row.members.length - 1];
  const respY = NODE_Y + (row.members.length - 1) * REPEAT_STEP + RESP_DROP;
  const nodes = row.members.map((m, i) => <SpineNode key={m.key} shape="small" y={NODE_Y + i * REPEAT_STEP} tone={m.state} />);
  return (
    <Row row={row} tone={last.state} respY={respY}
         left={
           <article className="tf-card">
             <CardHead open={false} onToggle={() => onToggleRepeat(row.key)}>
               <b>{row.members.length} × {last.comm.type_label}</b>
               <span className="meta num">latest <DateCell iso={last.comm.issued_on} /></span>
             </CardHead>
           </article>
         }
         spine={<PairSpine row={{ ...last, through: row.through, mergeIn: row.mergeIn }} respY={respY} nodes={nodes} />}
         right={<RightHalf row={last} h={h} />} />
  );
}

function AdjournmentRowView({ row }: { row: AdjournmentView }) {
  const out = DIAMOND_Y + 8;
  const spine = (
    <>
      {row.through ? <Connector dir="v" x={BRANCH_X} y={0} branch /> : null}
      <Curve fromX={SPINE_X} fromY={0} toX={BRANCH_X} toY={DIAMOND_Y - 8} />
      <Connector dir="h" x={BRANCH_X} y={DIAMOND_Y} />
      <SpineNode shape="diamond" x={BRANCH_X} y={DIAMOND_Y} tone={row.state} />
      {row.mergeKey
        ? <Connector dir="v" x={BRANCH_X} y={out} branch />
        : <><Curve fromX={BRANCH_X} fromY={out} toX={SPINE_X} toY={out + 24} /><SpineNode shape="ring" y={out + 30} tone="idle" /></>}
    </>
  );
  return (
    <Row row={row} tone={row.state} respY={DIAMOND_Y} spine={spine}
         right={<AdjournmentCard a={row.adj} />} minHeight={row.mergeKey ? undefined : out + 44} />
  );
}

export function ThreadMiniMap({ rows }: { rows: FlowRow[] }) {
  const comms = communicationsOf(rows);
  const step = 14;
  const w = Math.max(12, (comms.length - 1) * step + 12);
  return (
    <div className="tf-map">
      <svg width={w} height="12" viewBox={`0 0 ${w} 12`} aria-hidden="true">
        {comms.length > 1 ? <line x1="6" y1="6" x2={w - 6} y2="6" className="tf-map-line" /> : null}
        {comms.map((c, i) => (
          <circle key={c.key} cx={6 + i * step} cy="6" r="4"
                  className={`tf-map-dot tf-${c.state}${c.slot ? " open" : ""}`} />
        ))}
      </svg>
      <span className="meta">{openSummary(rows)}</span>
    </div>
  );
}

/** Hover lights one pair; rows sharing a pair key are one pair. */
function hoverRules(rows: FlowRow[]): string {
  const keys = [...new Set(rows.map((r) => r.pair))];
  return keys.map((k, i) => {
    const sel = `[data-pair="${CSS.escape(k)}"]`;
    return `.thread-flow:has(${sel}:hover) .tf-row:not(${sel}){opacity:.55}` + (i < keys.length - 1 ? "\n" : "");
  }).join("");
}

export default function ThreadFlow(props: Handlers) {
  const { p } = props;
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(new Set());
  const base = useMemo(() => pairThread(p), [p]);
  const rows = useMemo(() => annotate(unfold(base, openGroups)), [base, openGroups]);

  const toggle = (key: string) => setOpenGroups((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  // The first member of an opened group carries the fold control.
  const folds = new Map<string, { key: string; count: number }>();
  for (const r of base) if (r.kind === "repeat" && openGroups.has(r.key)) folds.set(r.members[0].key, { key: r.key, count: r.members.length });

  if (!p.communications.length && !p.responses.length && !p.adjournments.length) {
    return (
      <div className="thread-flow">
        <div className="tf-lanes">
          <div className="tf-row">
            <div className="tf-left"><EmptyState title="No communications yet." body="The thread fills as sweeps find notices and filed responses." /></div>
            <div className="tf-spine" aria-hidden="true"><SpineNode shape="ring" y={NODE_Y} tone="idle" /></div>
            <div className="tf-right" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="thread-flow">
      <style>{hoverRules(rows)}</style>
      <ThreadMiniMap rows={base} />
      <div className="tf-lane-heads" aria-hidden="true"><span>Department</span><span /><span>Firm</span></div>
      <div className="tf-lanes">
        {rows.map((r) => <ThreadRow key={r.key} row={r} h={props} fold={folds.get(r.key)} onToggleRepeat={toggle} />)}
        <div className="tf-end" aria-hidden="true">
          <span className="tf-spine"><SpineNode shape={p.status === "closed" ? "square" : "cap"} y={8} tone="idle" /></span>
        </div>
      </div>
    </div>
  );
}
