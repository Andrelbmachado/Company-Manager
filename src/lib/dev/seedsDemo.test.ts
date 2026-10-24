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

    await runAreaSeeds(DEMO_COMPANY_ID);
    expect(await db.select("SELECT count(*) AS n FROM products WHERE company_id=?", [DEMO_COMPANY_ID])).toEqual([{ n: products.length }]);
    expect(await db.select("SELECT count(*) AS n FROM finance_categories WHERE company_id=?", [DEMO_COMPANY_ID])).toEqual([{ n: categories.length }]);
  });
});
