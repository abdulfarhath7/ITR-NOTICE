/** The shell: navigation on the left, one screen on the right (docs/09). */
import { useEffect, useState } from "react";
import { PRODUCT_NAME, PRODUCT_SHORT } from "./lib/product";
import { href, navigate, useRoute, type Route } from "./lib/router";
import AttentionScreen from "./screens/attention";
import ClientDetailScreen from "./screens/client-detail";
import ClientsScreen from "./screens/clients";
import DevicesScreen from "./screens/devices";
import IngestionScreen from "./screens/ingestion";
import SettingsScreen from "./screens/settings";
import SetupScreen from "./screens/setup";
import { api } from "./lib/api";
import { useQuery } from "./lib/query";
import type { SetupState } from "./lib/types";
import WorkItemScreen from "./screens/work-item";
import SyncButton, { RunIndicator } from "./ui/sync-button";
import Toasts from "./ui/toasts";

const THEME_KEY = "lcc.theme";

const NAV: { route: Route; label: string }[] = [
  { route: { name: "attention" }, label: "Attention" },
  { route: { name: "clients" }, label: "Clients" },
  { route: { name: "ingestion" }, label: "Ingestion" },
  { route: { name: "devices" }, label: "Devices" },
  { route: { name: "settings" }, label: "Settings" },
];

function current(route: Route, nav: Route): boolean {
  if (route.name === nav.name) return true;
  if (nav.name === "clients" && route.name === "client") return true;
  if (nav.name === "attention" && route.name === "item") return true;
  return false;
}

export default function App() {
  const route = useRoute();
  // The first launch lands on the wizard until it is finished or skipped.
  const setup = useQuery<SetupState>("setup:gate", () => api.setupState());
  useEffect(() => {
    if (setup.data && !setup.data.done && route.name !== "setup") navigate({ name: "setup" });
  }, [setup.data, route.name]);
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    try { return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark"; } catch { return "dark"; }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* a private window is fine */ }
  }, [theme]);

  // Removed by the admin (Q16): the book and keys are gone; say so plainly.
  if (setup.data?.removed) {
    return (
      <div className="shell">
        <nav className="nav" aria-label="Main"><div className="brand"><span className="mark">{PRODUCT_SHORT}</span>{PRODUCT_NAME}</div></nav>
        <div className="page"><div className="page-body" style={{ maxWidth: 560 }}>
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

  let screen: React.ReactNode;
  switch (route.name) {
    case "attention": screen = <AttentionScreen />; break;
    case "clients": screen = <ClientsScreen />; break;
    case "client": screen = <ClientDetailScreen key={route.id} id={route.id} />; break;
    case "item": screen = <WorkItemScreen key={route.id} module={route.module} id={route.id} />; break;
    case "ingestion": screen = <IngestionScreen />; break;
    case "devices": screen = <DevicesScreen />; break;
    case "settings": screen = <SettingsScreen theme={theme} onTheme={setTheme} />; break;
    case "setup": screen = <SetupScreen />; break;
  }

  return (
    <div className="shell">
      <nav className="nav" aria-label="Main">
        <div className="brand"><span className="mark">{PRODUCT_SHORT}</span>{PRODUCT_NAME}</div>
        {NAV.map((n) => (
          <a key={n.label} href={href(n.route)} aria-current={current(route, n.route) ? "page" : undefined}>{n.label}</a>
        ))}
        <span className="spacer" />
        <div className="footer"><RunIndicator /></div>
        <div className="footer"><SyncButton /></div>
        <div className="footer">Read-only against the portal.</div>
      </nav>
      {screen}
      <Toasts />
    </div>
  );
}
