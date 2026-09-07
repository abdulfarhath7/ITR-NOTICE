import { BUCKETS, type BucketKey } from "../lib/buckets";

export type Filter = "to_respond" | BucketKey | "all";
export type Connection = "offline" | "connecting" | "ready" | "syncing";

interface Props {
  counts: Record<BucketKey | "to_respond", number>;
  total: number;
  filter: Filter;
  onFilter: (f: Filter) => void;
  connection: Connection;
  userId: string;
  onConnect: () => void;
  onSync: () => void;
  onExport: () => void;
  onSettings: () => void;
}

const STATUS: Record<Connection, string> = {
  offline: "Not connected to the portal",
  connecting: "Logging in",
  ready: "Portal session live",
  syncing: "Fetching notices",
};

export default function Rail(p: Props) {
  const Item = ({ k, label, count, dot }: { k: Filter; label: string; count: number; dot?: string }) => (
    <button className="bucket" aria-current={p.filter === k} onClick={() => p.onFilter(k)}>
      <span className={`dot ${dot ?? ""}`} />
      <span>{label}</span>
      <span className="count">{count}</span>
    </button>
  );

  return (
    <aside className="rail">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">ND</div>
        <div>
          <h1>Notice Desk</h1>
          <small>{p.userId ? `Portal user ${p.userId}` : "No portal user yet"}</small>
        </div>
      </div>

      <nav className="rail-section" aria-label="Filters">
        <div className="rail-title">Work outstanding</div>
        <Item k="to_respond" label="To respond" count={p.counts.to_respond} dot="overdue" />
        {BUCKETS.filter((b) => !["responded", "closed"].includes(b.key)).map((b) => (
          <Item key={b.key} k={b.key} label={b.label} count={p.counts[b.key]} dot={b.key} />
        ))}
        <div className="rail-title" style={{ marginTop: 8 }}>Done</div>
        {BUCKETS.filter((b) => ["responded", "closed"].includes(b.key)).map((b) => (
          <Item key={b.key} k={b.key} label={b.label} count={p.counts[b.key]} dot={b.key} />
        ))}
        <Item k="all" label="Everything" count={p.total} />
      </nav>

      <div className="rail-foot">
        <div className="status">
          <span className={`pulse ${p.connection === "ready" ? "on" : p.connection === "offline" ? "" : "busy"}`} />
          {STATUS[p.connection]}
        </div>
        <div className="btn-row">
          {p.connection === "offline" ? (
            <button className="btn btn-primary" onClick={p.onConnect}>Connect to portal</button>
          ) : (
            <button className="btn btn-primary" onClick={p.onSync} disabled={p.connection !== "ready"}>
              {p.connection === "syncing" ? "Fetching…" : "Fetch notices"}
            </button>
          )}
          <button className="btn" onClick={p.onExport} disabled={p.total === 0}>Export Excel</button>
        </div>
        <button className="btn btn-quiet" onClick={p.onSettings} style={{ justifySelf: "start" }}>Settings</button>
      </div>
    </aside>
  );
}
