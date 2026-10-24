import { describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import type { TestDb } from "@/test/sqlite";
import { DEV_AREAS, DEV_PASSWORD, devEmail } from "./quickLogin";
import { devUserId, seedDevData } from "./devSeed";
import { areaSeeds, runAreaSeeds } from "./seeds";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));

const testDb = useTestDb();
const COMPANY_ID = "dev-company";

/** Mesmo preparo de `devQuickLogin` (quickLogin.ts): empresa + uma conta por área. */
async function createDevCompany(db: TestDb): Promise<void> {
  await db.execute("INSERT OR IGNORE INTO companies (id, name) VALUES (?, ?)", [COMPANY_ID, "Minha Empresa"]);
  for (const area of DEV_AREAS) {
    const userId = devUserId(area.role);
    await db.execute("INSERT OR IGNORE INTO users (id, name, email, password_hash) VALUES (?,?,?,?)", [
      userId,
      area.name,
      devEmail(area.role),
      `plain:${DEV_PASSWORD}`,
    ]);
    await db.execute("INSERT OR IGNORE INTO memberships (id, company_id, user_id, role, scope) VALUES (?,?,?,?,?)", [
      `dev-member-${area.role}`,
      COMPANY_ID,
      userId,
      area.role,
      ["ceo", "admin", "gerente"].includes(area.role) ? "empresa" : "setor",
    ]);
  }
}

// Linhas que o seed principal (devSeed.ts) cria por empresa. Os seeds de área (seeds/*.ts) são conferidos à parte.
const EXPECTED: Record<string, number> = {
  customers: 12,
  contacts: 8,
  opportunities: 12,
  proposals: 4,
  tickets: 12,
  work_orders: 8,
  projects: 3,
  project_stages: 9,
  tasks: 9,
  suppliers: 5,
  stock_locations: 2,
  inventory_items: 16,
  stock_balances: 16,
  stock_movements: 10,
  custodies: 4,
  cost_centers: 5,
  payables: 12,
  receivables: 10,
  documents: 15,
  employees: 15,
  employee_compensation: 15,
  hr_requests: 7,
  hr_announcements: 4,
  hr_tasks: 5,
  activities: 5,
  audit_logs: 6,
  leads: 0,
};

async function count(db: TestDb, table: string): Promise<number> {
  const [row] = await db.select<{ n: number }[]>(`SELECT count(*) AS n FROM ${table}`);
  return row.n;
}

async function allTables(db: TestDb): Promise<string[]> {
  const rows = await db.select<{ name: string }[]>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  return rows.map((row) => row.name);
}

/** Contagem de todas as tabelas (inclui as que os seeds de área criarem no futuro). */
async function snapshot(db: TestDb): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const table of await allTables(db)) result[table] = await count(db, table);
  return result;
}

describe("seedDevData", () => {
  it("cria os dados de exemplo esperados e roda de novo sem duplicar", async () => {
    const db = testDb();
    await createDevCompany(db);
    expect(DEV_AREAS).toHaveLength(11);

    await seedDevData(COMPANY_ID);
    const first = await snapshot(db);
    expect(first).toMatchObject({ ...EXPECTED, companies: 1, users: 11, memberships: 11 });
    const [flag] = await db.select<{ n: number }[]>("SELECT count(*) AS n FROM settings WHERE company_id = ? AND key = ?", [COMPANY_ID, "seed.dev_data.v1"]);
    expect(flag.n).toBe(1);

    await seedDevData(COMPANY_ID);
    expect(await snapshot(db)).toEqual(first);
  });

  it("não duplica nada mesmo sem as flags (ids fixos + INSERT OR IGNORE)", async () => {
    const db = testDb();
    await createDevCompany(db);
    await seedDevData(COMPANY_ID);
    const first = await snapshot(db);

    await db.execute("DELETE FROM settings WHERE company_id = ?", [COMPANY_ID]);
    await seedDevData(COMPANY_ID);
    expect(await snapshot(db)).toEqual(first);
  });

  it("nunca semeia leads", async () => {
    const db = testDb();
    await createDevCompany(db);
    await seedDevData(COMPANY_ID);
    expect(await count(db, "leads")).toBe(0);
  });

  it("grava tudo na empresa certa, liga colaboradores às contas e respeita as chaves estrangeiras", async () => {
    const db = testDb();
    await createDevCompany(db);
    await seedDevData(COMPANY_ID);

    for (const table of await allTables(db)) {
      const cols = await db.select<{ name: string }[]>(`PRAGMA table_info(${table})`);
      if (!cols.some((col) => col.name === "company_id") || (await count(db, table)) === 0) continue;
      const rows = await db.select<{ company_id: string }[]>(`SELECT DISTINCT company_id FROM ${table}`);
      expect(rows, table).toEqual([{ company_id: COMPANY_ID }]);
    }

    const linked = await db.select<{ id: string; user_id: string | null }[]>(
      "SELECT id, user_id FROM employees WHERE company_id = ? AND user_id IS NOT NULL ORDER BY id",
      [COMPANY_ID],
    );
    expect(linked).toHaveLength(DEV_AREAS.length);
    for (const area of DEV_AREAS) expect(linked).toContainEqual({ id: `dev-emp-${area.role}`, user_id: devUserId(area.role) });

    expect(await db.select("PRAGMA foreign_key_check")).toEqual([]);
  });
});

describe("seeds de área (src/lib/dev/seeds/*.ts)", () => {
  it("são descobertos sozinhos, em ordem alfabética, e todos rodam sem erro", async () => {
    const names = areaSeeds.map((seed) => seed.name);
    expect(names).toEqual([...names].sort());
    expect(names).toEqual(expect.arrayContaining(["catalog", "finance"]));
    expect(names).not.toContain("index");

    const db = testDb();
    await createDevCompany(db);
    await seedDevData(COMPANY_ID);
    const results = await runAreaSeeds(COMPANY_ID);
    expect(results.filter((result) => !result.ok)).toEqual([]);
    expect(results.map((result) => result.name)).toEqual(names);
  });

  it("rodam também quando a flag principal já existe (cada área tem a sua)", async () => {
    const db = testDb();
    await createDevCompany(db);
    await db.execute("INSERT INTO settings (id, company_id, key, value_json) VALUES (?, ?, ?, ?)", ["flag-antiga", COMPANY_ID, "seed.dev_data.v1", "{}"]);
    await seedDevData(COMPANY_ID);
    expect(await count(db, "customers")).toBe(0);
    expect(await count(db, "finance_categories")).toBeGreaterThan(0);
    expect(await count(db, "products")).toBeGreaterThan(0);
    expect(await db.select("PRAGMA foreign_key_check")).toEqual([]);
  });

  it("catálogo e financeiro trazem produtos, tabela de preço, plano de contas e contas bancárias", async () => {
    const db = testDb();
    await createDevCompany(db);
    await seedDevData(COMPANY_ID);
    expect(await count(db, "products")).toBeGreaterThanOrEqual(10);
    expect(await count(db, "price_lists")).toBeGreaterThanOrEqual(1);
    expect(await count(db, "finance_categories")).toBeGreaterThanOrEqual(10);
    expect(await count(db, "bank_accounts")).toBeGreaterThanOrEqual(2);
    const children = await db.select<{ n: number }[]>("SELECT count(*) AS n FROM finance_categories WHERE parent_id IS NOT NULL");
    expect(children[0].n).toBeGreaterThan(0);
    const linked = await db.select<{ n: number }[]>("SELECT count(*) AS n FROM products WHERE inventory_item_id IS NOT NULL");
    expect(linked[0].n).toBeGreaterThan(0);
  });

  it("um seed de área que falha não derruba os outros nem o login", async () => {
    const db = testDb();
    await createDevCompany(db);
    // Empresa inexistente: as chaves estrangeiras fazem os inserts falharem; o erro volta no resultado.
    const results = await runAreaSeeds("empresa-que-nao-existe");
    expect(results.length).toBe(areaSeeds.length);
    expect(results.some((result) => !result.ok && typeof result.error === "string" && result.error.length > 0)).toBe(true);
  });
});
