// @vitest-environment jsdom
// Perfil de área e rótulos gravados em settings: leitura com padrão, gravação só para quem edita Configurações.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDemoDb, DEMO_COMPANY_ID, type DatabaseLike } from "@/lib/db/demo";
import { getCompanySetting } from "@/lib/settings/companySettings";
import { createTestDb, insertTestCompany, type TestDb } from "@/test/sqlite";
import { AREA_PROFILE_SETTING, LABELS_SETTING, loadAreaLabels, saveAreaLabels } from "./store";

let sqlite: TestDb | null = null;
beforeEach(() => localStorage.clear());
afterEach(() => {
  sqlite?.close();
  sqlite = null;
});

async function sqliteDb(): Promise<{ db: DatabaseLike; companyId: string }> {
  sqlite = await createTestDb();
  const { companyId } = await insertTestCompany(sqlite, { roles: ["ceo", "comercial"] });
  return { db: sqlite, companyId };
}

const CEO = { role: "ceo" as const, userId: "test-user-ceo" };
const COMERCIAL = { role: "comercial" as const, userId: "test-user-comercial" };

describe.each([
  ["SQLite", sqliteDb],
  ["demo", async () => ({ db: createDemoDb() as DatabaseLike, companyId: DEMO_COMPANY_ID })],
] as const)("rótulos da área (%s)", (_name, open) => {
  it("sem nada gravado: perfil TI e nenhuma sobrescrita", async () => {
    const { db, companyId } = await open();
    expect(await loadAreaLabels(db, companyId)).toEqual({ profile: "ti", overrides: {} });
  });

  it("grava o perfil e as sobrescritas (limpas) e lê de volta", async () => {
    const { db, companyId } = await open();
    const saved = await saveAreaLabels(db, companyId, CEO, {
      profile: "advocacia",
      overrides: { "dashboard.active_work": "  Casos em andamento ", "dashboard.profit": "", "chave.inventada": "X" },
    });
    expect(saved).toEqual({ profile: "advocacia", overrides: { "dashboard.active_work": "Casos em andamento" } });
    expect(await loadAreaLabels(db, companyId)).toEqual(saved);
    expect(await getCompanySetting(db, companyId, AREA_PROFILE_SETTING)).toBe("advocacia");
    expect(await getCompanySetting(db, companyId, LABELS_SETTING)).toEqual({ "dashboard.active_work": "Casos em andamento" });
  });

  it("mudar só o perfil mantém as sobrescritas; mudar só as sobrescritas mantém o perfil", async () => {
    const { db, companyId } = await open();
    await saveAreaLabels(db, companyId, CEO, { profile: "servicos", overrides: { "module.crm": "Clientes" } });
    expect(await saveAreaLabels(db, companyId, CEO, { profile: "comercio" })).toEqual({ profile: "comercio", overrides: { "module.crm": "Clientes" } });
    expect(await saveAreaLabels(db, companyId, CEO, { overrides: {} })).toEqual({ profile: "comercio", overrides: {} });
  });

  it("quem não edita Configurações não grava (a camada de dados também barra) e perfil inválido é recusado", async () => {
    const { db, companyId } = await open();
    await expect(saveAreaLabels(db, companyId, COMERCIAL, { profile: "advocacia" })).rejects.toThrow(/permissão/i);
    await expect(saveAreaLabels(db, companyId, CEO, { profile: "farmacia" as never })).rejects.toThrow(/área/i);
    expect(await loadAreaLabels(db, companyId)).toEqual({ profile: "ti", overrides: {} });
  });

  it("valor estranho gravado à mão vira o padrão em vez de quebrar", async () => {
    const { db, companyId } = await open();
    await db.execute("INSERT INTO settings (id, company_id, key, value_json) VALUES (?, ?, ?, ?)", ["s-1", companyId, AREA_PROFILE_SETTING, JSON.stringify("farmacia")]);
    await db.execute("INSERT INTO settings (id, company_id, key, value_json) VALUES (?, ?, ?, ?)", ["s-2", companyId, LABELS_SETTING, JSON.stringify(["x"])]);
    expect(await loadAreaLabels(db, companyId)).toEqual({ profile: "ti", overrides: {} });
  });
});
