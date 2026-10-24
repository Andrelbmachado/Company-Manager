// @vitest-environment jsdom
// Catálogo, vendas e compras também no banco demo do navegador (localStorage): o SQL tem de caber nos padrões do demo
// (sem JOIN, IN, soma nem expressão) e o resultado tem de bater com o do SQLite real (os outros testes desta pasta).
import { beforeEach, describe, expect, it } from "vitest";
import { createDemoDb, DEMO_COMPANY_ID } from "@/lib/db/demo";
import { sumMoney } from "@/lib/money";
import type { GoodsReceipt, Invoice, Payable, PriceListItem, Product, PurchaseOrder, PurchaseOrderItem, Receivable, SalesOrder, StockBalance, Supplier } from "@/types";
import { applyPercentToPriceList, savePriceList, savePriceListItem, saveProduct } from "./catalog";
import { cancelInvoice, confirmSalesOrder, createSalesOrder, deliverSalesOrder, invoiceDisplayStatus, invoiceSalesOrder, updateSalesOrder } from "./orders";
import { approvePurchaseOrder, createPurchaseOrder, loadPurchaseOrderItems, receivePurchaseOrder, reverseGoodsReceipt, sendPurchaseOrder } from "./receiving";
import { deleteSupplier, saveSupplier } from "./suppliers";
import { seedTradeFixture } from "./tradeFixtures";

const C = DEMO_COMPANY_ID;
beforeEach(() => localStorage.clear());

async function demo() {
  const db = createDemoDb();
  const fx = await seedTradeFixture(db, C, "demo-ceo");
  const one = async <T>(table: string, id: string) => (await db.select<T[]>(`SELECT * FROM ${table} WHERE company_id=? AND id=?`, [C, id]))[0];
  const balance = async (itemId: string, locationId: string) =>
    Number((await db.select<StockBalance[]>("SELECT * FROM stock_balances WHERE company_id=? AND item_id=? AND location_id=?", [C, itemId, locationId]))[0]?.quantity ?? 0);
  return { db, fx, one, balance };
}

describe("vendas no banco demo", () => {
  it("pedido → confirma → fatura em parcelas → entrega com baixa → cancela e refatura", async () => {
    const { db, fx, one, balance } = await demo();
    const orderId = await createSalesOrder(db, { companyId: C, customerId: fx.customerId, userId: "demo-ceo", items: [{ productId: fx.products.switch, qty: 2 }, { productId: fx.products.visita, qty: 1 }], shipping: 30 });
    await updateSalesOrder(db, orderId, { companyId: C, customerId: fx.customerId, locationId: fx.locationId, items: [{ productId: fx.products.switch, qty: 2 }, { productId: fx.products.visita, qty: 1 }], shipping: 30 });
    expect(await one<SalesOrder>("sales_orders", orderId)).toMatchObject({ subtotal: 5650, total: 5680, price_list_id: fx.priceLists.revenda, location_id: fx.locationId });
    await confirmSalesOrder(db, orderId, { companyId: C });

    const { invoiceId, receivableIds } = await invoiceSalesOrder(db, orderId, { companyId: C, installments: 3, issueDate: "2026-01-10" });
    const receivables = await db.select<Receivable[]>("SELECT * FROM receivables WHERE company_id=? AND invoice_id=?", [C, invoiceId]);
    expect(receivables.map((row) => row.id).sort()).toEqual([...receivableIds].sort());
    expect(sumMoney(receivables.map((row) => Number(row.amount)))).toBe(5680);
    expect(invoiceDisplayStatus(await one<Invoice>("invoices", invoiceId), receivables, "2026-01-11")).toBe("emitida");

    await deliverSalesOrder(db, orderId, { companyId: C });
    expect(await balance(fx.items.switch, fx.locationId)).toBe(8);
    expect((await one<SalesOrder>("sales_orders", orderId)).status).toBe("entregue");

    await cancelInvoice(db, invoiceId, { companyId: C, reason: "Teste" });
    expect((await db.select<Receivable[]>("SELECT * FROM receivables WHERE company_id=? AND invoice_id=?", [C, invoiceId])).every((row) => row.status === "cancelada")).toBe(true);
    const again = await invoiceSalesOrder(db, orderId, { companyId: C });
    expect((await one<Invoice>("invoices", again.invoiceId)).number).toBe(2);
    expect((await one<SalesOrder>("sales_orders", orderId)).status).toBe("entregue");
  });
});

describe("compras no banco demo", () => {
  it("pedido → aprova → envia → recebe em parte → estorna → recebe tudo", async () => {
    const { db, fx, one, balance } = await demo();
    const orderId = await createPurchaseOrder(db, { companyId: C, supplierId: fx.supplierId, items: [{ inventoryItemId: fx.items.mouse, qty: 10, unitPrice: 40 }, { productId: fx.products.switch, qty: 2, unitPrice: 2000 }], shipping: 60 });
    await approvePurchaseOrder(db, orderId, { companyId: C, userId: "demo-gerente" });
    await sendPurchaseOrder(db, orderId, { companyId: C });
    const [mouseLine, switchLine] = await loadPurchaseOrderItems(db, C, orderId);
    expect(switchLine.inventory_item_id).toBe(fx.items.switch);

    const partial = await receivePurchaseOrder(db, orderId, [{ itemId: mouseLine.id, qty: 4, locationId: fx.emptyLocationId }], { companyId: C, receivedDate: "2026-05-10" });
    expect(await balance(fx.items.mouse, fx.emptyLocationId)).toBe(4);
    expect((await one<PurchaseOrder>("purchase_orders", orderId)).status).toBe("recebido_parcial");
    await reverseGoodsReceipt(db, partial.receiptId, { companyId: C });
    expect(await balance(fx.items.mouse, fx.emptyLocationId)).toBe(0);
    expect((await one<GoodsReceipt>("goods_receipts", partial.receiptId)).status).toBe("estornado");
    expect((await one<PurchaseOrder>("purchase_orders", orderId)).status).toBe("enviado");

    const full = await receivePurchaseOrder(db, orderId, [{ itemId: mouseLine.id, qty: 10, locationId: fx.locationId }, { itemId: switchLine.id, qty: 2, locationId: fx.locationId }], { companyId: C, installments: 2 });
    expect(await balance(fx.items.mouse, fx.locationId)).toBe(13);
    expect(await balance(fx.items.switch, fx.locationId)).toBe(12);
    const payables = await db.select<Payable[]>("SELECT * FROM payables WHERE company_id=? AND goods_receipt_id=?", [C, full.receiptId]);
    expect(sumMoney(payables.map((row) => Number(row.amount)))).toBe(4460);
    expect((await one<PurchaseOrder>("purchase_orders", orderId)).status).toBe("recebido");
    const lines = await db.select<PurchaseOrderItem[]>("SELECT * FROM purchase_order_items WHERE company_id=? AND order_id=?", [C, orderId]);
    expect(lines.every((line) => line.received_qty === line.qty)).toBe(true);
  });
});

describe("catálogo e fornecedores no banco demo", () => {
  it("produto com item de estoque, SKU único, tabela padrão, percentual e fornecedor", async () => {
    const { db, fx, one } = await demo();
    const id = await saveProduct(db, C, { name: "Câmera IP", sku: "CAM-1", kind: "produto", price: 700, cost: 450, createStockItem: true });
    expect((await one<Product>("products", id)).inventory_item_id).toBeTruthy();
    await expect(saveProduct(db, C, { name: "Outra", sku: "cam-1", kind: "produto", price: 1 })).rejects.toThrow(/SKU/);

    const listId = await savePriceList(db, C, { name: "Promoção", isDefault: true });
    expect((await db.select<{ id: string; is_default: number }[]>("SELECT * FROM price_lists WHERE company_id=? AND is_default=1", [C])).map((row) => row.id)).toEqual([listId]);
    expect(await applyPercentToPriceList(db, C, listId, 5)).toEqual({ created: 4, updated: 0 });
    await expect(savePriceListItem(db, C, { priceListId: listId, productId: id, price: 1, minQty: 1 })).rejects.toThrow(/já tem preço/i);
    const items = await db.select<PriceListItem[]>("SELECT * FROM price_list_items WHERE company_id=? AND price_list_id=?", [C, listId]);
    expect(items.find((item) => item.product_id === id)?.price).toBe(735);

    const supplierId = await saveSupplier(db, C, { name: "Fornecedor Demo", document: "45.723.174/0001-10", email: "A@B.COM" });
    expect((await one<Supplier>("suppliers", supplierId)).email).toBe("a@b.com");
    await expect(saveSupplier(db, C, { name: "Repetido", document: "45723174000110" })).rejects.toThrow(/CNPJ/);
    await deleteSupplier(db, C, supplierId);
    expect((await one<Supplier>("suppliers", supplierId)).deleted_at).toBeTruthy();
    expect(fx.companyId).toBe(C);
  });
});
