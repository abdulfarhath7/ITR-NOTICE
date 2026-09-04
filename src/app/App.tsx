/** The shell: one window, one scroll, the same screens the web dashboard had.
 *
 *  Everything live comes from the hub store; everything stored comes from the
 *  two data hooks. No screen fetches on its own.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import { TopBar } from "@/app/TopBar";
import { applyTheme, readTheme, type Theme } from "@/app/theme";
import {
  markRunning,
  openCredentialsGate,
  pushLog,
  setSpeedLocal,
  startHub,
} from "@/app/hub-store";
import { Button } from "@/components/ui/button";
import { Toaster, toast } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PasswordGate } from "@/features/auth/PasswordGate";
import { CredentialsDialog } from "@/features/credentials/CredentialsDialog";
import { DraftDrawer } from "@/features/drafts/DraftDrawer";
import { NoticesTable } from "@/features/notices/NoticesTable";
import { PdfViewer, type ViewerDoc } from "@/features/notices/PdfViewer";
import { CommandPalette, type PaletteAction } from "@/features/palette/CommandPalette";
import { SettingsDialog } from "@/features/settings/SettingsDialog";
import { ReportPanel } from "@/features/summary/ReportPanel";
import { StatCards } from "@/features/summary/StatCards";
import { OtpDialog } from "@/features/sync/OtpDialog";
import { SyncPanel } from "@/features/sync/SyncPanel";
import { useHub } from "@/hooks/useHub";
import { useNotices } from "@/hooks/useNotices";
import { useSummary } from "@/hooks/useSummary";
import { ApiError, api, type BucketKey } from "@/lib/api";
import { saveBlob } from "@/lib/files";
import { backendFailure, inTauri } from "@/lib/runtime";

export function App() {
  const [theme, setTheme] = useState<Theme>(() => readTheme());
  const [limit, setLimit] = useState<number | null>(null);
  const [bucket, setBucket] = useState<BucketKey | "">("");
  const [viewing, setViewing] = useState<ViewerDoc | null>(null);
  const [draftRef, setDraftRef] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [credentialsOpen, setCredentialsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [unlockedAt, setUnlockedAt] = useState(0);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [update, setUpdate] = useState<{ version: string; install: () => Promise<void> } | null>(
    null,
  );
  const [updating, setUpdating] = useState(false);

  const hub = useHub();
  const notices = useNotices();
  const { summary, loading: summaryLoading } = useSummary(notices.notices.length + unlockedAt);

  useEffect(() => applyTheme(theme), [theme]);

  useEffect(() => {
    if (notices.locked) return; // the password gate opens the socket once it passes
    startHub();
  }, [notices.locked, unlockedAt]);

  // The sidecar never answered /health. Say so plainly; nothing else will work.
  // Both halves are needed: the event can fire before this listener exists, so
  // the shell is also asked directly on the first render.
  useEffect(() => {
    if (!inTauri()) return;
    let unlisten: (() => void) | undefined;
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen<{ message: string }>("sidecar://failed", (event) => {
        setStartupError(event.payload.message);
      });
      const reason = await backendFailure();
      if (reason) setStartupError((current) => current ?? reason);
    })();
    return () => unlisten?.();
  }, []);

  // An update is offered, never forced: the installer swaps in place and the
  // app relaunches, which is not something to do under someone mid-sync.
  useEffect(() => {
    if (!inTauri()) return;
    // The dev build points at the placeholder feed in tauri.conf.json, and the
    // plugin logs its own ERROR for every failed check. Nothing to update from
    // a dev tree anyway.
    if (import.meta.env.DEV) return;
    void (async () => {
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const found = await check();
        if (found) setUpdate({ version: found.version, install: () => found.downloadAndInstall() });
      } catch {
        // no feed, no signature, no network - none of it is worth a dialog
      }
    })();
  }, []);

  // The store asks for the login; the dialog is what answers.
  useEffect(() => {
    if (hub.credentialsRequired) setCredentialsOpen(true);
  }, [hub.credentialsRequired]);

  const runSync = useCallback(async () => {
    try {
      const result = await api.startSync(limit);
      if ("state" in result && result.state === "credentials_required") {
        openCredentialsGate();
        setCredentialsOpen(true);
        return;
      }
      markRunning();
      pushLog(limit ? `Sync started (at most ${limit} new PDFs)` : "Sync started (all notices)");
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        toast("A sync is already running.");
        return;
      }
      toast(cause instanceof Error ? cause.message : "Could not start the sync.", "error");
    }
  }, [limit]);

  const exportXlsx = useCallback(async () => {
    try {
      const blob = await api.exportXlsx();
      const stamp = summary?.generated_on ?? new Date().toISOString().slice(0, 10);
      await saveBlob(blob, `itr-summary-${stamp}.xlsx`);
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : "Could not build the workbook.", "error");
    }
  }, [summary]);

  const changeLogin = useCallback(async () => {
    try {
      await api.forgetCredentials();
    } catch {
      // the gate is opened either way; the server forgets on its own restart
    }
    openCredentialsGate();
    setCredentialsOpen(true);
  }, []);

  const paletteActions = useMemo<PaletteAction[]>(() => {
    const base: PaletteAction[] = [
      { label: "Run sync", hint: "s", run: () => void runSync() },
      { label: "Toggle theme", run: () => setTheme((value) => (value === "dark" ? "light" : "dark")) },
      { label: "Speed: slow", run: () => void setSpeed("slow") },
      { label: "Speed: fast", run: () => void setSpeed("fast") },
      { label: "Speed: extreme (testing only)", run: () => void setSpeed("extreme") },
      { label: "Clear the bucket filter", run: () => setBucket("") },
      { label: "Export summary to Excel", run: () => void exportXlsx() },
      { label: "Change portal login", run: () => void changeLogin() },
      { label: "Stored secrets", run: () => setSettingsOpen(true) },
    ];
    const documents: PaletteAction[] = notices.notices
      .filter((notice) => notice.has_pdf)
      .map((notice) => ({
        label: `Open notice ${notice.ref_id}`,
        hint: (notice.description ?? notice.proceeding_name ?? "").slice(0, 40),
        haystack: `${notice.ref_id} ${notice.description ?? ""} ${notice.proceeding_name ?? ""}`,
        run: () => setViewing({ kind: "notice", refId: notice.ref_id }),
      }));
    return base.concat(documents);
  }, [notices.notices, runSync, exportXlsx, changeLogin]);

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      const target = event.target as HTMLElement | null;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? "");
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (typing) return;
      if (event.key === "s") {
        event.preventDefault();
        void runSync();
      }
      if (event.key === "/") {
        event.preventDefault();
        // the notices filter, wherever the table put it
        document.querySelector<HTMLInputElement>('input[data-filter="name"]')?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [runSync]);

  if (notices.locked) {
    return (
      <TooltipProvider>
        <PasswordGate
          onUnlocked={() => {
            setUnlockedAt((value) => value + 1);
            notices.reload();
          }}
        />
        <Toaster />
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col bg-bg text-text">
        <TopBar
          limit={limit}
          onLimitChange={setLimit}
          theme={theme}
          onThemeToggle={() => setTheme((value) => (value === "dark" ? "light" : "dark"))}
          onSync={() => void runSync()}
          onExport={() => void exportXlsx()}
          onOpenPalette={() => setPaletteOpen(true)}
          onChangeLogin={() => void changeLogin()}
          onOpenSettings={() => setSettingsOpen(true)}
          syncing={hub.state === "running"}
        />

        {update ? (
          <div className="flex items-center gap-3 border-b border-hairline bg-action-soft px-4 py-2 text-xs text-text">
            <span>Version {update.version} is ready to install.</span>
            <Button
              variant="primary"
              size="sm"
              disabled={updating}
              onClick={() => {
                setUpdating(true);
                void update
                  .install()
                  .then(() => import("@tauri-apps/plugin-process"))
                  .then((process) => process.relaunch())
                  .catch((cause) => {
                    setUpdating(false);
                    toast(cause instanceof Error ? cause.message : "The update failed.", "error");
                  });
              }}
            >
              {updating ? "Installing…" : "Install and restart"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setUpdate(null)}>
              Later
            </Button>
          </div>
        ) : null}

        {startupError ? (
          <div className="flex items-center gap-3 border-b border-danger/40 bg-danger-soft px-4 py-2 text-xs text-danger-text">
            <span>The local backend did not start: {startupError}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void import("@tauri-apps/plugin-process").then((m) => m.relaunch())}
            >
              Restart the app
            </Button>
          </div>
        ) : null}

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4">
            <StatCards notices={notices.notices} lastRun={notices.lastRun} />
            <SyncPanel />
            <ReportPanel
              summary={summary}
              loading={summaryLoading}
              bucket={bucket}
              onBucketChange={setBucket}
            />
            <NoticesTable
              data={notices}
              bucket={bucket}
              onView={(refId) => setViewing({ kind: "notice", refId })}
              onDraft={(refId) => setDraftRef(refId)}
              onRunFirstSync={() => void runSync()}
            />
          </div>
        </main>
      </div>

      <CredentialsDialog
        open={credentialsOpen}
        onOpenChange={setCredentialsOpen}
        limit={limit}
      />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <OtpDialog />
      <PdfViewer doc={viewing} onClose={() => setViewing(null)} />
      <DraftDrawer
        refId={draftRef}
        onClose={() => setDraftRef(null)}
        onDrafted={(refId) => notices.patch(refId, { has_draft: 1 })}
        onViewPdf={(refId) => setViewing({ kind: "draft", refId })}
      />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} actions={paletteActions} />
      <Toaster />
    </TooltipProvider>
  );
}

async function setSpeed(mode: "slow" | "fast" | "extreme"): Promise<void> {
  try {
    const result = await api.writeSpeed(mode);
    setSpeedLocal(result.mode, result.delay_ms);
    toast(`Speed: ${result.mode} (${result.delay_ms}ms per action)`);
  } catch (cause) {
    toast(cause instanceof Error ? cause.message : "Could not change the speed.", "error");
  }
}
