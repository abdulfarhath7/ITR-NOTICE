/** Screen 7 — Settings. One section per concern, listed down the left the
 *  way every desktop app does it; adding a section is one entry here and
 *  one file beside it. */
import { href, navigate } from "../../lib/router";
import type { useTheme } from "../../lib/theme";
import Icon, { type IconName } from "../../ui/icons";
import { Page, PageBody, PageHead } from "../../ui/page";
import About from "./about";
import Calendar from "./calendar";
import Data from "./data";
import Drafting from "./drafting";
import Firm from "./firm";
import General from "./general";
import Notifications from "./notifications";
import Sweeps from "./sweeps";

const SECTIONS = [
  { id: "general", label: "General", icon: "sliders", blurb: "Appearance and the keyboard" },
  { id: "sweeps", label: "Sweeps", icon: "download", blurb: "Cadence, schedule, workers" },
  { id: "calendar", label: "Calendar", icon: "calendar", blurb: "Portal dates, firm dates, .ics" },
  { id: "drafting", label: "Drafting", icon: "sparkles", blurb: "The AI proxy and its token" },
  { id: "notifications", label: "Notifications", icon: "bell", blurb: "Desktop and email alerts" },
  { id: "data", label: "Data", icon: "database", blurb: "Storage, backup, transfer" },
  { id: "firm", label: "Firm and sync", icon: "shield", blurb: "This device on the relay" },
  { id: "about", label: "About", icon: "info", blurb: "Version and guarantees" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

function isSection(v: string | undefined): v is SectionId {
  return SECTIONS.some((s) => s.id === v);
}

export default function SettingsScreen({ section, theme }: { section?: string; theme: ReturnType<typeof useTheme> }) {
  const current: SectionId = isSection(section) ? section : "general";
  const meta = SECTIONS.find((s) => s.id === current);

  let body: React.ReactNode;
  switch (current) {
    case "general": body = <General theme={theme} />; break;
    case "sweeps": body = <Sweeps />; break;
    case "calendar": body = <Calendar />; break;
    case "drafting": body = <Drafting />; break;
    case "notifications": body = <Notifications />; break;
    case "data": body = <Data />; break;
    case "firm": body = <Firm />; break;
    case "about": body = <About />; break;
  }

  return (
    <Page>
      <PageHead title="Settings" meta={meta?.label} />
      <PageBody>
        <div className="settings">
          <nav className="settings-nav" aria-label="Settings sections">
            {SECTIONS.map((s) => (
              <a key={s.id} href={href({ name: "settings", section: s.id })} aria-current={s.id === current ? "page" : undefined}
                 onKeyDown={(e) => { if (e.key === "Enter") navigate({ name: "settings", section: s.id }); }}>
                <Icon name={s.icon as IconName} />
                <span className="stack-0">
                  <span>{s.label}</span>
                  <span className="hint">{s.blurb}</span>
                </span>
              </a>
            ))}
          </nav>
          <div className="settings-body">{body}</div>
        </div>
      </PageBody>
    </Page>
  );
}
