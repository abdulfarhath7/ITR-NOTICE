import { useState } from "react";

import { clearOtpGate } from "@/app/hub-store";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { useHub } from "@/hooks/useHub";
import { api } from "@/lib/api";

export function OtpDialog(): JSX.Element {
  const { otpRequired } = useHub();
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);

  async function send(): Promise<void> {
    const value = code.trim();
    if (!/^\d{4,8}$/.test(value)) {
      toast("Enter the numeric OTP first.");
      return;
    }
    setSending(true);
    try {
      await api.submitOtp(value);
      clearOtpGate();
      setCode("");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not send the OTP.", "error");
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={otpRequired}>
      <DialogContent
        hideClose
        className="max-w-sm"
        // The run is frozen behind this box: it closes when the code lands on
        // the portal, never because a click or a keystroke went astray.
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => event.preventDefault()}
      >
        <form
          className="flex flex-col gap-3 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <div className="flex flex-col gap-1">
            <DialogTitle className="text-sm font-semibold">Portal is asking for an OTP</DialogTitle>
            <DialogDescription className="text-xs text-muted">
              The sync waits here until the code reaches the portal.
            </DialogDescription>
          </div>
          <div className="flex items-center gap-2">
            <Input
              autoFocus
              value={code}
              onChange={(event) => setCode(event.target.value)}
              inputMode="numeric"
              maxLength={6}
              placeholder="6 digits"
              autoComplete="one-time-code"
              aria-label="One time password"
              className="w-32 tracking-widest"
            />
            <Button type="submit" variant="primary" disabled={sending}>
              Send to portal
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
