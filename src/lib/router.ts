/** A hash router with no dependencies. Routes are plain data so screens
 *  can link by constructing them, and the back button just works. */
import { useEffect, useState } from "react";

export type Route =
  | { name: "attention" }
  | { name: "clients" }
  | { name: "client"; id: string }
  | { name: "item"; module: string; id: string }
  | { name: "ingestion" }
  | { name: "devices" }
  | { name: "settings"; section?: string }
  | { name: "setup" };

export function href(route: Route): string {
  switch (route.name) {
    case "attention": return "#/attention";
    case "clients": return "#/clients";
    case "client": return `#/clients/${encodeURIComponent(route.id)}`;
    case "item": return `#/items/${route.module}/${encodeURIComponent(route.id)}`;
    case "ingestion": return "#/ingestion";
    case "devices": return "#/devices";
    case "settings": return route.section ? `#/settings/${route.section}` : "#/settings";
    case "setup": return "#/setup";
  }
}

export function parse(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  switch (parts[0]) {
    case "clients":
      return parts[1] ? { name: "client", id: parts[1] } : { name: "clients" };
    case "items":
      return parts[1] && parts[2] ? { name: "item", module: parts[1], id: parts[2] } : { name: "attention" };
    case "ingestion": return { name: "ingestion" };
    case "devices": return { name: "devices" };
    case "settings": return parts[1] ? { name: "settings", section: parts[1] } : { name: "settings" };
    case "setup": return { name: "setup" };
    default: return { name: "attention" };
  }
}

export function navigate(route: Route): void {
  window.location.hash = href(route);
}

/** The top-level screen a route belongs to, for the navigation highlight. */
export function section(route: Route): Route["name"] {
  if (route.name === "client") return "clients";
  if (route.name === "item") return "attention";
  return route.name;
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parse(window.location.hash));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}
