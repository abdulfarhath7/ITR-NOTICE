import * as React from "react";

import { clearCredentialsGate, pushLog } from "@/app/hub-store";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useHub } from "@/hooks/useHub";
import { ApiError, api } from "@/lib/api";

/** The portal login gate. Sending it also starts the sync, which is why the
 *  top bar's PDF limit has to travel with it. */
export function CredentialsDialog({
  open,
  onOpenChange,
  limit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  limit: number | null;
}): JSX.Element {
  const { credentialsError } = useHub();
  const [userId, setUserId] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const userField = React.useRef<HTMLInputElement>(null);

  // The password never survives a close; the user ID does, so a rejected
  // login only asks again for the half that was wrong.
  React.useEffect(() => {
    if (!open) return;
    setPassword("");
    setError(null);
    setBusy(false);
  }, [open]);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const id = userId.trim();
    if (!id || !password) {
      setError("Enter both the user ID and the password.");
      return;
    }
    setError(null);
    setBusy(true);

    // The request holds the only copy from here on: the field is emptied
    // before the answer comes back, so it never lingers in the DOM.
    const sent = api.storeCredentials(id, password, limit);
    setPassword("");
    try {
      await sent;
    } catch (err) {
      setBusy(false);
      setError(err instanceof ApiError ? err.message : "Could not store the login.");
      return;
    }
    setBusy(false);
    clearCredentialsGate();
    pushLog("Login sent (memory only). Sync started");
    onOpenChange(false);
  }

  const message = error ?? credentialsError;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md p-5"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          userField.current?.focus();
        }}
      >
        <DialogTitle className="text-base font-medium text-text">Portal login</DialogTitle>
        <DialogDescription className="mt-1.5 text-xs text-muted">
          Kept in this app&rsquo;s memory only &mdash; never written to disk. Restarting asks again.
        </DialogDescription>

        <form className="mt-4 flex flex-col gap-3" onSubmit={submit}>
          {message ? (
            <p
              role="alert"
              className="rounded-md border border-danger/40 bg-danger-soft px-2.5 py-2 text-xs text-danger-text"
            >
              {message}
            </p>
          ) : null}

          <Field label="User ID">
            <Input
              ref={userField}
              name="username"
              autoComplete="username"
              spellCheck={false}
              placeholder="PAN / AADHAAR / OTHER USER ID"
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
              disabled={busy}
            />
          </Field>

          <Field label="Portal password">
            <Input
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={busy}
            />
          </Field>

          <div className="mt-1 flex items-center justify-between gap-3">
            <span className="text-2xs text-faint">
              {limit === null
                ? "Sync starts as soon as this is sent."
                : `Sync starts at once, at most ${limit} new PDF${limit === 1 ? "" : "s"}.`}
            </span>
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? <Spinner /> : null}
              Save &amp; sync
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
