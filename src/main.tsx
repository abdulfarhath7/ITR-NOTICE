import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { api } from "./lib/api";
import { applyScale, cachedScale } from "./lib/scale";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/sync.css";
import "./styles/history.css";
import "./styles/badges.css";
import "./styles/calendar.css";

// Text size: the cached value before first paint, then the saved one.
applyScale(cachedScale());
api.settings().then((s) => applyScale(s.ui_scale)).catch(() => { /* outside Tauri: keep the cache */ });

const root = document.getElementById("root");
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
