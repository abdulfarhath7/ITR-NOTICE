/** Keyboard navigation for a list of rows (docs/10): arrows move, Enter
 *  opens, Home and End jump. One row is in the tab order at a time. */
import { useCallback, useEffect, useRef, useState } from "react";

export interface RowNavProps {
  ref: (el: HTMLTableRowElement | null) => void;
  tabIndex: number;
  onFocus: () => void;
  "aria-selected": boolean;
}

export function useRowNav(count: number, onOpen: (index: number) => void) {
  const [active, setActive] = useState(0);
  const rows = useRef<(HTMLTableRowElement | null)[]>([]);
  useEffect(() => { if (active >= count) setActive(Math.max(0, count - 1)); }, [count, active]);

  const focusRow = useCallback((i: number) => { setActive(i); rows.current[i]?.focus(); }, []);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!count) return;
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); focusRow(Math.min(count - 1, active + 1)); break;
      case "ArrowUp": e.preventDefault(); focusRow(Math.max(0, active - 1)); break;
      case "Home": e.preventDefault(); focusRow(0); break;
      case "End": e.preventDefault(); focusRow(count - 1); break;
      case "Enter": e.preventDefault(); onOpen(active); break;
    }
  }, [count, active, focusRow, onOpen]);

  const rowProps = useCallback((i: number): RowNavProps => ({
    ref: (el: HTMLTableRowElement | null) => { rows.current[i] = el; },
    tabIndex: i === active ? 0 : -1,
    onFocus: () => setActive(i),
    "aria-selected": i === active,
  }), [active]);

  return { active, onKeyDown, rowProps };
}
