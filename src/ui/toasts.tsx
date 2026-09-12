import { dismiss, useToasts } from "../lib/toast";

export default function Toasts() {
  const items = useToasts();
  return (
    <div className="toasts" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind === "error" ? "error" : ""}`} role={t.kind === "error" ? "alert" : "status"}>
          <span>{t.text}</span>
          {t.kind === "error"
            ? <button className="btn small quiet" onClick={() => dismiss(t.id)}>Dismiss</button>
            : null}
        </div>
      ))}
    </div>
  );
}
