import { FileText } from "lucide-react";
import * as React from "react";

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <FileText className="size-10 text-faint" strokeWidth={1.3} aria-hidden="true" />
      <div className="text-sm font-medium text-text">{title}</div>
      <p className="max-w-sm text-xs text-muted">{description}</p>
      {action}
    </div>
  );
}
