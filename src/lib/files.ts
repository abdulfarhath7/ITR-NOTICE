/** Saving a document out of the app.
 *
 * The webview cannot follow a Content-Disposition download, so bytes are
 * fetched with the shared token and then written wherever the OS save dialog
 * points. In a plain browser (dev), it falls back to an object-URL anchor.
 */
import { inTauri } from "@/lib/runtime";

export async function saveBlob(blob: Blob, suggestedName: string): Promise<boolean> {
  if (!inTauri()) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = suggestedName;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return true;
  }

  const [{ save }, { writeFile }] = await Promise.all([
    import("@tauri-apps/plugin-dialog"),
    import("@tauri-apps/plugin-fs"),
  ]);
  const extension = suggestedName.split(".").pop() ?? "";
  const path = await save({
    defaultPath: suggestedName,
    filters: extension ? [{ name: extension.toUpperCase(), extensions: [extension] }] : [],
  });
  if (!path) return false;
  await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
  return true;
}

/** An object URL for an <iframe>, with a matching revoke. */
export function objectUrl(blob: Blob): { url: string; revoke: () => void } {
  const url = URL.createObjectURL(blob);
  return { url, revoke: () => URL.revokeObjectURL(url) };
}
