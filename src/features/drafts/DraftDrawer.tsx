import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogTitle,
  DrawerContent,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api";
import { saveBlob } from "@/lib/files";
import { relTime } from "@/lib/format";

export type DraftDrawerProps = {
  refId: string | null;
  onClose: () => void;
  onDrafted: (refId: string) => void;
  onViewPdf: (refId: string) => void;
};

/** One notice's draft, held for the life of the drawer so an unsaved edit
 *  survives a close and re-open. */
type Entry = {
  summary: string;
  checklist: string[];
  text: string;
  generatedAt: string;
  /** the server's copy matches `text` */
  saved: boolean;
  dirty: boolean;
};

type Pending = "load" | "regenerate" | "save" | "pdf" | null;

function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return "Could not reach the server.";
}

const HEADING = "text-2xs font-semibold uppercase tracking-wider text-muted";

export function DraftDrawer(props: DraftDrawerProps): JSX.Element {
  const { refId, onClose, onViewPdf } = props;

  const [entries, setEntries] = React.useState<Record<string, Entry>>({});
  const [pending, setPending] = React.useState<Pending>(null);
  const [error, setError] = React.useState<string | null>(null);

  const textRef = React.useRef<HTMLTextAreaElement>(null);
  const warned = React.useRef(new Set<string>());
  const ticket = React.useRef(0);
  /** the mode of the most recent generate call, so Retry replays that one */
  const lastMode = React.useRef(false);

  // The parent may hand a fresh closure every render; the load effect must not
  // re-fire because of it.
  const draftedRef = React.useRef(props.onDrafted);
  React.useEffect(() => {
    draftedRef.current = props.onDrafted;
  }, [props.onDrafted]);

  const entry = refId === null ? undefined : entries[refId];
  const busy = pending !== null;

  const generate = React.useCallback(async (ref: string, regenerate: boolean) => {
    const mine = ++ticket.current;
    lastMode.current = regenerate;
    setError(null);
    setPending(regenerate ? "regenerate" : "load");
    try {
      const draft = await api.draft(ref, regenerate);
      draftedRef.current(ref);
      if (mine !== ticket.current) return;
      setEntries((prev) => {
        const held = prev[ref];
        // Re-opening must not throw away an edit; only a regeneration replaces it.
        const kept = !regenerate && held?.dirty ? held.text : null;
        return {
          ...prev,
          [ref]: {
            summary: draft.summary,
            checklist: draft.checklist,
            text: kept ?? draft.draft_text,
            generatedAt: draft.generated_at,
            saved: kept === null && draft.cached,
            dirty: kept !== null,
          },
        };
      });
    } catch (caught) {
      if (mine === ticket.current) setError(messageOf(caught));
    } finally {
      if (mine === ticket.current) setPending(null);
    }
  }, []);

  React.useEffect(() => {
    if (refId === null) return;
    void generate(refId, false);
  }, [refId, generate]);

  const close = React.useCallback(() => {
    if (refId !== null && entries[refId]?.dirty && !warned.current.has(refId)) {
      warned.current.add(refId);
      toast("Edits kept, but not saved — press Save edits to update the document.");
    }
    onClose();
  }, [refId, entries, onClose]);

  function edit(value: string): void {
    if (refId === null) return;
    setEntries((prev) => {
      const held = prev[refId];
      if (held === undefined) return prev;
      return { ...prev, [refId]: { ...held, text: value, dirty: true, saved: false } };
    });
  }

  async function saveEdits(): Promise<void> {
    if (refId === null || entry === undefined) return;
    const sent = entry.text;
    const mine = ++ticket.current;
    setPending("save");
    try {
      const result = await api.saveDraftText(refId, sent);
      setEntries((prev) => {
        const held = prev[refId];
        if (held === undefined) return prev;
        // Anything typed while the save was in flight is still unsaved.
        const stillDirty = held.text !== sent;
        return {
          ...prev,
          [refId]: {
            ...held,
            generatedAt: result.generated_at,
            saved: !stillDirty,
            dirty: stillDirty,
          },
        };
      });
      toast("Edits saved, document re-rendered.");
    } catch (caught) {
      toast(messageOf(caught), "error");
    } finally {
      if (mine === ticket.current) setPending(null);
    }
  }

  async function savePdf(): Promise<void> {
    if (refId === null) return;
    const mine = ++ticket.current;
    setPending("pdf");
    try {
      await saveBlob(await api.draftPdf(refId), `draft-${refId}.pdf`);
    } catch (caught) {
      toast(messageOf(caught), "error");
    } finally {
      if (mine === ticket.current) setPending(null);
    }
  }

  async function copy(): Promise<void> {
    if (entry === undefined) return;
    try {
      await navigator.clipboard.writeText(entry.text);
      toast("Draft copied.");
    } catch {
      textRef.current?.select();
      toast("Press Ctrl+C to copy.");
    }
  }

  return (
    <Dialog
      open={refId !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DrawerContent>
        <header className="flex shrink-0 items-center gap-3 border-b border-hairline px-4 py-2.5">
          <DialogTitle className="text-sm font-semibold tracking-tight">Draft response</DialogTitle>
          <span className="truncate font-mono text-xs text-muted">{refId}</span>
          {entry !== undefined && (
            <span className="whitespace-nowrap text-2xs text-faint">
              {entry.saved ? "saved" : "generated"} {relTime(entry.generatedAt)}
            </span>
          )}
          {pending === "load" && entry !== undefined && <Spinner className="text-faint" />}
          <span className="flex-1" />
          <DialogClose asChild>
            <Button variant="ghost" size="sm">
              Close
            </Button>
          </DialogClose>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
          <DialogDescription className="rounded-md border border-danger/40 bg-danger-soft px-3 py-2.5 text-xs text-danger-text">
            <strong className="font-semibold">DRAFT — review before filing.</strong> This tool never
            submits to the portal.
          </DialogDescription>

          {error !== null && (
            <div className="rounded-lg border border-hairline bg-raised p-4">
              <p className="text-sm text-text">{error}</p>
              <Button
                size="sm"
                className="mt-3"
                disabled={busy}
                onClick={() => {
                  if (refId !== null) void generate(refId, lastMode.current);
                }}
              >
                Retry
              </Button>
            </div>
          )}

          {entry === undefined && busy && (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
              <Spinner />
              Asking Claude for a draft…
            </div>
          )}

          {entry !== undefined && (
            <>
              <section className="rounded-lg border border-ai/30 border-l-2 border-l-ai bg-ai-soft p-4">
                <div className="mb-2 flex items-center gap-2">
                  <span className="grid size-5 shrink-0 place-items-center rounded-sm border border-ai/40 text-2xs text-ai">
                    ✦
                  </span>
                  <p className={HEADING}>Summary</p>
                </div>
                <p className="whitespace-pre-wrap text-sm text-text">
                  {entry.summary || "(no summary)"}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-hairline pt-2.5 text-2xs text-faint">
                  <span>✦ Generated by Claude · {relTime(entry.generatedAt)}</span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (refId !== null) void generate(refId, true);
                    }}
                    className="text-ai underline underline-offset-2 hover:no-underline disabled:opacity-50"
                  >
                    Regenerate
                  </button>
                </div>
              </section>

              <section>
                <p className={`${HEADING} mb-1`}>Documents required</p>
                {entry.checklist.length === 0 ? (
                  <p className="text-sm text-muted">Nothing specific demanded.</p>
                ) : (
                  <div className="divide-y divide-hairline">
                    {entry.checklist.map((line, index) => (
                      <div key={`${index}-${line}`} className="flex items-start gap-2.5 py-2">
                        <span className="mt-0.5 size-3.5 shrink-0 rounded-sm border border-divider" />
                        <span className="text-sm text-text">{line}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section>
                <p className={`${HEADING} mb-1.5`}>Draft reply (editable)</p>
                <Textarea
                  ref={textRef}
                  spellCheck={false}
                  value={entry.text}
                  onChange={(event) => edit(event.target.value)}
                  className="min-h-80 resize-y"
                  aria-label="Draft reply"
                />
              </section>
            </>
          )}
        </div>

        {entry !== undefined && (
          <footer className="shrink-0 border-t border-hairline px-4 py-3">
            {entry.dirty && (
              <p className="mb-2 text-xs text-warn-text">
                Edited — press Save edits to update the document too.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                size="sm"
                disabled={busy || !entry.dirty}
                onClick={() => void saveEdits()}
              >
                {pending === "save" && <Spinner />}
                Save edits
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  if (refId !== null) onViewPdf(refId);
                }}
              >
                View
              </Button>
              <Button size="sm" disabled={busy} onClick={() => void savePdf()}>
                {pending === "pdf" && <Spinner />}
                Save
              </Button>
              <Button size="sm" onClick={() => void copy()}>
                Copy draft
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => {
                  if (refId !== null) void generate(refId, true);
                }}
              >
                {pending === "regenerate" && <Spinner />}
                Regenerate
              </Button>
            </div>
          </footer>
        )}
      </DrawerContent>
    </Dialog>
  );
}
