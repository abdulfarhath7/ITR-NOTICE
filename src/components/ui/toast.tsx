import * as React from "react";

import { cn } from "@/lib/utils";

/** One line at the bottom of the window, the way the web dashboard did it.
 *  Errors from the API land here; nothing else interrupts the work. */
type Toast = { id: number; message: string; tone: "info" | "error" };

let nextId = 1;
let toasts: Toast[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function toast(message: string, tone: Toast["tone"] = "info"): void {
  const id = nextId++;
  toasts = [...toasts, { id, message, tone }];
  emit();
  setTimeout(() => {
    toasts = toasts.filter((entry) => entry.id !== id);
    emit();
  }, 3600);
}

export function Toaster() {
  const items = React.useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    () => toasts,
    () => toasts,
  );

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2"
    >
      {items.map((entry) => (
        <div
          key={entry.id}
          className={cn(
            "animate-fade-in rounded-md border px-3 py-2 text-sm shadow-panel",
            entry.tone === "error"
              ? "border-danger/40 bg-danger-soft text-danger-text"
              : "border-hairline bg-raised text-text",
          )}
        >
          {entry.message}
        </div>
      ))}
    </div>
  );
}
