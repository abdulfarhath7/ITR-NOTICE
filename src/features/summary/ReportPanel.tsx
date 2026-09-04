import type { BucketKey, ReportItem, Summary } from "@/lib/api";
import { BUCKET_TONE } from "@/lib/buckets";
import { dash, relTime, respondedLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Card, CardBody } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export type ReportPanelProps = {
  summary: Summary | null;
  loading: boolean;
  bucket: BucketKey | "";
  onBucketChange: (bucket: BucketKey | "") => void;
};

type Tone = (typeof BUCKET_TONE)[BucketKey];

/** The old sheet's chip colours. The count carries the stronger hue so the
 *  number reads first and the label stays quiet. */
const CHIP: Record<Tone, { box: string; count: string }> = {
  late: { box: "bg-danger-soft text-danger-text", count: "text-danger" },
  soon: { box: "bg-warn-soft text-warn-text", count: "text-warn" },
  watch: { box: "bg-info-soft text-info-text", count: "text-info" },
  ok: { box: "bg-ok-soft text-ok-text", count: "text-ok" },
  none: { box: "bg-ai-soft text-ai", count: "text-ai" },
  done: { box: "bg-raised text-muted", count: "text-muted" },
};

/** An empty bucket is not news, whatever its tone. */
const EMPTY_CHIP = { box: "bg-raised text-faint", count: "text-muted" };

function Strong({ children }: { children: string | number }) {
  return <b className="font-semibold text-muted">{children}</b>;
}

function RunLine({ run }: { run: Summary["run"] }) {
  if (!run.finished) {
    return (
      <p className="mt-0.5 text-xs text-muted">
        No sync has finished yet · <Strong>{run.notices_scanned || 0}</Strong> notices held
      </p>
    );
  }
  const when = relTime(run.finished) || run.finished;
  return (
    <p className="mt-0.5 text-xs text-muted">
      Run <Strong>{when}</Strong>
      {" · "}
      <Strong>{run.notices_scanned}</Strong> notices scanned
      {" · "}
      <Strong>{run.new_this_run}</Strong> new this run
    </p>
  );
}

// Red once the date has gone, amber while it is inside three days.
function DaysCell({ days }: { days: number | null }) {
  if (days === null) return <span className="text-muted">{dash}</span>;
  const tone = days < 0 ? "text-danger-text" : days <= 3 ? "text-warn-text" : "text-text";
  return <span className={cn("font-mono text-xs font-bold", tone)}>{days}</span>;
}

function AttentionRow({ item }: { item: ReportItem }) {
  return (
    <TR>
      <TD>
        {item.description || item.proceeding_name || item.ref_id || dash}
        {item.description && item.proceeding_name ? (
          <div className="mt-0.5 text-xs text-muted">{item.proceeding_name}</div>
        ) : null}
      </TD>
      <TD className="font-mono text-xs">{item.pan || dash}</TD>
      <TD className="font-mono text-xs">{item.assessment_year || dash}</TD>
      <TD>{item.notice_us || dash}</TD>
      <TD className="font-mono text-xs">{item.due_date || dash}</TD>
      <TD className="text-right">
        <DaysCell days={item.days_left} />
      </TD>
      <TD className={item.responded === null ? "text-muted" : undefined}>
        {respondedLabel(item.responded)}
      </TD>
    </TR>
  );
}

function Placeholder({ loading }: { loading: boolean }) {
  if (!loading) return <p className="mt-3 text-xs text-muted">No report yet.</p>;
  return (
    <div className="mt-3 grid gap-4">
      <Skeleton className="w-72" />
      <div className="flex flex-wrap gap-2">
        {[0, 1, 2, 3, 4].map((slot) => (
          <Skeleton key={slot} className="h-8 w-28 rounded-full" />
        ))}
      </div>
      <Skeleton className="h-28 w-full rounded-md" />
    </div>
  );
}

/** The firm's old Excel tracker, on the page. The server counts the buckets
 *  (app/report.py) so this panel and the downloaded workbook can never
 *  disagree; the chip only filters rows already loaded, so clicking one
 *  costs no round trip. */
export function ReportPanel({
  summary,
  loading,
  bucket,
  onBucketChange,
}: ReportPanelProps): JSX.Element {
  return (
    <Card>
      <CardBody>
        <h2 className="text-base font-semibold tracking-tight">
          {summary?.title ?? "Position at a glance"}
        </h2>

        {!summary ? (
          <Placeholder loading={loading} />
        ) : (
          <>
            <RunLine run={summary.run} />

            <div className="mt-3 flex flex-wrap gap-2">
              {summary.buckets.map((entry) => {
                const active = entry.key === bucket;
                const skin = entry.count ? CHIP[BUCKET_TONE[entry.key]] : EMPTY_CHIP;
                return (
                  <button
                    key={entry.key}
                    type="button"
                    aria-pressed={active}
                    title="Show only these in the table below"
                    onClick={() => onBucketChange(active ? "" : entry.key)}
                    className={cn(
                      "flex items-baseline gap-1.5 rounded-full border px-3 py-1.5 text-xs",
                      "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action",
                      skin.box,
                      active ? "border-current" : "border-transparent",
                    )}
                  >
                    <span className={cn("text-sm font-bold", skin.count)}>{entry.count}</span>
                    <span>{entry.label}</span>
                  </button>
                );
              })}
            </div>

            <p className="mb-2 mt-5 text-2xs font-bold uppercase tracking-wider text-muted">
              Attention — overdue &amp; due within 3 days
            </p>
            <div className="max-h-80 overflow-auto rounded-md border border-hairline">
              <Table>
                <THead className="bg-attn text-white">
                  <TR>
                    <TH>Client / Description</TH>
                    <TH>PAN</TH>
                    <TH>AY</TH>
                    <TH>Section</TH>
                    <TH>Due date</TH>
                    <TH className="text-right">Days left</TH>
                    <TH>Responded</TH>
                  </TR>
                </THead>
                <TBody>
                  {summary.attention.length === 0 ? (
                    <TR>
                      <TD colSpan={7}>
                        {/* the old sheet's own words, kept exactly */}
                        <span className="font-semibold text-ok-text">
                          Nothing overdue or critical.
                        </span>
                      </TD>
                    </TR>
                  ) : (
                    summary.attention.map((item, index) => (
                      <AttentionRow key={item.ref_id ?? index} item={item} />
                    ))
                  )}
                </TBody>
              </Table>
            </div>

            <p className="mt-3 text-xs italic text-faint">{summary.caution}</p>
          </>
        )}
      </CardBody>
    </Card>
  );
}
