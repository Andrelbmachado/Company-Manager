// getDb(): as chamadas que chegam juntas ao abrir o app (senhas antigas, limpeza do modo demonstração, revalidação da
// sessão) esperam o mesmo Database.load. O plugin só roda as migrations no primeiro load: um segundo load simultâneo
// podia usar o banco antes de elas terminarem. Load que falha não fica guardado (a próxima chamada tenta de novo).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const load = vi.fn();
const getDemoDb = vi.fn();
vi.mock("@tauri-apps/plugin-sql", () => ({ default: { load: (...args: unknown[]) => load(...args) } }));
vi.mock("./demo", () => ({ getDemoDb: () => getDemoDb() }));

async function freshClient() {
  vi.resetModules();
  return import("./client");
}

beforeEach(() => {
  load.mockReset();
  getDemoDb.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getDb no app desktop", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
  });

  it("chamadas simultâneas esperam o mesmo load (as migrations rodam uma vez só)", async () => {
    let finish!: (db: unknown) => void;
    load.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const { getDb } = await freshClient();

    const first = getDb();
    const second = getDb();
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith("sqlite:company-manager.db");

    const db = { select: vi.fn(), execute: vi.fn() };
    finish(db);
    expect(await first).toBe(db);
    expect(await second).toBe(db);
    expect(await getDb()).toBe(db);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("se o load falha, a próxima chamada tenta de novo", async () => {
    const db = { select: vi.fn(), execute: vi.fn() };
    load.mockRejectedValueOnce(new Error("banco travado")).mockResolvedValueOnce(db);
    const { getDb } = await freshClient();

    await expect(getDb()).rejects.toThrow("banco travado");
    expect(await getDb()).toBe(db);
    expect(await getDb()).toBe(db);
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe("getDb no navegador", () => {
  it("usa o banco demo, criado uma vez só", async () => {
    vi.stubGlobal("window", {});
    const demo = { select: vi.fn(), execute: vi.fn() };
    getDemoDb.mockReturnValue(demo);
    const { getDb } = await freshClient();

    expect(await Promise.all([getDb(), getDb()])).toEqual([demo, demo]);
    expect(getDemoDb).toHaveBeenCalledTimes(1);
    expect(load).not.toHaveBeenCalled();
  });
});
