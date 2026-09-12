/** Screen 6 — Devices. Roster, collector nomination and sync state arrive
 *  with the relay (Phase 7). */
import EmptyState from "../ui/empty-state";

export default function DevicesScreen() {
  return (
    <div className="page">
      <div className="page-head"><h1>Devices</h1></div>
      <div className="page-body">
        <div className="card">
          <EmptyState title="This device is on its own." body="Device enrolment, the collector lease and the sync state appear once the relay is configured." />
        </div>
      </div>
    </div>
  );
}
