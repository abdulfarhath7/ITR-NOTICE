/** A− · five dots · A+ · percentage (docs/16 §3). Each dot is a step and
 *  can be clicked; the ends disable at the first and last step. */
import { SCALES, stepScale, type Scale } from "../lib/scale";

export default function TextSizeStepper({ value, onChange }: { value: Scale; onChange: (s: Scale) => void }) {
  const i = SCALES.indexOf(value);
  return (
    <div className="stepper" role="group" aria-label="Text size">
      <button type="button" className="btn small" onClick={() => onChange(stepScale(value, -1))} disabled={i <= 0}
              aria-label="Smaller text" title="Smaller (Ctrl −)">A−</button>
      <span className="stepper-dots" role="radiogroup" aria-label="Text size steps">
        {SCALES.map((s) => (
          <button key={s} type="button" role="radio" aria-checked={s === value} aria-label={`${s}%`} title={`${s}%`}
                  className="stepper-dot" onClick={() => onChange(s)} />
        ))}
      </span>
      <button type="button" className="btn small" onClick={() => onChange(stepScale(value, 1))} disabled={i >= SCALES.length - 1}
              aria-label="Larger text" title="Larger (Ctrl +)">A+</button>
      <span className="stepper-value num">{value}%</span>
    </div>
  );
}
