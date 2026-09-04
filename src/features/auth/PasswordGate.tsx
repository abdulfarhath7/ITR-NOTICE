import * as React from "react";

import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ApiError, api } from "@/lib/api";

/** The shared token normally unlocks the sidecar on its own; this screen only
 *  appears when the backend was started with APP_PASSWORD and answered 401
 *  (app/main.py::require_password). Until it passes there is nothing else to
 *  show, so it owns the whole window rather than sitting in a dialog. */
export function PasswordGate({ onUnlocked }: { onUnlocked: () => void }): JSX.Element {
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const input = React.useRef<HTMLInputElement>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api.login(password);
      onUnlocked();
    } catch (cause) {
      // A 401 is the only answer worth naming; anything else is the sidecar.
      setError(cause instanceof ApiError ? "Wrong password." : "The app is not answering.");
      setPassword("");
      setBusy(false);
    }
  }

  // The field is disabled in flight, so a focus() inside submit() would land on
  // a still-disabled input: React has not flushed setBusy(false) yet. Wait for
  // the render that re-enables it. busy is in the deps so a second wrong
  // password re-focuses even though the message text never changed.
  React.useEffect(() => {
    if (!busy && error) input.current?.focus();
  }, [busy, error]);

  return (
    <div className="grid h-full place-items-center bg-bg p-6">
      <Card className="w-full max-w-sm shadow-panel">
        <CardBody className="p-6">
          <form className="flex flex-col gap-3" onSubmit={submit}>
            <div className="flex flex-col gap-1">
              <h1 className="text-base font-semibold tracking-tight">Notice Desk</h1>
              <p className="text-xs text-muted">Enter the app password.</p>
            </div>

            <Input
              ref={input}
              type="password"
              autoFocus
              autoComplete="current-password"
              aria-label="App password"
              value={password}
              disabled={busy}
              onChange={(event) => {
                setPassword(event.target.value);
                setError("");
              }}
            />

            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? <Spinner /> : null}
              Sign in
            </Button>

            <p className="min-h-5 text-xs text-danger-text" role="alert">
              {error}
            </p>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
