/** Saving bytes out of the window.
 *
 * The shell exposes no dialog or fs plugin (capabilities are locked to
 * `core:default`), so this is the same anchor-download trick `XLSX.writeFile`
 * already uses for the Excel export - one path for every "Save" button.
 * TODO: WebView2 can be configured to refuse a script-started download; if
 * Save is ever silent on Windows, the fix is the fs/dialog plugin pair and
 * a widened capability, not a change here.
 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** base64 -> Blob, for the PDFs the archive hands back. */
export function b64Blob(b64: string, type: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}
