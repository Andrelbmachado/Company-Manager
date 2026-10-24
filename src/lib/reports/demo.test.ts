// @vitest-environment jsdom
// Os relatórios também rodam no banco demo do navegador: as consultas têm de caber nos padrões do demo (sem JOIN/SUM).
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", async () => {
  const { getDemoDb } = await import("@/lib/db/demo");
  return { getDb: async () => getDemoDb(), isTauriRuntime: () => false };
});

describe("relatórios no banco demo", () => {
  it("carregam e montam vendas, aging, giro e DRE com os dados de exemplo", async () => {
    localStorage.clear();
    const { runAreaSeeds } = await import("@/lib/dev/seeds");
    const { DEMO_COMPANY_ID, getDemoDb } = await import("@/lib/db/demo");
    const { todayIso } = await import("@/lib/utils");
    const { addDays, monthOf } = await import("./common");
    const sales = await import("./sales");
    const aging = await import("./aging");
    const stock = await import("./stock");
    const dre = await import("./dre");
    await runAreaSeeds(DEMO_COMPANY_ID);
    const db = getDemoDb();
    const today = todayIso();
    const period = { from: addDays(today, -365), to: today };

    const salesReport = sales.buildSalesReport(await sales.loadSalesData(db, DEMO_COMPANY_ID), period);
    expect(salesReport.orders).toBeGreaterThan(0);
    expect(salesReport.byProduct.length).toBeGreaterThan(0);
    expect(sales.salesTable(salesReport, "vendedor").rows.length).toBeGreaterThan(0);

    const agingData = await aging.loadAgingData(db, DEMO_COMPANY_ID);
    expect(aging.buildAgingReport(agingData, "receber", today).count).toBeGreaterThan(0);
    expect(aging.buildAgingReport(agingData, "pagar", today).count).toBeGreaterThan(0);

    const stockReport = stock.buildStockReport(await stock.loadStockData(db, DEMO_COMPANY_ID), period);
    expect(stockReport.rows.length).toBeGreaterThan(0);
    expect(stockReport.rows.every((row) => row.closing >= 0)).toBe(true);

    const dreReport = dre.buildDreReport(await dre.loadDreData(db, DEMO_COMPANY_ID), { endMonth: monthOf(today), months: 12 });
    expect(dreReport.lines.find((line) => line.key === "receita")!.total).toBeGreaterThan(0);
  });
});
