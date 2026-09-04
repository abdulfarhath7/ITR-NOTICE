import { Search } from "lucide-react";
import * as React from "react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type PaletteAction = { label: string; hint?: string; haystack?: string; run: () => void };

export type CommandPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: PaletteAction[];
};

const LIMIT = 40;

// Subsequence match, the way every command palette does it: "rs" finds "Run sync".
function fuzzy(needle: string, hay: string): boolean {
  if (!needle) return true;
  const h = hay.toLowerCase();
  let i = 0;
  for (const ch of needle.toLowerCase()) {
    i = h.indexOf(ch, i);
    if (i < 0) return false;
    i += 1;
  }
  return true;
}

export function CommandPalette({ open, onOpenChange, actions }: CommandPaletteProps): JSX.Element {
  const uid = React.useId();
  const listRef = React.useRef<HTMLUListElement>(null);
  const [query, setQuery] = React.useState("");
  const [sel, setSel] = React.useState(0);

  const items = React.useMemo(() => {
    const q = query.trim();
    return actions.filter((a) => fuzzy(q, a.haystack ?? a.label)).slice(0, LIMIT);
  }, [actions, query]);

  // Clamped on read rather than corrected in state: the list can shrink under
  // the cursor on every keystroke.
  const at = Math.max(0, Math.min(sel, items.length - 1));

  // Layout effect, not a passive one: the reset has to commit before the newly
  // opened dialog paints, or the first frame shows the previous query.
  React.useLayoutEffect(() => {
    if (!open) return;
    setQuery("");
    setSel(0);
  }, [open]);

  // Keyed on the cursor alone. Depending on the list would re-scroll on every
  // unrelated shell render and yank the view away from where the mouse left it.
  React.useEffect(() => {
    listRef.current?.children.item(at)?.scrollIntoView({ block: "nearest" });
  }, [at]);

  function choose(action: PaletteAction | undefined): void {
    onOpenChange(false);
    action?.run();
  }

  function onKeyDown(ev: React.KeyboardEvent<HTMLInputElement>): void {
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      if (!items.length) return;
      setSel(Math.min(at + 1, items.length - 1));
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      setSel(Math.max(at - 1, 0));
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      choose(items[at]);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideClose
        aria-describedby={undefined}
        className="top-24 max-w-xl translate-y-0 overflow-hidden p-0"
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>

        <div className="flex items-center gap-2.5 border-b border-hairline px-3.5">
          <Search className="size-4 shrink-0 text-faint" aria-hidden="true" />
          <Input
            autoFocus
            value={query}
            onChange={(ev) => setQuery(ev.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Type a command or a notice…"
            aria-label="Command palette"
            role="combobox"
            aria-expanded
            aria-autocomplete="list"
            aria-controls={`${uid}-list`}
            aria-activedescendant={items.length ? `${uid}-opt-${at}` : undefined}
            className="h-11 rounded-none border-0 bg-transparent px-0 text-base focus-visible:ring-0"
          />
        </div>

        <ul
          ref={listRef}
          id={`${uid}-list`}
          role="listbox"
          aria-label="Commands"
          className="max-h-96 overflow-y-auto p-1.5"
        >
          {items.length ? (
            items.map((a, i) => (
              <li
                key={`${i}-${a.label}`}
                id={`${uid}-opt-${i}`}
                role="option"
                aria-selected={i === at}
                onClick={() => choose(a)}
                className={cn(
                  "flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm",
                  i === at ? "bg-action-soft text-text" : "hover:bg-raised",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{a.label}</span>
                {a.hint ? (
                  <span className="ml-auto shrink-0 whitespace-nowrap text-2xs text-faint">
                    {a.hint}
                  </span>
                ) : null}
              </li>
            ))
          ) : (
            <li role="presentation" className="px-2.5 py-2 text-sm text-muted">
              Nothing matches.
            </li>
          )}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
