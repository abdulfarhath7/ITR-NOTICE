import { useState } from "react";

import { setSpeedLocal } from "@/app/hub-store";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useHub } from "@/hooks/useHub";
import { api, type SpeedMode } from "@/lib/api";
import { cn } from "@/lib/utils";

const MODES: readonly { key: SpeedMode; label: string }[] = [
  { key: "slow", label: "Slow" },
  { key: "fast", label: "Fast" },
  { key: "extreme", label: "Extreme" },
];

/** The pace belongs to the server, not to this window: it is the delay the
 *  scraper waits before every action, read fresh each time. So a click here
 *  changes the speed of a run that is already going, not just the next one. */
export function SpeedControl(): JSX.Element {
  const { speed } = useHub();
  const [busy, setBusy] = useState(false);

  async function choose(mode: SpeedMode): Promise<void> {
    setBusy(true);
    try {
      const next = await api.writeSpeed(mode);
      setSpeedLocal(next.mode, next.delay_ms);
      toast(`Speed: ${next.mode} (${next.delay_ms}ms per action)`);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not change the speed.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <div
        role="group"
        aria-label="Browser speed"
        className="inline-flex items-center gap-0.5 rounded-md border border-hairline bg-surface p-0.5"
      >
        {MODES.map((mode) => (
          <Button
            key={mode.key}
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            aria-pressed={speed === mode.key}
            onClick={() => void choose(mode.key)}
            className={cn("rounded-sm", speed === mode.key && "bg-raised text-text")}
          >
            {mode.label}
          </Button>
        ))}
      </div>
      {speed === "extreme" ? <span className="text-2xs text-warn-text">testing only</span> : null}
    </div>
  );
}
