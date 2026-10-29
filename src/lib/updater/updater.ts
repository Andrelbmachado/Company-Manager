// Estado da atualização automática (GitHub Releases). O trabalho pesado fica nos comandos Tauri de
// src-tauri/src/updater.rs: `update_check` consulta o canal e `update_install` baixa, confere a assinatura e troca o
// app. Aqui: a máquina de estados que a interface mostra (components/shared/updater), a verificação silenciosa na
// abertura e a cada 24 h, e o clique em "Atualizar" (só ele baixa e instala).
import { invoke, Channel } from "@tauri-apps/api/core";
import { isNewerVersion } from "./semver";

export interface UpdateCheckResult {
  currentVersion: string;
  availableVersion: string | null;
  notes: string | null;
  date: string | null;
}

export type InstallEvent =
  | { event: "started"; data: { contentLength: number | null } }
  | { event: "progress"; data: { chunkLength: number } }
  | { event: "installing" };

export interface UpdaterBackend {
  check(): Promise<UpdateCheckResult>;
  install(onEvent: (event: InstallEvent) => void): Promise<void>;
  restart(): Promise<void>;
}

export type UpdateState =
  | { status: "idle"; currentVersion: string | null }
  | { status: "checking"; currentVersion: string | null }
  | { status: "upToDate"; currentVersion: string; checkedAt: number }
  | { status: "available"; currentVersion: string; availableVersion: string; notes: string | null }
  | { status: "downloading"; currentVersion: string; availableVersion: string; downloaded: number; total: number | null }
  | { status: "installing"; currentVersion: string; availableVersion: string }
  | { status: "done"; currentVersion: string; availableVersion: string }
  | { status: "error"; phase: "check" | "install"; message: string; currentVersion: string | null; availableVersion: string | null };

export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** De quanto em quanto tempo o app confere se já passaram 24 h (cobre o Mac que dormiu no meio do intervalo). */
export const CHECK_TICK_MS = 60 * 60 * 1000;
/** Tempo mostrando "Concluído" antes de reiniciar. */
export const RESTART_DELAY_MS = 1500;
export const LAST_CHECK_KEY = "cm.updater.lastCheckAt";

export interface UpdaterOptions {
  now?: () => number;
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
  restartDelayMs?: number;
}

function errorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error ?? "");
  if (/signature|minisign|verify/i.test(text)) return "O pacote baixado não passou na verificação de integridade e não foi instalado.";
  if (/404|not found/i.test(text)) return "O pacote da atualização não foi encontrado no servidor. Tente de novo mais tarde.";
  if (/network|connect|dns|timed out|timeout|request|status code|offline/i.test(text)) {
    return "Não foi possível falar com o servidor de atualizações. Verifique a conexão.";
  }
  return text || "Erro desconhecido.";
}

export function progressPercent(state: UpdateState): number | null {
  if (state.status !== "downloading" || !state.total) return null;
  return Math.min(100, Math.floor((state.downloaded / state.total) * 100));
}

export function createUpdater(backend: UpdaterBackend, options: UpdaterOptions = {}) {
  const now = options.now ?? Date.now;
  const storage = options.storage === undefined ? safeLocalStorage() : options.storage;
  const restartDelayMs = options.restartDelayMs ?? RESTART_DELAY_MS;
  let state: UpdateState = { status: "idle", currentVersion: null };
  const listeners = new Set<() => void>();

  function set(next: UpdateState) {
    state = next;
    listeners.forEach((listener) => listener());
  }

  function lastCheckAt(): number | null {
    try {
      const value = Number(storage?.getItem(LAST_CHECK_KEY));
      return Number.isFinite(value) && value > 0 ? value : null;
    } catch {
      return null;
    }
  }

  const busy = () => ["checking", "downloading", "installing", "done"].includes(state.status);

  async function check(): Promise<UpdateState> {
    if (busy()) return state;
    const previous = state;
    set({ status: "checking", currentVersion: previous.currentVersion });
    try {
      const result = await backend.check();
      try {
        storage?.setItem(LAST_CHECK_KEY, String(now()));
      } catch {
        // Sem localStorage: a próxima abertura verifica de novo, o que é seguro.
      }
      const available = result.availableVersion;
      if (available && isNewerVersion(available, result.currentVersion)) {
        set({ status: "available", currentVersion: result.currentVersion, availableVersion: available, notes: result.notes });
      } else {
        set({ status: "upToDate", currentVersion: result.currentVersion, checkedAt: now() });
      }
    } catch (error) {
      set({ status: "error", phase: "check", message: errorMessage(error), currentVersion: previous.currentVersion, availableVersion: null });
    }
    return state;
  }

  /** Verifica só se passaram 24 h desde a última consulta bem-sucedida (ou se nunca houve uma). */
  async function checkIfDue(): Promise<UpdateState> {
    const last = lastCheckAt();
    if (last !== null && now() - last < CHECK_INTERVAL_MS) return state;
    return check();
  }

  async function install(): Promise<UpdateState> {
    if (state.status !== "available") return state;
    const { currentVersion, availableVersion } = state;
    set({ status: "downloading", currentVersion, availableVersion, downloaded: 0, total: null });
    try {
      await backend.install((event) => {
        if (event.event === "started") {
          set({ status: "downloading", currentVersion, availableVersion, downloaded: 0, total: event.data.contentLength });
        } else if (event.event === "progress" && state.status === "downloading") {
          set({ ...state, downloaded: state.downloaded + event.data.chunkLength });
        } else if (event.event === "installing") {
          set({ status: "installing", currentVersion, availableVersion });
        }
      });
    } catch (error) {
      set({ status: "error", phase: "install", message: errorMessage(error), currentVersion, availableVersion });
      return state;
    }
    set({ status: "done", currentVersion, availableVersion });
    await new Promise((resolve) => setTimeout(resolve, restartDelayMs));
    await backend.restart();
    return state;
  }

  /** "Tentar novamente": refaz a consulta (o pacote da tentativa anterior foi descartado). */
  function retry(): Promise<UpdateState> {
    return check();
  }

  /** Verificação na abertura e depois a cada hora confere se já deu 24 h. Devolve a função que para o relógio. */
  function start(tickMs = CHECK_TICK_MS): () => void {
    void check();
    const timer = setInterval(() => void checkIfDue(), tickMs);
    return () => clearInterval(timer);
  }

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    check,
    checkIfDue,
    install,
    retry,
    start,
  };
}

export type AppUpdater = ReturnType<typeof createUpdater>;

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export const tauriUpdaterBackend: UpdaterBackend = {
  check: () => invoke<UpdateCheckResult>("update_check"),
  install: (onEvent) => {
    const channel = new Channel<InstallEvent>();
    channel.onmessage = onEvent;
    return invoke<void>("update_install", { onEvent: channel });
  },
  restart: () => invoke<void>("restart_app"),
};

let shared: AppUpdater | null = null;

/** O atualizador do app (um só por janela). */
export function appUpdater(): AppUpdater {
  shared ??= createUpdater(tauriUpdaterBackend);
  return shared;
}

/** Teste de ponta a ponta (scripts/updater-e2e.sh): o Rust diz se `CM_UPDATE_AUTOTEST` está ligado. */
export async function autotestEnabled(): Promise<boolean> {
  try {
    return await invoke<boolean>("update_autotest_enabled");
  } catch {
    return false;
  }
}

export function autotestLog(line: string): void {
  invoke("update_autotest_log", { line }).catch(() => undefined);
}
