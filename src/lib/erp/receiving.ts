// Compras: pedido de compra (rascunho → aprovado → enviado → recebido em parte → recebido, ou cancelado) e
// recebimento de mercadoria (entrada no estoque + contas a pagar em parcelas), com estorno.
// Valor de cada recebimento: a parte proporcional do total do pedido (desconto, frete e impostos rateados pela
// mercadoria recebida); o último recebimento leva o que falta, então as contas a pagar somam exatamente o total.
import { v4 as uuidv4 } from "uuid";
import type { DatabaseLike } from "@/lib/db/demo";
import { formatSequence, nextSequenceNumber } from "@/lib/db/sequence";
import { orderTotals, roundMoney, splitInstallments, sumMoney, toCents } from "@/lib/money";
import { todayIso } from "@/lib/utils";
import type { GoodsReceipt, GoodsReceiptItem, InventoryItem, Payable, Product, PurchaseOrder, PurchaseOrderItem, StockBalance, StockLocation, Supplier } from "@/types";
import { resolveDueDates, type ActionOptions } from "./orders";
import { computeLines, type ComputedLine, type LineDraft } from "./pricing";
import { assertStockAvailable, companyBalances, formatQty, postStockMovement, roundQty } from "./stockPosting";
import {
  activeRow,
  activeRows,
  activeRowsBy,
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

export interface PurchaseItemInput {
  /** Produto do catálogo (o item de estoque vem dele). */
  productId?: string | null;
  inventoryItemId?: string | null;
  description?: string | null;
  unit?: string | null;
  qty: number;
  /** Sem preço: custo do item de estoque (ou do produto). */
  unitPrice?: number | null;
  discount?: number | null;
  taxRate?: number | null;
}

export interface PurchaseOrderInput {
  companyId: string;
  supplierId: string;
  items: readonly PurchaseItemInput[];
  userId?: string | null;
  /** Local de entrada padrão do recebimento. */
  locationId?: string | null;
  orderDate?: string;
  expectedDate?: string | null;
  paymentTerms?: string | null;
  installments?: number;
  discount?: number | null;
  shipping?: number | null;
  /** Plano de contas das contas a pagar; padrão: custo das mercadorias. */
  categoryId?: string | null;
  costCenterId?: string | null;
  notes?: string | null;
}

export function loadPurchaseOrder(db: DatabaseLike, orderId: string, companyId?: string): Promise<PurchaseOrder> {
  return documentById<PurchaseOrder>(db, "purchase_orders", orderId, companyId, "Pedido de compra");
}

export async function loadPurchaseOrderItems(db: DatabaseLike, companyId: string, orderId: string): Promise<PurchaseOrderItem[]> {
  return (await activeRowsBy<PurchaseOrderItem>(db, "purchase_order_items", companyId, "order_id", orderId)).sort((a, b) => a.position - b.position);
}

/** Quanto ainda falta receber da linha. */
export function remainingQty(line: Pick<PurchaseOrderItem, "qty" | "received_qty">): number {
  return Math.max(0, roundQty(Number(line.qty) - Number(line.received_qty ?? 0)));
}

/** Pedido que ainda espera mercadoria. */
export function canReceive(order: Pick<PurchaseOrder, "status">): boolean {
  return order.status === "aprovado" || order.status === "enviado" || order.status === "recebido_parcial";
}

interface PreparedPurchase {
  supplier: Supplier;
  lines: ComputedLine[];
  totals: ReturnType<typeof orderTotals>;
  orderDate: string;
  installments: number;
  categoryId: string | null;
}

async function preparePurchase(db: DatabaseLike, input: PurchaseOrderInput): Promise<PreparedPurchase> {
  const { companyId } = input;
  const supplier = (await activeRow<Supplier>(db, "suppliers", companyId, input.supplierId)) ?? fail("Fornecedor não encontrado.");
  const orderDate = input.orderDate ?? todayIso();
  if (!isIsoDay(orderDate)) fail("Data do pedido inválida.");
  if (input.expectedDate && !isIsoDay(input.expectedDate)) fail("Previsão de entrega inválida.");
  if (input.locationId && !(await activeRow<StockLocation>(db, "stock_locations", companyId, input.locationId))) fail("Local de estoque não encontrado.");
  const installments = Number(input.installments ?? 1);
  if (!Number.isInteger(installments) || installments < 1 || installments > 120) fail("O número de parcelas deve ser um inteiro de 1 a 120.");
  const discount = Number(input.discount ?? 0);
  const shipping = Number(input.shipping ?? 0);
  if (!Number.isFinite(discount) || discount < 0) fail("O desconto do pedido não pode ser negativo.");
  if (!Number.isFinite(shipping) || shipping < 0) fail("O frete não pode ser negativo.");

  const products = new Map((await activeRows<Product>(db, "products", companyId)).map((product) => [product.id, product]));
  const stockItems = new Map((await activeRows<InventoryItem>(db, "inventory_items", companyId)).map((item) => [item.id, item]));
  const productOfItem = (itemId: string) => [...products.values()].find((product) => product.inventory_item_id === itemId && product.kind === "produto");

  const drafts = input.items.map<LineDraft>((item, index) => {
    const label = `Item ${index + 1}`;
    const product = item.productId ? products.get(item.productId) ?? fail(`${label}: produto não encontrado no catálogo.`) : undefined;
    const itemId = item.inventoryItemId ?? (product?.kind === "produto" ? product.inventory_item_id ?? null : null);
    const stockItem = itemId ? stockItems.get(itemId) ?? fail(`${label}: item de estoque não encontrado.`) : undefined;
    const linked = product ?? (stockItem ? productOfItem(stockItem.id) : undefined);
    const defaultPrice = stockItem ? Number(stockItem.cost ?? 0) : product ? Number(product.cost ?? 0) : null;
    const unitPrice = item.unitPrice ?? defaultPrice ?? fail(`${label}: informe o preço.`);
    return {
      productId: linked?.id ?? null,
      inventoryItemId: stockItem?.id ?? null,
      description: cleanText(item.description) ?? stockItem?.name ?? product?.name ?? "",
      unit: cleanText(item.unit) ?? stockItem?.unit ?? product?.unit ?? "un",
      qty: Number(item.qty),
      unitPrice: Number(unitPrice),
      discount: Number(item.discount ?? 0),
      taxRate: Number(item.taxRate ?? 0),
    };
  });
  const lines = computeLines(drafts);
  const totals = orderTotals(lines.map((line) => ({ qty: line.qty, unit_price: line.unitPrice, discount: line.discount, tax_rate: line.taxRate })), { discount, shipping });
  if (toCents(totals.discount) > toCents(totals.subtotal)) fail("O desconto do pedido é maior que o subtotal dos itens.");
  const categoryId = input.categoryId ?? (await defaultFinanceCategory(db, companyId, "despesa"));
  return { supplier, lines, totals, orderDate, installments, categoryId };
}

function purchaseItemRow(companyId: string, orderId: string, line: ComputedLine, now: string): Record<string, unknown> {
  return {
    id: uuidv4(),
    company_id: companyId,
    order_id: orderId,
    product_id: line.productId,
    inventory_item_id: line.inventoryItemId ?? null,
    description: line.description,
    unit: line.unit,
    qty: line.qty,
    unit_price: line.unitPrice,
    discount: line.discount,
    tax_rate: line.taxRate,
    total: line.total,
    received_qty: 0,
    position: line.position,
    created_at: now,
    updated_at: now,
  };
}

/** Grava o pedido de compra em rascunho com número PC sequencial. Devolve o id. */
export async function createPurchaseOrder(db: DatabaseLike, input: PurchaseOrderInput): Promise<string> {
  const { companyId } = input;
  const prepared = await preparePurchase(db, input);
  const id = uuidv4();
  const now = nowIso();
  const number = await nextSequenceNumber(db, "purchase_orders", companyId);
  await undoing(async (undo) => {
    await insertRow(db, "purchase_orders", {
      id,
      company_id: companyId,
      number,
      supplier_id: prepared.supplier.id,
      status: "rascunho",
      order_date: prepared.orderDate,
      expected_date: input.expectedDate ?? null,
      location_id: input.locationId ?? null,
      payment_terms: cleanText(input.paymentTerms) ?? cleanText(prepared.supplier.terms),
      installments: prepared.installments,
      ...prepared.totals,
      category_id: prepared.categoryId,
      cost_center_id: input.costCenterId ?? null,
      notes: cleanText(input.notes),
      created_by: input.userId ?? null,
      created_at: now,
      updated_at: now,
    });
    undo(() => updateRow(db, "purchase_orders", companyId, id, { deleted_at: nowIso() }));
    for (const line of prepared.lines) {
      const row = purchaseItemRow(companyId, id, line, now);
      await insertRow(db, "purchase_order_items", row);
      undo(() => updateRow(db, "purchase_order_items", companyId, String(row.id), { deleted_at: nowIso() }));
    }
  });
  return id;
}

/** Edita dados e itens do pedido em rascunho (depois de aprovado, só cancelando e refazendo). */
export async function updatePurchaseOrder(db: DatabaseLike, orderId: string, input: PurchaseOrderInput): Promise<void> {
  const { companyId } = input;
  const order = await loadPurchaseOrder(db, orderId, companyId);
  if (order.status !== "rascunho") fail("Só pedido de compra em rascunho pode ser editado.");
  const prepared = await preparePurchase(db, input);
  const oldItems = await loadPurchaseOrderItems(db, companyId, orderId);
  const now = nowIso();
  const patch = {
    supplier_id: prepared.supplier.id,
    order_date: prepared.orderDate,
    expected_date: input.expectedDate ?? null,
    location_id: input.locationId ?? null,
    payment_terms: cleanText(input.paymentTerms),
    installments: prepared.installments,
    ...prepared.totals,
    category_id: prepared.categoryId,
    cost_center_id: input.costCenterId ?? null,
    notes: cleanText(input.notes),
    updated_at: now,
  };
  const previous = Object.fromEntries(Object.keys(patch).map((key) => [key, (order as unknown as Record<string, unknown>)[key] ?? null]));
  await undoing(async (undo) => {
    await claimStatus(db, "purchase_orders", companyId, orderId, "rascunho", patch, "O pedido mudou enquanto você editava; recarregue a página.");
    undo(() => updateRow(db, "purchase_orders", companyId, orderId, previous));
    for (const item of oldItems) {
      await updateRow(db, "purchase_order_items", companyId, item.id, { deleted_at: now, updated_at: now });
      undo(() => updateRow(db, "purchase_order_items", companyId, item.id, { deleted_at: null }));
    }
    for (const line of prepared.lines) {
      const row = purchaseItemRow(companyId, orderId, line, now);
      await insertRow(db, "purchase_order_items", row);
      undo(() => updateRow(db, "purchase_order_items", companyId, String(row.id), { deleted_at: nowIso() }));
    }
  });
}

export async function approvePurchaseOrder(db: DatabaseLike, orderId: string, options: ActionOptions = {}): Promise<void> {
  const order = await loadPurchaseOrder(db, orderId, options.companyId);
  if (order.status !== "rascunho") fail("Só pedido de compra em rascunho pode ser aprovado.");
  const now = nowIso();
  await claimStatus(db, "purchase_orders", order.company_id, orderId, "rascunho", { status: "aprovado", approved_by: options.userId ?? null, approved_at: now, updated_at: now }, "O pedido mudou enquanto você aprovava; recarregue a página.");
}

/** Marca como enviado ao fornecedor. */
export async function sendPurchaseOrder(db: DatabaseLike, orderId: string, options: ActionOptions = {}): Promise<void> {
  const order = await loadPurchaseOrder(db, orderId, options.companyId);
  if (order.status === "rascunho") fail("Aprove o pedido de compra antes de enviar.");
  if (order.status !== "aprovado") fail("Só pedido aprovado pode ser marcado como enviado.");
  const now = nowIso();
  await claimStatus(db, "purchase_orders", order.company_id, orderId, "aprovado", { status: "enviado", sent_at: now, updated_at: now }, "O pedido mudou; recarregue a página.");
}

export async function cancelPurchaseOrder(db: DatabaseLike, orderId: string, options: ActionOptions & { reason: string }): Promise<void> {
  const order = await loadPurchaseOrder(db, orderId, options.companyId);
  const reason = cleanText(options.reason) ?? fail("Informe o motivo do cancelamento.");
  if (order.status === "cancelado") fail("O pedido já está cancelado.");
  const receipts = (await activeRowsBy<GoodsReceipt>(db, "goods_receipts", order.company_id, "purchase_order_id", orderId)).filter((receipt) => receipt.status !== "estornado");
  if (order.status === "recebido" || order.status === "recebido_parcial" || receipts.length > 0) fail("Pedido com mercadoria recebida não pode ser cancelado; estorne os recebimentos antes.");
  const now = nowIso();
  await claimStatus(db, "purchase_orders", order.company_id, orderId, order.status, { status: "cancelado", cancelled_at: now, cancel_reason: reason, updated_at: now }, "O pedido mudou enquanto você cancelava; recarregue a página.");
}

export async function deletePurchaseOrder(db: DatabaseLike, orderId: string, options: ActionOptions = {}): Promise<void> {
  const order = await loadPurchaseOrder(db, orderId, options.companyId);
  if (order.status !== "rascunho") fail("Só pedido de compra em rascunho pode ser excluído; os demais se cancelam.");
  const now = nowIso();
  await claimStatus(db, "purchase_orders", order.company_id, orderId, "rascunho", { deleted_at: now, updated_at: now }, "O pedido mudou; recarregue a página.");
  for (const item of await loadPurchaseOrderItems(db, order.company_id, orderId)) {
    await updateRow(db, "purchase_order_items", order.company_id, item.id, { deleted_at: now, updated_at: now });
  }
}

export interface ReceiveLineInput {
  /** Linha do pedido (purchase_order_items.id). */
  itemId: string;
  qty: number;
  locationId: string;
}

export interface ReceiveOptions extends ActionOptions {
  /** Dia do recebimento ('YYYY-MM-DD'); padrão: hoje. Emissão das contas a pagar. */
  receivedDate?: string;
  supplierInvoiceNumber?: string | null;
  notes?: string | null;
  /** Parcelas das contas a pagar; padrão: as do pedido. */
  installments?: number;
  /** Primeiro vencimento; padrão: recebimento + intervalo. */
  firstDueDate?: string;
  intervalDays?: number;
  dueDates?: readonly string[];
  paymentMethod?: string | null;
}

export interface ReceiveResult {
  receiptId: string;
  payableIds: string[];
  movementIds: string[];
}

/** Timestamp do recebimento: agora, se for hoje; senão, meio-dia (horário de Brasília) do dia escolhido. */
function receivedAtFor(day: string): string {
  return day === todayIso() ? nowIso() : `${day}T15:00:00.000Z`;
}

/**
 * Recebe mercadoria do pedido aprovado/enviado: entrada no estoque de cada linha com item de estoque (custo médio do
 * item e dos produtos ligados atualizado), recebimento numerado (REC), quantidade recebida nas linhas, status do pedido
 * e contas a pagar em parcelas. Tudo é conferido antes da primeira gravação.
 */
export async function receivePurchaseOrder(db: DatabaseLike, orderId: string, items: readonly ReceiveLineInput[], options: ReceiveOptions = {}): Promise<ReceiveResult> {
  const order = await loadPurchaseOrder(db, orderId, options.companyId);
  const companyId = order.company_id;
  if (order.status === "rascunho") fail("Aprove o pedido de compra antes de receber.");
  if (order.status === "cancelado") fail("Pedido cancelado não recebe mercadoria.");
  if (order.status === "recebido") fail("Este pedido já foi recebido por completo.");
  if (!canReceive(order)) fail("Este pedido não pode receber mercadoria.");
  if (items.length === 0) fail("Informe ao menos um item recebido.");

  const lines = await loadPurchaseOrderItems(db, companyId, orderId);
  const byId = new Map(lines.map((line) => [line.id, line]));
  const locations = new Map((await activeRows<StockLocation>(db, "stock_locations", companyId)).map((location) => [location.id, location]));
  const receiving = new Map<string, number>();
  for (const input of items) {
    const line = byId.get(input.itemId) ?? fail("Item do pedido não encontrado.");
    if (!locations.has(input.locationId)) fail(`${line.description}: local de estoque não encontrado.`);
    const qty = Number(input.qty);
    if (!Number.isFinite(qty) || qty <= 0) fail(`${line.description}: a quantidade recebida deve ser maior que zero.`);
    receiving.set(line.id, roundQty((receiving.get(line.id) ?? 0) + qty));
  }
  for (const [lineId, qty] of receiving) {
    const line = byId.get(lineId)!;
    const left = remainingQty(line);
    if (qty > left + 1e-9) fail(`${line.description}: recebendo ${formatQty(qty)} ${line.unit}, mas faltam só ${formatQty(left)} ${line.unit}.`);
  }

  const receivedDate = options.receivedDate ?? todayIso();
  if (!isIsoDay(receivedDate)) fail("Data do recebimento inválida.");
  const isFinal = lines.every((line) => remainingQty(line) - (receiving.get(line.id) ?? 0) <= 1e-9);
  const goods = sumMoney([...receiving].map(([lineId, qty]) => {
    const line = byId.get(lineId)!;
    return roundMoney((Number(line.total) * qty) / Number(line.qty));
  }));
  const previous = (await activeRowsBy<GoodsReceipt>(db, "goods_receipts", companyId, "purchase_order_id", orderId)).filter((receipt) => receipt.status !== "estornado");
  const orderTotal = roundMoney(Number(order.total));
  const value = isFinal
    ? Math.max(0, roundMoney(orderTotal - sumMoney(previous.map((receipt) => Number(receipt.total)))))
    : Number(order.subtotal) > 0
      ? roundMoney((orderTotal * goods) / Number(order.subtotal))
      : 0;
  const dueDates = value > 0 ? resolveDueDates(receivedDate, { installments: options.installments, firstDueDate: options.firstDueDate, intervalDays: options.intervalDays, dueDates: options.dueDates }, Number(order.installments) || 1) : [];
  const amounts = dueDates.length > 0 ? splitInstallments(value, dueDates.length) : [];

  const supplier = order.supplier_id ? await activeRow<Supplier>(db, "suppliers", companyId, order.supplier_id) : null;
  const supplierName = supplier?.name ?? "Fornecedor";
  const invoiceNumber = cleanText(options.supplierInvoiceNumber);
  const orderLabel = formatSequence("purchase_orders", order.number);
  const receiptNumber = await nextSequenceNumber(db, "goods_receipts", companyId);
  const receiptLabel = formatSequence("goods_receipts", receiptNumber);

  // Custo médio: saldo total do item (todos os locais) antes da entrada.
  const balances = await companyBalances(db, companyId);
  const stockItems = new Map((await activeRows<InventoryItem>(db, "inventory_items", companyId)).map((item) => [item.id, item]));
  const products = await activeRows<Product>(db, "products", companyId);
  const averageCost = new Map<string, { qty: number; cost: number; original: number }>();

  const receiptId = uuidv4();
  const now = nowIso();
  const payableIds: string[] = [];
  const movementIds: string[] = [];
  await undoing(async (undo) => {
    await claimStatus(
      db,
      "purchase_orders",
      companyId,
      orderId,
      order.status,
      isFinal ? { status: "recebido", received_at: now, updated_at: now } : { status: "recebido_parcial", updated_at: now },
      "O pedido mudou enquanto você recebia; recarregue a página.",
    );
    undo(() => updateRow(db, "purchase_orders", companyId, orderId, { status: order.status, received_at: order.received_at ?? null }));

    await insertRow(db, "goods_receipts", {
      id: receiptId,
      company_id: companyId,
      number: receiptNumber,
      purchase_order_id: orderId,
      supplier_id: order.supplier_id ?? null,
      location_id: items[0].locationId,
      status: "conferido",
      received_at: receivedAtFor(receivedDate),
      received_by: options.userId ?? null,
      supplier_invoice_number: invoiceNumber,
      total: value,
      notes: cleanText(options.notes),
      created_at: now,
      updated_at: now,
    });
    undo(() => updateRow(db, "goods_receipts", companyId, receiptId, { deleted_at: nowIso() }));

    for (const input of items) {
      const line = byId.get(input.itemId)!;
      const qty = roundQty(Number(input.qty));
      const unitCost = roundMoney(Number(line.total) / Number(line.qty));
      let movementId: string | null = null;
      if (line.inventory_item_id) {
        const itemId = line.inventory_item_id;
        const current = averageCost.get(itemId) ?? (() => {
          const original = Number(stockItems.get(itemId)?.cost ?? 0);
          const onHand = balances.filter((row: StockBalance) => row.item_id === itemId).reduce((total, row) => total + Math.max(0, Number(row.quantity)), 0);
          return { qty: onHand, cost: original, original };
        })();
        const newQty = roundQty(current.qty + qty);
        averageCost.set(itemId, { qty: newQty, cost: newQty > 0 ? (current.qty * current.cost + qty * unitCost) / newQty : unitCost, original: current.original });

        const posted = await postStockMovement(db, companyId, {
          itemId,
          type: "entrada",
          quantity: qty,
          toLocationId: input.locationId,
          unitCost,
          refType: "goods_receipt",
          refId: receiptId,
          userId: options.userId ?? null,
          note: `Recebimento ${receiptLabel} - ${supplierName} (${orderLabel}${invoiceNumber ? `, ${invoiceNumber}` : ""})`,
        });
        undo(posted.undo);
        movementId = posted.id;
        movementIds.push(posted.id);
      }
      const receiptItemId = uuidv4();
      await insertRow(db, "goods_receipt_items", {
        id: receiptItemId,
        company_id: companyId,
        receipt_id: receiptId,
        purchase_order_item_id: line.id,
        inventory_item_id: line.inventory_item_id ?? null,
        product_id: line.product_id ?? null,
        qty,
        unit_cost: unitCost,
        location_id: input.locationId,
        stock_movement_id: movementId,
        created_at: now,
        updated_at: now,
      });
      undo(() => updateRow(db, "goods_receipt_items", companyId, receiptItemId, { deleted_at: nowIso() }));
    }

    for (const [lineId, qty] of receiving) {
      const line = byId.get(lineId)!;
      await updateRow(db, "purchase_order_items", companyId, lineId, { received_qty: roundQty(Number(line.received_qty ?? 0) + qty), updated_at: now });
      undo(() => updateRow(db, "purchase_order_items", companyId, lineId, { received_qty: Number(line.received_qty ?? 0) }));
    }

    for (const [itemId, { cost, original }] of averageCost) {
      const rounded = roundMoney(cost);
      if (toCents(rounded) === toCents(original)) continue;
      await updateRow(db, "inventory_items", companyId, itemId, { cost: rounded, updated_at: now });
      undo(() => updateRow(db, "inventory_items", companyId, itemId, { cost: original }));
      for (const product of products.filter((row) => row.inventory_item_id === itemId)) {
        await updateRow(db, "products", companyId, product.id, { cost: rounded, updated_at: now });
        undo(() => updateRow(db, "products", companyId, product.id, { cost: product.cost }));
      }
    }

    for (const [index, dueDate] of dueDates.entries()) {
      const payableId = uuidv4();
      await insertRow(db, "payables", {
        id: payableId,
        company_id: companyId,
        description: `${supplierName} - ${orderLabel}${invoiceNumber ? ` / ${invoiceNumber}` : ""} (${index + 1}/${dueDates.length})`,
        supplier_id: order.supplier_id ?? null,
        amount: amounts[index],
        due_date: dueDate,
        status: "aberta",
        cost_center_id: order.cost_center_id ?? null,
        paid_amount: 0,
        category_id: order.category_id ?? null,
        installment_number: index + 1,
        installment_count: dueDates.length,
        payment_method: cleanText(options.paymentMethod),
        document_number: invoiceNumber,
        issue_date: receivedDate,
        competence: receivedDate.slice(0, 7),
        ref_type: "goods_receipt",
        ref_id: receiptId,
        purchase_order_id: orderId,
        goods_receipt_id: receiptId,
        created_at: now,
        updated_at: now,
      });
      undo(() => updateRow(db, "payables", companyId, payableId, { deleted_at: nowIso() }));
      payableIds.push(payableId);
    }
  });
  return { receiptId, payableIds, movementIds };
}

/** Conta a pagar com algo pago (ou baixa registrada). */
function isPaid(payable: Pick<Payable, "paid_amount" | "status">): boolean {
  return Number(payable.paid_amount ?? 0) > 0 || payable.status === "paga" || payable.status === "paga_parcial";
}

/**
 * Estorna um recebimento: saída do estoque do que entrou (se ainda houver saldo no local), quantidade recebida de volta
 * nas linhas, pedido reaberto e contas a pagar canceladas. Recusa se alguma conta já foi paga.
 */
export async function reverseGoodsReceipt(db: DatabaseLike, receiptId: string, options: ActionOptions = {}): Promise<void> {
  const receipt = await documentById<GoodsReceipt>(db, "goods_receipts", receiptId, options.companyId, "Recebimento");
  const companyId = receipt.company_id;
  if (receipt.status === "estornado") fail("Este recebimento já foi estornado.");
  const payables = (await activeRowsBy<Payable>(db, "payables", companyId, "goods_receipt_id", receiptId)).filter((row) => row.status !== "cancelada");
  let settlements = 0;
  for (const row of payables) settlements += (await activeRowsBy<{ id: string }>(db, "finance_settlements", companyId, "payable_id", row.id)).length;
  if (payables.some(isPaid) || settlements > 0) fail("Há contas a pagar deste recebimento já pagas: estorne os pagamentos no Financeiro antes.");

  const receiptItems = await activeRowsBy<GoodsReceiptItem>(db, "goods_receipt_items", companyId, "receipt_id", receiptId);
  const stockLines = receiptItems.filter((item) => item.inventory_item_id && item.location_id && item.stock_movement_id);
  await assertStockAvailable(db, companyId, stockLines.map((item) => ({ itemId: item.inventory_item_id!, locationId: item.location_id!, quantity: Number(item.qty) })));

  const order = receipt.purchase_order_id ? await activeRow<PurchaseOrder>(db, "purchase_orders", companyId, receipt.purchase_order_id) : null;
  const lines = order ? await loadPurchaseOrderItems(db, companyId, order.id) : [];
  const giveBack = new Map<string, number>();
  for (const item of receiptItems) {
    if (item.purchase_order_item_id) giveBack.set(item.purchase_order_item_id, roundQty((giveBack.get(item.purchase_order_item_id) ?? 0) + Number(item.qty)));
  }
  const newReceived = new Map(lines.map((line) => [line.id, Math.max(0, roundQty(Number(line.received_qty ?? 0) - (giveBack.get(line.id) ?? 0)))]));
  const label = formatSequence("goods_receipts", receipt.number);
  const now = nowIso();

  await undoing(async (undo) => {
    await claimStatus(db, "goods_receipts", companyId, receiptId, "conferido", { status: "estornado", reversed_at: now, updated_at: now }, "O recebimento mudou enquanto você estornava; recarregue a página.");
    undo(() => updateRow(db, "goods_receipts", companyId, receiptId, { status: "conferido", reversed_at: null }));
    for (const item of stockLines) {
      const posted = await postStockMovement(db, companyId, {
        itemId: item.inventory_item_id!,
        type: "saida",
        quantity: Number(item.qty),
        fromLocationId: item.location_id!,
        unitCost: Number(item.unit_cost ?? 0),
        refType: "goods_receipt",
        refId: receiptId,
        userId: options.userId ?? null,
        note: `Estorno do recebimento ${label}`,
      });
      undo(posted.undo);
    }
    for (const line of lines) {
      if (!giveBack.has(line.id)) continue;
      await updateRow(db, "purchase_order_items", companyId, line.id, { received_qty: newReceived.get(line.id) ?? 0, updated_at: now });
      undo(() => updateRow(db, "purchase_order_items", companyId, line.id, { received_qty: Number(line.received_qty ?? 0) }));
    }
    if (order && order.status !== "cancelado") {
      const anyReceived = [...newReceived.values()].some((qty) => qty > 0);
      const status = anyReceived ? "recebido_parcial" : order.sent_at ? "enviado" : "aprovado";
      await updateRow(db, "purchase_orders", companyId, order.id, { status, received_at: null, updated_at: now });
      undo(() => updateRow(db, "purchase_orders", companyId, order.id, { status: order.status, received_at: order.received_at ?? null }));
    }
    for (const row of payables) {
      await updateRow(db, "payables", companyId, row.id, { status: "cancelada", updated_at: now });
      undo(() => updateRow(db, "payables", companyId, row.id, { status: row.status }));
    }
  });
}
