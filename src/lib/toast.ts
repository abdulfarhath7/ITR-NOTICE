/** Toasts: success auto-dismisses, errors stay until dismissed (docs/10). */
import { useEffect, useState } from "react";

export interface ToastItem { id: number; text: string; kind: "info" | "error" }

type Listener = (items: ToastItem[]) => void;
let items: ToastItem[] = [];
let seq = 0;
const listeners = new Set<Listener>();

function emit() { listeners.forEach((l) => l(items)); }

export function toast(text: string, kind: "info" | "error" = "info"): void {
  const id = ++seq;
  items = [...items, { id, text, kind }];
  emit();
  if (kind === "info") setTimeout(() => dismiss(id), 3600);
}

export function toastError(text: string): void { toast(text, "error"); }

export function dismiss(id: number): void {
  items = items.filter((t) => t.id !== id);
  emit();
}

export function useToasts(): ToastItem[] {
  const [state, setState] = useState(items);
  useEffect(() => { listeners.add(setState); return () => { listeners.delete(setState); }; }, []);
  return state;
}
