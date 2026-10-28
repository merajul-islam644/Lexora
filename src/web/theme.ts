/* Light/dark theme: the choice lives in localStorage and is applied as
   data-theme="dark" on <html>; styles.css keys its dark tokens off that. */
export type Theme = "light" | "dark";

const KEY = "lexora-theme";

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

/** Applies the stored choice (default: light) before first paint of the app. */
export function initTheme(): Theme {
  const theme: Theme = localStorage.getItem(KEY) === "dark" ? "dark" : "light";
  applyTheme(theme);
  return theme;
}

/* Pieces that display the theme (top-bar toggle, Settings page) stay in sync
   through this event: saveTheme() broadcasts every change. */
export const THEME_EVENT = "lexora:theme";

export function saveTheme(theme: Theme): void {
  localStorage.setItem(KEY, theme);
  applyTheme(theme);
  window.dispatchEvent(new CustomEvent<Theme>(THEME_EVENT, { detail: theme }));
}
