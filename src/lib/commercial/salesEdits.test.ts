// Gravação das tabelas editáveis de vendas (pedidos e faturas) em SQLite real, com a massa fixa de catálogo/vendas.
import { afterEach, describe, expect, it } from "vitest";
import { createTestDb, insertTestCompany, type TestDb } from "@/test/sqlite";
import { confirmSalesOrder, createSalesOrder, invoiceSalesOrder } from "@/lib/erp/orders";
import { seedTradeFixture, type TradeFixture } from "@/lib/erp/tradeFixtures";
import { removeSalesOrderItem, saveInvoiceRows, saveSalesOrderItemRows, saveSalesOrderRows } from "./salesEdits";

type Row = Record<string, unknown>;

let db: TestDb | null = null;
afterEach(() => {
  db?.close();
  db = null;
});

async function setup(): Promise<{ db: TestDb; fx: TradeFixture; seller: { role: "comercial"; userId: string }; finance: { role: "financeiro"; userId: string } }> {
  db = await createTestDb();
  const { companyId, userIds } = await insertTestCompany(db, { roles: ["ceo", "comercial", "financeiro"] });
  const fx = await seedTradeFixture(db, companyId, userIds.comercial!);
  return { db, fx, seller: { role: "comercial", userId: userIds.comercial! }, finance: { role: "financeiro", userId: userIds.financeiro! } };
}

const one = async (sql: string, binds: unknown[]) => (await db!.select<Row[]>(sql, binds))[0];

async function confirmedOrder(fx: TradeFixture) {
  const id = await createSalesOrder(db!, { companyId: fx.companyId, customerId: fx.customerId, userId: fx.userId, items: [{ description: "Consultoria", qty: 2, unitPrice: 500 }], installments: 2 });
  await confirmSalesOrder(db!, id, { companyId: fx.companyId });
  return id;
}

describe("saveSalesOrderRows", () => {
  it("Adicionar cria o rascunho sem itens (número PV, condição do cliente) e ele não confirma vazio", async () => {
    const { db, fx, seller } = await setup();
    await db.execute("UPDATE customers SET payment_terms=? WHERE id=?", ["28 dias", fx.customerId]);
    const { created } = await saveSalesOrderRows(db, fx.companyId, seller, { updated: [], created: [{ customer_id: fx.customerId, order_date: "2026-10-20", delivery_date: "2026-10-30" }] });
    const order = await one("SELECT * FROM sales_orders WHERE id=?", [created[0]]);
    expect(order).toMatchObject({ status: "rascunho", customer_id: fx.customerId, order_date: "2026-10-20", delivery_date: "2026-10-30", payment_terms: "28 dias", installments: 1, total: 0, seller_id: seller.userId, created_by: seller.userId });
    expect(Number(order!.number)).toBeGreaterThan(0);
    await expect(confirmSalesOrder(db, String(created[0]), { companyId: fx.companyId })).rejects.toThrow(/item/);
  });

  it("muda cabeçalho e cliente sem perder itens nem preços", async () => {
    const { db, fx, seller } = await setup();
    const id = await confirmedOrder(fx);
    await saveSalesOrderRows(db, fx.companyId, seller, { updated: [{ id, delivery_date: "2026-11-15", installments: 3, payment_terms: "30/60/90" }], created: [] });
    expect(await one("SELECT delivery_date, installments, payment_terms, status, total FROM sales_orders WHERE id=?", [id])).toEqual({ delivery_date: "2026-11-15", installments: 3, payment_terms: "30/60/90", status: "confirmado", total: 1000 });
    await saveSalesOrderRows(db, fx.companyId, seller, { updated: [{ id, customer_id: fx.otherCustomerId }], created: [] });
    expect(await one("SELECT customer_id, total, delivery_date FROM sales_orders WHERE id=?", [id])).toEqual({ customer_id: fx.otherCustomerId, total: 1000, delivery_date: "2026-11-15" });
    const items = await db.select<Row[]>("SELECT * FROM sales_order_items WHERE order_id=? AND deleted_at IS NULL", [id]);
    expect(items.map((item) => [item.description, item.qty, item.unit_price])).toEqual([["Consultoria", 2, 500]]);
  });

  it("pedido faturado não muda pela tabela; parcelas fora de 1 a 120 e cliente vazio são recusados", async () => {
    const { db, fx, seller } = await setup();
    const id = await confirmedOrder(fx);
    await expect(saveSalesOrderRows(db, fx.companyId, seller, { updated: [{ id, installments: 0 }], created: [] })).rejects.toThrow(/parcelas/);
    await expect(saveSalesOrderRows(db, fx.companyId, seller, { updated: [], created: [{ order_date: "2026-10-20" }] })).rejects.toThrow(/cliente/);
    await invoiceSalesOrder(db, id, { companyId: fx.companyId });
    await expect(saveSalesOrderRows(db, fx.companyId, seller, { updated: [{ id, delivery_date: "2026-12-01" }], created: [] })).rejects.toThrow(/não pode ser editado/);
  });

  it("financeiro só consulta pedidos", async () => {
    const { db, fx, finance } = await setup();
    await expect(saveSalesOrderRows(db, fx.companyId, finance, { updated: [], created: [{ customer_id: fx.customerId }] })).rejects.toThrow(/permissão/);
  });
});

describe("saveInvoiceRows", () => {
  it("Adicionar fatura o pedido escolhido; na fatura emitida só número fiscal, forma de pagamento e observações mudam", async () => {
    const { db, fx, finance } = await setup();
    const orderId = await confirmedOrder(fx);
    const { created } = await saveInvoiceRows(db, fx.companyId, finance, { updated: [], created: [{ sales_order_id: orderId, issue_date: "2026-10-20", due_date: "2026-11-05", payment_method: "pix", fiscal_number: "123" }] });
    const invoice = await one("SELECT * FROM invoices WHERE id=?", [created[0]]);
    expect(invoice).toMatchObject({ sales_order_id: orderId, status: "emitida", issue_date: "2026-10-20", installments: 2, payment_method: "pix", fiscal_number: "123", total: 1000 });
    const dues = (await db.select<Row[]>("SELECT due_date FROM receivables WHERE invoice_id=? ORDER BY due_date", [created[0]])).map((row) => row.due_date);
    expect(dues).toEqual(["2026-11-05", "2026-12-05"]);
    expect(await one("SELECT status FROM sales_orders WHERE id=?", [orderId])).toEqual({ status: "faturado" });

    await saveInvoiceRows(db, fx.companyId, finance, { updated: [{ id: String(created[0]), fiscal_number: "456", notes: "NF emitida" }], created: [] });
    expect(await one("SELECT fiscal_number, notes FROM invoices WHERE id=?", [created[0]])).toEqual({ fiscal_number: "456", notes: "NF emitida" });
    await expect(saveInvoiceRows(db, fx.companyId, finance, { updated: [{ id: String(created[0]), issue_date: "2026-10-01" }], created: [] })).rejects.toThrow(/cancele/);
  });

  it("sem pedido ou com pedido em rascunho, não fatura", async () => {
    const { db, fx, finance } = await setup();
    await expect(saveInvoiceRows(db, fx.companyId, finance, { updated: [], created: [{ issue_date: "2026-10-20" }] })).rejects.toThrow(/pedido/);
    const draft = await createSalesOrder(db, { companyId: fx.companyId, customerId: fx.customerId, items: [{ description: "X", qty: 1, unitPrice: 10 }] });
    await expect(saveInvoiceRows(db, fx.companyId, finance, { updated: [], created: [{ sales_order_id: draft }] })).rejects.toThrow(/Confirme/);
    expect(await db.select("SELECT id FROM invoices WHERE company_id=?", [fx.companyId])).toHaveLength(0);
  });

  it("faturando vários pedidos, um sem valor recusa tudo antes de faturar o outro", async () => {
    const { db, fx, finance } = await setup();
    const good = await confirmedOrder(fx);
    const free = await createSalesOrder(db, { companyId: fx.companyId, customerId: fx.customerId, userId: fx.userId, items: [{ description: "Brinde", qty: 1, unitPrice: 0 }] });
    await confirmSalesOrder(db, free, { companyId: fx.companyId });
    await expect(saveInvoiceRows(db, fx.companyId, finance, { updated: [], created: [{ sales_order_id: good }, { sales_order_id: free }] })).rejects.toThrow(/sem valor/);
    expect(await db.select("SELECT id FROM invoices WHERE company_id=?", [fx.companyId])).toHaveLength(0);
    expect(await one("SELECT status FROM sales_orders WHERE id=?", [good])).toEqual({ status: "confirmado" });
  });
});

describe("saveSalesOrderItemRows e removeSalesOrderItem", () => {
  it("inclui item no rascunho vazio (preço da tabela do cliente), altera quantidade e mantém o preço digitado", async () => {
    const { db, fx, seller } = await setup();
    const { created } = await saveSalesOrderRows(db, fx.companyId, seller, { updated: [], created: [{ customer_id: fx.customerId }] });
    const orderId = String(created[0]);
    await saveSalesOrderItemRows(db, fx.companyId, seller, orderId, { updated: [], created: [{ product_id: fx.products.switch, qty: 2 }, { description: "Instalação", qty: 1, unit_price: 300 }] });
    let items = await db.select<Row[]>("SELECT * FROM sales_order_items WHERE order_id=? AND deleted_at IS NULL ORDER BY position", [orderId]);
    expect(items.map((item) => [item.description, item.qty, item.unit_price])).toEqual([["Switch 24 portas", 2, 2700], ["Instalação", 1, 300]]);
    expect(await one("SELECT total FROM sales_orders WHERE id=?", [orderId])).toEqual({ total: 5700 });

    await saveSalesOrderItemRows(db, fx.companyId, seller, orderId, { updated: [{ id: String(items[0]!.id), qty: 3 }], created: [] });
    items = await db.select<Row[]>("SELECT * FROM sales_order_items WHERE order_id=? AND deleted_at IS NULL ORDER BY position", [orderId]);
    expect(items.map((item) => [item.description, item.qty, item.unit_price])).toEqual([["Switch 24 portas", 3, 2700], ["Instalação", 1, 300]]);

    await removeSalesOrderItem(db, fx.companyId, seller, orderId, String(items[1]!.id));
    // updateSalesOrder regrava os itens (ids novos): a tela recarrega a lista depois de cada gravação.
    const rest = await db.select<Row[]>("SELECT * FROM sales_order_items WHERE order_id=? AND deleted_at IS NULL", [orderId]);
    expect(rest.map((item) => item.description)).toEqual(["Switch 24 portas"]);
    await expect(removeSalesOrderItem(db, fx.companyId, seller, orderId, String(rest[0]!.id))).rejects.toThrow(/ao menos um item/);
  });

  it("pedido faturado e item avulso sem preço são recusados", async () => {
    const { db, fx, seller } = await setup();
    const orderId = await confirmedOrder(fx);
    await expect(saveSalesOrderItemRows(db, fx.companyId, seller, orderId, { updated: [], created: [{ description: "Sem preço", qty: 1 }] })).rejects.toThrow(/preço/);
    await invoiceSalesOrder(db, orderId, { companyId: fx.companyId });
    await expect(saveSalesOrderItemRows(db, fx.companyId, seller, orderId, { updated: [], created: [{ description: "X", qty: 1, unit_price: 1 }] })).rejects.toThrow(/não pode ser editado/);
  });
});
