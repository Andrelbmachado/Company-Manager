// Leituras das telas de estoque (SQLite real).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/test/sqlite";
import { groupTransfers, instant, isAtReorderPoint, listStockMovements, loadStockSnapshot, movementOriginPath, signedQuantityAt } from "./queries";
import { recordStockMovement, transferStock } from "./stock";
import { seedStockFixture } from "./testFixtures";

let db: TestDb;
let C: string;
let user: string;

beforeEach(async () => {
  db = await createTestDb();
  ({ companyId: C, userId: user } = await seedStockFixture(db));
});
afterEach(() => db.close());

describe("loadStockSnapshot", () => {
  it("itens ativos por nome com saldo total e por local, fornecedor e locais ativos", async () => {
    await db.execute("UPDATE inventory_items SET deleted_at=datetime('now') WHERE id='item-4'");
    const snapshot = await loadStockSnapshot(db, C);
    expect(snapshot.locations.map((row) => row.name)).toEqual(["Depósito Central", "Loja"]);
    expect(snapshot.items.map((row) => [row.name, row.total, row.byLocation, row.supplier?.name ?? null])).toEqual([
      ["Cabo Cat6", 10, { "loc-a": 10 }, "NetPrime"],
      ["Mouse USB", 7, { "loc-a": 4, "loc-b": 3 }, "ByteCenter"],
      ["Switch 24p", 0, {}, "NetPrime"],
    ]);
  });
});

describe("listStockMovements e groupTransfers", () => {
  it("movimentações da mais recente para a mais antiga, com item, locais e responsável; transferências agrupadas", async () => {
    await db.execute(
      "INSERT INTO stock_movements (id, company_id, item_id, type, quantity, to_location_id, created_at) VALUES ('old', ?, 'item-1', 'entrada', 10, 'loc-a', '2026-01-01 10:00:00')",
      [C],
    );
    await recordStockMovement(db, { companyId: C, itemId: "item-1", type: "saida", quantity: 1, fromLocationId: "loc-a", userId: user });
    const transfer = await transferStock(db, { companyId: C, fromLocationId: "loc-a", toLocationId: "loc-b", lines: [{ itemId: "item-1", quantity: 2 }, { itemId: "item-3", quantity: 1 }], userId: user, note: "Vitrine" });

    const rows = await listStockMovements(db, C);
    expect(rows).toHaveLength(4);
    expect(rows[rows.length - 1].id).toBe("old");
    const saida = rows.find((row) => row.type === "saida")!;
    expect(saida).toMatchObject({ item_name: "Cabo Cat6", item_unit: "cx", sku: "ITEM-1", from_name: "Depósito Central", to_name: null, user_name: "Teste estoquista", quantity: 1 });
    expect(await listStockMovements(db, C, { limit: 2 })).toHaveLength(2);

    const transfers = groupTransfers(rows);
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({ id: transfer.transferId, from_name: "Depósito Central", to_name: "Loja", user_name: "Teste estoquista", note: "Vitrine" });
    expect(transfers[0].lines.map((line) => [line.item_name, line.quantity]).sort()).toEqual([["Cabo Cat6", 2], ["Mouse USB", 1]]);
  });
});

describe("utilitários", () => {
  it("ponto de reposição, sinal no local, link da origem e datas do SQLite", () => {
    expect(isAtReorderPoint(5, 5)).toBe(true);
    expect(isAtReorderPoint(5.001, 5)).toBe(false);
    expect(isAtReorderPoint(5.0001, 5)).toBe(true); // quantidades têm 3 casas
    expect(isAtReorderPoint(0, 0)).toBe(false);
    expect(signedQuantityAt({ quantity: 3, from_location_id: "a", to_location_id: "b" }, "a")).toBe(-3);
    expect(signedQuantityAt({ quantity: 3, from_location_id: "a", to_location_id: "b" }, "b")).toBe(3);
    expect(signedQuantityAt({ quantity: 3, from_location_id: "a", to_location_id: "b" }, "c")).toBe(0);
    expect(movementOriginPath("inventory_count", "c1")).toBe("/inventory/inventarios/c1");
    expect(movementOriginPath("sales_order", "o1")).toBe("/sales/pedidos/o1");
    expect(movementOriginPath("manual", "x")).toBeNull();
    expect(instant("2026-01-01 10:00:00")).toBe(Date.UTC(2026, 0, 1, 10));
    expect(instant("2026-01-01T10:00:00.000Z")).toBe(Date.UTC(2026, 0, 1, 10));
    expect(instant(null)).toBe(0);
  });
});
