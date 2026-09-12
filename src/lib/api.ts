/** Every command the frontend may call, typed once (docs/08). */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  ClientDetail, ClientInput, ClientSummary, Derived, Draft, DueDateAnswer, ImportPreview,
  IngestionEvent, IngestionJob, IngestionRun, IngestionState, ProceedingDetail, Scope, Settings,
  TypeEntry, WorkItemFilter, WorkItemRow,
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

  startIngestion: (scope: Scope) => invoke<string>("start_ingestion_run", { scope }),
  resumeSweep: (sweepId: string) => invoke<string>("resume_ingestion_sweep", { sweepId }),
  refreshClient: (clientId: string) => invoke<string>("refresh_client", { clientId }),
  pauseIngestion: () => invoke<void>("pause_ingestion_run"),
  resumeIngestion: () => invoke<void>("resume_ingestion_run"),
  stopIngestion: () => invoke<void>("stop_ingestion_run"),
  ingestionState: () => invoke<IngestionState>("get_ingestion_state"),
  submitChallenge: (kind: string, value: string) => invoke<void>("submit_login_challenge", { kind, value }),
  setPace: (seconds: number) => invoke<void>("set_ingestion_pace", { seconds }),
  ingestionJobs: (sweepId?: string) => invoke<IngestionJob[]>("list_ingestion_jobs", { sweepId: sweepId ?? null }),
  ingestionRuns: (limit?: number) => invoke<IngestionRun[]>("list_ingestion_runs", { limit: limit ?? null }),
};

export function onIngestion(handler: (ev: IngestionEvent) => void): Promise<UnlistenFn> {
  return listen<IngestionEvent>("ingestion", (e) => handler(e.payload));
}

/** base64 -> object URL. Caller revokes it. */
export function blobUrl(b64: string, type = "application/pdf"): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type }));
}

export { describeError } from "./query";
