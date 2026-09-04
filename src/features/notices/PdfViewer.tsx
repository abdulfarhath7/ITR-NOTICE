/** One modal for every document this app holds: a notice, or the draft written
 *  against it. Read it here rather than in a tab - the point of the table is
 *  that you never leave it.
 *
 *  The token cannot ride on an <iframe src>, so the bytes are fetched through
 *  the API client and handed to the frame as an object URL.
 */
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { objectUrl, saveBlob } from "@/lib/files";

export type ViewerDoc = { kind: "notice" | "draft"; refId: string };

export function PdfViewer({ doc, onClose }: { doc: ViewerDoc | null; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!doc) {
      setUrl(null);
      setBlob(null);
      setError(null);
      return;
    }
    let revoke: (() => void) | null = null;
    let alive = true;
    setUrl(null);
    setBlob(null);          // never let Save write the previous document's bytes
    setError(null);
    void (async () => {
      try {
        const bytes =
          doc.kind === "notice" ? await api.noticePdf(doc.refId) : await api.draftPdf(doc.refId);
        if (!alive) return;
        const made = objectUrl(bytes);
        revoke = made.revoke;
        setBlob(bytes);
        setUrl(made.url);
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : "Could not open the document.");
      }
    })();
    return () => {
      alive = false;
      revoke?.();
    };
  }, [doc]);

  const label = doc ? (doc.kind === "draft" ? `draft ${doc.refId}` : doc.refId) : "";

  async function save(): Promise<void> {
    if (!doc || !blob) return;
    const name = doc.kind === "draft" ? `draft-${doc.refId}.pdf` : `${doc.refId}.pdf`;
    try {
      await saveBlob(blob, name);
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : "Could not save the document.", "error");
    }
  }

  return (
    <Dialog open={doc !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[86vh] w-[min(980px,94vw)] max-w-none flex-col p-0" hideClose>
        <div className="flex items-center gap-3 border-b border-hairline px-4 py-2.5">
          <DialogTitle className="text-sm font-semibold">
            {doc?.kind === "draft" ? "Draft response" : "Notice"}
          </DialogTitle>
          <span className="font-mono text-xs text-muted">{label}</span>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => void save()} disabled={!blob}>
              Save
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
        <div className="flex-1 bg-surface">
          {error ? (
            <div className="grid h-full place-items-center px-6 text-center text-sm text-danger-text">
              {error}
            </div>
          ) : url ? (
            <iframe title="Document" src={url} className="h-full w-full border-0" />
          ) : (
            <div className="grid h-full place-items-center text-muted">
              <Spinner />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
