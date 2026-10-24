// @vitest-environment jsdom
// O estoque também roda no banco demo do navegador (localStorage), que só entende SQL simples: SQL fora dos padrões é erro.
import { beforeEach, describe, expect, it } from "vitest";
import { createDemoDb, DEMO_COMPANY_ID, type DatabaseLike } from "@/lib/db/demo";
import { cancelInventoryCount, finishInventoryCount, listInventoryCounts, loadInventoryCount, openInventoryCount, setCountedQuantity, addCountItem, removeCountItem } from "./counts";
import { archiveStockLocation, listLocationSummaries, saveStockLocation } from "./locations";
import { groupTransfers, listStockMovements, loadStockSnapshot } from "./queries";
import { createReorderPurchaseOrders, reorderSuggestions } from "./reorder";
import { recordStockMovement, StockError, transferStock } from "./stock";

const C = DEMO_COMPANY_ID;
const MAIN = "demo-stock-location";
const USER = "demo-admin";

beforeEach(() => localStorage.clear());

async function quantity(db: DatabaseLike, itemId: string, locationId: string): Promise<number> {
  const snapshot = await loadStockSnapshot(db, C);
  return snapshot.items.find((item) => item.id === itemId)?.byLocation[locationId] ?? 0;
}

describe("estoque no banco demo", () => {
  it("locais, entradas, saídas, transferências e saldo insuficiente", async () => {
    const db = createDemoDb();
    const before = await loadStockSnapshot(db, C);
    expect(before.items.length).toBeGreaterThan(0);
    expect(before.locations.map((row) => row.id)).toContain(MAIN);

    const store = await saveStockLocation(db, { companyId: C, name: "Loja do centro", type: "loja" });
    await expect(saveStockLocation(db, { companyId: C, name: "loja do CENTRO" })).rejects.toBeInstanceOf(StockError);

    const startMouse = await quantity(db, "item-5", MAIN);
    await recordStockMovement(db, { companyId: C, itemId: "item-5", type: "entrada", quantity: 5, toLocationId: MAIN, userId: USER });
    await recordStockMovement(db, { companyId: C, itemId: "item-5", type: "saida", quantity: 2, fromLocationId: MAIN, userId: USER });
    expect(await quantity(db, "item-5", MAIN)).toBe(startMouse + 3);

    const transfer = await transferStock(db, { companyId: C, fromLocationId: MAIN, toLocationId: store, lines: [{ itemId: "item-5", quantity: 4 }], userId: USER, note: "Vitrine" });
    expect(await quantity(db, "item-5", MAIN)).toBe(startMouse - 1);
    expect(await quantity(db, "item-5", store)).toBe(4);
    await expect(transferStock(db, { companyId: C, fromLocationId: store, toLocationId: MAIN, lines: [{ itemId: "item-5", quantity: 5 }] })).rejects.toMatchObject({ code: "saldo_insuficiente" });
    expect(await quantity(db, "item-5", store)).toBe(4);

    const movements = await listStockMovements(db, C);
    expect(movements).toHaveLength(3);
    expect(movements.find((row) => row.type === "transferencia")).toMatchObject({ item_name: "Mouse USB corporativo", from_name: "Depósito principal", to_name: "Loja do centro", user_name: "Mariana Costa" });
    expect(groupTransfers(movements).map((row) => row.id)).toEqual([transfer.transferId]);

    // Saldo que mudou "por fora" entre a leitura e a gravação: o compare-and-set do demo também recusa.
    let raced = false;
    const racing: DatabaseLike = {
      select: (sql, binds) => db.select(sql, binds),
      execute: async (sql, binds) => {
        if (!raced && /UPDATE stock_balances/i.test(sql)) {
          raced = true;
          await db.execute("UPDATE stock_balances SET quantity=? WHERE company_id=? AND item_id=? AND location_id=?", [1, C, "item-5", store]);
        }
        return db.execute(sql, binds);
      },
    };
    await expect(recordStockMovement(racing, { companyId: C, itemId: "item-5", type: "saida", quantity: 3, fromLocationId: store })).rejects.toMatchObject({ code: "conflito" });
    expect(await quantity(db, "item-5", store)).toBe(1);

    const summaries = await listLocationSummaries(db, C);
    expect(summaries.find((row) => row.id === store)).toMatchObject({ item_count: 1, total_qty: 1 });
    await expect(archiveStockLocation(db, { companyId: C, locationId: store })).rejects.toMatchObject({ code: "local_com_saldo" });
    await recordStockMovement(db, { companyId: C, itemId: "item-5", type: "saida", quantity: 1, fromLocationId: store });
    await archiveStockLocation(db, { companyId: C, locationId: store });
    expect((await listLocationSummaries(db, C)).some((row) => row.id === store)).toBe(false);
  });

  it("contagem de inventário do começo ao fim", async () => {
    const db = createDemoDb();
    const { id, number } = await openInventoryCount(db, { companyId: C, locationId: MAIN, userId: USER });
    expect(number).toBe(1);
    let detail = await loadInventoryCount(db, C, id);
    expect(detail!.items.length).toBeGreaterThan(1);
    const extra = await addCountItem(db, { companyId: C, countId: id, itemId: detail!.items[0].item_id }).catch((error: unknown) => error);
    expect(extra).toBeInstanceOf(StockError);

    for (const [index, line] of detail!.items.entries()) {
      await setCountedQuantity(db, { companyId: C, countItemId: line.id, countedQty: index === 0 ? Number(line.expected_qty) + 2 : Number(line.expected_qty), notes: index === 0 ? "Caixa achada" : undefined });
    }
    const first = detail!.items[0];
    const result = await finishInventoryCount(db, { companyId: C, countId: id, userId: USER });
    expect(result.movementIds).toHaveLength(1);
    expect(await quantity(db, first.item_id, MAIN)).toBe(Number(first.expected_qty) + 2);
    detail = await loadInventoryCount(db, C, id);
    expect(detail!.count).toMatchObject({ status: "concluida", location_name: "Depósito principal" });
    expect((await listInventoryCounts(db, C))[0]).toMatchObject({ number: 1, divergent_count: 1 });

    const second = await openInventoryCount(db, { companyId: C, locationId: MAIN, userId: USER, itemIds: [first.item_id] });
    const [line] = (await loadInventoryCount(db, C, second.id))!.items;
    await removeCountItem(db, { companyId: C, countItemId: line.id });
    await cancelInventoryCount(db, { companyId: C, countId: second.id });
    expect((await listInventoryCounts(db, C)).map((row) => row.status)).toEqual(["cancelada", "concluida"]);
  });

  it("sugestão de compra e pedido em rascunho", async () => {
    const db = createDemoDb();
    const suggestions = await reorderSuggestions(db, C);
    expect(suggestions.length).toBeGreaterThan(0);
    const created = await createReorderPurchaseOrders(db, { companyId: C, userId: USER, locationId: MAIN, lines: suggestions.map((row) => ({ itemId: row.item_id, qty: row.suggested_qty })) });
    expect(created.length).toBeGreaterThan(0);
    expect(await reorderSuggestions(db, C)).toEqual([]);
  });
});
