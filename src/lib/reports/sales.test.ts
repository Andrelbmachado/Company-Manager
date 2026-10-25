import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, insertTestCompany, type TestDb } from "@/test/sqlite";
import { formatCell } from "./export";
import { buildSalesReport, defaultGranularity, loadSalesData, salesTable, type SalesData } from "./sales";

const C = "test-company";
let db: TestDb;
let data: SalesData;

async function order(id: string, number: number, status: string, day: string, customer: string | null, seller: string | null, total: number, items: [string | null, string, number, number][], deleted = false) {
  await db.execute(
    "INSERT INTO sales_orders (id, company_id, number, customer_id, seller_id, status, order_date, subtotal, total, deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [id, C, number, customer, seller, status, day, total, total, deleted ? "2026-10-21T10:00:00.000Z" : null],
  );
  let position = 1;
  for (const [product, description, qty, itemTotal] of items) {
    await db.execute("INSERT INTO sales_order_items (id, company_id, order_id, product_id, description, qty, unit_price, total, position) VALUES (?,?,?,?,?,?,?,?,?)", [
      `${id}-i${position}`,
      C,
      id,
      product,
      description,
      qty,
      itemTotal / qty,
      itemTotal,
      position++,
    ]);
  }
}

beforeEach(async () => {
  db = await createTestDb();
  await insertTestCompany(db, { roles: ["ceo", "comercial"] });
  await db.execute("INSERT INTO customers (id, company_id, name) VALUES (?,?,?), (?,?,?)", ["c1", C, "Alfa Ltda", "c2", C, "Beta ME"]);
  await db.execute("INSERT INTO products (id, company_id, sku, name, price) VALUES (?,?,?,?,?), (?,?,?,?,?)", ["p1", C, "NB", "Notebook", 900, "p2", C, "MS", "Mouse", 50]);
  await order("so1", 1, "confirmado", "2026-10-02", "c1", "test-user-comercial", 1000, [["p1", "Notebook", 1, 900], ["p2", "Mouse", 2, 100]]);
  await order("so2", 2, "entregue", "2026-10-15", "c2", null, 500.5, [["p2", "Mouse", 5, 500.5]]);
  await order("so3", 3, "faturado", "2026-09-28", "c1", "test-user-comercial", 300, [["p1", "Notebook", 1, 300]]);
  await order("so4", 4, "cancelado", "2026-10-10", "c1", null, 999, [["p1", "Notebook", 1, 999]]);
  await order("so5", 5, "rascunho", "2026-10-11", "c2", null, 50, [["p2", "Mouse", 1, 50]]);
  await order("so6", 6, "confirmado", "2026-10-20", "c2", null, 77, [[null, "Serviço avulso", 1, 77]], true);
  await order("so7", 7, "confirmado", "2026-10-22", null, null, 40, [[null, "Instalação", 2, 40]]);
  data = await loadSalesData(db, C);
});

describe("relatório de vendas", () => {
  it("conta só pedidos confirmados, faturados e entregues do período (sem rascunho, cancelado e excluído)", () => {
    const report = buildSalesReport(data, { from: "2026-10-01", to: "2026-10-31" });
    expect(report.orders).toBe(3);
    expect(report.total).toBe(1540.5);
    expect(report.averageTicket).toBe(513.5);
  });

  it("agrupa por cliente, vendedor e produto, do maior para o menor, com participação", () => {
    const report = buildSalesReport(data, { from: "2026-10-01", to: "2026-10-31" });
    expect(report.byCustomer.map((row) => [row.label, row.orders, row.total, row.share])).toEqual([
      ["Alfa Ltda", 1, 1000, 64.9],
      ["Beta ME", 1, 500.5, 32.5],
      ["Sem cliente", 1, 40, 2.6],
    ]);
    expect(report.bySeller.map((row) => [row.label, row.total])).toEqual([
      ["Teste comercial", 1000],
      ["Sem vendedor", 540.5],
    ]);
    expect(report.byProduct.map((row) => [row.label, row.quantity, row.total, row.orders])).toEqual([
      ["Notebook", 1, 900, 1],
      ["Mouse", 7, 600.5, 2],
      ["Instalação", 2, 40, 1],
    ]);
  });

  it("série por dia (período curto, dias sem venda = 0) ou por mês", () => {
    expect(defaultGranularity("2026-10-01", "2026-10-31")).toBe("dia");
    expect(defaultGranularity("2026-01-01", "2026-10-31")).toBe("mes");
    const daily = buildSalesReport(data, { from: "2026-10-01", to: "2026-10-31" });
    expect(daily.granularity).toBe("dia");
    expect(daily.byPeriod).toHaveLength(31);
    expect(daily.byPeriod.find((row) => row.key === "2026-10-02")?.total).toBe(1000);
    expect(daily.byPeriod.find((row) => row.key === "2026-10-03")?.total).toBe(0);

    const monthly = buildSalesReport(data, { from: "2026-09-01", to: "2026-10-31", granularity: "mes" });
    expect(monthly.byPeriod.map((row) => [row.key, row.label, row.total, row.orders])).toEqual([
      ["2026-09", "set/2026", 300, 1],
      ["2026-10", "out/2026", 1540.5, 3],
    ]);
  });

  it("monta a tabela de exportação com linha de total", () => {
    const report = buildSalesReport(data, { from: "2026-10-01", to: "2026-10-31" });
    const table = salesTable(report, "cliente");
    expect(table.columns.map((column) => column.label)).toEqual(["Cliente", "Pedidos", "Total (R$)", "Participação (%)"]);
    expect(table.rows[0]).toEqual({ label: "Alfa Ltda", orders: 1, total: 1000, share: 64.9 });
    expect(table.totals).toEqual({ label: "Total", orders: 3, total: 1540.5, share: 100 });
    expect(table.fileName).toBe("relatorio-vendas-por-cliente-2026-10-01-a-2026-10-31");
    expect(salesTable(report, "produto").columns.map((column) => column.key)).toEqual(["label", "orders", "quantity", "total", "share"]);
  });

  it("série diária sai com a data completa na tabela e na exportação (dia/mês repete de um ano para outro)", () => {
    const daily = salesTable(buildSalesReport(data, { from: "2026-10-01", to: "2026-10-31" }), "periodo");
    expect(daily.columns[0]).toEqual({ key: "label", label: "Dia", kind: "date" });
    expect(daily.rows[1]).toEqual({ label: "2026-10-02", orders: 1, total: 1000, averageTicket: 1000 });
    expect(formatCell(daily.rows[1].label, "date")).toBe("02/10/2026");
    expect(daily.totals?.label).toBe("Total");

    const longDaily = salesTable(buildSalesReport(data, { from: "2025-10-01", to: "2026-10-31", granularity: "dia" }), "periodo");
    const labels = longDaily.rows.map((row) => formatCell(row.label, "date"));
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).toContain("02/10/2025");
    expect(labels).toContain("02/10/2026");

    const monthly = salesTable(buildSalesReport(data, { from: "2026-09-01", to: "2026-10-31", granularity: "mes" }), "periodo");
    expect(monthly.columns[0]).toEqual({ key: "label", label: "Mês", kind: "text" });
    expect(monthly.rows.map((row) => row.label)).toEqual(["set/2026", "out/2026"]);
  });
});
