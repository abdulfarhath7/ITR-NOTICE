import { Lock, LockOpen } from "lucide-react";

import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { useHub } from "@/hooks/useHub";
import { cn } from "@/lib/utils";
import type { LoginPhase } from "@/lib/ws";

/* No frame is sent while credentials or an OTP are on screen, and that rule is
   not being relaxed. The panel shows the phase instead of sitting dark. */
const LOGIN_PHASES: readonly { key: LoginPhase; text: string }[] = [
  { key: "opening", text: "Opening portal…" },
  { key: "credentials", text: "Entering credentials…" },
  { key: "force_login", text: "Another session found — taking over…" },
  { key: "otp", text: "Waiting for you — enter the OTP" },
  { key: "done", text: "Logged in ✓" },
];

function LoginStage({ phase }: { phase: LoginPhase }): JSX.Element {
  // The OTP bar only exists once the portal has actually asked for one.
  const steps = LOGIN_PHASES.filter((step) => step.key !== "otp" || phase === "otp");
  const here = steps.findIndex((step) => step.key === phase);
  const sentence =
    phase === "failed"
      ? "Login failed — see log"
      : (LOGIN_PHASES.find((step) => step.key === phase)?.text ?? "Signing in…");

  const tone =
    phase === "failed"
      ? "text-danger-text"
      : phase === "done"
        ? "text-ok-text"
        : phase === "otp"
          ? "text-warn-text"
          : "text-muted";

  return (
    <div className="grid size-full place-items-center">
      <div className="flex flex-col items-center gap-3">
        {phase === "done" ? (
          <LockOpen className={cn("size-8", tone)} strokeWidth={1.5} aria-hidden="true" />
        ) : (
          <Lock className={cn("size-8", tone)} strokeWidth={1.5} aria-hidden="true" />
        )}
        <p className={cn("text-xs", tone)}>{sentence}</p>
        {/* steps, not an endless spinner: one bar per phase, filled to here */}
        <div className="flex items-center gap-1" aria-hidden="true">
          {steps.map((step, index) => (
            <span
              key={step.key}
              className={cn("h-1 w-6 rounded-full", index <= here ? "bg-action" : "bg-divider")}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function Viewport(): JSX.Element {
  const { frame, loginPhase, otpRequired, caption, state } = useHub();

  // The REC light means frames are arriving. A frozen picture behind an OTP
  // gate is not live, and the login never is.
  const live = frame !== null && !otpRequired && loginPhase === null;

  const hint = otpRequired
    ? "paused — OTP on screen"
    : loginPhase === "failed"
      ? "login failed"
      : loginPhase !== null
        ? "signing in"
        : frame !== null
          ? "live"
          : state === "running"
            ? "waiting for the first frame…"
            : "idle";

  return (
    <Card>
      <CardHeader className="justify-between">
        <CardTitle>Live viewport</CardTitle>
        <span className="text-2xs text-muted">{hint}</span>
      </CardHeader>
      <CardBody className="p-3">
        <div className="relative aspect-video w-full overflow-hidden rounded-md border border-hairline bg-bg">
          {frame !== null ? (
            <img
              src={`data:image/jpeg;base64,${frame}`}
              alt="What the bot is looking at right now"
              className="size-full animate-fade-in object-contain"
            />
          ) : loginPhase !== null ? (
            <LoginStage phase={loginPhase} />
          ) : (
            <div className="grid size-full place-items-center text-xs text-muted">
              No frames yet.
            </div>
          )}

          {live ? (
            <span className="absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-full bg-overlay/70 px-2 py-0.5 text-2xs font-medium text-danger-text">
              <span
                className="size-1.5 animate-pulse-rec rounded-full bg-danger"
                aria-hidden="true"
              />
              REC
            </span>
          ) : null}
        </div>
        <p className="mt-2 min-h-4 truncate text-2xs text-muted">{caption}</p>
      </CardBody>
    </Card>
  );
}
