// Modo demonstração com todas as colunas preenchidas: fornecedores, contas, folha, produtos, OS e o fluxo dos próximos
// dias (balanço mensal e semanal do Dashboard). SQLite real; os seeds gravam pelo getDb() (mockDb).
import { describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { annualBalance } from "@/lib/dashboard/finance";
import { loadInitiatives } from "@/lib/products/initiatives";
import { setDemoMode } from "@/lib/demo/demoMode";
import { day } from "./seedUtils";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));

const testDb = useTestDb();
const COMPANY = "test-company";
type Row = Record<string, unknown>;

async function demo() {
  const db = testDb();
  await insertTestCompany(db, { companyId: COMPANY });
  await setDemoMode(db, COMPANY, true);
  return db;
}

const filled = (value: unknown) => value !== null && value !== undefined && String(value).trim() !== "";

describe("modo demonstração com as colunas completas", () => {
  it("fornecedores de exemplo têm todas as colunas da tabela", async () => {
    const db = await demo();
    const rows = await db.select<Row[]>("SELECT * FROM suppliers WHERE substr(id, 1, 4) = 'dev-'");
    expect(rows.length).toBeGreaterThanOrEqual(5);
    for (const row of rows) {
      for (const column of ["trade_name", "contact_name", "category", "rating", "email", "phone", "terms"]) expect(filled(row[column]), `${row.id}.${column}`).toBe(true);
      const address = JSON.parse(String(row.address_json ?? "{}"));
      expect(filled(address.cidade), `${row.id}.cidade`).toBe(true);
      expect(String(address.uf ?? "")).toMatch(/^[A-Z]{2}$/);
    }
  });

  it("contas de exemplo têm todas as colunas do Financeiro", async () => {
    const db = await demo();
    for (const table of ["payables", "receivables"]) {
      const rows = await db.select<Row[]>(`SELECT * FROM ${table} WHERE substr(id, 1, 4) = 'dev-'`);
      expect(rows.length, table).toBeGreaterThan(0);
      for (const row of rows) {
        for (const column of ["category_id", "cost_center_id", "document_number", "payment_method", "bank_account_id", "competence", "issue_date", "installment_number", "installment_count", "notes"]) {
          expect(filled(row[column]), `${table} ${row.id}.${column}`).toBe(true);
        }
      }
    }
  });

  it("folha tem observações", async () => {
    const db = await demo();
    const [{ n }] = await db.select<{ n: number }[]>("SELECT count(*) AS n FROM employee_compensation WHERE notes IS NOT NULL AND notes <> ''");
    expect(n).toBeGreaterThanOrEqual(5);
  });

  it("desenvolvimento de produtos tem iniciativas físicas e digitais", async () => {
    const db = await demo();
    const list = await loadInitiatives(db, COMPANY);
    expect(list.filter((item) => item.id.startsWith("dev-"))).toHaveLength(8);
    expect(list.filter((item) => item.type === "fisico")).toHaveLength(4);
    expect(list.every((item) => item.owner && item.next_milestone && item.milestone_date)).toBe(true);
  });

  it("ordens de serviço de exemplo têm prazo e passam de 12", async () => {
    const db = await demo();
    const rows = await db.select<Row[]>("SELECT * FROM work_orders WHERE substr(id, 1, 4) = 'dev-'");
    expect(rows.length).toBeGreaterThanOrEqual(12);
    expect(rows.every((row) => filled(row.sla_due_at))).toBe(true);
  });

  it("balanço tem movimento em todos os meses e nos próximos 7 dias", async () => {
    const db = await demo();
    const points = await annualBalance(db, COMPANY, Number(day(0).slice(0, 4)), { today: day(0) });
    expect(points.every((point) => point.previsto !== 0)).toBe(true);
    const next = new Set<string>();
    for (const table of ["payables", "receivables"]) {
      const rows = await db.select<{ due_date: string }[]>(`SELECT due_date FROM ${table} WHERE due_date >= ? AND due_date <= ?`, [day(0), day(6)]);
      for (const row of rows) next.add(row.due_date);
    }
    expect(next.size).toBeGreaterThanOrEqual(4);
  });

  it("o mês corrente tem lançamentos em pelo menos 10 dias (balanço mensal)", async () => {
    const db = await demo();
    const month = day(0).slice(0, 7);
    const days = new Set<string>();
    for (const table of ["payables", "receivables"]) {
      const rows = await db.select<{ due_date: string }[]>(`SELECT due_date FROM ${table} WHERE substr(due_date, 1, 7) = ?`, [month]);
      for (const row of rows) days.add(row.due_date);
    }
    expect(days.size).toBeGreaterThanOrEqual(10);
  });
});
