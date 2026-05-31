export type Theme = "dark" | "light";

const THEME_KEY = "cm_theme";

export function getTheme(): Theme {
  return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
}

export function saveTheme(theme: Theme): void {
  localStorage.setItem(THEME_KEY, theme);
  applyTheme(theme);
}
