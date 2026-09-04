/** The report's numbers. Counted server-side (app/report.py) so the panel and
 *  the downloaded workbook can never disagree. */
import { useEffect, useState } from "react";

import { useHub } from "@/hooks/useHub";
import { api, type Summary } from "@/lib/api";

export function useSummary(revision: number): { summary: Summary | null; loading: boolean } {
  const { finishedRevision } = useHub();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    void (async () => {
      try {
        const data = await api.summary(controller.signal);
        if (alive) setSummary(data);
      } catch {
        // The table still works without the report; leave what is on screen.
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
      controller.abort();
    };
  }, [revision, finishedRevision]);

  return { summary, loading };
}
