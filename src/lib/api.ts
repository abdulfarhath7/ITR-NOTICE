/** Every command the frontend may call, typed once (docs/08). */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  ClientDetail, ClientInput, ClientSummary, Derived, Draft, DueDateAnswer, ImportPreview,
  ProceedingDetail, ScraperEvent, Settings, TypeEntry, WorkItemFilter, WorkItemRow,
} from "./types";

export const api = {
  settings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<void>("save_settings", { settings }),

  clients: (search?: string) => invoke<ClientSummary[]>("list_clients", { search: search ?? null }),
  client: (id: string) => invoke<ClientDetail>("get_client", { id }),
  createClient: (input: ClientInput) => invoke<ClientDetail>("create_client", { input }),
  updateClient: (id: string, input: ClientInput) => invoke<ClientDetail>("update_client", { id, input }),
  deriveFromGstin: (gstin: string) => invoke<Derived>("derive_from_gstin", { gstin }),
  setClientFileNo: (clientId: string, value: string | null) =>
    invoke<void>("set_client_file_no", { clientId, value }),
  importClientsCsv: (path: string, dryRun: boolean) =>
    invoke<ImportPreview>("import_clients_csv", { path, dryRun }),
  setClientCredential: (clientId: string, password: string) =>
    invoke<void>("set_client_credential", { clientId, password }),
  forgetClientCredential: (clientId: string) => invoke<void>("forget_client_credential", { clientId }),

  workItems: (filter?: WorkItemFilter) => invoke<WorkItemRow[]>("list_work_items", { filter: filter ?? null }),
  proceeding: (id: string) => invoke<ProceedingDetail>("get_proceeding", { id }),
  setManualDueDate: (proceedingId: string, date: string | null) =>
    invoke<void>("set_manual_due_date", { proceedingId, date }),
  registry: (registryName: string) => invoke<TypeEntry[]>("list_registry", { registryName }),

  openDocument: (documentId: string) => invoke<void>("open_document", { documentId }),
  saveDocumentAs: (documentId: string, path: string) => invoke<void>("save_document_as", { documentId, path }),
  documentBase64: (documentId: string) => invoke<string>("get_document_base64", { documentId }),

  draft: (refId: string) => invoke<Draft | null>("get_draft", { refId }),
  saveDraftText: (refId: string, draftText: string) => invoke<void>("save_draft_text", { refId, draftText }),
  askDueDate: (refId: string) => invoke<DueDateAnswer>("ask_due_date", { refId }),
  draftResponse: (refId: string, regenerate: boolean) => invoke<Draft>("draft_response", { refId, regenerate }),

  hasSavedPassword: (userId: string) => invoke<boolean>("has_saved_password", { userId }),
  forgetPassword: (userId: string) => invoke<void>("forget_password", { userId }),
  login: (userId: string, password: string | null, remember: boolean) =>
    invoke<void>("portal_login", { userId, password, remember }),
  otp: (code: string) => invoke<void>("portal_otp", { code }),
  sync: (limit: number | null) => invoke<void>("portal_sync", { limit }),
  speed: (seconds: number) => invoke<void>("portal_speed", { seconds }),
  stop: () => invoke<void>("portal_stop"),
};

export function onScraper(handler: (ev: ScraperEvent) => void): Promise<UnlistenFn> {
  return listen<ScraperEvent>("scraper", (e) => handler(e.payload));
}

/** base64 -> object URL. Caller revokes it. */
export function blobUrl(b64: string, type = "application/pdf"): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type }));
}

export { describeError } from "./query";
