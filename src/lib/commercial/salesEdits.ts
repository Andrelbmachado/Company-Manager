// Gravação das tabelas editáveis de vendas: pedidos de venda e faturas.
// Pedido: Adicionar cria o rascunho (cabeçalho, sem itens: os itens entram abrindo o pedido); Editar muda o cabeçalho
// de pedido em rascunho ou confirmado sem fatura (cliente e data refazem o pedido mantendo itens e preços).
// Fatura: Adicionar fatura o pedido escolhido (invoiceSalesOrder); na emitida só mudam número fiscal, forma de pagamento
// e observações (o resto se refaz cancelando a fatura). Regras em lib/erp/orders.ts; SQL nos padrões do banco demo.
import { v4 as uuidv4 } from "uuid";
import type { DatabaseLike } from "@/lib/db/demo";
import { formatSequence, nextSequenceNumber } from "@/lib/db/sequence";
import { invoiceSalesOrder, isSalesOrderEditable, loadSalesOrder, loadSalesOrderItems, updateSalesOrder } from "@/lib/erp/orders";
import { effectivePriceList } from "@/lib/erp/pricing";
import { activeRow, claimStatus, cleanText, documentById, insertRow, isIsoDay, nowIso, updateRow } from "@/lib/erp/tradeDb";
import { todayIso } from "@/lib/utils";
import type { Customer, Invoice, SalesOrder } from "@/types";
import { assertChanges, type EditActor, type RowChanges, type SaveResult } from "./guard";

const label = (number: number | null | undefined) => formatSequence("sales_orders", number);

function checkDay(value: unknown, what: string): string | null {
  const day = cleanText(value as string | null | undefined);
  if (day && !isIsoDay(day)) throw new Error(`${what} inválida.`);
  return day;
}

function checkInstallments(value: unknown, prefix: string): number {
  const count = value === null || value === undefined || value === "" ? 1 : Number(value);
  if (!Number.isInteger(count) || count < 1 || count > 120) throw new Error(`${prefix}o número de parcelas deve ser um inteiro de 1 a 120.`);
  return count;
}

const HEADER_FIELDS = ["delivery_date", "payment_terms", "installments", "notes", "internal_notes", "seller_id"] as const;

type OrderPlan =
  | { mode: "header"; order: SalesOrder; patch: Record<string, unknown> }
  | { mode: "rebuild"; order: SalesOrder; merged: SalesOrder }
  | { mode: "create"; customer: Customer; row: Partial<SalesOrder>; orderDate: string; deliveryDate: string | null; installments: number };

/** Pedidos de venda pela tabela (ver o cabeçalho do arquivo). */
export async function saveSalesOrderRows(db: DatabaseLike, companyId: string, actor: EditActor, changes: RowChanges<SalesOrder>): Promise<SaveResult> {
  assertChanges(actor, changes, "sales_orders");
  const plans: OrderPlan[] = [];
  for (const patch of changes.updated) {
    const order = await loadSalesOrder(db, patch.id, companyId);
    const prefix = `${label(order.number)}: `;
    if (!isSalesOrderEditable(order)) throw new Error(`O pedido ${label(order.number)} não pode ser editado: já foi faturado, entregue ou cancelado.`);
    const merged = { ...order, ...patch } as SalesOrder;
    const values: Record<string, unknown> = {};
    for (const field of HEADER_FIELDS) if (field in patch) values[field] = field === "installments" ? checkInstallments(patch.installments, prefix) : cleanText(patch[field] as string | null | undefined);
    if ("delivery_date" in patch) checkDay(patch.delivery_date, `${prefix}data de entrega`);
    const customerChanged = "customer_id" in patch && (patch.customer_id ?? null) !== (order.customer_id ?? null);
    const dateChanged = "order_date" in patch && patch.order_date !== order.order_date;
    if (customerChanged || dateChanged) {
      if (!cleanText(merged.customer_id)) throw new Error(`${prefix}escolha o cliente.`);
      if (!(await activeRow<Customer>(db, "customers", companyId, merged.customer_id))) throw new Error(`${prefix}cliente não encontrado.`);
      if (!checkDay(merged.order_date, `${prefix}data do pedido`)) throw new Error(`${prefix}informe a data do pedido.`);
      plans.push({ mode: "rebuild", order, merged });
    } else if (Object.keys(values).length > 0) {
      plans.push({ mode: "header", order, patch: values });
    }
  }
  for (const [index, row] of changes.created.entries()) {
    const prefix = changes.created.length > 1 ? `Linha nova ${index + 1}: ` : "";
    const customerId = cleanText(row.customer_id);
    if (!customerId) throw new Error(`${prefix}escolha o cliente do pedido.`);
    const customer = await activeRow<Customer>(db, "customers", companyId, customerId);
    if (!customer) throw new Error(`${prefix}cliente não encontrado.`);
    const orderDate = checkDay(row.order_date, `${prefix}data do pedido`) ?? todayIso();
    const deliveryDate = checkDay(row.delivery_date, `${prefix}data de entrega`);
    plans.push({ mode: "create", customer, row, orderDate, deliveryDate, installments: checkInstallments(row.installments, prefix) });
  }

  const result: SaveResult = { created: [], updated: [] };
  const conflict = "O pedido mudou enquanto você editava; atualize a lista.";
  for (const plan of plans) {
    if (plan.mode === "header") {
      await claimStatus(db, "sales_orders", companyId, plan.order.id, plan.order.status, { ...plan.patch, updated_at: nowIso() }, conflict, ["invoiced_at"]);
      result.updated.push(plan.order.id);
    } else if (plan.mode === "rebuild") {
      const { order, merged } = plan;
      const items = await loadSalesOrderItems(db, companyId, order.id);
      const customerChanged = (merged.customer_id ?? null) !== (order.customer_id ?? null);
      if (items.length === 0) {
        // Rascunho ainda sem itens: só o cabeçalho (updateSalesOrder exige ao menos um item).
        const list = await effectivePriceList(db, companyId, { customerId: merged.customer_id, priceListId: customerChanged ? null : order.price_list_id, day: merged.order_date });
        const header = Object.fromEntries(HEADER_FIELDS.filter((field) => field in merged).map((field) => [field, merged[field] ?? null]));
        await claimStatus(db, "sales_orders", companyId, order.id, order.status, { ...header, customer_id: merged.customer_id, order_date: merged.order_date, price_list_id: list?.id ?? null, updated_at: nowIso() }, conflict, ["invoiced_at"]);
      } else {
        await updateSalesOrder(db, order.id, {
          companyId,
          customerId: String(merged.customer_id),
          // Preço digitado em cada item: trocar cliente ou data não reprecifica o que já foi combinado.
          items: items.map((item) => ({ productId: item.product_id ?? null, description: item.description, unit: item.unit, qty: Number(item.qty), unitPrice: Number(item.unit_price), discount: Number(item.discount ?? 0), taxRate: Number(item.tax_rate ?? 0) })),
          userId: actor.userId,
          sellerId: merged.seller_id ?? null,
          contactId: customerChanged ? null : order.contact_id ?? null,
          priceListId: customerChanged ? null : order.price_list_id ?? null,
          locationId: order.location_id ?? null,
          orderDate: merged.order_date,
          deliveryDate: merged.delivery_date ?? null,
          paymentTerms: merged.payment_terms ?? null,
          installments: checkInstallments(merged.installments, ""),
          discount: Number(order.discount ?? 0),
          shipping: Number(order.shipping ?? 0),
          notes: merged.notes ?? null,
          internalNotes: merged.internal_notes ?? null,
        });
      }
      result.updated.push(order.id);
    } else {
      result.created.push(await createDraftOrder(db, companyId, actor, plan));
    }
  }
  return result;
}

async function createDraftOrder(db: DatabaseLike, companyId: string, actor: EditActor, plan: Extract<OrderPlan, { mode: "create" }>): Promise<string> {
  const { customer, row } = plan;
  const id = uuidv4();
  const now = nowIso();
  const number = await nextSequenceNumber(db, "sales_orders", companyId);
  const list = await effectivePriceList(db, companyId, { customerId: customer.id, day: plan.orderDate });
  await insertRow(db, "sales_orders", {
    id,
    company_id: companyId,
    number,
    customer_id: customer.id,
    price_list_id: list?.id ?? null,
    seller_id: cleanText(row.seller_id) ?? actor.userId,
    status: "rascunho",
    order_date: plan.orderDate,
    delivery_date: plan.deliveryDate,
    payment_terms: cleanText(row.payment_terms) ?? customer.payment_terms ?? null,
    installments: plan.installments,
    subtotal: 0,
    discount: 0,
    shipping: 0,
    tax_total: 0,
    total: 0,
    notes: cleanText(row.notes),
    created_by: actor.userId,
    created_at: now,
    updated_at: now,
  });
  return id;
}

// ---------------------------------------------------------------------------------------------------------------
// Faturas
// ---------------------------------------------------------------------------------------------------------------

/** Campos que mudam numa fatura já emitida (o resto vem do pedido e das parcelas). */
const INVOICE_EDITABLE = ["fiscal_number", "notes", "payment_method"] as const;
const INVOICE_FIXED = ["sales_order_id", "customer_id", "issue_date", "due_date", "installments", "total", "status", "payment_terms"] as const;

/** Faturas pela tabela (ver o cabeçalho do arquivo). */
export async function saveInvoiceRows(db: DatabaseLike, companyId: string, actor: EditActor, changes: RowChanges<Invoice>): Promise<SaveResult> {
  assertChanges(actor, changes, "invoices");
  const updates: { id: string; patch: Record<string, unknown> }[] = [];
  for (const patch of changes.updated) {
    const invoice = await documentById<Invoice>(db, "invoices", patch.id, companyId, "Fatura");
    const name = formatSequence("invoices", invoice.number);
    const fixed = INVOICE_FIXED.filter((field) => field in patch && String(patch[field] ?? "") !== String(invoice[field] ?? ""));
    if (fixed.length > 0) throw new Error(`A fatura ${name} já foi emitida: aqui só mudam número fiscal, forma de pagamento e observações. Para refazer, cancele a fatura e fature o pedido de novo.`);
    const values = Object.fromEntries(INVOICE_EDITABLE.filter((field) => field in patch).map((field) => [field, cleanText(patch[field] as string | null | undefined)]));
    if (Object.keys(values).length > 0) updates.push({ id: patch.id, patch: values });
  }
  const seen = new Set<string>();
  const creations: { orderId: string; row: Partial<Invoice>; issueDate: string; dueDate: string | null; installments?: number }[] = [];
  for (const [index, row] of changes.created.entries()) {
    const prefix = changes.created.length > 1 ? `Linha nova ${index + 1}: ` : "";
    const orderId = cleanText(row.sales_order_id);
    if (!orderId) throw new Error(`${prefix}escolha o pedido a faturar.`);
    if (seen.has(orderId)) throw new Error(`${prefix}o mesmo pedido aparece duas vezes.`);
    seen.add(orderId);
    const order = await loadSalesOrder(db, orderId, companyId);
    if (order.status === "rascunho") throw new Error(`${prefix}Confirme o pedido ${label(order.number)} antes de faturar.`);
    if (order.status === "cancelado") throw new Error(`${prefix}o pedido ${label(order.number)} está cancelado.`);
    if (order.status === "faturado" || order.invoiced_at) throw new Error(`${prefix}o pedido ${label(order.number)} já foi faturado.`);
    const issueDate = checkDay(row.issue_date, `${prefix}data de emissão`) ?? todayIso();
    const dueDate = checkDay(row.due_date, `${prefix}primeiro vencimento`);
    if (dueDate && dueDate < issueDate) throw new Error(`${prefix}o primeiro vencimento é antes da emissão.`);
    const installments = row.installments == null ? undefined : checkInstallments(row.installments, prefix);
    creations.push({ orderId, row, issueDate, dueDate, installments });
  }
  for (const { id, patch } of updates) await updateRow(db, "invoices", companyId, id, { ...patch, updated_at: nowIso() });
  const created: string[] = [];
  for (const { orderId, row, issueDate, dueDate, installments } of creations) {
    const { invoiceId } = await invoiceSalesOrder(db, orderId, {
      companyId,
      userId: actor.userId,
      issueDate,
      firstDueDate: dueDate ?? undefined,
      installments,
      paymentMethod: row.payment_method ?? null,
      notes: row.notes ?? null,
    });
    const fiscal = cleanText(row.fiscal_number);
    if (fiscal) await updateRow(db, "invoices", companyId, invoiceId, { fiscal_number: fiscal, updated_at: nowIso() });
    created.push(invoiceId);
  }
  return { created, updated: updates.map((item) => item.id) };
}
