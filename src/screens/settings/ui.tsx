/** The settings vocabulary: a titled section of rows, each row a label
 *  and hint on the left and its control on the right. Every section is
 *  the same shape so a new setting is one `Row`, never a new layout. */
import Icon from "../../ui/icons";

export interface SaveBarProps {
  dirty: boolean; busy?: boolean; onSave: () => void; onDiscard: () => void;
}

export function Section({ title, description, children, save, footer }: {
  title: string; description?: string; children: React.ReactNode;
  /** A save bar that appears under the rows only while something changed. */
  save?: SaveBarProps;
  footer?: React.ReactNode;
}) {
  return (
    <section className="settings-section">
      <header>
        <h2>{title}</h2>
        {description ? <p className="muted">{description}</p> : null}
      </header>
      <div className="settings-rows">{children}</div>
      {save?.dirty ? <footer><SaveBar {...save} /></footer> : footer ? <footer>{footer}</footer> : null}
    </section>
  );
}

export function Row({ label, hint, children, stacked = false }: {
  label: string; hint?: React.ReactNode; children: React.ReactNode;
  /** The control sits under the label instead of beside it (long inputs). */
  stacked?: boolean;
}) {
  return (
    <div className={`settings-row${stacked ? " stacked" : ""}`}>
      <div className="settings-label">
        <span>{label}</span>
        {hint ? <span className="hint">{hint}</span> : null}
      </div>
      <div className="settings-control">{children}</div>
    </div>
  );
}

/** A small set of exclusive choices, shown as one control. */
export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: string; icon?: React.ReactNode }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value}
                onClick={() => onChange(o.value)}>
          {o.icon}{o.label}
        </button>
      ))}
    </div>
  );
}

function SaveBar({ busy = false, onSave, onDiscard }: SaveBarProps) {
  return (
    <div className="save-bar" role="status">
      <Icon name="info" className="faint" />
      <span>Unsaved changes</span>
      <span className="grow" />
      <button className="btn small" onClick={onDiscard} disabled={busy}>Discard</button>
      <button className="btn small accent" onClick={onSave} disabled={busy}>Save</button>
    </div>
  );
}
