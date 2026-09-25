/** The shell: navigation on the left, one screen on the right (docs/09). */
import { useEffect } from "react";
import { useTextSizeShortcuts } from "./hooks/use-text-size";
import { useAttentionCounts } from "./hooks/use-work-items";
import { api } from "./lib/api";
import { PRODUCT_NAME, PRODUCT_SHORT } from "./lib/product";
import { useQuery } from "./lib/query";
import { href, navigate, section, useRoute, type Route } from "./lib/router";
import { useTheme } from "./lib/theme";
import type { SetupState } from "./lib/types";
import { useUnreadUpdates } from "./hooks/use-updates";
import AttentionScreen from "./screens/attention";
import CalendarScreen from "./screens/calendar";
import ClientDetailScreen from "./screens/client-detail";
import ClientsScreen from "./screens/clients";
import DevicesScreen from "./screens/devices";
import IngestionScreen from "./screens/ingestion";
import SettingsScreen from "./screens/settings";
import SetupScreen from "./screens/setup";
import UpdatesScreen from "./screens/updates";
import WorkItemScreen from "./screens/work-item";
import CommandPalette, { useCommandPalette } from "./ui/command-palette";
import Icon, { type IconName } from "./ui/icons";
import SyncButton, { RunIndicator } from "./ui/sync-button";
import Toasts from "./ui/toasts";

const NAV: { route: Route; label: string; icon: IconName }[] = [
  { route: { name: "attention" }, label: "Attention", icon: "inbox" },
  { route: { name: "updates" }, label: "Updates", icon: "bell" },
  { route: { name: "calendar" }, label: "Calendar", icon: "calendar" },
  { route: { name: "clients" }, label: "Clients", icon: "users" },
  { route: { name: "ingestion" }, label: "Sweep", icon: "refresh" },
  { route: { name: "devices" }, label: "Devices", icon: "monitor" },
  { route: { name: "settings" }, label: "Settings", icon: "sliders" },
];

const IS_MAC = navigator.platform.toUpperCase().includes("MAC");

function AttentionBadge() {
  const { open, overdue } = useAttentionCounts();
  if (!open) return null;
  return overdue
    ? <span className="count danger" title={`${overdue} overdue of ${open} open`}>{overdue}</span>
    : <span className="count">{open}</span>;
}

function UpdatesBadge() {
  const n = useUnreadUpdates();
  return n ? <span className="count" title={`${n} new since you last marked them seen`}>{n}</span> : null;
}

function Brand() {
  return <div className="brand"><span className="mark">{PRODUCT_SHORT}</span><span className="name">{PRODUCT_NAME}</span></div>;
}

function RemovedScreen() {
  return (
    <div className="shell">
      <nav className="nav" aria-label="Main"><Brand /></nav>
      <div className="page"><div className="page-body narrow">
        <div className="card"><div className="card-body stack">
          <h2>This device was removed from the firm</h2>
          <p className="muted">The firm's admin removed it. The local book, its documents and the keys on this machine have been deleted. Nothing on the relay or on the firm's other devices was touched.</p>
          <p className="muted">To use it again, an admin has to invite it afresh (Devices → Invite a device on their machine), then this app can be reinstalled or its data folder emptied and the invite entered on first run.</p>
        </div></div>
      </div></div>
      <Toasts />
    </div>
  );
}

export default function App() {
  const route = useRoute();
  const theme = useTheme();
  const palette = useCommandPalette();
  useTextSizeShortcuts();
  // The first launch lands on the wizard until it is finished or skipped.
  const setup = useQuery<SetupState>("setup:gate", () => api.setupState());
  useEffect(() => {
    if (setup.data && !setup.data.done && route.name !== "setup") navigate({ name: "setup" });
  }, [setup.data, route.name]);

  // Removed by the admin (Q16): the book and keys are gone; say so plainly.
  if (setup.data?.removed) return <RemovedScreen />;

  let screen: React.ReactNode;
  switch (route.name) {
    case "attention": screen = <AttentionScreen />; break;
    case "clients": screen = <ClientsScreen filter={route.filter} />; break;
    case "client": screen = <ClientDetailScreen key={route.id} id={route.id} tab={route.tab} />; break;
    case "item": screen = <WorkItemScreen key={route.id} module={route.module} id={route.id} />; break;
    case "ingestion": screen = <IngestionScreen filter={route.filter} />; break;
    case "devices": screen = <DevicesScreen />; break;
    case "settings": screen = <SettingsScreen section={route.section} theme={theme} />; break;
    case "setup": screen = <SetupScreen />; break;
    case "updates": screen = <UpdatesScreen />; break;
    case "calendar": screen = <CalendarScreen />; break;
  }
  const active = section(route);

  return (
    <div className="shell">
      <nav className="nav" aria-label="Main">
        <Brand />
        <button className="nav-search" onClick={() => palette.setOpen(true)} aria-keyshortcuts={IS_MAC ? "Meta+K" : "Control+K"}>
          <Icon name="search" />
          <span>Search</span>
          <kbd>{IS_MAC ? "⌘" : "Ctrl"} K</kbd>
        </button>
        <div className="nav-list">
          {NAV.map((n) => (
            <a key={n.label} href={href(n.route)} aria-current={active === n.route.name ? "page" : undefined}>
              <Icon name={n.icon} />
              <span>{n.label}</span>
              {n.route.name === "attention" ? <AttentionBadge /> : n.route.name === "updates" ? <UpdatesBadge /> : null}
            </a>
          ))}
        </div>
        <span className="spacer" />
        <div className="nav-foot">
          <RunIndicator />
          <SyncButton />
          <div className="nav-note"><Icon name="shield" /><span>Read-only against the portal</span></div>
        </div>
      </nav>
      {screen}
      <Toasts />
      {palette.open ? <CommandPalette onClose={() => palette.setOpen(false)} /> : null}
    </div>
  );
}
