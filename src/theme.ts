export type Theme = "dark" | "light";

const KEY = "gateahead-theme";
const LEGACY_KEY = "smartrail-theme";

export const MAP_STYLE: Record<Theme, string> = {
  dark: "https://tiles.openfreemap.org/styles/dark",
  light: "https://tiles.openfreemap.org/styles/positron",
};

export function readTheme(): Theme {
  let theme: Theme = "dark";
  try {
    const saved = localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY_KEY);
    if (saved === "light") theme = "light";
  } catch {
    theme = "dark";
  }
  document.documentElement.dataset.theme = theme;
  return theme;
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // Storage can be blocked. The toggle still applies for this visit.
  }
}
