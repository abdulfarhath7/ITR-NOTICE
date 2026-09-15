/** Modal dialog and side drawer. Escape and the backdrop close; focus goes
 *  to the first control and back to the opener afterwards. */
import { useEffect, useRef } from "react";
import Icon from "./icons";

export function Dialog({ title, onClose, children, footer, wide = false, drawer = false }: {
  title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode;
  wide?: boolean; drawer?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = ref.current?.querySelector<HTMLElement>("input, select, textarea, button");
    first?.focus();
    return () => { opener?.focus(); };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const box = (
    <div ref={ref} className={drawer ? "drawer" : `dialog${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
      <div className="dialog-head">
        <h2>{title}</h2>
        <button className="btn small quiet icon" onClick={onClose} aria-label="Close" title="Close (Esc)"><Icon name="x" /></button>
      </div>
      <div className="dialog-body">{children}</div>
      {footer ? <div className="dialog-foot">{footer}</div> : null}
    </div>
  );
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      {box}
    </div>
  );
}

/** A yes/no confirmation. Destructive actions always confirm (docs/10). */
export function Confirm({ title, body, confirmLabel, danger = false, onConfirm, onClose }: {
  title: string; body: string; confirmLabel: string; danger?: boolean;
  onConfirm: () => void; onClose: () => void;
}) {
  return (
    <Dialog title={title} onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className={`btn ${danger ? "danger" : "accent"}`} onClick={onConfirm}>{confirmLabel}</button>
      </>
    }>
      <p>{body}</p>
    </Dialog>
  );
}
