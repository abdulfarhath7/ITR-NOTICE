/** The AI draft for one communication: cached per notice; the proxy is
 *  never called twice for the same notice (docs/08). */
import { useCallback, useState } from "react";
import { api, describeError } from "../lib/api";
import { invalidate } from "../lib/query";
import { toast, toastError } from "../lib/toast";
import type { Draft } from "../lib/types";

export function useDraft() {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const open = useCallback(async (refId: string) => {
    setBusy(true);
    try {
      const existing = await api.draft(refId);
      setDraft(existing ?? await api.createDraft(refId));
    } catch (e) { toastError(describeError(e)); }
    finally { setBusy(false); }
  }, []);

  const saveText = useCallback(async (text: string) => {
    if (!draft) return;
    setBusy(true);
    try {
      await api.saveDraftText(draft.ref_id, text);
      setDraft({ ...draft, draft_text: text });
      toast("Edits saved.");
    } catch (e) { toastError(describeError(e)); }
    finally { setBusy(false); }
  }, [draft]);

  const close = useCallback(() => setDraft(null), []);

  /** "Mark reviewed" (docs/16 §6); the Attention strip counts the rest. */
  const setReviewed = useCallback(async (reviewed: boolean) => {
    if (!draft) return;
    setBusy(true);
    try {
      await api.setDraftReviewed(draft.ref_id, reviewed);
      setDraft({ ...draft, reviewed_at: reviewed ? new Date().toISOString() : null });
      toast(reviewed ? "Marked reviewed." : "Review mark cleared.");
      invalidate("work_items");
    } catch (e) { toastError(describeError(e)); }
    finally { setBusy(false); }
  }, [draft]);

  return { draft, busy, open, saveText, close, setReviewed };
}
