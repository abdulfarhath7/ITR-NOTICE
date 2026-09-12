/** Opening and saving documents; both allowed for every status. */
import { save } from "@tauri-apps/plugin-dialog";
import { useCallback, useState } from "react";
import { api, blobUrl, describeError } from "../lib/api";
import { toast, toastError } from "../lib/toast";
import type { Document } from "../lib/types";

export interface Preview { doc: Document; url: string }

export function useDocuments() {
  const [preview, setPreview] = useState<Preview | null>(null);

  const closePreview = useCallback(() => {
    setPreview((p) => { if (p) URL.revokeObjectURL(p.url); return null; });
  }, []);

  const view = useCallback(async (doc: Document) => {
    try {
      const b64 = await api.documentBase64(doc.id);
      setPreview((p) => { if (p) URL.revokeObjectURL(p.url); return { doc, url: blobUrl(b64) }; });
    } catch (e) { toastError(describeError(e)); }
  }, []);

  const openExternal = useCallback(async (doc: Document) => {
    try { await api.openDocument(doc.id); }
    catch (e) { toastError(describeError(e)); }
  }, []);

  const saveAs = useCallback(async (doc: Document) => {
    try {
      const path = await save({ defaultPath: doc.filename ?? "document.pdf", filters: [{ name: "PDF", extensions: ["pdf"] }] });
      if (!path) return;
      await api.saveDocumentAs(doc.id, path);
      toast("Saved.");
    } catch (e) { toastError(describeError(e)); }
  }, []);

  return { preview, closePreview, view, openExternal, saveAs };
}
