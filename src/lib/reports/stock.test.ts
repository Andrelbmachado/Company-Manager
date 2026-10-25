import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, insertTestCompany, type TestDb } from "@/test/sqlite";
import { buildStockReport, loadStockData, stockTable, type StockData } from "./stock";

const C = "test-company";
const PERIOD = { from: "2026-09-21", to: "2026-10-20" };
let db: TestDb;
let data: StockData;
let movement = 0;

/** Instante local (10h) do dia: o relatório agrupa movimentações pelo dia local. */
function at(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date, 10).toISOString();
}

async function move(item: string, type: string, quantity: number, from: string | null, to: string | null, day: string, refType: string | null = null) {
  await db.execute("INSERT INTO stock_movements (id, company_id, item_id, type, quantity, from_location_id, to_location_id, ref_type, created_at) VALUES (?,?,?,?,?,?,?,?,?)", [
    `m${++movement}`,
    C,
    item,
    type,
    quantity,
    from,
    to,
    refType,
    at(day),
  ]);
}

beforeEach(async () => {
  db = await createTestDb();
  await insertTestCompany(db);
  await db.execute("INSERT INTO stock_locations (id, company_id, name) VALUES (?,?,?), (?,?,?)", ["l1", C, "Depósito", "l2", C, "Loja"]);
  await db.execute("INSERT INTO inventory_items (id, company_id, name, sku, unit, cost, deleted_at) VALUES (?,?,?,?,?,?,?), (?,?,?,?,?,?,?), (?,?,?,?,?,?,?), (?,?,?,?,?,?,?)", [
    "i1", C, "Cabo HDMI", "CB-1", "un", 10, null,
    "i2", C, "Mouse", "MS-1", "un", 25.5, null,
    "i3", C, "Teclado", null, "un", 50, null,
    "i4", C, "Item excluído", null, "un", 1, "2026-10-01T10:00:00.000Z",
  ]);
  await db.execute("INSERT INTO stock_balances (id, company_id, item_id, location_id, quantity) VALUES (?,?,?,?,?), (?,?,?,?,?), (?,?,?,?,?)", [
    "b1", C, "i1", "l1", 40,
    "b2", C, "i1", "l2", 10,
    "b3", C, "i2", "l1", 4,
  ]);
  await move("i1", "entrada", 100, null, "l1", "2026-09-01");
  await move("i1", "saida", 30, "l1", null, "2026-09-10");
  await move("i1", "saida", 20, "l1", null, "2026-10-05", "sales_order");
  await move("i1", "transferencia", 10, "l1", "l2", "2026-10-06");
  await move("i1", "entrada", 10, null, "l1", "2026-10-10");
  await move("i1", "ajuste", 5, "l1", null, "2026-10-15", "inventory_count");
  await move("i1", "saida", 5, "l1", null, "2026-10-22");
  await move("i2", "entrada", 4, null, "l1", "2026-08-01");
  data = await loadStockData(db, C);
});

describe("giro de estoque", () => {
  it("reconstrói saldo inicial e final do período a partir do saldo atual e das movimentações", () => {
    const report = buildStockReport(data, PERIOD);
    const cabo = report.rows.find((row) => row.itemId === "i1")!;
    expect(cabo).toMatchObject({ opening: 70, closing: 55, inQty: 10, outQty: 20, currentBalance: 50 });
    expect(cabo.averageBalance).toBe(62.5);
  });

  it("giro = saídas ÷ saldo médio; cobertura em dias; ajuste de inventário e transferência não contam como saída", () => {
    const cabo = buildStockReport(data, PERIOD).rows.find((row) => row.itemId === "i1")!;
    expect(cabo.turnover).toBe(0.32);
    expect(cabo.coverageDays).toBe(83);
    expect(cabo.lastMovement).toBe("2026-10-15");
    expect(cabo.idleDays).toBe(5);
    expect(cabo.value).toBe(550);
    expect(cabo.idle).toBe(false);
  });

  it("item com saldo e sem saída no período é parado; sem saldo não é; excluído não entra", () => {
    const report = buildStockReport(data, PERIOD);
    expect(report.rows.map((row) => row.name)).toEqual(["Cabo HDMI", "Mouse", "Teclado"]);
    const mouse = report.rows.find((row) => row.itemId === "i2")!;
    expect(mouse).toMatchObject({ outQty: 0, turnover: 0, coverageDays: null, lastMovement: "2026-08-01", idleDays: 80, idle: true, value: 102 });
    const teclado = report.rows.find((row) => row.itemId === "i3")!;
    expect(teclado).toMatchObject({ closing: 0, turnover: null, lastMovement: null, idleDays: null, idle: false, value: 0 });
    expect(report.totals).toEqual({ items: 3, value: 652, idleItems: 1, idleValue: 102 });
  });

  it("tabela de exportação, com filtro de itens parados", () => {
    const report = buildStockReport(data, PERIOD);
    const table = stockTable(report);
    expect(table.columns.map((column) => column.label)).toEqual([
      "Item",
      "SKU",
      "Unid.",
      "Saldo inicial",
      "Entradas",
      "Saídas",
      "Saldo final",
      "Giro",
      "Cobertura (dias)",
      "Última movimentação",
      "Dias sem movimento",
      "Valor em estoque (R$)",
    ]);
    expect(table.rows).toHaveLength(3);
    expect(table.totals).toMatchObject({ name: "Total (3 itens)", value: 652 });
    expect(table.fileName).toBe("giro-de-estoque-2026-09-21-a-2026-10-20");
    const idle = stockTable(report, { onlyIdle: true });
    expect(idle.rows.map((row) => row.name)).toEqual(["Mouse"]);
    expect(idle.fileName).toBe("itens-parados-2026-09-21-a-2026-10-20");
  });
});
