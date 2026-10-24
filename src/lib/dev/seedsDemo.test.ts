// @vitest-environment jsdom
// Os seeds de área também rodam no banco demo do navegador (login rápido): o SQL deles tem de caber nos padrões do demo.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", async () => {
  const { getDemoDb } = await import("@/lib/db/demo");
  return { getDb: async () => getDemoDb(), isTauriRuntime: () => false };
});

type Row = Record<string, unknown>;

describe("seeds de área no banco demo", () => {
  it("rodam sem erro, ligam produtos ao estoque demo e não duplicam ao rodar de novo", async () => {
    localStorage.clear();
    const { runAreaSeeds, areaSeeds } = await import("./seeds");
    const { DEMO_COMPANY_ID, getDemoDb } = await import("@/lib/db/demo");
    const db = getDemoDb();

    const results = await runAreaSeeds(DEMO_COMPANY_ID);
    expect(results).toEqual(areaSeeds.map((seed) => ({ name: seed.name, ok: true })));

    const products = await db.select<Row[]>("SELECT * FROM products WHERE company_id=? AND deleted_at IS NULL", [DEMO_COMPANY_ID]);
    expect(products.length).toBeGreaterThanOrEqual(10);
    expect(products.some((product) => product.inventory_item_id === "item-2")).toBe(true);
    const categories = await db.select<Row[]>("SELECT * FROM finance_categories WHERE company_id=?", [DEMO_COMPANY_ID]);
    expect(categories.some((category) => category.parent_id != null)).toBe(true);

    // CRM, vendas, compras, estoque, RH, importação e extrato também sobem no demo (clientes, itens e fornecedores do demo).
    const tables = ["crm_activities", "proposal_items", "sales_orders", "invoices", "purchase_orders", "goods_receipts", "inventory_counts", "employees", "hr_time_entries", "import_batches", "recurring_entries", "finance_settlements", "bank_transactions", "stock_movements", "receivables", "payables"];
    const before: Record<string, number> = {};
    for (const table of tables) {
      const [{ n }] = await db.select<{ n: number }[]>(`SELECT count(*) AS n FROM ${table} WHERE company_id=?`, [DEMO_COMPANY_ID]);
      expect(n, table).toBeGreaterThan(0);
      before[table] = n;
    }

    await runAreaSeeds(DEMO_COMPANY_ID);
    expect(await db.select("SELECT count(*) AS n FROM products WHERE company_id=?", [DEMO_COMPANY_ID])).toEqual([{ n: products.length }]);
    expect(await db.select("SELECT count(*) AS n FROM finance_categories WHERE company_id=?", [DEMO_COMPANY_ID])).toEqual([{ n: categories.length }]);
    for (const table of tables) {
      expect(await db.select(`SELECT count(*) AS n FROM ${table} WHERE company_id=?`, [DEMO_COMPANY_ID]), table).toEqual([{ n: before[table] }]);
    }
    const balances = await db.select<Row[]>("SELECT * FROM stock_balances WHERE company_id=?", [DEMO_COMPANY_ID]);
    expect(balances.filter((row) => Number(row.quantity) < 0)).toEqual([]);
  });
});
