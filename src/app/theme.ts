/** Dark by default, because the app is looked at all day. The choice is a
 *  preference, not a secret, so localStorage is the right place for it. */
export type Theme = "dark" | "light";

const KEY = "notice-desk-theme";

export function readTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // a locked-down webview is not a reason to fail; the class is already set
  }
}
