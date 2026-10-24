// Armazenamento do navegador (IndexedDB) com um IndexedDB mínimo simulado: grava, lê, mede, apaga, guarda uma cópia
// dos bytes e, quando um pedido falha, devolve um erro só (sem promessa rejeitada solta no console).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (() => void) | null;

/** IndexedDB de mentira: uma tabela em memória; `failNext` faz o próximo pedido falhar como no navegador. */
function fakeIndexedDb() {
  const data = new Map<string, unknown>();
  const state = { failNext: false };
  const database = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => undefined,
    transaction() {
      const transaction = { error: null as unknown, oncomplete: null as Handler, onerror: null as Handler, onabort: null as Handler, objectStore: () => store };
      const request = (run: () => unknown) => {
        const req = { result: undefined as unknown, error: null as unknown, onsuccess: null as Handler, onerror: null as Handler };
        queueMicrotask(() => {
          if (state.failNext) {
            state.failNext = false;
            req.error = transaction.error = new Error("falha simulada do IndexedDB");
            req.onerror?.();
            transaction.onerror?.(); // o erro do pedido sobe para a transação, que é abortada
            transaction.onabort?.();
            return;
          }
          req.result = run();
          req.onsuccess?.();
          queueMicrotask(() => transaction.oncomplete?.());
        });
        return req;
      };
      const store = {
        get: (key: string) => request(() => data.get(key)),
        put: (value: unknown, key: string) => request(() => data.set(key, value)),
        count: (key: string) => request(() => (data.has(key) ? 1 : 0)),
        delete: (key: string) => request(() => data.delete(key)),
      };
      return transaction;
    },
  };
  const factory = {
    open() {
      const req = { result: database, error: null, onsuccess: null as Handler, onerror: null as Handler, onupgradeneeded: null as Handler, onblocked: null as Handler };
      queueMicrotask(() => req.onsuccess?.());
      return req;
    },
  };
  return { factory, data, state };
}

const KEY = `empresa-1/ab/${"ab".repeat(32)}`;
const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => unhandled.push(reason);

beforeEach(() => {
  unhandled.length = 0;
  process.on("unhandledRejection", onUnhandled);
  vi.resetModules();
});

afterEach(() => {
  process.off("unhandledRejection", onUnhandled);
  vi.unstubAllGlobals();
});

async function backendWith(fake: ReturnType<typeof fakeIndexedDb>) {
  vi.stubGlobal("indexedDB", fake.factory);
  const { demoFileBackend } = await import("./demoStore");
  return demoFileBackend();
}

describe("demoFileBackend com IndexedDB", () => {
  it("grava uma cópia só dos bytes da view, lê, mede, confere e apaga", async () => {
    const fake = fakeIndexedDb();
    const backend = await backendWith(fake);
    expect(backend.persistent).toBe(true);
    const buffer = Uint8Array.from([9, 1, 2, 3, 9]);
    await backend.write(KEY, buffer.subarray(1, 4));
    buffer[2] = 0; // mexer no original depois não altera o que foi guardado
    expect((fake.data.get(KEY) as ArrayBuffer).byteLength).toBe(3);
    expect(await backend.exists(KEY)).toBe(true);
    expect(await backend.size(KEY)).toBe(3);
    expect(Array.from(await backend.read(KEY))).toEqual([1, 2, 3]);
    await backend.remove(KEY);
    expect(await backend.exists(KEY)).toBe(false);
    expect(await backend.size(KEY)).toBeNull();
    await expect(backend.read(KEY)).rejects.toThrow(/ausente/);
  });

  it("pedido que falha rejeita a operação uma vez, sem deixar promessa rejeitada sem tratamento", async () => {
    const fake = fakeIndexedDb();
    const backend = await backendWith(fake);
    await backend.write(KEY, Uint8Array.from([1]));
    fake.state.failNext = true;
    await expect(backend.read(KEY)).rejects.toThrow(/falha simulada/);
    fake.state.failNext = true;
    await expect(backend.write(KEY, Uint8Array.from([2]))).rejects.toThrow(/falha simulada/);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(unhandled).toEqual([]);
  });
});
