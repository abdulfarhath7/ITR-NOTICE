import { useCallback, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Select } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { DueChip } from "@/features/notices/DueChip";
import { StatusTicks } from "@/features/notices/StatusTicks";
import type { useNotices } from "@/hooks/useNotices";
import { api, type BucketKey, type DueDateSource, type Notice } from "@/lib/api";
import { inBucket } from "@/lib/buckets";
import { saveBlob } from "@/lib/files";
import { orDash } from "@/lib/format";

export type NoticesTableProps = {
  data: ReturnType<typeof useNotices>;
  /** The chip filter lives with the stat cards, so the parent owns it. */
  bucket: BucketKey | "";
  onView: (refId: string) => void;
  onDraft: (refId: string) => void;
  onRunFirstSync: () => void;
};

const COLUMNS = 6;

/** The five placeholder rows keep the table's shape while the first load runs,
 *  so the header does not jump when rows arrive. */
const SKELETON_WIDTHS = ["w-7/12", "w-8/12", "w-2/5", "w-1/3", "w-1/2", "w-5/12"];

/** `source` comes off the wire as a plain string; the row will not take one. */
function asSource(value: string | null): DueDateSource {
  return value === "portal" || value === "claude" ? value : "claude";
}

export function NoticesTable({
  data,
  bucket,
  onView,
  onDraft,
  onRunFirstSync,
}: NoticesTableProps): JSX.Element {
  const [year, setYear] = useState("");
  const [name, setName] = useState("");
  const [missingOnly, setMissingOnly] = useState(false);
  const [asking, setAsking] = useState<ReadonlySet<string>>(new Set<string>());
  const [noDate, setNoDate] = useState<Record<string, string>>({});

  const years = useMemo(() => {
    const seen = new Set<string>();
    for (const notice of data.notices) {
      if (notice.assessment_year) seen.add(notice.assessment_year);
    }
    return [...seen].sort();
  }, [data.notices]);

  // A year that no longer exists in the data quietly stops filtering, rather
  // than hiding every row behind a value the select cannot show.
  const activeYear = year && years.includes(year) ? year : "";

  const rows = useMemo(() => {
    const needle = name.trim().toLowerCase();
    return data.notices.filter(
      (notice) =>
        (!activeYear || notice.assessment_year === activeYear) &&
        (!needle || (notice.proceeding_name ?? "").toLowerCase().includes(needle)) &&
        (!missingOnly || !notice.due_date) &&
        inBucket(notice, bucket),
    );
  }, [data.notices, activeYear, name, missingOnly, bucket]);

  const savePdf = useCallback(async (refId: string) => {
    try {
      await saveBlob(await api.noticePdf(refId), `${refId}.pdf`);
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : "Could not save the PDF.", "error");
    }
  }, []);

  const { patch } = data;
  const askClaude = useCallback(
    async (refId: string) => {
      setAsking((current) => new Set(current).add(refId));
      try {
        const answer = await api.askClaude(refId);
        if (answer.due_date) {
          patch(refId, {
            due_date: answer.due_date,
            due_date_source: asSource(answer.source),
            due_date_basis: answer.basis,
          });
          toast(`Due ${answer.due_date}${answer.basis ? ` — ${answer.basis}` : ""}`);
        } else {
          // Plenty of letters genuinely set no deadline: say so quietly.
          setNoDate((current) => ({
            ...current,
            [refId]: answer.basis ?? "Claude found no deadline in this notice",
          }));
        }
      } catch (cause) {
        toast(cause instanceof Error ? cause.message : "Could not ask Claude.", "error");
      } finally {
        setAsking((current) => {
          const next = new Set(current);
          next.delete(refId);
          return next;
        });
      }
    },
    [patch],
  );

  return (
    <Card className="flex min-h-0 flex-col">
      <CardHeader className="flex-wrap gap-x-4 gap-y-2">
        <label className="flex items-center gap-1.5 text-xs text-muted">
          Assessment year
          <Select value={activeYear} onChange={(event) => setYear(event.target.value)}>
            <option value="">All</option>
            {years.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </label>

        <label className="flex items-center gap-1.5 text-xs text-muted">
          Proceeding
          <Input
            type="text"
            data-filter="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="name contains…"
            className="w-56"
          />
        </label>

        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input
            type="checkbox"
            checked={missingOnly}
            onChange={(event) => setMissingOnly(event.target.checked)}
            className="size-3.5 accent-action"
          />
          Missing due date only
        </label>

        <span className="ml-auto text-xs text-muted">
          {data.loading
            ? ""
            : rows.length === data.notices.length
              ? `${data.notices.length} notice(s)`
              : `${rows.length} of ${data.notices.length}`}
        </span>
      </CardHeader>

      <div className="max-h-[32rem] min-h-0 flex-1 overflow-auto">
        <Table>
          <THead>
            <TR className="hover:bg-transparent">
              <TH>Notice</TH>
              <TH>Proceeding</TH>
              <TH className="whitespace-nowrap">Issued</TH>
              <TH className="whitespace-nowrap">Due</TH>
              <TH className="whitespace-nowrap">Status</TH>
              <TH className="text-right">Actions</TH>
            </TR>
          </THead>
          <TBody>
            {data.loading ? (
              Array.from({ length: 5 }, (_, row) => (
                <TR key={row}>
                  {SKELETON_WIDTHS.map((width) => (
                    <TD key={width}>
                      <Skeleton className={width} />
                    </TD>
                  ))}
                </TR>
              ))
            ) : data.error ? (
              <TR className="hover:bg-transparent">
                <TD colSpan={COLUMNS}>
                  <div className="flex items-center justify-center gap-3 px-6 py-10 text-xs text-muted">
                    <span title={data.error ?? undefined}>Could not reach the sidecar.</span>
                    <Button size="sm" onClick={data.reload}>
                      Try again
                    </Button>
                  </div>
                </TD>
              </TR>
            ) : rows.length === 0 ? (
              <TR className="hover:bg-transparent">
                <TD colSpan={COLUMNS}>
                  {data.notices.length > 0 ? (
                    <EmptyState
                      title="Nothing matches these filters."
                      description="Clear the year, the name or the missing-date toggle to see the rest."
                    />
                  ) : (
                    <EmptyState
                      title="No notices stored yet."
                      description="A sync logs into the portal, walks e-Proceedings and stores every notice PDF here."
                      action={
                        <Button variant="accent" className="mt-2" onClick={onRunFirstSync}>
                          Run first sync
                        </Button>
                      }
                    />
                  )}
                </TD>
              </TR>
            ) : (
              rows.map((notice) => (
                <NoticeRow
                  key={notice.ref_id}
                  notice={notice}
                  asking={asking.has(notice.ref_id)}
                  noDate={noDate[notice.ref_id]}
                  onView={onView}
                  onSave={savePdf}
                  onAsk={askClaude}
                  onDraft={onDraft}
                />
              ))
            )}
          </TBody>
        </Table>
      </div>
    </Card>
  );
}

type NoticeRowProps = {
  notice: Notice;
  asking: boolean;
  /** Claude's basis for finding no deadline, once it has said so. */
  noDate: string | undefined;
  onView: (refId: string) => void;
  onSave: (refId: string) => void;
  onAsk: (refId: string) => void;
  onDraft: (refId: string) => void;
};

function NoticeRow({
  notice,
  asking,
  noDate,
  onView,
  onSave,
  onAsk,
  onDraft,
}: NoticeRowProps): JSX.Element {
  const ref = notice.ref_id;

  return (
    <TR>
      <TD>
        <div className="font-medium text-text">{orDash(notice.notice_us)}</div>
        {notice.description ? (
          <div className="mt-0.5 text-xs text-muted">{notice.description}</div>
        ) : null}
        <div className="mt-1">
          <span className="rounded-md bg-raised px-1.5 py-0.5 font-mono text-2xs text-faint">
            {ref}
          </span>
        </div>
      </TD>

      <TD>
        <div>{orDash(notice.proceeding_name)}</div>
        <div className="mt-0.5 font-mono text-2xs text-muted">
          {notice.pan ?? ""} · AY {orDash(notice.assessment_year)}
        </div>
      </TD>

      <TD className="whitespace-nowrap font-mono text-xs">{orDash(notice.issued_on)}</TD>

      <TD>
        <DueChip notice={notice} />
      </TD>

      <TD>
        <StatusTicks notice={notice} />
      </TD>

      <TD>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {notice.has_pdf ? (
            <>
              <Button size="sm" onClick={() => onView(ref)}>
                View
              </Button>
              <Button size="sm" onClick={() => onSave(ref)}>
                Save
              </Button>
            </>
          ) : null}

          {!notice.due_date && notice.has_pdf ? (
            noDate !== undefined ? (
              <span className="text-xs text-muted" title={noDate}>
                no date stated
              </span>
            ) : (
              <Button
                size="sm"
                disabled={asking}
                onClick={() => onAsk(ref)}
                title="Ask Claude to read this notice for a deadline"
              >
                {asking ? <Spinner /> : "✦ Date"}
              </Button>
            )
          ) : null}

          {notice.has_pdf ? (
            <Button size="sm" variant="accent" onClick={() => onDraft(ref)}>
              Draft
            </Button>
          ) : null}
        </div>
      </TD>
    </TR>
  );
}
