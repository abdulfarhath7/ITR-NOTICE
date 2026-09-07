/** The ⌘K command palette. Port of `#palette` in `app/static/index.html`. */
import { useEffect, useRef, useState } from "react";

export interface Command {
  label: string;
  hint?: string;
  haystack?: string;
  run: () => void;
}

/** Subsequence match, the way every command palette does it: "rs" finds
 *  "Run sync". */
function fuzzy(needle: string, hay: string): boolean {
  if (!needle) return true;
  const h = hay.toLowerCase();
  let i = 0;
  for (const ch of needle.toLowerCase()) {
    i = h.indexOf(ch, i);
    if (i < 0) return false;
    i++;
  }
  return true;
}

export default function Palette({ show, commands, onClose }: {
  show: boolean; commands: Command[]; onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!show) return;
    setQuery("");
    setAt(0);
    input.current?.focus();
  }, [show]);

  const items = commands.filter((c) => fuzzy(query.trim(), c.haystack || c.label)).slice(0, 40);
  const cursor = Math.min(at, Math.max(0, items.length - 1));
  const fire = (c: Command | undefined) => { onClose(); c?.run(); };

  return (
    <div className={"palette" + (show ? " show" : "")} role="dialog" aria-modal="true"
         aria-label="Command palette"
         onClick={(ev) => { if (ev.target === ev.currentTarget) onClose(); }}>
      <div className="box">
        <input ref={input} placeholder="Type a command or a notice…" aria-label="Command palette"
               value={query}
               onChange={(e) => { setQuery(e.target.value); setAt(0); }}
               onKeyDown={(ev) => {
                 if (ev.key === "ArrowDown") { setAt(Math.min(cursor + 1, items.length - 1)); ev.preventDefault(); }
                 if (ev.key === "ArrowUp") { setAt(Math.max(cursor - 1, 0)); ev.preventDefault(); }
                 if (ev.key === "Enter") fire(items[cursor]);
               }} />
        <ul role="listbox">
          {items.length
            ? items.map((c, i) => (
                <li key={c.label} role="option" aria-selected={i === cursor}
                    onClick={() => fire(c)}>
                  <span>{c.label}</span>
                  {c.hint ? <span className="hint">{c.hint}</span> : null}
                </li>
              ))
            : <li className="mut" aria-disabled="true">Nothing matches.</li>}
        </ul>
      </div>
    </div>
  );
}
