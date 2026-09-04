/** What the machine is allowed to remember.
 *
 *  The default is to remember nothing: the portal login is typed in each run
 *  and lives in the sidecar's memory only, which is the property the backend
 *  was built around. Anything stored here goes to the OS keychain (Windows
 *  Credential Manager) and is handed to the sidecar at spawn - so a change
 *  takes effect the next time the app starts.
 */
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { inTauri } from "@/lib/runtime";
import { secrets, type SecretSlot, type SecretStatus } from "@/lib/secrets";

type Row = { slot: SecretSlot; label: string; hint: string; placeholder: string };

const ROWS: Row[] = [
  {
    slot: "llm_key",
    label: "Anthropic API key",
    hint: "Used for due dates and draft replies. Without it those two buttons answer 503.",
    placeholder: "sk-ant-…",
  },
  {
    slot: "app_password",
    label: "Backend password",
    hint: "Only needed if this machine also serves the web dashboard. Leave empty otherwise.",
    placeholder: "APP_PASSWORD",
  },
  {
    slot: "portal_user_id",
    label: "Portal user ID",
    hint: "Optional convenience. The portal password is never stored by default.",
    placeholder: "PAN / AADHAAR / OTHER USER ID",
  },
];

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [status, setStatus] = useState<SecretStatus | null>(null);
  const [values, setValues] = useState<Partial<Record<SecretSlot, string>>>({});
  const [busy, setBusy] = useState<SecretSlot | null>(null);

  useEffect(() => {
    if (!open) return;
    void secrets.status().then(setStatus).catch(() => setStatus(null));
  }, [open]);

  async function store(slot: SecretSlot): Promise<void> {
    const value = (values[slot] ?? "").trim();
    if (!value) return;
    setBusy(slot);
    try {
      await secrets.set(slot, value);
      setValues((current) => ({ ...current, [slot]: "" }));
      setStatus(await secrets.status());
      toast("Saved to the keychain. It reaches the backend on the next start.");
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : "The keychain refused it.", "error");
    } finally {
      setBusy(null);
    }
  }

  async function forget(slot: SecretSlot): Promise<void> {
    setBusy(slot);
    try {
      await secrets.remove(slot);
      setStatus(await secrets.status());
      toast("Forgotten.");
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : "The keychain refused it.", "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(560px,94vw)] p-0">
        <div className="border-b border-hairline px-4 py-3">
          <DialogTitle className="text-sm font-semibold">Stored secrets</DialogTitle>
          <DialogDescription className="mt-1 text-xs text-muted">
            Kept in the OS keychain, never in a file this app writes. Nothing here is required —
            the app works with an empty list and asks each time.
          </DialogDescription>
        </div>

        <div className="flex flex-col gap-4 p-4">
          {!inTauri() ? (
            <p className="text-xs text-warn-text">
              The keychain is only available in the desktop app.
            </p>
          ) : null}

          {ROWS.map((row) => {
            const held = status?.[row.slot] ?? false;
            return (
              <div key={row.slot} className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium">{row.label}</span>
                  {held ? (
                    <span className="rounded-full bg-ok-soft px-2 py-0.5 text-2xs text-ok-text">
                      remembered
                    </span>
                  ) : (
                    <span className="rounded-full bg-raised px-2 py-0.5 text-2xs text-muted">
                      ask each time
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="password"
                    placeholder={row.placeholder}
                    autoComplete="off"
                    value={values[row.slot] ?? ""}
                    onChange={(event) =>
                      setValues((current) => ({ ...current, [row.slot]: event.target.value }))
                    }
                  />
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={busy === row.slot || !(values[row.slot] ?? "").trim()}
                    onClick={() => void store(row.slot)}
                  >
                    {busy === row.slot ? <Spinner /> : "Save"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!held || busy === row.slot}
                    onClick={() => void forget(row.slot)}
                  >
                    Forget
                  </Button>
                </div>
                <p className="text-2xs text-faint">{row.hint}</p>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between border-t border-hairline px-4 py-2.5">
          <span className="text-2xs text-faint">
            A change reaches the backend the next time the app starts.
          </span>
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
