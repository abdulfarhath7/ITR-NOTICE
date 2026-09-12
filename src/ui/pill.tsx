/** Status pill: text, never a bare dot (docs/10). */
import { STATUS_LABEL, parseStatus } from "../lib/status";

const TONE: Record<string, string> = {
  open: "normal", adjournment_sought: "warning", response_submitted: "success",
  closed: "", unknown: "warning",
};

export function StatusPill({ status }: { status: string | null | undefined }) {
  const st = parseStatus(status);
  return <span className={`pill ${TONE[st]}`}>{STATUS_LABEL[st]}</span>;
}

export function Pill({ tone = "", children }: { tone?: "" | "danger" | "warning" | "success" | "accent" | "normal"; children: React.ReactNode }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}
