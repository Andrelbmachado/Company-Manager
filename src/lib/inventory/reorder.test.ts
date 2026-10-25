// Ponto de reposição e sugestão de compra (SQLite real).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/test/sqlite";
import type { DatabaseLike } from "@/lib/db/demo";
import { createReorderPurchaseOrders, reorderSuggestions, suggestReorderQty } from "./reorder";
import { StockError } from "./stock";
import { seedStockFixture } from "./testFixtures";

let db: TestDb;
let C: string;
let user: string;

beforeEach(async () => {
  db = await createTestDb();
  ({ companyId: C, userId: user } = await seedStockFixture(db));
});
afterEach(() => db.close());

type Row = Record<string, unknown>;

describe("suggestReorderQty", () => {
  it("só sugere no ponto de reposição ou abaixo; repõe até o máximo (sem máximo, o dobro do mínimo); arredonda para cima", () => {
    expect(suggestReorderQty({ onHand: 6, onOrder: 0, minStock: 5, maxStock: 20 })).toBe(0);
    expect(suggestReorderQty({ onHand: 5, onOrder: 0, minStock: 5, maxStock: 20 })).toBe(15);
    expect(suggestReorderQty({ onHand: 2, onOrder: 0, minStock: 5, maxStock: null })).toBe(8);
    expect(suggestReorderQty({ onHand: 2.5, onOrder: 0, minStock: 5, maxStock: 10 })).toBe(8);
    // O que já está pedido conta como estoque a caminho.
    expect(suggestReorderQty({ onHand: 2, onOrder: 4, minStock: 5, maxStock: 10 })).toBe(0);
    expect(suggestReorderQty({ onHand: 0, onOrder: 4, minStock: 5, maxStock: 10 })).toBe(6);
    // Sem mínimo não há ponto de reposição; máximo menor que o mínimo vale como não informado.
    expect(suggestReorderQty({ onHand: 0, onOrder: 0, minStock: 0, maxStock: 10 })).toBe(0);
    expect(suggestReorderQty({ onHand: 1, onOrder: 0, minStock: 4, maxStock: 3 })).toBe(7);
  });
});

describe("reorderSuggestions", () => {
  it("lista os itens no ponto de reposição somando todos os locais, com o que já está em pedido de compra aberto (por fornecedor)", async () => {
    // item-1: 10 (mín. 5) → fora. item-2: 0 (mín. 2, máx. 6) → 6. item-3: 4 + 3 = 7 (mín. 10, sem máx.) → 13. item-4: sem mínimo → fora.
    let list = await reorderSuggestions(db, C);
    expect(list.map((row) => [row.item_id, row.on_hand, row.on_order, row.suggested_qty, row.supplier_name])).toEqual([
      ["item-3", 7, 0, 13, "ByteCenter"],
      ["item-2", 0, 0, 6, "NetPrime"],
    ]);
    expect(list[0].estimated_cost).toBe(635.7);
    expect(list[1].estimated_cost).toBe(13083);

    // Pedido aberto com 5 Mouse USB, 2 já recebidos (faltam 3: 7 + 3 = 10, ainda no ponto); pedido cancelado e item excluído não contam.
    await db.execute("INSERT INTO purchase_orders (id, company_id, number, supplier_id, status) VALUES ('po-1', ?, 1, 'sup-2', 'enviado')", [C]);
    await db.execute("INSERT INTO purchase_order_items (id, company_id, order_id, inventory_item_id, description, qty, received_qty) VALUES ('poi-1', ?, 'po-1', 'item-3', 'Mouse', 5, 2)", [C]);
    await db.execute("INSERT INTO purchase_order_items (id, company_id, order_id, inventory_item_id, description, qty, deleted_at) VALUES ('poi-2', ?, 'po-1', 'item-3', 'Mouse', 50, datetime('now'))", [C]);
    await db.execute("INSERT INTO purchase_orders (id, company_id, number, supplier_id, status) VALUES ('po-2', ?, 2, 'sup-1', 'cancelado')", [C]);
    await db.execute("INSERT INTO purchase_order_items (id, company_id, order_id, inventory_item_id, description, qty) VALUES ('poi-3', ?, 'po-2', 'item-2', 'Switch', 6)", [C]);
    list = await reorderSuggestions(db, C);
    expect(list.map((row) => [row.item_id, row.on_order, row.suggested_qty])).toEqual([
      ["item-3", 3, 10],
      ["item-2", 0, 6],
    ]);
    // Com mais 1 unidade pedida a posição (7 + 4) passa do ponto e o item sai.
    await db.execute("UPDATE purchase_order_items SET qty=6 WHERE id='poi-1'");
    expect((await reorderSuggestions(db, C)).map((row) => row.item_id)).toEqual(["item-2"]);
  });

  it("item que já tem pedido suficiente sai da lista", async () => {
    await db.execute("INSERT INTO purchase_orders (id, company_id, number, supplier_id, status) VALUES ('po-1', ?, 1, 'sup-1', 'rascunho')", [C]);
    await db.execute("INSERT INTO purchase_order_items (id, company_id, order_id, inventory_item_id, description, qty) VALUES ('poi-1', ?, 'po-1', 'item-2', 'Switch', 6)", [C]);
    expect((await reorderSuggestions(db, C)).map((row) => row.item_id)).toEqual(["item-3"]);
  });
});

describe("createReorderPurchaseOrders", () => {
  it("gera um pedido de compra em rascunho por fornecedor, numerado, com itens a preço de custo e totais em centavos", async () => {
    await db.execute("INSERT INTO products (id, company_id, sku, name, kind, inventory_item_id) VALUES ('prod-2', ?, 'SW-24', 'Switch 24p', 'produto', 'item-2')", [C]);
    const created = await createReorderPurchaseOrders(db, {
      companyId: C,
      userId: user,
      locationId: "loc-a",
      lines: [{ itemId: "item-2", qty: 2 }, { itemId: "item-3", qty: 13 }, { itemId: "item-4", qty: 2 }],
    });
    expect(created.map((row) => [row.number, row.supplier_id, row.total, row.item_count])).toEqual([
      [1, "sup-2", 635.7, 1],
      [2, "sup-1", 4361, 1],
      [3, null, 1040, 1],
    ]);

    const orders = await db.select<Row[]>("SELECT * FROM purchase_orders ORDER BY number");
    expect(orders[1]).toMatchObject({ company_id: C, number: 2, supplier_id: "sup-1", status: "rascunho", location_id: "loc-a", subtotal: 4361, total: 4361, created_by: user, installments: 1 });
    expect(String(orders[1].order_date)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const items = await db.select<Row[]>("SELECT * FROM purchase_order_items WHERE order_id=?", [orders[1].id]);
    expect(items).toEqual([expect.objectContaining({ inventory_item_id: "item-2", product_id: "prod-2", description: "Switch 24p", unit: "un", qty: 2, unit_price: 2180.5, total: 4361, received_qty: 0, position: 1 })]);

    // O que foi pedido passa a contar como "em pedido": 0 + 2 ainda está no ponto (mín. 2) e sugere o resto até o máximo.
    const after = await reorderSuggestions(db, C);
    expect(after.map((row) => [row.item_id, row.on_order, row.suggested_qty])).toEqual([["item-2", 2, 4]]);
  });

  it("custo com mais de 2 casas: a sugestão usa o mesmo preço em centavos do pedido, e a estimativa bate com o total gerado", async () => {
    await db.execute("UPDATE inventory_items SET cost=10.555 WHERE id='item-3'");
    const mouse = (await reorderSuggestions(db, C)).find((row) => row.item_id === "item-3")!;
    expect(mouse.suggested_qty).toBe(13);
    expect(mouse.cost).toBe(10.56);
    expect(mouse.estimated_cost).toBe(137.28);

    const [order] = await createReorderPurchaseOrders(db, { companyId: C, userId: user, lines: [{ itemId: "item-3", qty: mouse.suggested_qty }] });
    expect(order.total).toBe(mouse.estimated_cost);
    const [line] = await db.select<Row[]>("SELECT * FROM purchase_order_items WHERE order_id=?", [order.id]);
    expect(line).toMatchObject({ unit_price: 10.56, total: 137.28 });
  });

  it("falha no meio dos itens de um pedido: o pedido incompleto é excluído (soft delete), sem total que não bate com os itens", async () => {
    // Switch 24p e Mouse USB do mesmo fornecedor: um pedido só, com dois itens; o segundo item falha ao gravar.
    await db.execute("UPDATE inventory_items SET supplier_id='sup-1' WHERE id='item-3'");
    let lineInserts = 0;
    const failing: DatabaseLike = {
      select: (sql, binds) => db.select(sql, binds),
      execute: async (sql, binds) => {
        if (/INSERT INTO purchase_order_items/i.test(sql) && ++lineInserts === 2) throw new Error("disco cheio");
        return db.execute(sql, binds);
      },
    };
    await expect(createReorderPurchaseOrders(failing, { companyId: C, userId: user, lines: [{ itemId: "item-2", qty: 2 }, { itemId: "item-3", qty: 13 }] })).rejects.toThrow(/disco cheio/);

    const active = await db.select<Row[]>("SELECT * FROM purchase_orders WHERE deleted_at IS NULL");
    expect(active).toEqual([]);
    const activeLines = await db.select<Row[]>("SELECT * FROM purchase_order_items WHERE deleted_at IS NULL");
    expect(activeLines).toEqual([]);
    // Nada ficou "em pedido": a sugestão volta inteira para gerar de novo.
    expect((await reorderSuggestions(db, C)).map((row) => [row.item_id, row.on_order])).toEqual([
      ["item-3", 0],
      ["item-2", 0],
    ]);
    // O número usado não volta (a numeração conta os excluídos).
    const [retry] = await createReorderPurchaseOrders(db, { companyId: C, userId: user, lines: [{ itemId: "item-2", qty: 2 }] });
    expect(retry.number).toBe(2);
  });

  it("grava pela regra das Compras (createPurchaseOrder): condição do fornecedor, categoria de custo padrão e observação", async () => {
    await db.execute("UPDATE suppliers SET terms='28 dias' WHERE id='sup-1'");
    await db.execute("INSERT INTO finance_categories (id, company_id, code, name, kind, dre_group, position, active) VALUES ('cat-custo', ?, '3.1', 'Custo das mercadorias', 'despesa', 'custo', 1, 1)", [C]);
    const created = await createReorderPurchaseOrders(db, { companyId: C, userId: user, lines: [{ itemId: "item-2", qty: 2 }, { itemId: "item-4", qty: 1 }] });
    const orders = await db.select<Row[]>("SELECT * FROM purchase_orders ORDER BY number");
    expect(orders.map((row) => [row.supplier_id, row.payment_terms, row.category_id, row.notes])).toEqual([
      ["sup-1", "28 dias", "cat-custo", "Gerado pela reposição de estoque."],
      [null, null, "cat-custo", "Gerado pela reposição de estoque."],
    ]);
    expect(created.map((row) => [row.supplier_name, row.total])).toEqual([["NetPrime", 4361], [null, 520]]);
  });

  it("recusa lista vazia, quantidade inválida e item inexistente sem gravar pedido", async () => {
    const attempts = [
      createReorderPurchaseOrders(db, { companyId: C, userId: user, lines: [] }),
      createReorderPurchaseOrders(db, { companyId: C, userId: user, lines: [{ itemId: "item-2", qty: 0 }] }),
      createReorderPurchaseOrders(db, { companyId: C, userId: user, lines: [{ itemId: "item-2", qty: 1 }, { itemId: "nao-existe", qty: 1 }] }),
      createReorderPurchaseOrders(db, { companyId: C, userId: user, locationId: "loc-x", lines: [{ itemId: "item-2", qty: 1 }] }),
    ];
    for (const attempt of attempts) await expect(attempt).rejects.toBeInstanceOf(StockError);
    const [row] = await db.select<{ n: number }[]>("SELECT count(*) AS n FROM purchase_orders");
    expect(row.n).toBe(0);
  });
});
