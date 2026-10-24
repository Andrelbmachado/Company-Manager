import { describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import type { TestDb } from "@/test/sqlite";
import { DEV_AREAS, DEV_PASSWORD, devEmail } from "./quickLogin";
import { devUserId, seedDevData } from "./devSeed";

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

// Linhas que o seed cria (por empresa). Quem estender o seed atualiza esta tabela.
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
  settings: 1,
  leads: 0,
};

async function count(db: TestDb, table: string): Promise<number> {
  const [row] = await db.select<{ n: number }[]>(`SELECT count(*) AS n FROM ${table}`);
  return row.n;
}

async function snapshot(db: TestDb): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const table of [...Object.keys(EXPECTED), "companies", "users", "memberships"]) result[table] = await count(db, table);
  return result;
}

describe("seedDevData", () => {
  it("cria os dados de exemplo esperados e roda de novo sem duplicar", async () => {
    const db = testDb();
    await createDevCompany(db);
    expect(DEV_AREAS).toHaveLength(11);

    await seedDevData(COMPANY_ID);
    const first = await snapshot(db);
    expect(first).toEqual({ ...EXPECTED, companies: 1, users: 11, memberships: 11 });

    await seedDevData(COMPANY_ID);
    expect(await snapshot(db)).toEqual(first);
  });

  it("não duplica nada mesmo sem a flag (ids fixos + INSERT OR IGNORE)", async () => {
    const db = testDb();
    await createDevCompany(db);
    await seedDevData(COMPANY_ID);
    const first = await snapshot(db);

    await db.execute("DELETE FROM settings WHERE company_id = ? AND key = ?", [COMPANY_ID, "seed.dev_data.v1"]);
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

    for (const table of Object.keys(EXPECTED).filter((t) => EXPECTED[t] > 0)) {
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
