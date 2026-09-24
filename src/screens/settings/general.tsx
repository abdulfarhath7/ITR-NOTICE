/** Settings › General: appearance and the keyboard. */
import { useTextSize } from "../../hooks/use-text-size";
import type { useTheme } from "../../lib/theme";
import Icon from "../../ui/icons";
import TextSizeStepper from "../../ui/stepper";
import { Row, Section, Segmented } from "./ui";

const IS_MAC = navigator.platform.toUpperCase().includes("MAC");
const MOD = IS_MAC ? "⌘" : "Ctrl";

const SHORTCUTS: { keys: string[]; does: string }[] = [
  { keys: [`${MOD} K`], does: "Search: go to a screen, find a client, run an action" },
  { keys: ["↑", "↓"], does: "Move through the Attention list" },
  { keys: ["Enter"], does: "Open the highlighted item" },
  { keys: ["Esc"], does: "Close a dialog or the search" },
  { keys: [`${MOD} +`, `${MOD} −`, `${MOD} 0`], does: "Larger text, smaller text, reset text size" },
];

export default function General({ theme }: { theme: ReturnType<typeof useTheme> }) {
  const [scale, setScale] = useTextSize();
  return (
    <>
      <Section title="Appearance" description="Dark is the default. System follows the operating system and switches with it.">
        <Row label="Theme">
          <Segmented label="Theme" value={theme.preference} onChange={theme.setPreference} options={[
            { value: "dark", label: "Dark", icon: <Icon name="moon" /> },
            { value: "light", label: "Light", icon: <Icon name="sun" /> },
            { value: "system", label: "System", icon: <Icon name="monitor" /> },
          ]} />
        </Row>
        <Row label="Text size" hint={`Scales the whole app. ${MOD} + / ${MOD} − / ${MOD} 0 to reset.`} stacked>
          <div className="stack">
            <TextSizeStepper value={scale} onChange={setScale} />
            <p className="text-preview" aria-hidden="true">AABCV••••K · Notice u/s 143(1) · Due 30 Sep · Reply pending</p>
          </div>
        </Row>
      </Section>
      <Section title="Keyboard">
        {SHORTCUTS.map((s) => (
          <Row key={s.does} label={s.does}>
            <span className="keys">{s.keys.map((k) => <kbd key={k}>{k}</kbd>)}</span>
          </Row>
        ))}
      </Section>
    </>
  );
}
