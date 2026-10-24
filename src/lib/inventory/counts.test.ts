// Inventário (contagem) com SQLite real: abrir, contar, concluir com ajuste de falta/sobra e cancelar.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/test/sqlite";
import {
  addCountItem,
  cancelInventoryCount,
  finishInventoryCount,
  listInventoryCounts,
  loadInventoryCount,
  openInventoryCount,
  removeCountItem,
  setCountedQuantity,
  setCountItemNote,
} from "./counts";
import { recordStockMovement, StockError } from "./stock";
import { balanceOf, countRows, seedStockFixture } from "./testFixtures";

let db: TestDb;
let C: string;
let user: string;

beforeEach(async () => {
  db = await createTestDb();
  ({ companyId: C, userId: user } = await seedStockFixture(db));
});
afterEach(() => db.close());

type Row = Record<string, unknown>;

async function expectStockError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  expect(error, `esperava StockError(${code})`).toBeInstanceOf(StockError);
  expect((error as StockError).code).toBe(code);
}

async function countItems(countId: string) {
  return db.select<Row[]>("SELECT * FROM inventory_count_items WHERE count_id=? AND deleted_at IS NULL ORDER BY item_id", [countId]);
}

describe("openInventoryCount", () => {
  it("cria a contagem numerada com os itens que têm saldo no local e guarda o saldo do sistema", async () => {
    const first = await openInventoryCount(db, { companyId: C, locationId: "loc-a", userId: user, notes: "Contagem mensal" });
    expect(first.number).toBe(1);
    const [count] = await db.select<Row[]>("SELECT * FROM inventory_counts WHERE id=?", [first.id]);
    expect(count).toMatchObject({ company_id: C, number: 1, location_id: "loc-a", status: "aberta", counted_by: user, notes: "Contagem mensal", finished_at: null });

    const items = await countItems(first.id);
    expect(items.map((row) => [row.item_id, row.expected_qty, row.counted_qty, row.location_id])).toEqual([
      ["item-1", 10, null, "loc-a"],
      ["item-3", 4, null, "loc-a"],
    ]);

    const second = await openInventoryCount(db, { companyId: C, locationId: "loc-b", userId: user });
    expect(second.number).toBe(2);
  });

  it("com itens escolhidos, conta só esses (item sem saldo no local entra com 0)", async () => {
    const { id } = await openInventoryCount(db, { companyId: C, locationId: "loc-a", userId: user, itemIds: ["item-2", "item-1", "item-2"] });
    expect((await countItems(id)).map((row) => [row.item_id, row.expected_qty])).toEqual([["item-1", 10], ["item-2", 0]]);
  });

  it("não deixa abrir duas contagens ao mesmo tempo no mesmo local", async () => {
    await openInventoryCount(db, { companyId: C, locationId: "loc-a", userId: user });
    await expectStockError(openInventoryCount(db, { companyId: C, locationId: "loc-a", userId: user }), "contagem_aberta");
    await expectStockError(openInventoryCount(db, { companyId: C, locationId: "loc-x", userId: user }), "local_invalido");
    expect(await countRows(db, "inventory_counts")).toBe(1);
  });
});

describe("contagem", () => {
  it("registra a quantidade contada (zero vale; negativa e texto não) e só enquanto a contagem está aberta", async () => {
    const { id } = await openInventoryCount(db, { companyId: C, locationId: "loc-a", userId: user });
    const [first, second] = await countItems(id);
    await setCountedQuantity(db, { companyId: C, countItemId: String(first.id), countedQty: 9, notes: "Uma caixa amassada" });
    await setCountedQuantity(db, { companyId: C, countItemId: String(second.id), countedQty: 0 });
    await expectStockError(setCountedQuantity(db, { companyId: C, countItemId: String(second.id), countedQty: -1 }), "quantidade_invalida");
    await expectStockError(setCountedQuantity(db, { companyId: C, countItemId: String(second.id), countedQty: Number.NaN }), "quantidade_invalida");
    expect((await countItems(id)).map((row) => [row.counted_qty, row.notes])).toEqual([[9, "Uma caixa amassada"], [0, null]]);

    await setCountedQuantity(db, { companyId: C, countItemId: String(second.id), countedQty: null });
    expect((await countItems(id))[1].counted_qty).toBeNull();

    await cancelInventoryCount(db, { companyId: C, countId: id });
    await expectStockError(setCountedQuantity(db, { companyId: C, countItemId: String(first.id), countedQty: 1 }), "contagem_fechada");
  });

  it("a observação muda sozinha: não regrava a quantidade contada (a gravada por último não volta ao valor antigo)", async () => {
    const { id } = await openInventoryCount(db, { companyId: C, locationId: "loc-a", userId: user });
    const [first] = await countItems(id);
    await setCountedQuantity(db, { companyId: C, countItemId: String(first.id), countedQty: 9 });
    await setCountItemNote(db, { companyId: C, countItemId: String(first.id), notes: "  Uma caixa amassada " });
    expect((await countItems(id))[0]).toMatchObject({ counted_qty: 9, notes: "Uma caixa amassada" });
    await setCountItemNote(db, { companyId: C, countItemId: String(first.id), notes: "   " });
    expect((await countItems(id))[0]).toMatchObject({ counted_qty: 9, notes: null });

    await cancelInventoryCount(db, { companyId: C, countId: id });
    await expectStockError(setCountItemNote(db, { companyId: C, countItemId: String(first.id), notes: "x" }), "contagem_fechada");
    await expectStockError(setCountItemNote(db, { companyId: C, countItemId: "nao-existe", notes: "x" }), "contagem_invalida");
  });

  it("adiciona e remove itens da contagem aberta; item repetido é recusado", async () => {
    const { id } = await openInventoryCount(db, { companyId: C, locationId: "loc-b", userId: user });
    expect((await countItems(id)).map((row) => row.item_id)).toEqual(["item-3"]);
    const added = await addCountItem(db, { companyId: C, countId: id, itemId: "item-1" });
    await expectStockError(addCountItem(db, { companyId: C, countId: id, itemId: "item-1" }), "item_repetido");
    expect((await countItems(id)).map((row) => [row.item_id, row.expected_qty])).toEqual([["item-1", 0], ["item-3", 3]]);
    await removeCountItem(db, { companyId: C, countItemId: added });
    expect((await countItems(id)).map((row) => row.item_id)).toEqual(["item-3"]);
    // Removido pode voltar.
    await addCountItem(db, { companyId: C, countId: id, itemId: "item-1" });
    expect((await countItems(id)).map((row) => row.item_id)).toEqual(["item-1", "item-3"]);
  });
});

describe("finishInventoryCount", () => {
  it("concluir ajusta o estoque: falta sai do local, sobra entra, igual não gera movimentação", async () => {
    await db.execute("INSERT INTO stock_balances (id, company_id, item_id, location_id, quantity) VALUES ('bal-2a', ?, 'item-2', 'loc-a', 3)", [C]);
    const { id } = await openInventoryCount(db, { companyId: C, locationId: "loc-a", userId: user });
    const items = await countItems(id);
    const counted: Record<string, number> = { "item-1": 8, "item-2": 3, "item-3": 6 };
    for (const row of items) await setCountedQuantity(db, { companyId: C, countItemId: String(row.id), countedQty: counted[String(row.item_id)] });

    const result = await finishInventoryCount(db, { companyId: C, countId: id, userId: user });
    expect(result.movementIds).toHaveLength(2);
    expect(await balanceOf(db, "item-1", "loc-a")).toBe(8);
    expect(await balanceOf(db, "item-2", "loc-a")).toBe(3);
    expect(await balanceOf(db, "item-3", "loc-a")).toBe(6);

    const movements = await db.select<Row[]>("SELECT * FROM stock_movements ORDER BY item_id");
    expect(movements.map((row) => [row.item_id, row.type, row.quantity, row.from_location_id, row.to_location_id, row.ref_type, row.ref_id])).toEqual([
      ["item-1", "ajuste", 2, "loc-a", null, "inventory_count", id],
      ["item-3", "ajuste", 2, null, "loc-a", "inventory_count", id],
    ]);

    const [count] = await db.select<Row[]>("SELECT * FROM inventory_counts WHERE id=?", [id]);
    expect(count.status).toBe("concluida");
    expect(count.finished_at).toBeTruthy();
    const after = await countItems(id);
    expect(after.map((row) => [row.item_id, row.expected_qty, row.counted_qty, row.adjustment_movement_id != null])).toEqual([
      ["item-1", 10, 8, true],
      ["item-2", 3, 3, false],
      ["item-3", 4, 6, true],
    ]);

    // Concluída não volta a ajustar.
    await expectStockError(finishInventoryCount(db, { companyId: C, countId: id, userId: user }), "contagem_fechada");
    expect(await countRows(db, "stock_movements")).toBe(2);
  });

  it("não conclui com item sem contagem, e nada muda", async () => {
    const { id } = await openInventoryCount(db, { companyId: C, locationId: "loc-a", userId: user });
    const [first] = await countItems(id);
    await setCountedQuantity(db, { companyId: C, countItemId: String(first.id), countedQty: 1 });
    await expectStockError(finishInventoryCount(db, { companyId: C, countId: id, userId: user }), "contagem_incompleta");
    expect(await balanceOf(db, "item-1", "loc-a")).toBe(10);
    expect(await countRows(db, "stock_movements")).toBe(0);
    const [count] = await db.select<Row[]>("SELECT * FROM inventory_counts WHERE id=?", [id]);
    expect(count.status).toBe("aberta");
  });

  it("o ajuste parte do saldo atual: o que se movimentou durante a contagem não é ajustado de novo", async () => {
    const { id } = await openInventoryCount(db, { companyId: C, locationId: "loc-a", userId: user });
    // Durante a contagem saem 2 caixas (venda); a contagem física já vê 8.
    await recordStockMovement(db, { companyId: C, itemId: "item-1", type: "saida", quantity: 2, fromLocationId: "loc-a" });
    for (const row of await countItems(id)) {
      await setCountedQuantity(db, { companyId: C, countItemId: String(row.id), countedQty: row.item_id === "item-1" ? 8 : 4 });
    }
    const result = await finishInventoryCount(db, { companyId: C, countId: id, userId: user });
    expect(result.movementIds).toHaveLength(0);
    expect(await balanceOf(db, "item-1", "loc-a")).toBe(8);
    const after = await countItems(id);
    expect(after[0]).toMatchObject({ item_id: "item-1", expected_qty: 8, counted_qty: 8 });
  });

  it("item excluído do estoque durante a contagem: a conclusão diz qual é, não ajusta nada e conclui depois de retirá-lo", async () => {
    const { id } = await openInventoryCount(db, { companyId: C, locationId: "loc-a", userId: user });
    for (const row of await countItems(id)) await setCountedQuantity(db, { companyId: C, countItemId: String(row.id), countedQty: 1 });
    await db.execute("UPDATE inventory_items SET deleted_at=datetime('now') WHERE id='item-3'");

    const error = await finishInventoryCount(db, { companyId: C, countId: id, userId: user }).then(() => null, (caught: unknown) => caught);
    expect(error).toBeInstanceOf(StockError);
    expect((error as StockError).code).toBe("item_invalido");
    expect((error as StockError).message).toContain("Mouse USB");
    expect(await countRows(db, "stock_movements")).toBe(0);

    const mouse = (await countItems(id)).find((row) => row.item_id === "item-3")!;
    await removeCountItem(db, { companyId: C, countItemId: String(mouse.id) });
    const result = await finishInventoryCount(db, { companyId: C, countId: id, userId: user });
    expect(result.movementIds).toHaveLength(1);
    expect(await balanceOf(db, "item-1", "loc-a")).toBe(1);
  });

  it("contagem vazia ou cancelada não conclui; cancelar só a aberta", async () => {
    await db.execute("INSERT INTO stock_locations (id, company_id, name) VALUES ('loc-c', ?, 'Vazio')", [C]);
    const empty = await openInventoryCount(db, { companyId: C, locationId: "loc-c", userId: user });
    await expectStockError(finishInventoryCount(db, { companyId: C, countId: empty.id, userId: user }), "sem_itens");

    await cancelInventoryCount(db, { companyId: C, countId: empty.id });
    const [count] = await db.select<Row[]>("SELECT * FROM inventory_counts WHERE id=?", [empty.id]);
    expect(count.status).toBe("cancelada");
    await expectStockError(cancelInventoryCount(db, { companyId: C, countId: empty.id }), "contagem_fechada");
    await expectStockError(finishInventoryCount(db, { companyId: C, countId: empty.id, userId: user }), "contagem_fechada");
    await expectStockError(finishInventoryCount(db, { companyId: C, countId: "nao-existe", userId: user }), "contagem_invalida");

    // Cancelada libera o local para uma contagem nova.
    await openInventoryCount(db, { companyId: C, locationId: "loc-c", userId: user });
  });
});

describe("leitura para as telas", () => {
  it("lista as contagens com local, progresso e divergências; carrega a contagem com nome do item e saldo atual", async () => {
    const { id } = await openInventoryCount(db, { companyId: C, locationId: "loc-a", userId: user });
    const [first] = await countItems(id);
    await setCountedQuantity(db, { companyId: C, countItemId: String(first.id), countedQty: 7 });
    await openInventoryCount(db, { companyId: C, locationId: "loc-b", userId: user });

    const list = await listInventoryCounts(db, C);
    expect(list.map((row) => [row.number, row.location_name, row.item_count, row.counted_count, row.divergent_count])).toEqual([
      [2, "Loja", 1, 0, 0],
      [1, "Depósito Central", 2, 1, 1],
    ]);

    const detail = await loadInventoryCount(db, C, id);
    expect(detail?.count).toMatchObject({ id, number: 1, location_name: "Depósito Central", counted_by_name: "Teste estoquista" });
    expect(detail?.items.map((row) => [row.item_name, row.sku, row.unit, row.expected_qty, row.counted_qty, row.current_qty])).toEqual([
      ["Cabo Cat6", "ITEM-1", "cx", 10, 7, 10],
      ["Mouse USB", "ITEM-3", "un", 4, null, 4],
    ]);
    expect(await loadInventoryCount(db, C, "nao-existe")).toBeNull();
  });

  it("na lista, a diferença da contagem aberta é contra o saldo de agora (a mesma conta da folha e da conclusão)", async () => {
    const { id } = await openInventoryCount(db, { companyId: C, locationId: "loc-a", userId: user });
    const cabo = (await countItems(id)).find((row) => row.item_id === "item-1")!;
    await setCountedQuantity(db, { companyId: C, countItemId: String(cabo.id), countedQty: 8 });
    expect((await listInventoryCounts(db, C))[0].divergent_count).toBe(1);

    // Saem 2 caixas durante a contagem: o sistema passa a ter 8, igual ao contado, e a conclusão não ajusta nada.
    await recordStockMovement(db, { companyId: C, itemId: "item-1", type: "saida", quantity: 2, fromLocationId: "loc-a" });
    expect((await listInventoryCounts(db, C))[0].divergent_count).toBe(0);
    const line = (await loadInventoryCount(db, C, id))!.items.find((row) => row.item_id === "item-1")!;
    expect(Number(line.counted_qty) - line.current_qty).toBe(0);
  });
});
