// @vitest-environment jsdom
// Configurações da empresa (tabela settings, uma linha por chave): SQLite real e banco demo do navegador.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDemoDb, DEMO_COMPANY_ID, type DatabaseLike } from "@/lib/db/demo";
import { createTestDb, insertTestCompany, type TestDb } from "@/test/sqlite";
import { getCompanySetting, setCompanySetting } from "./companySettings";

let sqlite: TestDb | null = null;
beforeEach(() => localStorage.clear());
afterEach(() => {
  sqlite?.close();
  sqlite = null;
});

async function sqliteDb(): Promise<{ db: DatabaseLike; companyId: string; count: (key: string) => Promise<number> }> {
  sqlite = await createTestDb();
  const { companyId } = await insertTestCompany(sqlite, { roles: ["ceo"] });
  await insertTestCompany(sqlite, { companyId: "outra", roles: ["ceo"] });
  const db = sqlite;
  return { db, companyId, count: async (key) => (await db.select<unknown[]>("SELECT * FROM settings WHERE key = ?", [key])).length };
}

function demoDb(): { db: DatabaseLike; companyId: string; count: (key: string) => Promise<number> } {
  const db = createDemoDb();
  return { db, companyId: DEMO_COMPANY_ID, count: async (key) => (await db.select<unknown[]>("SELECT * FROM settings WHERE company_id=? AND key=?", [DEMO_COMPANY_ID, key])).length };
}

describe.each([
  ["SQLite", sqliteDb],
  ["demo", async () => demoDb()],
] as const)("configurações da empresa (%s)", (_name, open) => {
  it("chave que não existe volta undefined; gravar e ler devolve o mesmo valor (texto, objeto, booleano)", async () => {
    const { db, companyId } = await open();
    expect(await getCompanySetting(db, companyId, "company.area_profile")).toBeUndefined();
    await setCompanySetting(db, companyId, "company.area_profile", "advocacia");
    await setCompanySetting(db, companyId, "company.labels", { "dashboard.profit": "Honorários do mês" });
    await setCompanySetting(db, companyId, "demo_mode", false);
    expect(await getCompanySetting(db, companyId, "company.area_profile")).toBe("advocacia");
    expect(await getCompanySetting(db, companyId, "company.labels")).toEqual({ "dashboard.profit": "Honorários do mês" });
    expect(await getCompanySetting(db, companyId, "demo_mode")).toBe(false);
  });

  it("gravar de novo atualiza a mesma linha (não duplica) e não vaza para outra empresa", async () => {
    const { db, companyId, count } = await open();
    await setCompanySetting(db, companyId, "company.area_profile", "ti");
    await setCompanySetting(db, companyId, "company.area_profile", "comercio");
    expect(await count("company.area_profile")).toBe(1);
    expect(await getCompanySetting(db, companyId, "company.area_profile")).toBe("comercio");
    expect(await getCompanySetting(db, "outra", "company.area_profile")).toBeUndefined();
  });

  it("valor gravado que não é JSON válido volta undefined (não derruba a tela)", async () => {
    const { db, companyId } = await open();
    await db.execute("INSERT INTO settings (id, company_id, key, value_json) VALUES (?, ?, ?, ?)", ["s-bad", companyId, "company.labels", "{quebrado"]);
    expect(await getCompanySetting(db, companyId, "company.labels")).toBeUndefined();
  });
});
