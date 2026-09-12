/** Labelled form control. */
export default function Field({ label, hint, error, wide = false, children }: {
  label: string; hint?: string; error?: string | null; wide?: boolean; children: React.ReactNode;
}) {
  return (
    <div className={`field${wide ? " wide" : ""}`}>
      <label>{label}</label>
      {children}
      {error ? <span className="error">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}
