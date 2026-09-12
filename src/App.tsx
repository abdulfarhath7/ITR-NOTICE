/** The shell: navigation on the left, one screen on the right (docs/09). */
import { useEffect, useState } from "react";
import { PRODUCT_NAME } from "./lib/product";
import { href, useRoute, type Route } from "./lib/router";
import AttentionScreen from "./screens/attention";
import ClientDetailScreen from "./screens/client-detail";
import ClientsScreen from "./screens/clients";
import DevicesScreen from "./screens/devices";
import IngestionScreen from "./screens/ingestion";
import SettingsScreen from "./screens/settings";
import WorkItemScreen from "./screens/work-item";
import Toasts from "./ui/toasts";

const THEME_KEY = "draftax.theme";

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
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    try { return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark"; } catch { return "dark"; }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* a private window is fine */ }
  }, [theme]);

  let screen: React.ReactNode;
  switch (route.name) {
    case "attention": screen = <AttentionScreen />; break;
    case "clients": screen = <ClientsScreen />; break;
    case "client": screen = <ClientDetailScreen key={route.id} id={route.id} />; break;
    case "item": screen = <WorkItemScreen key={route.id} module={route.module} id={route.id} />; break;
    case "ingestion": screen = <IngestionScreen />; break;
    case "devices": screen = <DevicesScreen />; break;
    case "settings": screen = <SettingsScreen theme={theme} onTheme={setTheme} />; break;
    case "setup": screen = <SettingsScreen theme={theme} onTheme={setTheme} />; break;
  }

  return (
    <div className="shell">
      <nav className="nav" aria-label="Main">
        <div className="brand"><span className="mark">Dx</span>{PRODUCT_NAME}</div>
        {NAV.map((n) => (
          <a key={n.label} href={href(n.route)} aria-current={current(route, n.route) ? "page" : undefined}>{n.label}</a>
        ))}
        <span className="spacer" />
        <div className="footer">Read-only against the portal.</div>
      </nav>
      {screen}
      <Toasts />
    </div>
  );
}
