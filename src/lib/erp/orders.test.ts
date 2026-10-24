import { afterEach, describe, expect, it } from "vitest";
import { sumMoney } from "@/lib/money";
import { createTestDb, insertTestCompany, type TestDb } from "@/test/sqlite";
import type { Invoice, InvoiceItem, Receivable, SalesOrder, SalesOrderItem, StockBalance, StockMovement } from "@/types";
import {
  cancelInvoice,
  cancelSalesOrder,
  confirmSalesOrder,
  createSalesOrder,
  deleteSalesOrder,
  deliverSalesOrder,
  invoiceDisplayStatus,
  invoiceSalesOrder,
  updateSalesOrder,
} from "./orders";
import { deleteProduct } from "./catalog";
import { seedTradeFixture, type TradeFixture } from "./tradeFixtures";

let db: TestDb | null = null;
afterEach(() => {
  db?.close();
  db = null;
});

async function setup(): Promise<{ db: TestDb; fx: TradeFixture }> {
  db = await createTestDb();
  const { companyId, userIds } = await insertTestCompany(db, { roles: ["ceo", "comercial", "financeiro"] });
  return { db, fx: await seedTradeFixture(db, companyId, userIds.comercial!) };
}

const one = async <T>(table: string, id: string): Promise<T> => (await db!.select<T[]>(`SELECT * FROM ${table} WHERE id=?`, [id]))[0];
const all = <T>(sql: string, binds: unknown[] = []) => db!.select<T[]>(sql, binds);
const balance = async (itemId: string, locationId: string) =>
  Number((await all<StockBalance>("SELECT * FROM stock_balances WHERE item_id=? AND location_id=?", [itemId, locationId]))[0]?.quantity ?? 0);

/** Pedido de R$ 1.000,00 sem produto (serviço avulso), já confirmado. */
async function confirmedThousand(fx: TradeFixture): Promise<string> {
  const id = await createSalesOrder(db!, { companyId: fx.companyId, customerId: fx.otherCustomerId, userId: fx.userId, items: [{ description: "Consultoria de rede", qty: 1, unitPrice: 1000 }] });
  await confirmSalesOrder(db!, id, { companyId: fx.companyId, userId: fx.userId });
  return id;
}

describe("pedido de venda", () => {
  it("grava pedido numerado com itens e totais (preço da tabela do cliente quando não informado)", async () => {
    const { db, fx } = await setup();
    const id = await createSalesOrder(db, {
      companyId: fx.companyId,
      customerId: fx.customerId,
      userId: fx.userId,
      sellerId: fx.userId,
      orderDate: "2026-05-10",
      items: [
        { productId: fx.products.switch, qty: 1 },
        { productId: fx.products.mouse, qty: 2, unitPrice: 80, discount: 10 },
        { productId: fx.products.visita, qty: 1 },
      ],
      discount: 50,
      shipping: 20,
      installments: 2,
      paymentTerms: "30/60 dias",
    });
    const order = await one<SalesOrder>("sales_orders", id);
    expect(order).toMatchObject({ number: 1, status: "rascunho", customer_id: fx.customerId, price_list_id: fx.priceLists.revenda, order_date: "2026-05-10", installments: 2, created_by: fx.userId, seller_id: fx.userId });
    // switch 2700 (tabela revenda) + mouse 2×80−10 = 150 + visita 250 = 3100; −50 +20 = 3070
    expect(order).toMatchObject({ subtotal: 3100, discount: 50, shipping: 20, tax_total: 0, total: 3070 });
    const items = await all<SalesOrderItem>("SELECT * FROM sales_order_items WHERE order_id=? ORDER BY position", [id]);
    expect(items.map((item) => [item.description, item.unit_price, item.total, item.product_id])).toEqual([
      ["Switch 24 portas", 2700, 2700, fx.products.switch],
      ["Mouse USB", 80, 150, fx.products.mouse],
      ["Visita técnica", 250, 250, fx.products.visita],
    ]);

    const second = await createSalesOrder(db, { companyId: fx.companyId, customerId: fx.otherCustomerId, items: [{ productId: fx.products.visita, qty: 1 }] });
    expect((await one<SalesOrder>("sales_orders", second)).number).toBe(2);
  });

  it("recusa pedido sem item, cliente de fora, desconto maior que o subtotal ou produto inativo", async () => {
    const { db, fx } = await setup();
    const base = { companyId: fx.companyId, customerId: fx.customerId };
    await expect(createSalesOrder(db, { ...base, items: [] })).rejects.toThrow(/ao menos um item/i);
    await expect(createSalesOrder(db, { ...base, customerId: "fx-nao-existe", items: [{ productId: fx.products.visita, qty: 1 }] })).rejects.toThrow(/cliente/i);
    await expect(createSalesOrder(db, { ...base, items: [{ productId: fx.products.visita, qty: 1 }], discount: 251 })).rejects.toThrow(/desconto/i);
    await expect(createSalesOrder(db, { ...base, items: [{ productId: fx.products.inativo, qty: 1 }] })).rejects.toThrow(/inativo/i);
    await expect(createSalesOrder(db, { ...base, items: [{ productId: fx.products.visita, qty: -1 }] })).rejects.toThrow(/quantidade/i);
    expect(await all("SELECT * FROM sales_orders")).toEqual([]);
    expect(await all("SELECT * FROM sales_order_items")).toEqual([]);
  });

  it("edita o rascunho trocando os itens e recalculando; pedido faturado não se edita", async () => {
    const { db, fx } = await setup();
    const id = await createSalesOrder(db, { companyId: fx.companyId, customerId: fx.otherCustomerId, items: [{ productId: fx.products.visita, qty: 1 }] });
    await updateSalesOrder(db, id, { companyId: fx.companyId, customerId: fx.otherCustomerId, items: [{ productId: fx.products.mouse, qty: 3 }], shipping: 15 });
    const order = await one<SalesOrder>("sales_orders", id);
    expect(order).toMatchObject({ subtotal: 240, shipping: 15, total: 255, number: 1 });
    const items = await all<SalesOrderItem>("SELECT * FROM sales_order_items WHERE order_id=? AND deleted_at IS NULL", [id]);
    expect(items.map((item) => item.description)).toEqual(["Mouse USB"]);

    await confirmSalesOrder(db, id, { companyId: fx.companyId });
    await invoiceSalesOrder(db, id, { companyId: fx.companyId });
    await expect(updateSalesOrder(db, id, { companyId: fx.companyId, customerId: fx.otherCustomerId, items: [{ productId: fx.products.mouse, qty: 1 }] })).rejects.toThrow(/não pode ser editado/i);
  });

  it("editar sem informar o vendedor mantém o vendedor do pedido", async () => {
    const { db, fx } = await setup();
    const id = await createSalesOrder(db, { companyId: fx.companyId, customerId: fx.otherCustomerId, userId: fx.userId, sellerId: fx.userId, items: [{ productId: fx.products.visita, qty: 1 }] });
    await updateSalesOrder(db, id, { companyId: fx.companyId, customerId: fx.otherCustomerId, userId: fx.userId, items: [{ productId: fx.products.visita, qty: 2 }] });
    expect(await one<SalesOrder>("sales_orders", id)).toMatchObject({ seller_id: fx.userId, total: 500 });
    await updateSalesOrder(db, id, { companyId: fx.companyId, customerId: fx.otherCustomerId, sellerId: null, items: [{ productId: fx.products.visita, qty: 2 }] });
    expect((await one<SalesOrder>("sales_orders", id)).seller_id).toBeNull();
  });

  it("só exclui (soft delete) rascunho", async () => {
    const { db, fx } = await setup();
    const draft = await createSalesOrder(db, { companyId: fx.companyId, customerId: fx.otherCustomerId, items: [{ productId: fx.products.visita, qty: 1 }] });
    const confirmed = await confirmedThousand(fx);
    await deleteSalesOrder(db, draft, { companyId: fx.companyId });
    expect((await one<SalesOrder>("sales_orders", draft)).deleted_at).toBeTruthy();
    expect((await all<SalesOrderItem>("SELECT * FROM sales_order_items WHERE order_id=? AND deleted_at IS NULL", [draft]))).toEqual([]);
    await expect(deleteSalesOrder(db, confirmed, { companyId: fx.companyId })).rejects.toThrow(/rascunho/i);
  });

  it("cancela pedido aberto com motivo; faturado ou entregue não cancela", async () => {
    const { db, fx } = await setup();
    const id = await confirmedThousand(fx);
    await expect(cancelSalesOrder(db, id, { companyId: fx.companyId, reason: " " })).rejects.toThrow(/motivo/i);
    await cancelSalesOrder(db, id, { companyId: fx.companyId, reason: "Cliente desistiu" });
    expect(await one<SalesOrder>("sales_orders", id)).toMatchObject({ status: "cancelado", cancel_reason: "Cliente desistiu" });
    await expect(confirmSalesOrder(db, id, { companyId: fx.companyId })).rejects.toThrow(/rascunho/i);

    const invoiced = await confirmedThousand(fx);
    await invoiceSalesOrder(db, invoiced, { companyId: fx.companyId });
    await expect(cancelSalesOrder(db, invoiced, { companyId: fx.companyId, reason: "x" })).rejects.toThrow(/fatura/i);
  });
});

describe("faturamento", () => {
  it("fatura R$ 1.000,00 em 3 parcelas: 3 contas a receber somando 1.000,00, a última absorve os centavos", async () => {
    const { db, fx } = await setup();
    const orderId = await confirmedThousand(fx);
    const { invoiceId, receivableIds } = await invoiceSalesOrder(db, orderId, { companyId: fx.companyId, userId: fx.userId, installments: 3, issueDate: "2026-01-10", paymentMethod: "boleto" });

    const invoice = await one<Invoice>("invoices", invoiceId);
    expect(invoice).toMatchObject({ number: 1, status: "emitida", sales_order_id: orderId, customer_id: fx.otherCustomerId, issue_date: "2026-01-10", installments: 3, total: 1000, subtotal: 1000, paid_amount: 0, category_id: fx.categories.receita, due_date: "2026-04-10" });
    const invoiceItems = await all<InvoiceItem>("SELECT * FROM invoice_items WHERE invoice_id=?", [invoiceId]);
    expect(invoiceItems).toHaveLength(1);
    expect(invoiceItems[0]).toMatchObject({ description: "Consultoria de rede", total: 1000, qty: 1 });
    expect(invoiceItems[0].sales_order_item_id).toBeTruthy();

    expect(receivableIds).toHaveLength(3);
    const receivables = await all<Receivable>("SELECT * FROM receivables WHERE invoice_id=? ORDER BY installment_number", [invoiceId]);
    expect(receivables.map((row) => row.id)).toEqual(receivableIds);
    expect(receivables.map((row) => row.amount)).toEqual([333.33, 333.33, 333.34]);
    expect(sumMoney(receivables.map((row) => row.amount))).toBe(1000);
    expect(receivables.map((row) => row.due_date)).toEqual(["2026-02-09", "2026-03-11", "2026-04-10"]);
    for (const [index, row] of receivables.entries()) {
      expect(row).toMatchObject({
        status: "aberta",
        customer_id: fx.otherCustomerId,
        sales_order_id: orderId,
        ref_type: "invoice",
        ref_id: invoiceId,
        installment_number: index + 1,
        installment_count: 3,
        received_amount: 0,
        payment_method: "boleto",
        document_number: "FAT-00001",
        issue_date: "2026-01-10",
        competence: "2026-01",
        category_id: fx.categories.receita,
      });
      expect(row.description).toBe(`FAT-00001 - Cliente Final (${index + 1}/3)`);
    }

    const order = await one<SalesOrder>("sales_orders", orderId);
    expect(order.status).toBe("faturado");
    expect(order.invoiced_at).toBeTruthy();
    const items = await all<SalesOrderItem>("SELECT * FROM sales_order_items WHERE order_id=?", [orderId]);
    expect(items.every((item) => item.invoiced_qty === item.qty)).toBe(true);
    expect((await db.raw.prepare("PRAGMA foreign_key_check").all())).toEqual([]);
  });

  it("à vista e vencimentos escolhidos", async () => {
    const { db, fx } = await setup();
    const cash = await confirmedThousand(fx);
    const a = await invoiceSalesOrder(db, cash, { companyId: fx.companyId, issueDate: "2026-03-01", installments: 1, firstDueDate: "2026-03-01" });
    expect((await all<Receivable>("SELECT * FROM receivables WHERE invoice_id=?", [a.invoiceId])).map((row) => [row.amount, row.due_date])).toEqual([[1000, "2026-03-01"]]);

    const custom = await confirmedThousand(fx);
    const b = await invoiceSalesOrder(db, custom, { companyId: fx.companyId, issueDate: "2026-03-01", dueDates: ["2026-03-15", "2026-04-15"] });
    expect((await all<Receivable>("SELECT * FROM receivables WHERE invoice_id=? ORDER BY installment_number", [b.invoiceId])).map((row) => [row.amount, row.due_date])).toEqual([
      [500, "2026-03-15"],
      [500, "2026-04-15"],
    ]);
    expect((await one<Invoice>("invoices", b.invoiceId)).number).toBe(2);
    await expect(invoiceSalesOrder(db, await confirmedThousand(fx), { companyId: fx.companyId, issueDate: "2026-03-01", dueDates: ["2026-02-28"] })).rejects.toThrow(/vencimento/i);
  });

  it("não gera parcela de R$ 0,00: valor pequeno demais para o número de parcelas é recusado sem gravar nada", async () => {
    const { db, fx } = await setup();
    const id = await createSalesOrder(db, { companyId: fx.companyId, customerId: fx.otherCustomerId, items: [{ description: "Ajuste", qty: 1, unitPrice: 0.02 }], confirm: true });
    await expect(invoiceSalesOrder(db, id, { companyId: fx.companyId, installments: 3 })).rejects.toThrow(/parcelas/i);
    expect(await all("SELECT * FROM invoices")).toEqual([]);
    expect(await all("SELECT * FROM receivables")).toEqual([]);
    expect((await one<SalesOrder>("sales_orders", id)).status).toBe("confirmado");

    const { receivableIds } = await invoiceSalesOrder(db, id, { companyId: fx.companyId, installments: 2 });
    expect((await all<Receivable>("SELECT * FROM receivables WHERE company_id=? ORDER BY installment_number", [fx.companyId])).map((row) => row.amount)).toEqual([0.01, 0.01]);
    expect(receivableIds).toHaveLength(2);
  });

  it("não fatura rascunho, cancelado nem duas vezes", async () => {
    const { db, fx } = await setup();
    const draft = await createSalesOrder(db, { companyId: fx.companyId, customerId: fx.customerId, items: [{ productId: fx.products.visita, qty: 1 }] });
    await expect(invoiceSalesOrder(db, draft, { companyId: fx.companyId })).rejects.toThrow(/confirm/i);
    const orderId = await confirmedThousand(fx);
    await invoiceSalesOrder(db, orderId, { companyId: fx.companyId });
    await expect(invoiceSalesOrder(db, orderId, { companyId: fx.companyId })).rejects.toThrow(/já foi faturado/i);
    expect(await all("SELECT * FROM invoices")).toHaveLength(1);
    await expect(invoiceSalesOrder(db, orderId, { companyId: "outra" })).rejects.toThrow(/não encontrado/i);
  });

  it("cancelar a fatura cancela as parcelas e devolve o pedido para confirmado; com parcela recebida, não cancela", async () => {
    const { db, fx } = await setup();
    const orderId = await confirmedThousand(fx);
    const first = await invoiceSalesOrder(db, orderId, { companyId: fx.companyId, installments: 2 });
    await expect(cancelInvoice(db, first.invoiceId, { companyId: fx.companyId, reason: "" })).rejects.toThrow(/motivo/i);
    await cancelInvoice(db, first.invoiceId, { companyId: fx.companyId, reason: "Valor errado" });
    expect(await one<Invoice>("invoices", first.invoiceId)).toMatchObject({ status: "cancelada", cancel_reason: "Valor errado" });
    expect((await all<Receivable>("SELECT * FROM receivables WHERE invoice_id=?", [first.invoiceId])).map((row) => row.status)).toEqual(["cancelada", "cancelada"]);
    const order = await one<SalesOrder>("sales_orders", orderId);
    expect(order).toMatchObject({ status: "confirmado", invoiced_at: null });
    expect((await all<SalesOrderItem>("SELECT * FROM sales_order_items WHERE order_id=?", [orderId])).every((item) => item.invoiced_qty === 0)).toBe(true);

    const second = await invoiceSalesOrder(db, orderId, { companyId: fx.companyId, installments: 2 });
    expect((await one<Invoice>("invoices", second.invoiceId)).number).toBe(2);
    await db.execute("UPDATE receivables SET received_amount=?, status=? WHERE id=?", [500, "recebida", second.receivableIds[0]]);
    await expect(cancelInvoice(db, second.invoiceId, { companyId: fx.companyId, reason: "x" })).rejects.toThrow(/recebid/i);
  });

  it("status da fatura pelas parcelas: emitida, paga em parte, vencida e paga", () => {
    const invoice = { status: "emitida", total: 1000 } as Invoice;
    const r = (amount: number, received: number, due: string, status = "aberta") => ({ amount, received_amount: received, due_date: due, status, deleted_at: null }) as Receivable;
    const today = "2026-05-10";
    expect(invoiceDisplayStatus(invoice, [r(500, 0, "2026-06-01"), r(500, 0, "2026-07-01")], today)).toBe("emitida");
    expect(invoiceDisplayStatus(invoice, [r(500, 500, "2026-05-01", "recebida"), r(500, 0, "2026-07-01")], today)).toBe("paga_parcial");
    expect(invoiceDisplayStatus(invoice, [r(500, 500, "2026-04-01", "recebida"), r(500, 100, "2026-05-09", "recebida_parcial")], today)).toBe("vencida");
    expect(invoiceDisplayStatus(invoice, [r(500, 500, "2026-04-01", "recebida"), r(500, 500, "2026-05-01", "recebida")], today)).toBe("paga");
    // Conta antiga quitada sem received_amount conta como recebida inteira.
    expect(invoiceDisplayStatus(invoice, [r(1000, 0, "2026-04-01", "recebida")], today)).toBe("paga");
    expect(invoiceDisplayStatus({ ...invoice, status: "cancelada" }, [r(1000, 0, "2026-04-01")], today)).toBe("cancelada");
  });
});

describe("entrega e baixa no estoque", () => {
  it("dá saída dos produtos com estoque (serviço não movimenta) e marca o pedido como entregue", async () => {
    const { db, fx } = await setup();
    const id = await createSalesOrder(db, {
      companyId: fx.companyId,
      customerId: fx.otherCustomerId,
      locationId: fx.locationId,
      items: [{ productId: fx.products.switch, qty: 2 }, { productId: fx.products.visita, qty: 1 }, { productId: fx.products.switch, qty: 1 }],
      confirm: true,
    });
    expect((await one<SalesOrder>("sales_orders", id)).status).toBe("confirmado");
    const { movementIds } = await deliverSalesOrder(db, id, { companyId: fx.companyId, userId: fx.userId });
    expect(movementIds).toHaveLength(2);
    expect(await balance(fx.items.switch, fx.locationId)).toBe(7);
    const moves = await all<StockMovement>("SELECT * FROM stock_movements WHERE ref_type=? AND ref_id=?", ["sales_order", id]);
    expect(moves.map((move) => [move.type, move.item_id, move.quantity, move.from_location_id, move.to_location_id, move.unit_cost])).toEqual(
      expect.arrayContaining([["saida", fx.items.switch, 2, fx.locationId, null, 2000], ["saida", fx.items.switch, 1, fx.locationId, null, 2000]]),
    );
    const order = await one<SalesOrder>("sales_orders", id);
    expect(order.status).toBe("entregue");
    expect(order.delivered_at).toBeTruthy();
    expect((await all<SalesOrderItem>("SELECT * FROM sales_order_items WHERE order_id=?", [id])).every((item) => item.delivered_qty === item.qty)).toBe(true);
    await expect(deliverSalesOrder(db, id, { companyId: fx.companyId })).rejects.toThrow(/já foi entregue|não pode ser entregue/i);

    // Entregue antes de faturar: fatura depois e continua entregue.
    await invoiceSalesOrder(db, id, { companyId: fx.companyId });
    expect((await one<SalesOrder>("sales_orders", id)).status).toBe("entregue");
  });

  it("sem saldo suficiente não grava nada e diz qual item falta; sem local de saída, pede o local", async () => {
    const { db, fx } = await setup();
    const id = await createSalesOrder(db, { companyId: fx.companyId, customerId: fx.otherCustomerId, items: [{ productId: fx.products.switch, qty: 1 }, { productId: fx.products.mouse, qty: 2 }, { productId: fx.products.mouse, qty: 2 }], confirm: true });
    await expect(deliverSalesOrder(db, id, { companyId: fx.companyId })).rejects.toThrow(/local/i);
    await expect(deliverSalesOrder(db, id, { companyId: fx.companyId, locationId: fx.locationId })).rejects.toThrow(/Mouse USB/);
    expect(await balance(fx.items.switch, fx.locationId)).toBe(10);
    expect(await balance(fx.items.mouse, fx.locationId)).toBe(3);
    expect(await all("SELECT * FROM stock_movements")).toEqual([]);
    expect((await one<SalesOrder>("sales_orders", id)).status).toBe("confirmado");

    const draft = await createSalesOrder(db, { companyId: fx.companyId, customerId: fx.otherCustomerId, items: [{ productId: fx.products.visita, qty: 1 }] });
    await expect(deliverSalesOrder(db, draft, { companyId: fx.companyId })).rejects.toThrow(/confirm/i);
  });

  it("produto excluído do catálogo depois do pedido continua dando baixa no estoque e levando a categoria para a fatura", async () => {
    const { db, fx } = await setup();
    await db.execute("INSERT INTO finance_categories (id, company_id, code, name, kind, dre_group, position, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", ["fx-cat-1-2", fx.companyId, "1.2", "Revenda de equipamentos", "receita", "receita", 3, 1]);
    await db.execute("UPDATE products SET revenue_category_id=? WHERE id=?", ["fx-cat-1-2", fx.products.switch]);
    const id = await createSalesOrder(db, { companyId: fx.companyId, customerId: fx.otherCustomerId, locationId: fx.locationId, items: [{ productId: fx.products.switch, qty: 2 }], confirm: true });
    await deleteProduct(db, fx.companyId, fx.products.switch);

    const { movementIds } = await deliverSalesOrder(db, id, { companyId: fx.companyId });
    expect(movementIds).toHaveLength(1);
    expect(await balance(fx.items.switch, fx.locationId)).toBe(8);

    const { invoiceId } = await invoiceSalesOrder(db, id, { companyId: fx.companyId });
    expect((await one<Invoice>("invoices", invoiceId)).category_id).toBe("fx-cat-1-2");
  });
});
