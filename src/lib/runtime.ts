/** True when running inside the Tauri desktop shell (SQLite available). */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
