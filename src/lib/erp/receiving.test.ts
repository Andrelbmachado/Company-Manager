import { afterEach, describe, expect, it } from "vitest";
import { sumMoney } from "@/lib/money";
import { createTestDb, insertTestCompany, type TestDb } from "@/test/sqlite";
import type { GoodsReceipt, GoodsReceiptItem, InventoryItem, Payable, Product, PurchaseOrder, PurchaseOrderItem, StockBalance, StockMovement } from "@/types";
import {
  approvePurchaseOrder,
  cancelPurchaseOrder,
  createPurchaseOrder,
  deletePurchaseOrder,
  receivePurchaseOrder,
  reverseGoodsReceipt,
  sendPurchaseOrder,
  updatePurchaseOrder,
} from "./receiving";
import { seedTradeFixture, type TradeFixture } from "./tradeFixtures";

let db: TestDb | null = null;
afterEach(() => {
  db?.close();
  db = null;
});

async function setup(): Promise<{ db: TestDb; fx: TradeFixture; manager: string }> {
  db = await createTestDb();
  const { companyId, userIds } = await insertTestCompany(db, { roles: ["ceo", "gerente", "estoquista"] });
  return { db, fx: await seedTradeFixture(db, companyId, userIds.estoquista!), manager: userIds.gerente! };
}

const one = async <T>(table: string, id: string): Promise<T> => (await db!.select<T[]>(`SELECT * FROM ${table} WHERE id=?`, [id]))[0];
const all = <T>(sql: string, binds: unknown[] = []) => db!.select<T[]>(sql, binds);
const balance = async (itemId: string, locationId: string) =>
  Number((await all<StockBalance>("SELECT * FROM stock_balances WHERE item_id=? AND location_id=?", [itemId, locationId]))[0]?.quantity ?? 0);
const lines = (orderId: string) => all<PurchaseOrderItem>("SELECT * FROM purchase_order_items WHERE order_id=? AND deleted_at IS NULL ORDER BY position", [orderId]);

/** Pedido: 8 switches a 2.000 + 10 mouses a 40 (via produto), desconto 100, frete 50 → total 16.350. */
async function approvedOrder(fx: TradeFixture, manager: string): Promise<string> {
  const id = await createPurchaseOrder(db!, {
    companyId: fx.companyId,
    supplierId: fx.supplierId,
    userId: fx.userId,
    locationId: fx.locationId,
    orderDate: "2026-05-02",
    expectedDate: "2026-05-12",
    items: [
      { inventoryItemId: fx.items.switch, qty: 8, unitPrice: 2000 },
      { productId: fx.products.mouse, qty: 10, unitPrice: 40 },
    ],
    discount: 100,
    shipping: 50,
  });
  await approvePurchaseOrder(db!, id, { companyId: fx.companyId, userId: manager });
  return id;
}

describe("pedido de compra", () => {
  it("grava numerado, com totais, item de estoque vindo do produto e categoria de custo padrão", async () => {
    const { db, fx, manager } = await setup();
    const id = await approvedOrder(fx, manager);
    const order = await one<PurchaseOrder>("purchase_orders", id);
    expect(order).toMatchObject({ number: 1, supplier_id: fx.supplierId, status: "aprovado", approved_by: manager, subtotal: 16400, discount: 100, shipping: 50, total: 16350, expected_date: "2026-05-12", created_by: fx.userId, category_id: fx.categories.custo });
    expect(order.approved_at).toBeTruthy();
    const items = await lines(id);
    expect(items.map((item) => [item.description, item.inventory_item_id, item.product_id, item.total])).toEqual([
      ["Switch 24 portas", fx.items.switch, fx.products.switch, 16000],
      ["Mouse USB", fx.items.mouse, fx.products.mouse, 400],
    ]);
    await sendPurchaseOrder(db, id, { companyId: fx.companyId });
    expect((await one<PurchaseOrder>("purchase_orders", id)).status).toBe("enviado");
  });

  it("recusa fornecedor de fora, item sem quantidade e edição depois de aprovado", async () => {
    const { db, fx, manager } = await setup();
    const base = { companyId: fx.companyId, supplierId: fx.supplierId };
    await expect(createPurchaseOrder(db, { ...base, supplierId: "nao-existe", items: [{ inventoryItemId: fx.items.mouse, qty: 1, unitPrice: 1 }] })).rejects.toThrow(/fornecedor/i);
    await expect(createPurchaseOrder(db, { ...base, items: [] })).rejects.toThrow(/ao menos um item/i);
    await expect(createPurchaseOrder(db, { ...base, items: [{ inventoryItemId: fx.items.mouse, qty: 0, unitPrice: 1 }] })).rejects.toThrow(/quantidade/i);
    await expect(createPurchaseOrder(db, { ...base, items: [{ inventoryItemId: "nao-existe", qty: 1, unitPrice: 1 }] })).rejects.toThrow(/item de estoque/i);
    expect(await all("SELECT * FROM purchase_orders")).toEqual([]);

    const draft = await createPurchaseOrder(db, { ...base, items: [{ inventoryItemId: fx.items.mouse, qty: 5, unitPrice: 40 }] });
    await updatePurchaseOrder(db, draft, { ...base, items: [{ inventoryItemId: fx.items.mouse, qty: 6, unitPrice: 39 }], shipping: 10 });
    expect(await one<PurchaseOrder>("purchase_orders", draft)).toMatchObject({ subtotal: 234, total: 244 });
    const approved = await approvedOrder(fx, manager);
    await expect(updatePurchaseOrder(db, approved, { ...base, items: [{ inventoryItemId: fx.items.mouse, qty: 1, unitPrice: 1 }] })).rejects.toThrow(/rascunho/i);
    await expect(deletePurchaseOrder(db, approved, { companyId: fx.companyId })).rejects.toThrow(/rascunho/i);
    await deletePurchaseOrder(db, draft, { companyId: fx.companyId });
    expect((await one<PurchaseOrder>("purchase_orders", draft)).deleted_at).toBeTruthy();
  });

  it("editar sem informar categoria e centro de custo mantém os do pedido", async () => {
    const { db, fx } = await setup();
    await db.execute("INSERT INTO finance_categories (id, company_id, code, name, kind, dre_group, position, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", ["fx-cat-4-1", fx.companyId, "4.1", "Despesas administrativas", "despesa", "despesa", 3, 1]);
    await db.execute("INSERT INTO cost_centers (id, company_id, name) VALUES (?, ?, ?)", ["fx-cc-1", fx.companyId, "Loja"]);
    const base = { companyId: fx.companyId, supplierId: fx.supplierId };
    const draft = await createPurchaseOrder(db, { ...base, categoryId: "fx-cat-4-1", costCenterId: "fx-cc-1", items: [{ inventoryItemId: fx.items.mouse, qty: 5, unitPrice: 40 }] });
    await updatePurchaseOrder(db, draft, { ...base, items: [{ inventoryItemId: fx.items.mouse, qty: 6, unitPrice: 40 }] });
    expect(await one<PurchaseOrder>("purchase_orders", draft)).toMatchObject({ category_id: "fx-cat-4-1", cost_center_id: "fx-cc-1", total: 240 });
    await updatePurchaseOrder(db, draft, { ...base, categoryId: null, costCenterId: null, items: [{ inventoryItemId: fx.items.mouse, qty: 6, unitPrice: 40 }] });
    expect(await one<PurchaseOrder>("purchase_orders", draft)).toMatchObject({ category_id: fx.categories.custo, cost_center_id: null });
  });

  it("não recebe pedido em rascunho nem cancelado", async () => {
    const { db, fx } = await setup();
    const draft = await createPurchaseOrder(db, { companyId: fx.companyId, supplierId: fx.supplierId, items: [{ inventoryItemId: fx.items.mouse, qty: 5, unitPrice: 40 }] });
    const [line] = await lines(draft);
    await expect(receivePurchaseOrder(db, draft, [{ itemId: line.id, qty: 5, locationId: fx.locationId }], { companyId: fx.companyId })).rejects.toThrow(/aprov/i);
    await cancelPurchaseOrder(db, draft, { companyId: fx.companyId, reason: "Fornecedor sem estoque" });
    expect(await one<PurchaseOrder>("purchase_orders", draft)).toMatchObject({ status: "cancelado", cancel_reason: "Fornecedor sem estoque" });
    await expect(receivePurchaseOrder(db, draft, [{ itemId: line.id, qty: 5, locationId: fx.locationId }], { companyId: fx.companyId })).rejects.toThrow(/cancelado/i);
  });
});

describe("recebimento", () => {
  it("receber 5 un. dá entrada no estoque (saldo novo no local), registra o recebimento e cria a conta a pagar", async () => {
    const { db, fx, manager } = await setup();
    const orderId = await approvedOrder(fx, manager);
    const [switchLine] = await lines(orderId);
    const result = await receivePurchaseOrder(db, orderId, [{ itemId: switchLine.id, qty: 5, locationId: fx.emptyLocationId }], {
      companyId: fx.companyId,
      userId: fx.userId,
      receivedDate: "2026-05-10",
      supplierInvoiceNumber: "NF 1234",
    });

    expect(await balance(fx.items.switch, fx.emptyLocationId)).toBe(5);
    expect(await balance(fx.items.switch, fx.locationId)).toBe(10);
    const moves = await all<StockMovement>("SELECT * FROM stock_movements WHERE ref_type=? AND ref_id=?", ["goods_receipt", result.receiptId]);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ type: "entrada", item_id: fx.items.switch, quantity: 5, to_location_id: fx.emptyLocationId, from_location_id: null, unit_cost: 2000, user_id: fx.userId });

    const receipt = await one<GoodsReceipt>("goods_receipts", result.receiptId);
    // 5 × 2.000 de 16.400 em mercadoria: 16.350 × 10.000 / 16.400 = 9.969,51 (desconto e frete rateados).
    expect(receipt).toMatchObject({ number: 1, purchase_order_id: orderId, supplier_id: fx.supplierId, status: "conferido", supplier_invoice_number: "NF 1234", total: 9969.51, received_by: fx.userId });
    const receiptItems = await all<GoodsReceiptItem>("SELECT * FROM goods_receipt_items WHERE receipt_id=?", [result.receiptId]);
    expect(receiptItems).toEqual([expect.objectContaining({ purchase_order_item_id: switchLine.id, inventory_item_id: fx.items.switch, qty: 5, unit_cost: 2000, location_id: fx.emptyLocationId, stock_movement_id: moves[0].id })]);

    expect(result.payableIds).toHaveLength(1);
    const payable = await one<Payable>("payables", result.payableIds[0]);
    expect(payable).toMatchObject({
      supplier_id: fx.supplierId,
      amount: 9969.51,
      status: "aberta",
      paid_amount: 0,
      due_date: "2026-06-09",
      purchase_order_id: orderId,
      goods_receipt_id: result.receiptId,
      ref_type: "goods_receipt",
      ref_id: result.receiptId,
      document_number: "NF 1234",
      issue_date: "2026-05-10",
      competence: "2026-05",
      category_id: fx.categories.custo,
      installment_number: 1,
      installment_count: 1,
    });
    expect(payable.description).toContain("PC-00001");

    expect((await lines(orderId)).map((line) => line.received_qty)).toEqual([5, 0]);
    expect((await one<PurchaseOrder>("purchase_orders", orderId)).status).toBe("recebido_parcial");
    expect((await db.raw.prepare("PRAGMA foreign_key_check").all())).toEqual([]);
  });

  it("entrada em local que já tem saldo soma ao saldo e atualiza o custo médio do item e do produto", async () => {
    const { db, fx, manager } = await setup();
    const id = await createPurchaseOrder(db, { companyId: fx.companyId, supplierId: fx.supplierId, items: [{ inventoryItemId: fx.items.switch, qty: 5, unitPrice: 2300 }] });
    await approvePurchaseOrder(db, id, { companyId: fx.companyId, userId: manager });
    const [line] = await lines(id);
    await receivePurchaseOrder(db, id, [{ itemId: line.id, qty: 5, locationId: fx.locationId }], { companyId: fx.companyId });
    expect(await balance(fx.items.switch, fx.locationId)).toBe(15);
    // (10 × 2.000 + 5 × 2.300) / 15 = 2.100
    expect((await one<InventoryItem>("inventory_items", fx.items.switch)).cost).toBe(2100);
    expect((await one<Product>("products", fx.products.switch)).cost).toBe(2100);
    expect((await one<PurchaseOrder>("purchase_orders", id)).status).toBe("recebido");
  });

  it("estorno tira a entrada do custo médio do item e do produto", async () => {
    const { db, fx, manager } = await setup();
    const id = await createPurchaseOrder(db, { companyId: fx.companyId, supplierId: fx.supplierId, items: [{ inventoryItemId: fx.items.switch, qty: 5, unitPrice: 2300 }] });
    await approvePurchaseOrder(db, id, { companyId: fx.companyId, userId: manager });
    const [line] = await lines(id);
    const { receiptId } = await receivePurchaseOrder(db, id, [{ itemId: line.id, qty: 5, locationId: fx.emptyLocationId }], { companyId: fx.companyId });
    expect((await one<InventoryItem>("inventory_items", fx.items.switch)).cost).toBe(2100);

    await reverseGoodsReceipt(db, receiptId, { companyId: fx.companyId });
    // (15 × 2.100 − 5 × 2.300) / 10 = 2.000: volta ao custo de antes do recebimento.
    expect((await one<InventoryItem>("inventory_items", fx.items.switch)).cost).toBe(2000);
    expect((await one<Product>("products", fx.products.switch)).cost).toBe(2000);
    expect(await balance(fx.items.switch, fx.emptyLocationId)).toBe(0);
    expect(await balance(fx.items.switch, fx.locationId)).toBe(10);
  });

  it("o último recebimento fecha o pedido e as contas a pagar somam exatamente o total do pedido", async () => {
    const { db, fx, manager } = await setup();
    const orderId = await approvedOrder(fx, manager);
    const [switchLine, mouseLine] = await lines(orderId);
    const first = await receivePurchaseOrder(db, orderId, [{ itemId: switchLine.id, qty: 5, locationId: fx.locationId }], { companyId: fx.companyId, receivedDate: "2026-05-10" });
    const second = await receivePurchaseOrder(db, orderId, [{ itemId: switchLine.id, qty: 3, locationId: fx.locationId }, { itemId: mouseLine.id, qty: 10, locationId: fx.locationId }], {
      companyId: fx.companyId,
      receivedDate: "2026-05-12",
      installments: 2,
      firstDueDate: "2026-06-01",
      intervalDays: 30,
    });
    expect((await one<GoodsReceipt>("goods_receipts", second.receiptId)).number).toBe(2);
    expect(second.payableIds).toHaveLength(2);
    const payables = await all<Payable>("SELECT * FROM payables WHERE purchase_order_id=? ORDER BY due_date", [orderId]);
    expect(payables.map((row) => row.amount)).toEqual([3190.24, 9969.51, 3190.25]);
    expect(payables.map((row) => row.due_date)).toEqual(["2026-06-01", "2026-06-09", "2026-07-01"]);
    expect(sumMoney(payables.map((row) => row.amount))).toBe(16350);
    expect(first.payableIds).toHaveLength(1);

    const order = await one<PurchaseOrder>("purchase_orders", orderId);
    expect(order.status).toBe("recebido");
    expect(order.received_at).toBeTruthy();
    expect(await balance(fx.items.switch, fx.locationId)).toBe(18);
    expect(await balance(fx.items.mouse, fx.locationId)).toBe(13);
    await expect(cancelPurchaseOrder(db, orderId, { companyId: fx.companyId, reason: "x" })).rejects.toThrow(/recebid/i);
  });

  it("não recebe mais do que falta, nem em local de fora; nada é gravado", async () => {
    const { db, fx, manager } = await setup();
    const orderId = await approvedOrder(fx, manager);
    const [switchLine, mouseLine] = await lines(orderId);
    await expect(
      receivePurchaseOrder(db, orderId, [{ itemId: mouseLine.id, qty: 4, locationId: fx.locationId }, { itemId: switchLine.id, qty: 9, locationId: fx.locationId }], { companyId: fx.companyId }),
    ).rejects.toThrow(/Switch 24 portas/);
    await expect(receivePurchaseOrder(db, orderId, [{ itemId: switchLine.id, qty: 1, locationId: "nao-existe" }], { companyId: fx.companyId })).rejects.toThrow(/local/i);
    await expect(receivePurchaseOrder(db, orderId, [{ itemId: switchLine.id, qty: 0, locationId: fx.locationId }], { companyId: fx.companyId })).rejects.toThrow(/quantidade/i);
    await expect(receivePurchaseOrder(db, orderId, [], { companyId: fx.companyId })).rejects.toThrow(/ao menos um item/i);
    expect(await all("SELECT * FROM goods_receipts")).toEqual([]);
    expect(await all("SELECT * FROM stock_movements")).toEqual([]);
    expect(await all("SELECT * FROM payables")).toEqual([]);
    expect(await balance(fx.items.mouse, fx.locationId)).toBe(3);
  });

  it("não gera conta a pagar de R$ 0,00: valor pequeno demais para o número de parcelas é recusado sem gravar nada", async () => {
    const { db, fx, manager } = await setup();
    const orderId = await createPurchaseOrder(db, { companyId: fx.companyId, supplierId: fx.supplierId, items: [{ inventoryItemId: fx.items.mouse, qty: 1, unitPrice: 0.02 }] });
    await approvePurchaseOrder(db, orderId, { companyId: fx.companyId, userId: manager });
    const [line] = await lines(orderId);
    await expect(receivePurchaseOrder(db, orderId, [{ itemId: line.id, qty: 1, locationId: fx.locationId }], { companyId: fx.companyId, installments: 3 })).rejects.toThrow(/parcelas/i);
    expect(await all("SELECT * FROM goods_receipts")).toEqual([]);
    expect(await all("SELECT * FROM stock_movements")).toEqual([]);
    expect(await all("SELECT * FROM payables")).toEqual([]);
    expect(await balance(fx.items.mouse, fx.locationId)).toBe(3);

    await receivePurchaseOrder(db, orderId, [{ itemId: line.id, qty: 1, locationId: fx.locationId }], { companyId: fx.companyId, installments: 2 });
    expect((await all<Payable>("SELECT * FROM payables WHERE company_id=? ORDER BY installment_number", [fx.companyId])).map((row) => row.amount)).toEqual([0.01, 0.01]);
  });

  it("estorno devolve o estoque, reabre o pedido e cancela as contas a pagar; com conta paga, não estorna", async () => {
    const { db, fx, manager } = await setup();
    const orderId = await approvedOrder(fx, manager);
    await sendPurchaseOrder(db, orderId, { companyId: fx.companyId });
    const [switchLine] = await lines(orderId);
    const { receiptId, payableIds } = await receivePurchaseOrder(db, orderId, [{ itemId: switchLine.id, qty: 5, locationId: fx.emptyLocationId }], { companyId: fx.companyId });
    await reverseGoodsReceipt(db, receiptId, { companyId: fx.companyId, userId: fx.userId });

    expect(await balance(fx.items.switch, fx.emptyLocationId)).toBe(0);
    const receipt = await one<GoodsReceipt>("goods_receipts", receiptId);
    expect(receipt.status).toBe("estornado");
    expect(receipt.reversed_at).toBeTruthy();
    expect((await one<Payable>("payables", payableIds[0])).status).toBe("cancelada");
    expect((await lines(orderId)).map((line) => line.received_qty)).toEqual([0, 0]);
    expect((await one<PurchaseOrder>("purchase_orders", orderId)).status).toBe("enviado");
    const moves = await all<StockMovement>("SELECT * FROM stock_movements WHERE ref_id=? ORDER BY created_at", [receiptId]);
    expect(moves.map((move) => [move.type, move.quantity, move.from_location_id, move.to_location_id])).toEqual(
      expect.arrayContaining([["entrada", 5, null, fx.emptyLocationId], ["saida", 5, fx.emptyLocationId, null]]),
    );
    await expect(reverseGoodsReceipt(db, receiptId, { companyId: fx.companyId })).rejects.toThrow(/estornado/i);

    const again = await receivePurchaseOrder(db, orderId, [{ itemId: switchLine.id, qty: 2, locationId: fx.locationId }], { companyId: fx.companyId });
    await db.execute("UPDATE payables SET paid_amount=?, status=? WHERE id=?", [100, "paga_parcial", again.payableIds[0]]);
    await expect(reverseGoodsReceipt(db, again.receiptId, { companyId: fx.companyId })).rejects.toThrow(/paga/i);
    expect(await balance(fx.items.switch, fx.locationId)).toBe(12);
  });

  it("estorno sem saldo no local (já vendido) não grava nada", async () => {
    const { db, fx, manager } = await setup();
    const orderId = await approvedOrder(fx, manager);
    const [, mouseLine] = await lines(orderId);
    const { receiptId } = await receivePurchaseOrder(db, orderId, [{ itemId: mouseLine.id, qty: 10, locationId: fx.emptyLocationId }], { companyId: fx.companyId });
    await db.execute("UPDATE stock_balances SET quantity=? WHERE item_id=? AND location_id=?", [4, fx.items.mouse, fx.emptyLocationId]);
    await expect(reverseGoodsReceipt(db, receiptId, { companyId: fx.companyId })).rejects.toThrow(/Mouse USB/);
    expect((await one<GoodsReceipt>("goods_receipts", receiptId)).status).toBe("conferido");
    expect(await balance(fx.items.mouse, fx.emptyLocationId)).toBe(4);
  });
});
