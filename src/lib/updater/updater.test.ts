import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compareSemver, isNewerVersion } from "./semver";
import {
  CHECK_INTERVAL_MS,
  CHECK_TICK_MS,
  LAST_CHECK_KEY,
  createUpdater,
  progressPercent,
  type InstallEvent,
  type UpdateCheckResult,
  type UpdaterBackend,
} from "./updater";

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value), data };
}

function backend(overrides: Partial<UpdaterBackend> = {}, result: Partial<UpdateCheckResult> = {}): UpdaterBackend {
  return {
    check: vi.fn(async () => ({ currentVersion: "0.1.0", availableVersion: null, notes: null, date: null, ...result })),
    install: vi.fn(async (onEvent: (event: InstallEvent) => void) => {
      onEvent({ event: "started", data: { contentLength: 1000 } });
      onEvent({ event: "progress", data: { chunkLength: 400 } });
      onEvent({ event: "progress", data: { chunkLength: 600 } });
      onEvent({ event: "installing" });
    }),
    restart: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("semver", () => {
  it("ordena núcleo, pre-release e ignora metadados de build", () => {
    expect(compareSemver("0.1.1", "0.1.0")).toBe(1);
    expect(compareSemver("1.0.0", "0.99.99")).toBe(1);
    expect(compareSemver("0.10.0", "0.9.0")).toBe(1);
    expect(compareSemver("1.0.0-alpha", "1.0.0")).toBe(-1);
    expect(compareSemver("1.0.0-test.2", "1.0.0-test.10")).toBe(-1);
    expect(compareSemver("1.0.0-alpha.1", "1.0.0-alpha.beta")).toBe(-1);
    expect(compareSemver("1.0.0-alpha", "1.0.0-alpha.1")).toBe(-1);
    expect(compareSemver("v1.2.3+build.5", "1.2.3")).toBe(0);
  });

  it("versão inválida nunca conta como mais nova", () => {
    expect(isNewerVersion("latest", "0.1.0")).toBe(false);
    expect(isNewerVersion("0.1.1-test.1", "0.1.0")).toBe(true);
  });
});

describe("atualizador", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sem atualização: fica Atualizado e grava a hora da consulta", async () => {
    const storage = memoryStorage();
    const updater = createUpdater(backend(), { storage, now: () => 5000 });
    await updater.check();
    expect(updater.getState()).toMatchObject({ status: "upToDate", currentVersion: "0.1.0" });
    expect(storage.data.get(LAST_CHECK_KEY)).toBe("5000");
  });

  it("versão nova: habilita Atualizar e, só depois do clique, baixa com progresso, instala e reinicia", async () => {
    const api = backend({}, { availableVersion: "0.1.1-test.1" });
    const updater = createUpdater(api, { storage: null, restartDelayMs: 10 });
    const seen: string[] = [];
    updater.subscribe(() => seen.push(`${updater.getState().status}:${progressPercent(updater.getState()) ?? ""}`));
    await updater.check();
    expect(updater.getState()).toMatchObject({ status: "available", currentVersion: "0.1.0", availableVersion: "0.1.1-test.1" });
    expect(api.install).not.toHaveBeenCalled();

    const done = updater.install();
    await vi.advanceTimersByTimeAsync(10);
    await done;
    expect(seen).toEqual(["checking:", "available:", "downloading:", "downloading:0", "downloading:40", "downloading:100", "installing:", "done:"]);
    expect(api.restart).toHaveBeenCalledTimes(1);
  });

  it("de uma versão antiga para a mais nova publicada", async () => {
    const updater = createUpdater(backend({}, { currentVersion: "0.0.3", availableVersion: "0.2.0" }), { storage: null });
    await updater.check();
    expect(updater.getState()).toMatchObject({ status: "available", currentVersion: "0.0.3", availableVersion: "0.2.0" });
  });

  it("versão publicada igual ou menor não habilita o botão (impede instalar versão inferior)", async () => {
    for (const availableVersion of ["0.1.0", "0.0.9", "0.1.0-test.5"]) {
      const api = backend({}, { availableVersion });
      const updater = createUpdater(api, { storage: null });
      await updater.check();
      expect(updater.getState().status).toBe("upToDate");
      await updater.install();
      expect(api.install).not.toHaveBeenCalled();
    }
  });

  it("falha de conexão: estado de erro com mensagem e Tentar novamente refaz a consulta", async () => {
    const check = vi.fn()
      .mockRejectedValueOnce(new Error("error sending request for url (https://github.com/...): dns error"))
      .mockResolvedValueOnce({ currentVersion: "0.1.0", availableVersion: null, notes: null, date: null });
    const updater = createUpdater(backend({ check }), { storage: null });
    await updater.check();
    expect(updater.getState()).toMatchObject({ status: "error", phase: "check" });
    expect((updater.getState() as { message: string }).message).toMatch(/conexão/);
    await updater.retry();
    expect(updater.getState().status).toBe("upToDate");
  });

  it("download interrompido: erro, sem reiniciar, e dá para tentar de novo", async () => {
    const api = backend({
      install: vi.fn(async (onEvent: (event: InstallEvent) => void) => {
        onEvent({ event: "started", data: { contentLength: 1000 } });
        onEvent({ event: "progress", data: { chunkLength: 300 } });
        throw new Error("error decoding response body: connection closed before message completed");
      }),
    }, { availableVersion: "0.2.0" });
    const updater = createUpdater(api, { storage: null });
    await updater.check();
    await updater.install();
    expect(updater.getState()).toMatchObject({ status: "error", phase: "install", availableVersion: "0.2.0" });
    expect(api.restart).not.toHaveBeenCalled();
    await updater.retry();
    expect(updater.getState().status).toBe("available");
  });

  it("pacote corrompido (assinatura não confere): não instala nem reinicia", async () => {
    const api = backend({ install: vi.fn(async () => { throw new Error("signature verification failed: Invalid signature"); }) }, { availableVersion: "0.2.0" });
    const updater = createUpdater(api, { storage: null });
    await updater.check();
    await updater.install();
    expect(updater.getState()).toMatchObject({ status: "error", phase: "install" });
    expect((updater.getState() as { message: string }).message).toMatch(/integridade/);
    expect(api.restart).not.toHaveBeenCalled();
  });

  it("falha de instalação: mantém a versão atual (o plugin devolve o app antigo) e mostra o erro", async () => {
    const api = backend({
      install: vi.fn(async (onEvent: (event: InstallEvent) => void) => {
        onEvent({ event: "installing" });
        throw new Error("Permission denied (os error 13)");
      }),
    }, { availableVersion: "0.2.0" });
    const updater = createUpdater(api, { storage: null });
    await updater.check();
    await updater.install();
    expect(updater.getState()).toMatchObject({ status: "error", phase: "install", currentVersion: "0.1.0", message: "Permission denied (os error 13)" });
    expect(api.restart).not.toHaveBeenCalled();
  });

  it("verifica na abertura e de novo quando passam 24 h (mesmo com o app aberto o tempo todo)", async () => {
    let clock = 1_000_000;
    const api = backend();
    const updater = createUpdater(api, { storage: memoryStorage(), now: () => clock });
    const stop = updater.start(CHECK_TICK_MS);
    await vi.advanceTimersByTimeAsync(0);
    expect(api.check).toHaveBeenCalledTimes(1);

    for (let hour = 1; hour < 24; hour++) {
      clock += CHECK_TICK_MS;
      await vi.advanceTimersByTimeAsync(CHECK_TICK_MS);
    }
    expect(api.check).toHaveBeenCalledTimes(1);
    clock += CHECK_TICK_MS;
    await vi.advanceTimersByTimeAsync(CHECK_TICK_MS);
    expect(api.check).toHaveBeenCalledTimes(2);
    expect(clock - 1_000_000).toBe(CHECK_INTERVAL_MS);
    stop();
  });

  it("a hora da última consulta sobrevive ao reinício: abrir de novo antes de 24 h não repete a checagem diária", async () => {
    const storage = memoryStorage();
    storage.setItem(LAST_CHECK_KEY, String(10_000));
    const api = backend();
    const updater = createUpdater(api, { storage, now: () => 10_000 + CHECK_INTERVAL_MS - 1 });
    await updater.checkIfDue();
    expect(api.check).not.toHaveBeenCalled();
    const later = createUpdater(api, { storage, now: () => 10_000 + CHECK_INTERVAL_MS });
    await later.checkIfDue();
    expect(api.check).toHaveBeenCalledTimes(1);
  });
});
