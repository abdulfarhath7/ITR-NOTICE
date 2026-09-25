/** Screen 4 — Work item detail. Metadata left, documents right, the
 *  communication and response thread below (docs/09). Every action comes
 *  from the matrix; every gap renders "Not stated". */
import { useMemo, useState } from "react";
import { useDocuments } from "../hooks/use-documents";
import { useDraft } from "../hooks/use-draft";
import { useProceeding } from "../hooks/use-proceeding";
import { api, describeError } from "../lib/api";
import { describeDue } from "../lib/due";
import { isModule, panelLabel } from "../lib/labels";
import { invalidate } from "../lib/query";
import { actionsFor, parseStatus } from "../lib/status";
import { toast, toastError } from "../lib/toast";
import type { CommunicationView, ProceedingDetail } from "../lib/types";
import { DateCell } from "../ui/dates";
import { DocList, DocPreview } from "../ui/doc-list";
import DraftDrawer from "../ui/draft-drawer";
import DueText from "../ui/due-text";
import EmptyState from "../ui/empty-state";
import Gap from "../ui/gap";
import { ErrorPage, LoadingPage, Page, PageBody, PageHead } from "../ui/page";
import { NotesCard, OwnerRow } from "../ui/item-meta";
import { PendingBanner } from "../ui/pending-docs";
import { StatusPill } from "../ui/pill";
import ThreadFlow from "../ui/thread-flow";
import { DemandScreen, FiledFormScreen, ReturnScreen } from "./module-items";

function ManualDueDate({ p, onSaved }: { p: ProceedingDetail; onSaved: () => void }) {
  const [value, setValue] = useState(p.manual_due_date ?? "");
  const can = actionsFor(p.status).editManualDueDate;
  const save = async () => {
    try {
      await api.setManualDueDate(p.id, value || null);
      toast(value ? "Manual due date saved." : "Manual due date cleared.");
      onSaved();
    } catch (e) { toastError(describeError(e)); }
  };
  if (!can) return <span className="muted">{p.manual_due_date ?? "not set"}</span>;
  return (
    <div className="row">
      <input className="input mono" type="date" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Manual due date" />
      {value !== (p.manual_due_date ?? "") ? <button className="btn small" onClick={() => { void save(); }}>Save</button> : null}
    </div>
  );
}

function ProceedingScreen({ id }: { id: string }) {
  const q = useProceeding(id);
  const docs = useDocuments();
  const draft = useDraft();
  const [draftSource, setDraftSource] = useState<string | null>(null);
  const p = q.data;
  const allDocs = useMemo(() => (p ? [...p.documents, ...p.communications.flatMap((c) => c.documents)] : []), [p]);

  if (q.error) return <ErrorPage message={q.error} />;
  if (!p) return <LoadingPage />;
  const status = parseStatus(p.status);
  // The manual date drives the worklist when set; the portal's is shown
  // beside it, labelled (Q14).
  const due = describeDue(p.manual_due_date ?? p.due_date, status);
  const portalDue = describeDue(p.due_date, status);
  const limitation = describeDue(p.limitation_date, status);
  const refresh = () => invalidate(`proceedings:${id}`);
  const promote = async () => {
    try { await api.promoteSuggestedDueDate(p.id); toast("Suggested date promoted to the manual due date."); refresh(); invalidate("work_items"); }
    catch (e) { toastError(describeError(e)); }
  };
  const suggest = async (c: CommunicationView) => {
    try {
      const a = await api.suggestDueDate(c.reference_id);
      toast(a.due_date ? `Suggested ${a.due_date}${a.basis ? `: ${a.basis}` : ""}` : (a.basis ?? "No deadline was found in this notice."));
      refresh();
    } catch (e) { toastError(describeError(e)); }
  };

  return (
    <Page>
      <PageHead title={p.display_name ?? p.type_label} back={{ route: { name: "client", id: p.client_id }, label: p.client_name }}
                meta={<span className="row"><StatusPill status={p.status} />
                  {p.verified_flag ? <span className="pill success">Verified</span> : <span className="pill warning">Unverified</span>}</span>}>
        <OwnerRow module="proceedings" id={p.id} />
      </PageHead>
      <PageBody>
        <PendingBanner key={p.id} module="proceedings" id={p.id} pending={allDocs.filter((d) => d.state === "pending").length} />
        <div className="grid-2">
          <div className="card">
            <div className="card-head"><h2>Proceeding</h2><span className="meta">{p.type_label}</span></div>
            <div className="card-body">
              <dl className="kv">
                <dt>Client</dt><dd>{p.client_name} <span className="mono muted">{p.pan_masked}</span></dd>
                <dt>Assessment year</dt><dd>{p.assessment_year ?? <span className="muted">Not stated<span className="unverified">unverified</span></span>}{p.financial_year ? <span className="muted"> · FY {p.financial_year}</span> : null}</dd>
                <dt>Assessee</dt><dd>{p.assessee_name ?? <span className="muted">Not stated</span>}</dd>
                <dt>Section</dt><dd><Gap value={p.section} gaps={p.gaps} column="section" /></dd>
                <dt>DIN</dt><dd><Gap value={p.din_reference} gaps={p.gaps} column="din_reference" mono /></dd>
                <dt>Authority</dt><dd><Gap value={p.authority} gaps={p.gaps} column="authority" /></dd>
                <dt>Initiated on</dt><dd><DateCell iso={p.initiated_on} gap={p.gaps.includes("initiated_on")} /></dd>
                <dt>Response due</dt><dd><DueText due={due} />{p.manual_due_date ? <span className="meta"> · manual</span> : null}</dd>
                {p.manual_due_date ? <><dt>Portal states</dt><dd><DueText due={portalDue} /></dd></> : null}
                <dt>Manual due date</dt><dd><ManualDueDate p={p} onSaved={refresh} /></dd>
                <dt>Suggested due date</dt>
                <dd>{p.suggested_due_date
                  ? <span className="row">
                      <span className="suggested">{p.suggested_due_date}</span> <span className="pill warning">suggested</span>
                      {actionsFor(p.status).editManualDueDate && p.manual_due_date !== p.suggested_due_date
                        ? <button className="btn small" onClick={() => { void promote(); }}>Promote to manual due date</button> : null}
                    </span>
                  : <span className="muted">none</span>}</dd>
                <dt>Limitation date</dt><dd><DueText due={limitation} unverified={p.gaps.includes("limitation_date")} /></dd>
                <dt>Portal status</dt><dd>{p.portal_status ?? <span className="muted">Not stated</span>}</dd>
                <dt>Closure</dt><dd><DateCell iso={p.closure_date} />{p.closure_order ? <span className="muted"> · {p.closure_order}</span> : null}</dd>
                <dt>Panel</dt><dd>{panelLabel(p.source_panel)}</dd>
                <dt>Created</dt><dd>{p.created_mode === "auto" ? "by sweep" : "by hand"}</dd>
                {p.appeal_number ? <><dt>Appeal number</dt><dd className="mono">{p.appeal_number}</dd></> : null}
                {p.order_appealed_against ? <><dt>Order appealed against</dt><dd>{p.order_appealed_against}</dd></> : null}
                <dt>Last seen</dt><dd className="num">{p.last_seen_at.slice(0, 10)}</dd>
              </dl>
            </div>
          </div>
          <div className="card">
            <div className="card-head"><h2>Documents</h2><span className="meta num">{allDocs.length}</span></div>
            <DocList items={allDocs} docs={docs} />
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h2>Thread</h2><span className="meta">communications, responses and adjournments in date order</span></div>
          <div className="card-body">
            <ThreadFlow p={p} docs={docs} onDraft={(c) => { setDraftSource(c.documents.find((d) => d.state === "stored")?.id ?? null); void draft.open(c.reference_id); }}
                    onSuggest={(c) => { void suggest(c); }} />
          </div>
        </div>

        <NotesCard module="proceedings" id={p.id} />
      </PageBody>

      <DocPreview docs={docs} />
      {draft.draft ? <DraftDrawer draft={draft.draft} busy={draft.busy} sourceDocumentId={draftSource} onClose={draft.close}
                                  onSave={(t) => { void draft.saveText(t); }} onReviewed={(r) => { void draft.setReviewed(r); }} /> : null}
    </Page>
  );
}

export default function WorkItemScreen({ module, id }: { module: string; id: string }) {
  if (!isModule(module)) {
    return (
      <Page><PageBody><div className="card">
        <EmptyState title="Unknown module." body="This link points at a module the app does not know." />
      </div></PageBody></Page>
    );
  }
  switch (module) {
    case "demands": return <DemandScreen id={id} />;
    case "returns": return <ReturnScreen id={id} />;
    case "forms": return <FiledFormScreen id={id} />;
    case "proceedings": return <ProceedingScreen id={id} />;
  }
}
