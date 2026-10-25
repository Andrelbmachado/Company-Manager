// Baixa o texto de uma agenda por link. No app desktop vai pelo plugin HTTP do Tauri (o pedido sai do Rust, sem o
// bloqueio de CORS do webview: Google, iCloud e Outlook não liberam o link .ics para páginas web); no navegador
// (banco demo) usa o fetch comum, que só funciona com servidores que liberam CORS.

export type CalendarFetcher = (url: string, init?: RequestInit) => Promise<Response>;

/** Tempo máximo para o servidor da agenda responder. */
export const FETCH_TIMEOUT_MS = 20_000;

export const inTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const defaultCalendarFetcher: CalendarFetcher = async (url, init) => {
  if (inTauri()) {
    const http = await import("@tauri-apps/plugin-http");
    return http.fetch(url, { ...init, connectTimeout: FETCH_TIMEOUT_MS });
  }
  return fetch(url, init);
};
