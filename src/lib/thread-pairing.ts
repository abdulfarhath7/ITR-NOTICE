/** Pairing for the two-lane thread flow (docs/thread-flow-context.md §5).
 *
 *  Pure: every row, colour and branch the flow draws is decided here, so the
 *  component only lays out what it is handed. Nothing reads a field the
 *  proceeding does not already carry. */
import { daysBetween, parseDate, todayIst, type Ymd } from "./dates";
import { describeDue, type DueDescription } from "./due";
import { actionsFor } from "./status";
import type { AdjournmentRow, CommunicationView, ProceedingDetail, ResponseRow } from "./types";

/** `idle` is the muted/border-strong state: closed with no response, or unknown. */
export type PairState = "success" | "warning" | "danger" | "idle";

interface RowBase {
  key: string;
  /** Rows sharing a pair key light up together on hover. */
  pair: string;
  /** A spine label goes above this row when the gap exceeds 14 days. */
  gapBefore: number | null;
  /** An adjournment branch runs past this row in the branch lane. */
  through: boolean;
  /** An adjournment branch merges back into this row's node. */
  mergeIn: boolean;
}

export interface PairRow extends RowBase {
  kind: "pair";
  comm: CommunicationView;
  effective: string;
  responses: ResponseRow[];
  due: DueDescription;
  state: PairState;
  /** An empty response slot is drawn on the right. */
  slot: boolean;
  /** Elapsed share of the response window, 0..1, for the countdown ring. */
  ring: number | null;
}

export interface RepeatRow extends RowBase {
  kind: "repeat";
  members: PairRow[];
}

export interface AdjournmentView extends RowBase {
  kind: "adjournment";
  adj: AdjournmentRow;
  state: PairState;
  /** Pair key of the communication the branch merges into; null until the reissue arrives. */
  mergeKey: string | null;
}

export interface OrphanResponse extends RowBase {
  kind: "response";
  response: ResponseRow;
}

export type FlowRow = PairRow | RepeatRow | AdjournmentView | OrphanResponse;

const REPEAT_MIN = 2;
const GAP_LABEL_OVER = 14;

function ymd(iso: string | null | undefined): Ymd | null {
  return parseDate(iso);
}

/** `a <= b` for two ISO-ish dates; false when either is missing. */
function onOrBefore(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = ymd(a), y = ymd(b);
  return !!x && !!y && daysBetween(x, y) >= 0;
}

function byDate<T>(items: T[], when: (t: T) => string | null): T[] {
  // Undated items sort last, and ties keep their incoming order.
  return items
    .map((t, i) => ({ t, i, d: ymd(when(t)) }))
    .sort((a, b) => {
      if (a.d && b.d) return daysBetween(b.d, a.d) || a.i - b.i;
      if (a.d) return -1;
      if (b.d) return 1;
      return a.i - b.i;
    })
    .map((x) => x.t);
}

export function pairState(answered: boolean, due: DueDescription): PairState {
  if (answered) return "success";
  if (due.tone === "danger") return "danger";
  if (due.tone === "warning" || due.tone === "normal") return "warning";
  return "idle";
}

/** Elapsed share of `issued_on .. response_due_date`. `due.days` is used as
 *  a ratio only; no number from it is ever printed (QUESTIONS Q25). */
export function ringRatio(c: CommunicationView, due: DueDescription): number | null {
  const issued = ymd(c.issued_on), dueOn = ymd(c.response_due_date);
  if (!issued || !dueOn || due.days === null) return null;
  const total = Math.max(1, daysBetween(issued, dueOn));
  const elapsed = Math.min(total, Math.max(0, total - due.days));
  return elapsed / total;
}

/** The latest communication issued on or before `when`. */
function latestBefore(comms: CommunicationView[], when: string | null): CommunicationView | null {
  let hit: CommunicationView | null = null;
  for (const c of comms) if (onOrBefore(c.issued_on, when)) hit = c;
  return hit;
}

/** Ordered rows for a proceeding: each communication, then the adjournments
 *  it drew; consecutive unanswered repeats of one type folded together. */
export function pairThread(p: ProceedingDetail, today: Ymd = todayIst()): FlowRow[] {
  const comms = byDate(p.communications, (c) => c.issued_on);
  const keyOf = new Map(comms.map((c, i) => [c.id, `p${i}`]));

  const repliesTo = new Map<string, ResponseRow[]>();
  const orphans: FlowRow[] = [];
  const blank = { gapBefore: null, through: false, mergeIn: false };

  for (const r of byDate(p.responses, (x) => x.filed_on)) {
    const direct = r.in_reply_to
      ? comms.find((c) => c.reference_id === r.in_reply_to || c.id === r.in_reply_to)
      : undefined;
    const anchor = direct ?? latestBefore(comms, r.filed_on);
    if (anchor) repliesTo.set(anchor.id, [...(repliesTo.get(anchor.id) ?? []), r]);
    else orphans.push({ kind: "response", key: `r:${r.id}`, pair: `r:${r.id}`, response: r, ...blank });
  }

  const adjournedFrom = new Map<string, AdjournmentRow[]>();
  const orphanAdj: AdjournmentRow[] = [];
  for (const a of byDate(p.adjournments, (x) => x.filed_on)) {
    const anchor = latestBefore(comms, a.filed_on);
    if (anchor) adjournedFrom.set(anchor.id, [...(adjournedFrom.get(anchor.id) ?? []), a]);
    else orphanAdj.push(a);
  }

  const mergeTarget = (a: AdjournmentRow, after: number): string | null => {
    const hit = comms.slice(after + 1).find((c) => onOrBefore(a.sought_date, c.issued_on));
    return hit ? keyOf.get(hit.id) ?? null : null;
  };

  for (const a of orphanAdj) {
    orphans.push({ kind: "adjournment", key: `a:${a.id}`, pair: `a:${a.id}`, adj: a, state: "idle", mergeKey: mergeTarget(a, -1), ...blank });
  }

  const pairs: FlowRow[] = [];
  comms.forEach((c, i) => {
    const key = keyOf.get(c.id) ?? `p${i}`;
    const effective = c.status === "response_submitted" ? "response_submitted" : p.status;
    const due = describeDue(c.response_due_date, effective, today);
    const responses = repliesTo.get(c.id) ?? [];
    const slot = !responses.length && actionsFor(effective).draft;
    const state = pairState(responses.length > 0, due);
    pairs.push({
      kind: "pair", key, pair: key, comm: c, effective, responses, due, state, slot,
      ring: slot ? ringRatio(c, due) : null, ...blank,
    });
    for (const a of adjournedFrom.get(c.id) ?? []) {
      pairs.push({ kind: "adjournment", key: `a:${a.id}`, pair: key, adj: a, state, mergeKey: mergeTarget(a, i), ...blank });
    }
  });

  const dated = orphans.filter((o) => rowStart(o));
  const undated = orphans.filter((o) => !rowStart(o));
  return foldRepeats([...dated, ...pairs, ...undated]);
}

function lonely(r: FlowRow, next: FlowRow | undefined): r is PairRow {
  // A repeat is a notice nobody answered and nobody adjourned against.
  return r.kind === "pair" && !r.responses.length && next?.kind !== "adjournment";
}

function foldRepeats(rows: FlowRow[]): FlowRow[] {
  const out: FlowRow[] = [];
  for (let i = 0; i < rows.length;) {
    const first = rows[i];
    if (!lonely(first, rows[i + 1])) { out.push(first); i += 1; continue; }
    const members: PairRow[] = [first];
    let j = i + 1;
    for (; j < rows.length; j += 1) {
      const r = rows[j];
      if (!lonely(r, rows[j + 1]) || r.comm.communication_type_id !== first.comm.communication_type_id) break;
      members.push(r);
    }
    if (members.length >= REPEAT_MIN) {
      out.push({ kind: "repeat", key: `g:${first.key}`, pair: `g:${first.key}`, members, gapBefore: null, through: false, mergeIn: false });
    } else {
      out.push(first);
    }
    i = j;
  }
  return out;
}

/** Repeat groups the user opened become their member rows again. */
export function unfold(rows: FlowRow[], open: ReadonlySet<string>): FlowRow[] {
  return rows.flatMap((r) => (r.kind === "repeat" && open.has(r.key) ? r.members : [r]));
}

function rowStart(r: FlowRow): string | null {
  switch (r.kind) {
    case "pair": return r.comm.issued_on;
    case "repeat": return r.members[0].comm.issued_on;
    case "adjournment": return r.adj.filed_on;
    case "response": return r.response.filed_on;
  }
}

function rowEnd(r: FlowRow): string | null {
  switch (r.kind) {
    case "pair": {
      const last = r.responses[r.responses.length - 1];
      return last?.filed_on ?? r.comm.issued_on;
    }
    case "repeat": return r.members[r.members.length - 1].comm.issued_on;
    default: return rowStart(r);
  }
}

function pairKeys(r: FlowRow): string[] {
  if (r.kind === "pair") return [r.key];
  if (r.kind === "repeat") return r.members.map((m) => m.key);
  return [];
}

/** Gap labels and branch lanes, computed on the rows as displayed. */
export function annotate(rows: FlowRow[]): FlowRow[] {
  const out = rows.map((r) => ({ ...r }));
  for (let i = 1; i < out.length; i += 1) {
    const a = ymd(rowEnd(out[i - 1])), b = ymd(rowStart(out[i]));
    const gap = a && b ? daysBetween(a, b) : null;
    out[i].gapBefore = gap !== null && gap > GAP_LABEL_OVER ? gap : null;
  }
  out.forEach((r, i) => {
    if (r.kind !== "adjournment" || !r.mergeKey) return;
    const target = out.findIndex((x, j) => j > i && pairKeys(x).includes(r.mergeKey ?? ""));
    if (target < 0) { r.mergeKey = null; return; }
    for (let j = i + 1; j < target; j += 1) out[j].through = true;
    out[target].mergeIn = true;
  });
  return out;
}

/** Every communication in issued order, for the mini-map. */
export function communicationsOf(rows: FlowRow[]): PairRow[] {
  return rows.flatMap((r) => (r.kind === "pair" ? [r] : r.kind === "repeat" ? r.members : []));
}

/** `1 open · due in 6 days` for the most pressing open communication. */
export function openSummary(rows: FlowRow[]): string {
  const open = communicationsOf(rows).filter((r) => r.slot);
  if (!open.length) return "Nothing open";
  const first = [...open].sort((a, b) => (a.due.days ?? Infinity) - (b.due.days ?? Infinity))[0];
  const text = first.due.text.charAt(0).toLowerCase() + first.due.text.slice(1);
  return `${open.length} open · ${text}`;
}
