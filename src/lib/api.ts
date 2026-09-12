import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Draft, DueDateAnswer, NoticeRow, ScraperEvent, Settings } from "./types";

export const api = {
  settings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<void>("save_settings", { settings }),

  notices: () => invoke<NoticeRow[]>("list_notices"),
  pdf: (refId: string) => invoke<string>("get_notice_pdf", { refId }),
  draft: (refId: string) => invoke<Draft | null>("get_draft", { refId }),
  saveDraftText: (refId: string, draftText: string) =>
    invoke<void>("save_draft_text", { refId, draftText }),

  hasSavedPassword: (userId: string) => invoke<boolean>("has_saved_password", { userId }),
  forgetPassword: (userId: string) => invoke<void>("forget_password", { userId }),

  login: (userId: string, password: string | null, remember: boolean) =>
    invoke<void>("portal_login", { userId, password, remember }),
  otp: (code: string) => invoke<void>("portal_otp", { code }),
  sync: (limit: number | null) => invoke<void>("portal_sync", { limit }),
  speed: (seconds: number) => invoke<void>("portal_speed", { seconds }),
  stop: () => invoke<void>("portal_stop"),

  askDueDate: (refId: string) => invoke<DueDateAnswer>("ask_due_date", { refId }),
  draftResponse: (refId: string, regenerate: boolean) =>
    invoke<Draft>("draft_response", { refId, regenerate }),
};

export function onScraper(handler: (ev: ScraperEvent) => void): Promise<UnlistenFn> {
  return listen<ScraperEvent>("scraper", (e) => handler(e.payload));
}

/** Commands reject with an `AppError` object ({ code, message, detail }) or,
 *  from the older commands, a plain string. One reader for both. */
export function describeError(e: unknown): string {
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string") {
    return (e as { message: string }).message;
  }
  return String(e);
}

/** base64 PDF -> object URL for an <iframe>. Caller revokes it. */
export function pdfUrl(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
}
