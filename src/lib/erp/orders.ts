// Vendas: pedido de venda (rascunho → confirmado → faturado → entregue, ou cancelado), faturamento em parcelas
// (cada parcela vira uma conta a receber) e entrega com saída do estoque.
// Regras de dinheiro em src/lib/money.ts (centavos; a última parcela absorve a diferença). Datas de documento no dia
// local ('YYYY-MM-DD', todayIso). SQL nos padrões do banco demo (ver tradeDb.ts).
import { v4 as uuidv4 } from "uuid";
import type { DatabaseLike } from "@/lib/db/demo";
import { formatSequence, nextSequenceNumber } from "@/lib/db/sequence";
import { orderTotals, roundMoney, splitInstallments, sumMoney, toCents } from "@/lib/money";
import { todayIso } from "@/lib/utils";
import type { Customer, Invoice, InvoiceStatus, Product, Receivable, SalesOrder, SalesOrderItem, StockLocation } from "@/types";
import { effectivePriceList, quoteItems, type ComputedLine, type QuoteItemInput } from "./pricing";
import { assertStockAvailable, postStockMovement } from "./stockPosting";
import {
  activeRow,
  activeRows,
  activeRowsBy,
  addDaysIso,
  claimStatus,
  cleanText,
  defaultFinanceCategory,
  documentById,
  fail,
  insertRow,
  isIsoDay,
  nowIso,
  undoing,
  updateRow,
} from "./tradeDb";

export type SalesItemInput = QuoteItemInput;

export interface SalesOrderInput {
  companyId: string;
  customerId: string;
  items: readonly SalesItemInput[];
  /** Quem grava (created_by). */
  userId?: string | null;
  sellerId?: string | null;
  contactId?: string | null;
  opportunityId?: string | null;
  proposalId?: string | null;
  /** Tabela escolhida; sem ela, a do cliente ou a padrão (effectivePriceList). */
  priceListId?: string | null;
  /** Local de saída do estoque na entrega. */
  locationId?: string | null;
  orderDate?: string;
  deliveryDate?: string | null;
  paymentTerms?: string | null;
  installments?: number;
  /** Desconto do pedido em R$. */
  discount?: number | null;
  shipping?: number | null;
  notes?: string | null;
  internalNotes?: string | null;
}

export interface ActionOptions {
  /** Confere que o documento é desta empresa. */
  companyId?: string;
  userId?: string | null;
}

/** Pedido que ainda aceita edição dos itens: rascunho ou confirmado, sem fatura. */
export function isSalesOrderEditable(order: Pick<SalesOrder, "status" | "invoiced_at">): boolean {
  return (order.status === "rascunho" || order.status === "confirmado") && !order.invoiced_at;
}

export function loadSalesOrder(db: DatabaseLike, orderId: string, companyId?: string): Promise<SalesOrder> {
  return documentById<SalesOrder>(db, "sales_orders", orderId, companyId, "Pedido de venda");
}

export async function loadSalesOrderItems(db: DatabaseLike, companyId: string, orderId: string): Promise<SalesOrderItem[]> {
  const items = await activeRowsBy<SalesOrderItem>(db, "sales_order_items", companyId, "order_id", orderId);
  return items.sort((a, b) => a.position - b.position);
}

function checkInstallments(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 120) fail("O número de parcelas deve ser um inteiro de 1 a 120.");
  return value;
}

interface PreparedOrder {
  customer: Customer;
  priceListId: string | null;
  lines: ComputedLine[];
  totals: ReturnType<typeof orderTotals>;
  orderDate: string;
  installments: number;
}

async function prepareOrder(db: DatabaseLike, input: SalesOrderInput): Promise<PreparedOrder> {
  const { companyId } = input;
  const customer = (await activeRow<Customer>(db, "customers", companyId, input.customerId)) ?? fail("Cliente não encontrado.");
  const orderDate = input.orderDate ?? todayIso();
  if (!isIsoDay(orderDate)) fail("Data do pedido inválida.");
  if (input.deliveryDate && !isIsoDay(input.deliveryDate)) fail("Data de entrega inválida.");
  if (input.locationId && !(await activeRow<StockLocation>(db, "stock_locations", companyId, input.locationId))) fail("Local de estoque não encontrado.");
  const discount = Number(input.discount ?? 0);
  const shipping = Number(input.shipping ?? 0);
  if (!Number.isFinite(discount) || discount < 0) fail("O desconto do pedido não pode ser negativo.");
  if (!Number.isFinite(shipping) || shipping < 0) fail("O frete não pode ser negativo.");
  const installments = checkInstallments(Number(input.installments ?? 1));

  const priceList = await effectivePriceList(db, companyId, { customerId: customer.id, priceListId: input.priceListId, day: orderDate });
  const lines = await quoteItems(db, companyId, { items: input.items, priceListId: priceList?.id ?? null });
  const totals = orderTotals(lines.map((line) => ({ qty: line.qty, unit_price: line.unitPrice, discount: line.discount, tax_rate: line.taxRate })), { discount, shipping });
  if (toCents(totals.discount) > toCents(totals.subtotal)) fail("O desconto do pedido é maior que o subtotal dos itens.");
  return { customer, priceListId: priceList?.id ?? null, lines, totals, orderDate, installments };
}

function itemRow(companyId: string, orderId: string, line: ComputedLine, now: string): Record<string, unknown> {
  return {
    id: uuidv4(),
    company_id: companyId,
    order_id: orderId,
    product_id: line.productId,
    description: line.description,
    unit: line.unit,
    qty: line.qty,
    unit_price: line.unitPrice,
    discount: line.discount,
    tax_rate: line.taxRate,
    total: line.total,
    delivered_qty: 0,
    invoiced_qty: 0,
    position: line.position,
    created_at: now,
    updated_at: now,
  };
}

/** Grava o pedido (rascunho, ou já confirmado com `confirm`) com número PV sequencial. Devolve o id. */
export async function createSalesOrder(db: DatabaseLike, input: SalesOrderInput & { confirm?: boolean }): Promise<string> {
  const { companyId } = input;
  const prepared = await prepareOrder(db, input);
  const id = uuidv4();
  const now = nowIso();
  const number = await nextSequenceNumber(db, "sales_orders", companyId);
  await undoing(async (undo) => {
    await insertRow(db, "sales_orders", {
      id,
      company_id: companyId,
      number,
      customer_id: prepared.customer.id,
      contact_id: input.contactId ?? null,
      opportunity_id: input.opportunityId ?? null,
      proposal_id: input.proposalId ?? null,
      price_list_id: prepared.priceListId,
      seller_id: input.sellerId ?? null,
      location_id: input.locationId ?? null,
      status: input.confirm ? "confirmado" : "rascunho",
      order_date: prepared.orderDate,
      delivery_date: input.deliveryDate ?? null,
      payment_terms: cleanText(input.paymentTerms),
      installments: prepared.installments,
      ...prepared.totals,
      notes: cleanText(input.notes),
      internal_notes: cleanText(input.internalNotes),
      confirmed_at: input.confirm ? now : null,
      created_by: input.userId ?? null,
      created_at: now,
      updated_at: now,
    });
    undo(() => updateRow(db, "sales_orders", companyId, id, { deleted_at: nowIso() }));
    for (const line of prepared.lines) {
      const row = itemRow(companyId, id, line, now);
      await insertRow(db, "sales_order_items", row);
      undo(() => updateRow(db, "sales_order_items", companyId, String(row.id), { deleted_at: nowIso() }));
    }
  });
  return id;
}

/** Troca dados, itens e totais de um pedido em rascunho ou confirmado (sem fatura). O número não muda. */
export async function updateSalesOrder(db: DatabaseLike, orderId: string, input: SalesOrderInput): Promise<void> {
  const { companyId } = input;
  const order = await loadSalesOrder(db, orderId, companyId);
  if (!isSalesOrderEditable(order)) fail("Este pedido não pode ser editado: já foi faturado, entregue ou cancelado.");
  const prepared = await prepareOrder(db, input);
  const oldItems = await loadSalesOrderItems(db, companyId, orderId);
  const now = nowIso();
  const patch = {
    customer_id: prepared.customer.id,
    contact_id: input.contactId ?? order.contact_id ?? null,
    price_list_id: prepared.priceListId,
    // A tela de edição não escolhe vendedor: sem `sellerId`, mantém o do pedido; `null` limpa.
    seller_id: input.sellerId === undefined ? order.seller_id ?? null : input.sellerId,
    location_id: input.locationId ?? null,
    order_date: prepared.orderDate,
    delivery_date: input.deliveryDate ?? null,
    payment_terms: cleanText(input.paymentTerms),
    installments: prepared.installments,
    ...prepared.totals,
    notes: cleanText(input.notes),
    internal_notes: cleanText(input.internalNotes),
    updated_at: now,
  };
  const previous = Object.fromEntries(Object.keys(patch).map((key) => [key, (order as unknown as Record<string, unknown>)[key] ?? null]));
  await undoing(async (undo) => {
    // Só grava se o pedido segue no mesmo status e sem fatura (faturar no meio da edição não pode trocar os itens).
    await claimStatus(db, "sales_orders", companyId, orderId, order.status, patch, "O pedido mudou enquanto você editava; recarregue a página.", ["invoiced_at"]);
    undo(() => updateRow(db, "sales_orders", companyId, orderId, previous));
    for (const item of oldItems) {
      await updateRow(db, "sales_order_items", companyId, item.id, { deleted_at: now, updated_at: now });
      undo(() => updateRow(db, "sales_order_items", companyId, item.id, { deleted_at: null }));
    }
    for (const line of prepared.lines) {
      const row = itemRow(companyId, orderId, line, now);
      await insertRow(db, "sales_order_items", row);
      undo(() => updateRow(db, "sales_order_items", companyId, String(row.id), { deleted_at: nowIso() }));
    }
  });
}

export async function confirmSalesOrder(db: DatabaseLike, orderId: string, options: ActionOptions = {}): Promise<void> {
  const order = await loadSalesOrder(db, orderId, options.companyId);
  if (order.status !== "rascunho") fail("Só um pedido em rascunho pode ser confirmado.");
  const now = nowIso();
  await claimStatus(db, "sales_orders", order.company_id, orderId, "rascunho", { status: "confirmado", confirmed_at: now, updated_at: now }, "O pedido mudou enquanto você confirmava; recarregue a página.");
}

/** Exclusão (soft delete) só de rascunho; pedido confirmado se cancela. */
export async function deleteSalesOrder(db: DatabaseLike, orderId: string, options: ActionOptions = {}): Promise<void> {
  const order = await loadSalesOrder(db, orderId, options.companyId);
  if (order.status !== "rascunho") fail("Só pedido em rascunho pode ser excluído; os demais se cancelam.");
  const now = nowIso();
  await claimStatus(db, "sales_orders", order.company_id, orderId, "rascunho", { deleted_at: now, updated_at: now }, "O pedido mudou; recarregue a página.");
  for (const item of await loadSalesOrderItems(db, order.company_id, orderId)) {
    await updateRow(db, "sales_order_items", order.company_id, item.id, { deleted_at: now, updated_at: now });
  }
}

export async function cancelSalesOrder(db: DatabaseLike, orderId: string, options: ActionOptions & { reason: string }): Promise<void> {
  const order = await loadSalesOrder(db, orderId, options.companyId);
  const reason = cleanText(options.reason) ?? fail("Informe o motivo do cancelamento.");
  if (order.status === "cancelado") fail("O pedido já está cancelado.");
  if (order.status === "entregue") fail("Pedido entregue não pode ser cancelado.");
  if (order.status === "faturado" || order.invoiced_at) fail("Cancele a fatura do pedido antes de cancelá-lo.");
  const now = nowIso();
  await claimStatus(db, "sales_orders", order.company_id, orderId, order.status, { status: "cancelado", cancelled_at: now, cancel_reason: reason, updated_at: now }, "O pedido mudou enquanto você cancelava; recarregue a página.", ["invoiced_at"]);
}

export interface InvoiceOptions extends ActionOptions {
  /** Emissão ('YYYY-MM-DD'); padrão: hoje (dia local). */
  issueDate?: string;
  /** Padrão: as parcelas do pedido. Ignorado quando `dueDates` vem. */
  installments?: number;
  /** Primeiro vencimento; padrão: emissão + intervalo. */
  firstDueDate?: string;
  /** Dias entre parcelas (padrão 30: 30/60/90). */
  intervalDays?: number;
  /** Vencimentos escolhidos um a um (define o número de parcelas). */
  dueDates?: readonly string[];
  paymentMethod?: string | null;
  paymentTerms?: string | null;
  categoryId?: string | null;
  bankAccountId?: string | null;
  notes?: string | null;
}

/** Vencimentos: o primeiro e os seguintes a cada `intervalDays` dias. */
export function installmentDueDates(firstDueDate: string, count: number, intervalDays = 30): string[] {
  return Array.from({ length: count }, (_, index) => addDaysIso(firstDueDate, index * intervalDays));
}

/** Confere e devolve os vencimentos: datas válidas, em ordem e não antes da emissão. */
export function resolveDueDates(issueDate: string, options: { installments?: number; firstDueDate?: string; intervalDays?: number; dueDates?: readonly string[] }, fallbackInstallments = 1): string[] {
  const interval = options.intervalDays ?? 30;
  if (!Number.isInteger(interval) || interval < 1 || interval > 366) fail("O intervalo entre parcelas deve ser de 1 a 366 dias.");
  let dates: string[];
  if (options.dueDates && options.dueDates.length > 0) {
    dates = [...options.dueDates];
    checkInstallments(dates.length);
  } else {
    const count = checkInstallments(Number(options.installments ?? fallbackInstallments));
    const first = options.firstDueDate ?? addDaysIso(issueDate, interval);
    if (!isIsoDay(first)) fail("Primeiro vencimento inválido.");
    dates = installmentDueDates(first, count, interval);
  }
  dates.forEach((date, index) => {
    if (!isIsoDay(date)) fail(`Vencimento da parcela ${index + 1} inválido.`);
    if (date < issueDate) fail(`O vencimento da parcela ${index + 1} é antes da emissão.`);
    if (index > 0 && date < dates[index - 1]) fail("Os vencimentos devem estar em ordem.");
  });
  return dates;
}

/**
 * Fatura o pedido confirmado (ou entregue sem fatura): cria a fatura (FAT), copia os itens e gera uma conta a receber
 * por parcela (splitInstallments: soma exata, a última absorve os centavos). Pedido confirmado vira "faturado";
 * entregue continua "entregue".
 */
export async function invoiceSalesOrder(db: DatabaseLike, orderId: string, options: InvoiceOptions = {}): Promise<{ invoiceId: string; receivableIds: string[] }> {
  const order = await loadSalesOrder(db, orderId, options.companyId);
  const companyId = order.company_id;
  if (order.status === "rascunho") fail("Confirme o pedido antes de faturar.");
  if (order.status === "cancelado") fail("Pedido cancelado não pode ser faturado.");
  if (order.status === "faturado" || order.invoiced_at) fail("Este pedido já foi faturado.");
  const open = (await activeRowsBy<Invoice>(db, "invoices", companyId, "sales_order_id", orderId)).filter((invoice) => invoice.status !== "cancelada");
  if (open.length > 0) fail("Este pedido já foi faturado.");
  const items = await loadSalesOrderItems(db, companyId, orderId);
  if (items.length === 0) fail("O pedido não tem itens.");
  const total = roundMoney(Number(order.total));
  if (!(total > 0)) fail("Pedido sem valor não gera fatura.");

  const issueDate = options.issueDate ?? todayIso();
  if (!isIsoDay(issueDate)) fail("Data de emissão inválida.");
  const dueDates = resolveDueDates(issueDate, options, Number(order.installments) || 1);
  const amounts = splitInstallments(total, dueDates.length);

  const products = new Map((await activeRows<Product>(db, "products", companyId)).map((product) => [product.id, product]));
  const productCategory = items.map((item) => (item.product_id ? products.get(item.product_id)?.revenue_category_id : null)).find(Boolean) ?? null;
  const categoryId = options.categoryId ?? productCategory ?? (await defaultFinanceCategory(db, companyId, "receita"));
  const customer = order.customer_id ? await activeRow<Customer>(db, "customers", companyId, order.customer_id) : null;
  const customerName = customer?.name ?? "Cliente";
  const paymentMethod = cleanText(options.paymentMethod);

  const number = await nextSequenceNumber(db, "invoices", companyId);
  const label = formatSequence("invoices", number);
  const invoiceId = uuidv4();
  const receivableIds: string[] = [];
  const now = nowIso();

  await undoing(async (undo) => {
    const nextStatus = order.status === "entregue" ? "entregue" : "faturado";
    await claimStatus(db, "sales_orders", companyId, orderId, order.status, { status: nextStatus, invoiced_at: now, updated_at: now }, "O pedido mudou enquanto você faturava; recarregue a página.", ["invoiced_at"]);
    undo(() => updateRow(db, "sales_orders", companyId, orderId, { status: order.status, invoiced_at: null }));

    await insertRow(db, "invoices", {
      id: invoiceId,
      company_id: companyId,
      number,
      sales_order_id: orderId,
      customer_id: order.customer_id ?? null,
      status: "emitida",
      issue_date: issueDate,
      due_date: dueDates[dueDates.length - 1],
      installments: dueDates.length,
      payment_terms: cleanText(options.paymentTerms) ?? order.payment_terms ?? null,
      payment_method: paymentMethod,
      subtotal: order.subtotal,
      discount: order.discount,
      shipping: order.shipping,
      tax_total: order.tax_total,
      total,
      paid_amount: 0,
      category_id: categoryId,
      bank_account_id: options.bankAccountId ?? null,
      notes: cleanText(options.notes),
      created_by: options.userId ?? null,
      created_at: now,
      updated_at: now,
    });
    undo(() => updateRow(db, "invoices", companyId, invoiceId, { deleted_at: nowIso() }));

    for (const item of items) {
      const rowId = uuidv4();
      await insertRow(db, "invoice_items", {
        id: rowId,
        company_id: companyId,
        invoice_id: invoiceId,
        sales_order_item_id: item.id,
        product_id: item.product_id ?? null,
        description: item.description,
        unit: item.unit,
        qty: item.qty,
        unit_price: item.unit_price,
        discount: item.discount,
        tax_rate: item.tax_rate,
        total: item.total,
        position: item.position,
        created_at: now,
        updated_at: now,
      });
      undo(() => updateRow(db, "invoice_items", companyId, rowId, { deleted_at: nowIso() }));
      await updateRow(db, "sales_order_items", companyId, item.id, { invoiced_qty: item.qty, updated_at: now });
      undo(() => updateRow(db, "sales_order_items", companyId, item.id, { invoiced_qty: item.invoiced_qty ?? 0 }));
    }

    for (const [index, dueDate] of dueDates.entries()) {
      const receivableId = uuidv4();
      await insertRow(db, "receivables", {
        id: receivableId,
        company_id: companyId,
        customer_id: order.customer_id ?? null,
        ref_type: "invoice",
        ref_id: invoiceId,
        description: `${label} - ${customerName} (${index + 1}/${dueDates.length})`,
        amount: amounts[index],
        due_date: dueDate,
        status: "aberta",
        received_amount: 0,
        category_id: categoryId,
        bank_account_id: options.bankAccountId ?? null,
        installment_number: index + 1,
        installment_count: dueDates.length,
        payment_method: paymentMethod,
        document_number: label,
        issue_date: issueDate,
        competence: issueDate.slice(0, 7),
        invoice_id: invoiceId,
        sales_order_id: orderId,
        created_at: now,
        updated_at: now,
      });
      undo(() => updateRow(db, "receivables", companyId, receivableId, { deleted_at: nowIso() }));
      receivableIds.push(receivableId);
    }
  });
  return { invoiceId, receivableIds };
}

/** Valor já recebido de uma parcela (conta antiga quitada sem received_amount conta inteira). */
export function receivedOf(receivable: Pick<Receivable, "amount" | "received_amount" | "status">): number {
  const received = Number(receivable.received_amount ?? 0);
  if (received > 0) return roundMoney(received);
  return receivable.status === "recebida" ? roundMoney(Number(receivable.amount ?? 0)) : 0;
}

/** Parcela ainda conta (não cancelada nem excluída). */
export function isActiveReceivable(receivable: Pick<Receivable, "status" | "deleted_at">): boolean {
  return !receivable.deleted_at && receivable.status !== "cancelada";
}

/** Parcela vencida: em aberto (não recebida inteira) e com vencimento antes de hoje. */
export function isReceivableOverdue(receivable: Pick<Receivable, "amount" | "received_amount" | "status" | "due_date" | "deleted_at">, today: string): boolean {
  if (!isActiveReceivable(receivable)) return false;
  if (receivable.status === "recebida" || toCents(receivedOf(receivable)) >= toCents(Number(receivable.amount ?? 0))) return false;
  return Boolean(receivable.due_date && receivable.due_date.slice(0, 10) < today);
}

/**
 * Status da fatura pelas parcelas (as baixas acontecem no Financeiro, que mexe só nas contas a receber):
 * tudo recebido → paga; alguma parcela vencida → vencida; algo recebido → paga em parte; senão o gravado.
 */
export function invoiceDisplayStatus(invoice: Pick<Invoice, "status" | "total">, receivables: readonly Receivable[], today: string): InvoiceStatus {
  if (invoice.status === "cancelada" || invoice.status === "rascunho") return invoice.status;
  const active = receivables.filter(isActiveReceivable);
  if (active.length === 0) return invoice.status;
  const expected = sumMoney(active.map((row) => Number(row.amount ?? 0)));
  const received = sumMoney(active.map(receivedOf));
  if (toCents(received) >= toCents(expected)) return "paga";
  if (active.some((row) => isReceivableOverdue(row, today))) return "vencida";
  if (received > 0) return "paga_parcial";
  return invoice.status === "paga" || invoice.status === "paga_parcial" || invoice.status === "vencida" ? "emitida" : invoice.status;
}

/**
 * Cancela a fatura se nada foi recebido: parcelas viram "cancelada", o pedido perde a marca de faturado (volta a
 * "confirmado"; entregue continua entregue) e pode ser faturado de novo.
 */
export async function cancelInvoice(db: DatabaseLike, invoiceId: string, options: ActionOptions & { reason: string }): Promise<void> {
  const invoice = await documentById<Invoice>(db, "invoices", invoiceId, options.companyId, "Fatura");
  const companyId = invoice.company_id;
  const reason = cleanText(options.reason) ?? fail("Informe o motivo do cancelamento.");
  if (invoice.status === "cancelada") fail("A fatura já está cancelada.");
  const receivables = (await activeRowsBy<Receivable>(db, "receivables", companyId, "invoice_id", invoiceId)).filter(isActiveReceivable);
  const settled = receivables.some((row) => receivedOf(row) > 0 || row.status === "recebida_parcial");
  let settlements = 0;
  for (const row of receivables) settlements += (await activeRowsBy<{ id: string }>(db, "finance_settlements", companyId, "receivable_id", row.id)).length;
  if (settled || settlements > 0) fail("Há parcelas recebidas nesta fatura: estorne as baixas no Financeiro antes de cancelar.");

  const now = nowIso();
  await claimStatus(db, "invoices", companyId, invoiceId, invoice.status, { status: "cancelada", cancelled_at: now, cancel_reason: reason, updated_at: now }, "A fatura mudou enquanto você cancelava; recarregue a página.");
  for (const row of receivables) await updateRow(db, "receivables", companyId, row.id, { status: "cancelada", updated_at: now });
  if (!invoice.sales_order_id) return;
  const order = await activeRow<SalesOrder>(db, "sales_orders", companyId, invoice.sales_order_id);
  if (!order) return;
  await updateRow(db, "sales_orders", companyId, order.id, { status: order.status === "faturado" ? "confirmado" : order.status, invoiced_at: null, updated_at: now });
  for (const item of await loadSalesOrderItems(db, companyId, order.id)) {
    await updateRow(db, "sales_order_items", companyId, item.id, { invoiced_qty: 0, updated_at: now });
  }
}

export interface DeliverOptions extends ActionOptions {
  /** Local de saída; padrão: o do pedido. */
  locationId?: string | null;
}

/**
 * Entrega o pedido confirmado ou faturado: saída do estoque dos produtos ligados a item de estoque (serviço não
 * movimenta), conferindo o saldo de tudo antes de gravar. O pedido fica "entregue".
 */
export async function deliverSalesOrder(db: DatabaseLike, orderId: string, options: DeliverOptions = {}): Promise<{ movementIds: string[] }> {
  const order = await loadSalesOrder(db, orderId, options.companyId);
  const companyId = order.company_id;
  if (order.status === "entregue") fail("Este pedido já foi entregue.");
  if (order.status === "rascunho") fail("Confirme o pedido antes de entregar.");
  if (order.status === "cancelado") fail("Pedido cancelado não pode ser entregue.");

  const items = await loadSalesOrderItems(db, companyId, orderId);
  const products = new Map((await activeRows<Product>(db, "products", companyId)).map((product) => [product.id, product]));
  const stockLines = items
    .map((item) => ({ item, product: item.product_id ? products.get(item.product_id) : undefined }))
    .filter((entry): entry is { item: SalesOrderItem; product: Product } => Boolean(entry.product && entry.product.kind === "produto" && entry.product.inventory_item_id));

  const locationId = options.locationId ?? order.location_id ?? null;
  if (stockLines.length > 0) {
    if (!locationId) fail("Escolha o local de saída do estoque.");
    if (!(await activeRow<StockLocation>(db, "stock_locations", companyId, locationId))) fail("Local de estoque não encontrado.");
    await assertStockAvailable(db, companyId, stockLines.map(({ item, product }) => ({ itemId: product.inventory_item_id!, locationId, quantity: Number(item.qty) })));
  }

  const customer = order.customer_id ? await activeRow<Customer>(db, "customers", companyId, order.customer_id) : null;
  const label = formatSequence("sales_orders", order.number);
  const now = nowIso();
  const movementIds: string[] = [];
  await undoing(async (undo) => {
    await claimStatus(
      db,
      "sales_orders",
      companyId,
      orderId,
      order.status,
      { status: "entregue", delivered_at: now, delivery_date: order.delivery_date ?? todayIso(), location_id: locationId, updated_at: now },
      "O pedido mudou enquanto você registrava a entrega; recarregue a página.",
    );
    undo(() => updateRow(db, "sales_orders", companyId, orderId, { status: order.status, delivered_at: null, delivery_date: order.delivery_date ?? null, location_id: order.location_id ?? null }));
    for (const { item, product } of stockLines) {
      const posted = await postStockMovement(db, companyId, {
        itemId: product.inventory_item_id!,
        type: "saida",
        quantity: Number(item.qty),
        fromLocationId: locationId,
        unitCost: roundMoney(Number(product.cost ?? 0)),
        refType: "sales_order",
        refId: orderId,
        userId: options.userId ?? null,
        note: `Entrega do pedido ${label}${customer ? ` - ${customer.name}` : ""}`,
      });
      undo(posted.undo);
      movementIds.push(posted.id);
    }
    for (const item of items) {
      await updateRow(db, "sales_order_items", companyId, item.id, { delivered_qty: item.qty, updated_at: now });
      undo(() => updateRow(db, "sales_order_items", companyId, item.id, { delivered_qty: item.delivered_qty ?? 0 }));
    }
  });
  return { movementIds };
}
