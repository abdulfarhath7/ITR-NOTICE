import { useEffect, useRef } from "react";

import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { useHub } from "@/hooks/useHub";

/** How near the end still counts as "reading the tail". */
const TAIL_SLACK_PX = 24;

export function LogPane(): JSX.Element {
  const { logLines } = useHub();
  const scroller = useRef<HTMLDivElement | null>(null);
  // Follow the tail only while the reader is already there: scrolling up to
  // read an earlier line must not be yanked back down by the next log push.
  const pinned = useRef(true);

  useEffect(() => {
    const element = scroller.current;
    if (!element || !pinned.current) return;
    element.scrollTop = element.scrollHeight;
  }, [logLines]);

  function onScroll(): void {
    const element = scroller.current;
    if (!element) return;
    pinned.current =
      element.scrollHeight - element.scrollTop - element.clientHeight < TAIL_SLACK_PX;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Run log</CardTitle>
      </CardHeader>
      <div
        ref={scroller}
        onScroll={onScroll}
        role="log"
        aria-label="Run log"
        className="h-64 overflow-y-auto px-4 py-3 font-mono text-2xs leading-5 text-muted"
      >
        {logLines.map((line, index) => (
          <div key={index} className="whitespace-pre-wrap break-words">
            {line}
          </div>
        ))}
      </div>
    </Card>
  );
}
