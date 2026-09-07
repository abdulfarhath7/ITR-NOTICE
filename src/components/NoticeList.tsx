import { BUCKETS, TO_RESPOND, describe, type BucketKey, type Item } from "../lib/buckets";
import type { Filter } from "./Rail";

interface Props {
  items: Item[];
  filter: Filter;
  query: string;
  onQuery: (q: string) => void;
  selected: string | null;
  onSelect: (refId: string) => void;
}

function Days({ i }: { i: Item }) {
  if (i.bucket === "closed") return <div className="days quiet"><span className="n">Closed</span></div>;
  if (i.bucket === "responded") return <div className="days quiet"><span className="n">Replied</span></div>;
  if (i.days === null) return <div className="days none"><span className="n">No date</span><span className="u">ask Claude</span></div>;
  const n = Math.abs(i.days);
  const unit = n === 1 ? "day" : "days";
  return (
    <div className={`days ${i.bucket}`}>
      <span className="n">{i.days < 0 ? `-${n}` : n}</span>
      <span className="u">{i.days < 0 ? `${unit} overdue` : i.days === 0 ? "due today" : `${unit} left`}</span>
    </div>
  );
}

const ORDER: BucketKey[] = ["overdue", "due_3", "due_10", "on_track", "no_due_date", "responded", "closed"];

export default function NoticeList(p: Props) {
  const q = p.query.trim().toLowerCase();
  const visible = p.items.filter((i) => {
    if (p.filter === "to_respond" && !TO_RESPOND.includes(i.bucket)) return false;
    if (p.filter !== "all" && p.filter !== "to_respond" && i.bucket !== p.filter) return false;
    if (!q) return true;
    return [i.ref_id, i.description, i.proceeding_name, i.pan, i.assessee_name, i.notice_us, i.assessment_year]
      .some((s) => (s ?? "").toLowerCase().includes(q));
  });

  const groups = ORDER.map((k) => ({
    key: k,
    label: BUCKETS.find((b) => b.key === k)!.label,
    rows: visible.filter((i) => i.bucket === k).sort((a, b) => (a.days ?? 9e9) - (b.days ?? 9e9)),
  })).filter((g) => g.rows.length);

  const heading = p.filter === "to_respond" ? "To respond" : p.filter === "all" ? "Everything"
    : BUCKETS.find((b) => b.key === p.filter)?.label ?? "";

  return (
    <section className="main">
      <div className="topbar">
        <h2>{heading}</h2>
        <span className="note">{visible.length} of {p.items.length}</span>
        <span className="spacer" />
        <input className="search" placeholder="Search client, PAN, section, reference"
               value={p.query} onChange={(e) => p.onQuery(e.target.value)} aria-label="Search notices" />
      </div>

      <div className="list">
        {p.items.length === 0 ? (
          <div className="empty">
            <h3>No notices yet</h3>
            Connect to the portal, then fetch notices. Everything lands here, most urgent first.
          </div>
        ) : visible.length === 0 ? (
          <div className="empty"><h3>Nothing here</h3>Try another filter or clear the search.</div>
        ) : groups.map((g) => (
          <div key={g.key}>
            {(p.filter === "to_respond" || p.filter === "all") && (
              <div className="group">{g.label} · {g.rows.length}</div>
            )}
            {g.rows.map((i) => (
              <button key={i.ref_id} className="row" aria-selected={p.selected === i.ref_id}
                      onClick={() => p.onSelect(i.ref_id)}>
                <div>
                  <div className="title">{describe(i)}</div>
                  <div className="meta">
                    {i.assessee_name && <><b>{i.assessee_name}</b> · </>}
                    {i.pan && <>{i.pan} · </>}
                    {i.assessment_year && <>AY {i.assessment_year} · </>}
                    {i.notice_us && <>s.{i.notice_us} · </>}
                    {i.due_date ? <>due {i.due_date}</> : <>issued {i.issued_on ?? "—"}</>}
                    {i.has_draft && <> · <span className="tag">draft ready</span></>}
                  </div>
                </div>
                <Days i={i} />
              </button>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
