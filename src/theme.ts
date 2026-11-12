export type Theme = "dark" | "light";

const KEY = "smartrail-theme";

export const MAP_STYLE: Record<Theme, string> = {
  dark: "https://tiles.openfreemap.org/styles/dark",
  light: "https://tiles.openfreemap.org/styles/positron",
};

export function readTheme(): Theme {
  let theme: Theme = "dark";
  try {
    if (localStorage.getItem(KEY) === "light") theme = "light";
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
  } catch {
    // Storage can be blocked. The toggle still applies for this visit.
  }
}
