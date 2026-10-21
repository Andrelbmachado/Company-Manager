export type Theme = "light" | "dark" | "system";

const THEME_KEY = "cm_theme";

export function getTheme(): Theme {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(theme: Theme = getTheme()): void {
  const dark =
    theme === "dark" || (theme === "system" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", !!dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // ignore: preference just won't persist
  }
  applyTheme(theme);
}
