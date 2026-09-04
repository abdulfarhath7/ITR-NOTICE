import * as React from "react";

import { cn } from "@/lib/utils";

export function Field({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("flex flex-col gap-1 text-xs text-muted", className)}>
      <span>{label}</span>
      {children}
      {hint ? <span className="text-2xs text-faint">{hint}</span> : null}
    </label>
  );
}
