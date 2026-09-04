/** The OS keychain, through the shell.
 *
 * Values cross this boundary exactly once, on their way in. Reading a secret
 * back is possible but nothing in the UI does it: the shell injects what the
 * sidecar needs at spawn, so the window never holds a key.
 */
import { inTauri } from "@/lib/runtime";

export type SecretSlot = "app_password" | "llm_key" | "portal_user_id" | "portal_password";

export type SecretStatus = {
  app_password: boolean;
  llm_key: boolean;
  portal_user_id: boolean;
  portal_password: boolean;
};

const EMPTY: SecretStatus = {
  app_password: false,
  llm_key: false,
  portal_user_id: false,
  portal_password: false,
};

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

export const secrets = {
  /** Which slots are filled. Never the values themselves. */
  status: async (): Promise<SecretStatus> => (inTauri() ? call("secret_status") : EMPTY),
  set: async (slot: SecretSlot, value: string): Promise<void> =>
    call("secret_set", { slot, value }),
  remove: async (slot: SecretSlot): Promise<void> => call("secret_delete", { slot }),
};
