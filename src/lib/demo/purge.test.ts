// Limpeza dos dados de exemplo (purge.ts): apaga só linhas com id dev-*/demo-* da empresa, na ordem que as chaves
// estrangeiras exigem, e nunca toca em leads, contas, vínculos e empresas. SQLite real (createTestDb).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, insertTestCompany, type TestDb } from "@/test/sqlite";
import { countDemoRows, DEMO_EXCLUDED_TABLES, isDemoId, purgeDemoData } from "./purge";

const COMPANY = "dev-company";
let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
  // A empresa do login rápido tem id "dev-company": a tabela companies fica de fora da limpeza.
  await insertTestCompany(db, { companyId: COMPANY, roles: ["ceo"] });
});

afterEach(() => db.close());

const ids = async (table: string) => (await db.select<{ id: string }[]>(`SELECT id FROM ${table} ORDER BY id`)).map((row) => row.id);

describe("isDemoId", () => {
  it("reconhece só os prefixos dev- e demo-", () => {
    expect(["dev-customer-1", "demo-ceo", "dev-flag-x"].every(isDemoId)).toBe(true);
    expect(["developer", "demonstração", "0f8e1a2b-3c4d", "", "prospeccao-1-dev-company", null, undefined, 12].some(isDemoId)).toBe(false);
  });

  it("a lista de tabelas protegidas é a do plano", () => {
    expect([...DEMO_EXCLUDED_TABLES]).toEqual(["leads", "users", "memberships", "companies", "_sqlx_migrations"]);
  });
});

describe("purgeDemoData", () => {
  it("apaga filhos antes dos pais, inclusive numa árvore da mesma tabela (plano de contas)", async () => {
    // Inseridas do pai para o neto: apagar na ordem de inserção quebraria a chave estrangeira.
    await db.execute("INSERT INTO finance_categories (id, company_id, parent_id, name) VALUES ('dev-cat-a', ?, NULL, 'Despesas')", [COMPANY]);
    await db.execute("INSERT INTO finance_categories (id, company_id, parent_id, name) VALUES ('dev-cat-b', ?, 'dev-cat-a', 'Operação')", [COMPANY]);
    await db.execute("INSERT INTO finance_categories (id, company_id, parent_id, name) VALUES ('dev-cat-c', ?, 'dev-cat-b', 'Energia')", [COMPANY]);
    await db.execute("INSERT INTO customers (id, company_id, type, name) VALUES ('dev-c1', ?, 'PJ', 'Cliente exemplo')", [COMPANY]);
    await db.execute("INSERT INTO contacts (id, company_id, customer_id, name) VALUES ('demo-ct1', ?, 'dev-c1', 'Contato exemplo')", [COMPANY]);

    const result = await purgeDemoData(db, COMPANY);

    expect(result).toMatchObject({ removed: 5, kept: 0, removedByTable: { finance_categories: 3, customers: 1, contacts: 1 }, keptByTable: {} });
    expect(await ids("finance_categories")).toEqual([]);
    expect(await ids("customers")).toEqual([]);
    expect(await db.select("PRAGMA foreign_key_check")).toEqual([]);
  });

  it("não toca em leads, contas, vínculos e empresas, nem em linhas sem o prefixo", async () => {
    await db.execute("INSERT INTO users (id, name, email, password_hash) VALUES ('dev-user-ceo', 'Exemplo', 'dev.ceo@company.local', 'plain:dev')");
    await db.execute("INSERT INTO memberships (id, company_id, user_id, role, scope) VALUES ('dev-member-ceo', ?, 'dev-user-ceo', 'ceo', 'empresa')", [COMPANY]);
    await db.execute("INSERT INTO leads (id, company_id, name, status) VALUES ('dev-lead-1', ?, 'Lead dev', 'novo')", [COMPANY]);
    await db.execute("INSERT INTO customers (id, company_id, type, name) VALUES ('cliente-real', ?, 'PJ', 'Real')", [COMPANY]);
    await db.execute("INSERT INTO customers (id, company_id, type, name) VALUES ('DEV-maiusculo', ?, 'PJ', 'Não é prefixo exato')", [COMPANY]);

    const result = await purgeDemoData(db, COMPANY);

    expect(result.removed).toBe(0);
    expect(await ids("users")).toContain("dev-user-ceo");
    expect(await ids("memberships")).toContain("dev-member-ceo");
    expect(await ids("leads")).toEqual(["dev-lead-1"]);
    expect(await ids("companies")).toEqual([COMPANY]);
    expect(await ids("customers")).toEqual(["DEV-maiusculo", "cliente-real"]);
  });

  it("um lead que aponta para um registro de exemplo segura esse registro (e o que ele usa)", async () => {
    await db.execute("INSERT INTO customers (id, company_id, type, name) VALUES ('dev-c1', ?, 'PJ', 'Cliente exemplo')", [COMPANY]);
    await db.execute("INSERT INTO projects (id, company_id, name, status) VALUES ('dev-p1', ?, 'Projeto exemplo', 'andamento')", [COMPANY]);
    await db.execute("INSERT INTO project_stages (id, company_id, project_id, name, position) VALUES ('dev-s1', ?, 'dev-p1', 'Etapa', 1)", [COMPANY]);
    await db.execute("INSERT INTO leads (id, company_id, name, status, customer_id) VALUES ('lead-real', ?, 'Lead real', 'novo', 'dev-c1')", [COMPANY]);

    const result = await purgeDemoData(db, COMPANY);

    expect(result.keptByTable).toEqual({ customers: 1 });
    expect(result.removedByTable).toEqual({ projects: 1, project_stages: 1 });
    expect(await ids("customers")).toEqual(["dev-c1"]);
    expect(await db.select("SELECT customer_id FROM leads")).toEqual([{ customer_id: "dev-c1" }]);
    expect(await db.select("PRAGMA foreign_key_check")).toEqual([]);
  });

  it("countDemoRows conta por tabela só as linhas de exemplo da empresa", async () => {
    await db.execute("INSERT INTO customers (id, company_id, type, name) VALUES ('dev-c1', ?, 'PJ', 'A'), ('dev-c2', ?, 'PJ', 'B'), ('real', ?, 'PJ', 'C')", [COMPANY, COMPANY, COMPANY]);
    await db.execute("INSERT INTO cost_centers (id, company_id, name) VALUES ('demo-cc', ?, 'Operações')", [COMPANY]);
    await db.execute("INSERT INTO leads (id, company_id, name, status) VALUES ('dev-lead-1', ?, 'Lead', 'novo')", [COMPANY]);

    expect(await countDemoRows(db, COMPANY)).toEqual({ total: 3, byTable: { cost_centers: 1, customers: 2 } });
    expect(await countDemoRows(db, "outra")).toEqual({ total: 0, byTable: {} });
  });
});

describe("purgeDemoData: iniciativas de produto no JSON de settings", () => {
  it("tira só as iniciativas de exemplo e mantém as da pessoa", async () => {
    const item = (id: string, name: string) => ({ id, name, type: "digital", status: "planejado", owner: null, next_milestone: null, milestone_date: null, created_at: "2026-01-01", updated_at: "2026-01-01" });
    await db.execute("INSERT INTO settings (id, company_id, key, value_json) VALUES (?, ?, ?, ?)", [
      "0d1c2b3a-0000-4000-8000-000000000001",
      COMPANY,
      "product_development.initiatives",
      JSON.stringify([item("dev-initiative-1", "Exemplo"), item("6a5b4c3d-0000-4000-8000-000000000002", "Minha iniciativa")]),
    ]);

    await purgeDemoData(db, COMPANY);

    const [row] = await db.select<{ value_json: string }[]>("SELECT value_json FROM settings WHERE key = 'product_development.initiatives'");
    expect(JSON.parse(row.value_json).map((entry: { name: string }) => entry.name)).toEqual(["Minha iniciativa"]);
  });
});
