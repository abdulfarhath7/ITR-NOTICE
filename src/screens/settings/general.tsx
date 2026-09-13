/** Settings › General: appearance and the keyboard. */
import type { useTheme } from "../../lib/theme";
import Icon from "../../ui/icons";
import { Row, Section, Segmented } from "./ui";

const IS_MAC = navigator.platform.toUpperCase().includes("MAC");
const MOD = IS_MAC ? "⌘" : "Ctrl";

const SHORTCUTS: { keys: string[]; does: string }[] = [
  { keys: [`${MOD} K`], does: "Search: go to a screen, find a client, run an action" },
  { keys: ["↑", "↓"], does: "Move through the Attention list" },
  { keys: ["Enter"], does: "Open the highlighted item" },
  { keys: ["Esc"], does: "Close a dialog or the search" },
];

export default function General({ theme }: { theme: ReturnType<typeof useTheme> }) {
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
