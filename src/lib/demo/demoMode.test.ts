// Modo demonstração (Tarefa 10 do redesign): ligar semeia os dados de exemplo (ids dev-*/demo-*), desligar apaga só
// essas linhas, nunca leads nem o que a pessoa cadastrou. SQLite real; os seeds gravam pelo getDb() (mockDb).
import { describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany, type TestDb } from "@/test/sqlite";
import { runRecurring } from "@/lib/erp/recurring";
import { ensureSiteProspectingSeed } from "@/lib/prospecting/seed";
import { seedDevData } from "@/lib/dev/devSeed";
import { DEV_AREAS, DISABLED_PASSWORD_HASH, ensureDevAccounts } from "@/lib/dev/devAccounts";
import { getCompanySetting, setCompanySetting } from "@/lib/settings/companySettings";
import { todayIso } from "@/lib/utils";
import type { Session } from "@/types";
import { changeDemoMode, DEMO_MODE_KEY, initDemoMode, isDemoMode, refreshDemoData, setDemoMode } from "./demoMode";
import { countDemoRows, DEMO_EXCLUDED_TABLES, isDemoId } from "./purge";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));

const testDb = useTestDb();
const COMPANY = "test-company";

type Row = Record<string, unknown>;

async function count(db: TestDb, table: string, where = "1 = 1", binds: unknown[] = []): Promise<number> {
  const [row] = await db.select<{ n: number }[]>(`SELECT count(*) AS n FROM ${table} WHERE ${where}`, binds);
  return row.n;
}

async function tables(db: TestDb): Promise<string[]> {
  const rows = await db.select<{ name: string }[]>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  return rows.map((row) => row.name);
}

async function snapshot(db: TestDb): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const table of await tables(db)) result[table] = await count(db, table);
  return result;
}

/** Linhas de exemplo (id dev-/demo-) que sobram nas tabelas que o modo demonstração limpa. */
async function demoLeftovers(db: TestDb): Promise<string[]> {
  const left: string[] = [];
  for (const table of await tables(db)) {
    if ((DEMO_EXCLUDED_TABLES as readonly string[]).includes(table)) continue;
    const cols = await db.select<{ name: string }[]>(`PRAGMA table_info(${table})`);
    if (!cols.some((col) => col.name === "id")) continue;
    for (const row of await db.select<{ id: string }[]>(`SELECT id FROM ${table}`)) if (isDemoId(row.id)) left.push(`${table}:${row.id}`);
  }
  return left;
}

async function insertLead(db: TestDb, id: string, name: string, companyId = COMPANY): Promise<void> {
  await db.execute("INSERT INTO leads (id, company_id, name, status) VALUES (?, ?, ?, 'novo')", [id, companyId, name]);
}

async function ready(): Promise<TestDb> {
  const db = testDb();
  await insertTestCompany(db, { companyId: COMPANY });
  return db;
}

describe("setDemoMode: ligar", () => {
  it("popula clientes, financeiro, estoque, projetos e RH, grava o modo ligado e cria as contas de exemplo sem senha", async () => {
    const db = await ready();
    expect(await isDemoMode(db, COMPANY)).toBe(false);

    const result = await setDemoMode(db, COMPANY, true);

    expect(result.inserted).toBeGreaterThan(100);
    expect(result.failed ?? []).toEqual([]);
    expect(await isDemoMode(db, COMPANY)).toBe(true);
    expect(await getCompanySetting(db, COMPANY, DEMO_MODE_KEY)).toBe(true);
    expect(await count(db, "customers")).toBe(12);
    expect(await count(db, "payables")).toBeGreaterThan(0);
    expect(await count(db, "receivables")).toBeGreaterThan(0);
    expect(await count(db, "inventory_items")).toBeGreaterThan(0);
    expect(await count(db, "projects")).toBeGreaterThanOrEqual(3);
    expect(await count(db, "employees")).toBeGreaterThan(0);
    expect(await count(db, "sales_orders")).toBeGreaterThan(0);
    expect(await count(db, "leads")).toBe(0);
    // As contas de exemplo existem (os dados pertencem a elas), mas ninguém entra com elas por senha.
    const accounts = await db.select<{ id: string; password_hash: string }[]>("SELECT id, password_hash FROM users WHERE id LIKE 'dev-user-%'");
    expect(accounts).toHaveLength(DEV_AREAS.length);
    expect(accounts.every((account) => account.password_hash === DISABLED_PASSWORD_HASH)).toBe(true);
    expect(await db.select("PRAGMA foreign_key_check")).toEqual([]);
  });

  it("ligar duas vezes não duplica nada", async () => {
    const db = await ready();
    await setDemoMode(db, COMPANY, true);
    const first = await snapshot(db);

    const again = await setDemoMode(db, COMPANY, true);

    expect(again.inserted).toBe(0);
    expect(await snapshot(db)).toEqual(first);
  });
});

describe("setDemoMode: desligar", () => {
  it("remove todos os dados de exemplo e mantém os leads (inclusive dev-*) e o cliente criado pela pessoa durante o modo", async () => {
    const db = await ready();
    for (const [index, name] of ["Padaria Real", "Oficina Real", "Clínica Real"].entries()) await insertLead(db, `5b7c0d1e-0000-4000-8000-00000000000${index}`, name);
    await setDemoMode(db, COMPANY, true);
    // Enquanto o modo está ligado: um cliente de verdade (uuid) e um lead que por acaso tem id dev-*.
    await db.execute("INSERT INTO customers (id, company_id, type, name) VALUES (?, ?, 'PJ', ?)", ["0f8e1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b", COMPANY, "Cliente de Verdade Ltda"]);
    await insertLead(db, "dev-lead-importado", "Lead com id dev");
    const usersBefore = await db.select<Row[]>("SELECT * FROM users ORDER BY id");
    const membershipsBefore = await db.select<Row[]>("SELECT * FROM memberships ORDER BY id");

    const result = await setDemoMode(db, COMPANY, false);

    expect(result.removed).toBeGreaterThan(100);
    expect(result.kept).toBe(0);
    expect(await demoLeftovers(db)).toEqual([]);
    expect(await countDemoRows(db, COMPANY)).toEqual({ total: 0, byTable: {} });
    for (const table of ["payables", "receivables", "inventory_items", "projects", "employees", "sales_orders", "tickets", "documents"]) {
      expect(await count(db, table), table).toBe(0);
    }
    expect(await db.select("SELECT id, name FROM customers")).toEqual([{ id: "0f8e1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b", name: "Cliente de Verdade Ltda" }]);
    expect(await count(db, "leads")).toBe(4);
    expect(await count(db, "leads", "id = ?", ["dev-lead-importado"])).toBe(1);
    // Contas (inclusive as de exemplo) e vínculos ficam.
    expect(await db.select("SELECT * FROM users ORDER BY id")).toEqual(usersBefore);
    expect(await db.select("SELECT * FROM memberships ORDER BY id")).toEqual(membershipsBefore);
    expect(await isDemoMode(db, COMPANY)).toBe(false);
    expect(await db.select("PRAGMA foreign_key_check")).toEqual([]);
  });

  it("desligar e ligar de novo traz os dados de exemplo de volta", async () => {
    const db = await ready();
    await setDemoMode(db, COMPANY, true);
    const seeded = await snapshot(db);
    await setDemoMode(db, COMPANY, false);
    expect(await count(db, "customers")).toBe(0);

    const result = await setDemoMode(db, COMPANY, true);

    expect(result.inserted).toBeGreaterThan(100);
    const after = await snapshot(db);
    for (const table of ["customers", "payables", "receivables", "sales_orders", "employees", "projects", "inventory_items"]) expect(after[table], table).toBe(seeded[table]);
  });

  it("registro real que aponta para um de exemplo fica intacto, e o de exemplo que ele usa também (sem quebrar chave estrangeira)", async () => {
    const db = await ready();
    await setDemoMode(db, COMPANY, true);
    await db.execute(
      "INSERT INTO receivables (id, company_id, customer_id, description, amount, due_date, status) VALUES (?, ?, ?, ?, ?, ?, 'aberta')",
      ["a1b2c3d4-0000-4000-8000-000000000001", COMPANY, "dev-customer-1", "Serviço de verdade", 1500, "2026-11-10"],
    );
    await db.execute(
      "INSERT INTO payables (id, company_id, supplier_id, cost_center_id, description, amount, due_date, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'aberta')",
      ["a1b2c3d4-0000-4000-8000-000000000002", COMPANY, "dev-supplier-2", "dev-cc-1", "Conta de verdade", 320, "2026-11-12"],
    );
    const realRows = async () => [
      ...(await db.select<Row[]>("SELECT * FROM receivables WHERE id LIKE 'a1b2c3d4-%'")),
      ...(await db.select<Row[]>("SELECT * FROM payables WHERE id LIKE 'a1b2c3d4-%'")),
    ];
    const realBefore = await realRows();
    expect(realBefore).toHaveLength(2);

    const result = await setDemoMode(db, COMPANY, false);

    expect(await realRows()).toEqual(realBefore);
    expect(result.keptByTable).toEqual({ customers: 1, suppliers: 1, cost_centers: 1 });
    expect(result.kept).toBe(3);
    expect((await demoLeftovers(db)).sort()).toEqual(["cost_centers:dev-cc-1", "customers:dev-customer-1", "suppliers:dev-supplier-2"]);
    // O resto do que pendia do cliente de exemplo (contatos, oportunidades, pedidos) saiu.
    expect(await count(db, "contacts")).toBe(0);
    expect(await count(db, "opportunities")).toBe(0);
    expect(await count(db, "sales_orders")).toBe(0);
    expect(await countDemoRows(db, COMPANY)).toEqual({ total: 3, byTable: { cost_centers: 1, customers: 1, suppliers: 1 } });
    expect(await db.select("PRAGMA foreign_key_check")).toEqual([]);
  });

  it("os lançamentos que a recorrência de exemplo gerou também saem (são dados de exemplo, não da pessoa)", async () => {
    const db = await ready();
    await setDemoMode(db, COMPANY, true);
    const ahead = new Date();
    ahead.setMonth(ahead.getMonth() + 3);
    const generated = await runRecurring(db, COMPANY, todayIso(ahead));
    expect(generated.created).toBeGreaterThan(0);
    expect([...generated.payableIds, ...generated.receivableIds].some((id) => !isDemoId(id))).toBe(true);

    const result = await setDemoMode(db, COMPANY, false);

    expect(result.kept).toBe(0);
    expect(await count(db, "payables")).toBe(0);
    expect(await count(db, "receivables")).toBe(0);
    expect(await count(db, "recurring_entries")).toBe(0);
  });

  it("só mexe na empresa informada", async () => {
    const db = await ready();
    await db.execute("INSERT INTO companies (id, name) VALUES ('outra-empresa', 'Outra')");
    await db.execute("INSERT INTO customers (id, company_id, type, name) VALUES ('dev-outra-1', 'outra-empresa', 'PJ', 'Cliente de exemplo da outra')");
    await setDemoMode(db, COMPANY, true);

    await setDemoMode(db, COMPANY, false);

    expect(await db.select("SELECT id FROM customers")).toEqual([{ id: "dev-outra-1" }]);
  });
});

describe("changeDemoMode (tela de Configurações)", () => {
  it("só CEO e Administração ligam ou desligam; o bloqueio vale na camada de dados", async () => {
    const db = await ready();
    await expect(changeDemoMode(db, COMPANY, { role: "comercial", userId: "test-user-comercial" }, true)).rejects.toThrow(/CEO|Administração/);
    await expect(changeDemoMode(db, COMPANY, { role: "gerente", userId: "test-user-gerente" }, true)).rejects.toThrow(/CEO|Administração/);
    expect(await count(db, "customers")).toBe(0);
    expect(await getCompanySetting(db, COMPANY, DEMO_MODE_KEY)).toBeUndefined();

    const on = await changeDemoMode(db, COMPANY, { role: "admin", userId: "test-user-admin" }, true);
    expect(on.inserted).toBeGreaterThan(0);
    const off = await changeDemoMode(db, COMPANY, { role: "ceo", userId: "test-user-ceo" }, false);
    expect(off.removed).toBeGreaterThan(0);
    // Fica registrado quem ligou e quem desligou.
    const log = await db.select<{ action: string; actor_id: string }[]>("SELECT action, actor_id FROM activities WHERE company_id = ? AND action LIKE 'settings.demo_mode%' ORDER BY action", [COMPANY]);
    expect(log).toEqual([{ action: "settings.demo_mode.off", actor_id: "test-user-ceo" }, { action: "settings.demo_mode.on", actor_id: "test-user-admin" }]);
  });
});

describe("initDemoMode (primeira abertura depois da atualização)", () => {
  /** Banco como o do André antes desta versão: dados do login rápido antigo (sem a chave demo_mode) e leads reais. */
  async function oldQuickLoginDb(): Promise<TestDb> {
    const db = await ready();
    await ensureDevAccounts(db, COMPANY, "plain:dev");
    await seedDevData(COMPANY);
    await insertLead(db, "6c1d2e3f-0000-4000-8000-000000000001", "Lead da pesquisa 1");
    await insertLead(db, "6c1d2e3f-0000-4000-8000-000000000002", "Lead da pesquisa 2");
    await insertLead(db, "6c1d2e3f-0000-4000-8000-000000000003", "Lead da pesquisa 3");
    return db;
  }

  it("deixa o modo desligado: os dados fictícios somem, os leads e as contas ficam; da segunda vez não faz nada", async () => {
    const db = await oldQuickLoginDb();
    expect(await count(db, "customers")).toBe(12);
    expect(await getCompanySetting(db, COMPANY, DEMO_MODE_KEY)).toBeUndefined();

    const results = await initDemoMode(db);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ companyId: COMPANY, kept: 0 });
    expect(results[0].removed).toBeGreaterThan(100);
    expect(await demoLeftovers(db)).toEqual([]);
    expect(await count(db, "leads")).toBe(3);
    expect(await count(db, "users", "id LIKE 'dev-user-%'")).toBe(DEV_AREAS.length);
    expect(await getCompanySetting(db, COMPANY, DEMO_MODE_KEY)).toBe(false);
    expect(await db.select("PRAGMA foreign_key_check")).toEqual([]);

    const before = await snapshot(db);
    expect(await initDemoMode(db)).toEqual([]);
    expect(await snapshot(db)).toEqual(before);
  });

  it("com a prospecção de sites semeada junto (banco do André), leads, campanha, pacotes e o projeto do site ficam", async () => {
    const db = await oldQuickLoginDb();
    const comercial = {
      user: { id: "test-user-comercial", name: "Teste comercial", email: "comercial@teste.local" },
      membership: { id: `test-member-${COMPANY}-comercial`, company_id: COMPANY, user_id: "test-user-comercial", role: "comercial", scope: "setor" },
      company: { id: COMPANY, name: "Empresa de Teste" },
    } as unknown as Session;
    expect(await ensureSiteProspectingSeed(comercial)).toBe(true);
    const kept = ["leads", "prospecting_campaigns", "service_packages", "package_prices", "revenue_scenarios", "revenue_forecasts"];
    const before: Record<string, number> = {};
    for (const table of kept) before[table] = await count(db, table);
    expect(before.leads).toBeGreaterThan(100);
    const siteProject = await db.select<Row[]>("SELECT * FROM projects WHERE name = 'Desenvolvimento de Site'");
    expect(siteProject).toHaveLength(1);

    const [result] = await initDemoMode(db);

    expect(result.kept).toBe(0);
    for (const table of kept) expect(await count(db, table), table).toBe(before[table]);
    expect(await db.select<Row[]>("SELECT * FROM projects")).toEqual(siteProject);
    expect(await count(db, "tasks", "project_id = ?", [siteProject[0].id])).toBeGreaterThan(0);
    expect(await demoLeftovers(db)).toEqual([]);
    expect(await db.select("PRAGMA foreign_key_check")).toEqual([]);
  });

  it("não mexe em empresa que já escolheu o modo (ligado fica ligado)", async () => {
    const db = await ready();
    await setDemoMode(db, COMPANY, true);
    const before = await snapshot(db);

    expect(await initDemoMode(db)).toEqual([]);

    expect(await snapshot(db)).toEqual(before);
    expect(await isDemoMode(db, COMPANY)).toBe(true);
  });

  it("isDemoMode entende true/false e também 'on'/'off' gravados como texto", async () => {
    const db = await ready();
    await setCompanySetting(db, COMPANY, DEMO_MODE_KEY, "on");
    expect(await isDemoMode(db, COMPANY)).toBe(true);
    await setCompanySetting(db, COMPANY, DEMO_MODE_KEY, "off");
    expect(await isDemoMode(db, COMPANY)).toBe(false);
  });
});

describe("refreshDemoData", () => {
  it("recompõe o que falta mesmo com a flag do seed principal gravada", async () => {
    const db = await ready();
    // Banco do desktop: modo ligado e flag gravada, mas os dados de exemplo do seed principal sumiram.
    await setCompanySetting(db, COMPANY, DEMO_MODE_KEY, true);
    await db.execute("INSERT INTO settings (id, company_id, key, value_json) VALUES (?, ?, ?, ?)", ["flag-antiga", COMPANY, "seed.dev_data.v1", "{}"]);

    await refreshDemoData(db, COMPANY);

    expect(await count(db, "work_orders")).toBeGreaterThanOrEqual(8);
    expect(await count(db, "projects")).toBeGreaterThanOrEqual(3);
    expect(await count(db, "employees")).toBeGreaterThan(0);
    expect(await count(db, "hr_requests")).toBeGreaterThan(0);
    expect(await count(db, "leads")).toBe(0);
    expect(await db.select("PRAGMA foreign_key_check")).toEqual([]);
  });

  it("com o modo desligado não grava nada", async () => {
    const db = await ready();
    const before = await snapshot(db);

    expect(await refreshDemoData(db, COMPANY)).toEqual([]);

    expect(await snapshot(db)).toEqual(before);
  });
});
