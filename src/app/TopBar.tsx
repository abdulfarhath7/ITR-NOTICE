/** The one persistent row: what the app is, what it is doing, and the two
 *  controls that change a run - the download limit and the pace. */
import { Command, Download, Moon, RefreshCw, Settings, Sun, UserRound } from "lucide-react";

import { SpeedControl } from "@/features/sync/SpeedControl";
import { useHub } from "@/hooks/useHub";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Theme } from "@/app/theme";

const STATE_LABEL: Record<string, string> = {
  idle: "idle",
  running: "syncing",
  failed: "failed",
  credentials_required: "needs portal login",
  otp_required: "waiting for OTP",
  disconnected: "disconnected",
};

const STATE_TONE: Record<string, string> = {
  idle: "bg-muted",
  running: "bg-action animate-pulse-rec",
  failed: "bg-danger",
  credentials_required: "bg-warn",
  otp_required: "bg-warn animate-pulse-rec",
  disconnected: "bg-faint",
};

export type TopBarProps = {
  limit: number | null;
  onLimitChange: (limit: number | null) => void;
  theme: Theme;
  onThemeToggle: () => void;
  onSync: () => void;
  onExport: () => void;
  onOpenPalette: () => void;
  onChangeLogin: () => void;
  onOpenSettings: () => void;
  syncing: boolean;
};

export function TopBar(props: TopBarProps) {
  const { state } = useHub();

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-hairline bg-panel px-3">
      <div className="flex items-center gap-2">
        <span className="grid size-6 place-items-center rounded-md bg-accent-gradient text-2xs font-bold text-white">
          ND
        </span>
        <span className="text-sm font-semibold tracking-tight">Notice Desk</span>
      </div>

      <div className="flex items-center gap-1.5 rounded-full border border-hairline px-2 py-0.5">
        <span
          className={cn("size-1.5 rounded-full", STATE_TONE[state] ?? "bg-muted")}
          aria-hidden="true"
        />
        <span className="text-2xs text-muted">{STATE_LABEL[state] ?? state}</span>
      </div>

      <div className="flex-1" />

      <label className="flex items-center gap-2 text-2xs text-muted">
        Download at most
        <Input
          type="number"
          min={1}
          step={1}
          placeholder="all"
          className="w-[74px]"
          aria-label="How many new PDFs to download this run"
          autoComplete="off"
          value={props.limit ?? ""}
          onChange={(event) => {
            const parsed = Number.parseInt(event.target.value, 10);
            props.onLimitChange(Number.isFinite(parsed) && parsed > 0 ? parsed : null);
          }}
        />
      </label>

      <SpeedControl />

      <Tooltip label="Forget the portal login and ask again">
        <Button variant="ghost" size="icon" aria-label="Change portal login" onClick={props.onChangeLogin}>
          <UserRound />
        </Button>
      </Tooltip>

      <Tooltip label="Stored secrets">
        <Button variant="ghost" size="icon" aria-label="Stored secrets" onClick={props.onOpenSettings}>
          <Settings />
        </Button>
      </Tooltip>

      <Tooltip label={props.theme === "dark" ? "Switch to light" : "Switch to dark"}>
        <Button variant="ghost" size="icon" aria-label="Switch theme" onClick={props.onThemeToggle}>
          {props.theme === "dark" ? <Moon /> : <Sun />}
        </Button>
      </Tooltip>

      <Tooltip label="Command palette (Ctrl K)">
        <Button variant="ghost" size="icon" aria-label="Command palette" onClick={props.onOpenPalette}>
          <Command />
        </Button>
      </Tooltip>

      <Tooltip label="Download the summary as Excel">
        <Button variant="ghost" size="sm" onClick={props.onExport}>
          <Download />
          Export
        </Button>
      </Tooltip>

      <Button variant="accent" size="sm" onClick={props.onSync} disabled={props.syncing}>
        <RefreshCw className={cn(props.syncing && "animate-spin")} />
        Sync
      </Button>
    </header>
  );
}
