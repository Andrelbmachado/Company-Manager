// Pedidos de compra editados na própria tabela (lista de Compras e dados do pedido): permissão conferida na camada de
// dados, rascunho muda por inteiro (os demais itens, desconto e frete são mantidos), pedido aprovado/enviado/recebido
// em parte só muda a previsão de entrega e as observações, e todas as linhas são conferidas antes da primeira gravação.
// Pedido novo precisa de um item (regra de lib/erp/receiving): as colunas "1º item" e "Qtd." da lista são o item 1.
import type { EditableTableChanges } from "@/components/shared/EditableTable";
import type { DatabaseLike } from "@/lib/db/demo";
import { formatSequence } from "@/lib/db/sequence";
import { createPurchaseOrder, loadPurchaseOrderItems, updatePurchaseOrder, type PurchaseOrderInput } from "@/lib/erp/receiving";
import { activeRow, isIsoDay, nowIso, updateRow } from "@/lib/erp/tradeDb";
import { emit } from "@/lib/events/bus";
import { todayIso } from "@/lib/utils";
import type { PurchaseOrder, PurchaseOrderItem, PurchaseOrderStatus, StockLocation, Supplier } from "@/types";
import { requireTablePermission, rowError, type EditContext } from "@/modules/finance/data/guard";
import { has, headerInput, itemInputs, itemRef, lineInput, text, type HeaderFields } from "./purchaseInputs";

export interface PurchaseOrderRow extends HeaderFields {
  id: string;
  /** "PC-00001" (só leitura). */
  number: string;
  /** Produto ou item de estoque do item 1 ("p:<id>" / "i:<id>"). */
  first_item: string | null;
  /** Quantidade do item 1. */
  first_qty: number | null;
  /** Quantos itens o pedido tem (só leitura). */
  item_count: number | null;
  status: PurchaseOrderStatus | null;
  total: number | null;
}

export const PURCHASE_ORDER_RESOURCE = "purchase_orders" as const;

/** Status em que o pedido ainda espera mercadoria: só previsão e observações mudam. */
const AWAITING = new Set<PurchaseOrderStatus>(["aprovado", "enviado", "recebido_parcial"]);
const LATE_FIELDS = new Set<keyof PurchaseOrderRow>(["expected_date", "notes"]);
const EDITABLE_FIELDS: (keyof PurchaseOrderRow)[] = ["supplier_id", "order_date", "expected_date", "location_id", "payment_terms", "installments", "discount", "shipping", "notes", "first_item", "first_qty"];

export function purchaseOrderRow(order: PurchaseOrder, items: readonly PurchaseOrderItem[] = []): PurchaseOrderRow {
  const first = items[0];
  return {
    id: order.id,
    number: formatSequence("purchase_orders", order.number),
    supplier_id: order.supplier_id ?? null,
    order_date: order.order_date ? order.order_date.slice(0, 10) : null,
    expected_date: order.expected_date ? order.expected_date.slice(0, 10) : null,
    location_id: order.location_id ?? null,
    payment_terms: order.payment_terms ?? null,
    installments: Number(order.installments ?? 1),
    discount: Number(order.discount ?? 0),
    shipping: Number(order.shipping ?? 0),
    first_item: first ? itemRef(first) || null : null,
    first_qty: first ? Number(first.qty) : null,
    item_count: items.length,
    status: order.status,
    total: Number(order.total ?? 0),
    notes: order.notes ?? null,
  };
}

interface Known {
  supplierIds: Set<string>;
  locationIds: Set<string>;
}

/** Conferência das regras do cabeçalho antes de gravar (as mesmas de lib/erp/receiving, com o nome da linha). */
function checkHeader(label: string, input: PurchaseOrderInput, known: Known): void {
  if (input.supplierId && !known.supplierIds.has(input.supplierId)) throw rowError(label, "fornecedor não encontrado.");
  if (input.locationId && !known.locationIds.has(input.locationId)) throw rowError(label, "local de estoque não encontrado.");
  if (!isIsoDay(input.orderDate)) throw rowError(label, "data do pedido inválida.");
  if (input.expectedDate && !isIsoDay(input.expectedDate)) throw rowError(label, "previsão de entrega inválida.");
  const installments = Number(input.installments);
  if (!Number.isInteger(installments) || installments < 1 || installments > 120) throw rowError(label, "o número de parcelas deve ser um inteiro de 1 a 120.");
  if (!Number.isFinite(Number(input.discount)) || Number(input.discount) < 0) throw rowError(label, "o desconto do pedido não pode ser negativo.");
  if (!Number.isFinite(Number(input.shipping)) || Number(input.shipping) < 0) throw rowError(label, "o frete não pode ser negativo.");
}

type Work =
  | { kind: "draft"; order: PurchaseOrder; input: PurchaseOrderInput }
  | { kind: "late"; order: PurchaseOrder; patch: { expected_date?: string | null; notes?: string | null } }
  | { kind: "create"; input: PurchaseOrderInput };

/** Grava as alterações da tabela de pedidos. Devolve os ids dos pedidos criados (em rascunho, com o item 1). */
export async function savePurchaseOrderChanges(db: DatabaseLike, ctx: EditContext, changes: EditableTableChanges<PurchaseOrderRow>): Promise<string[]> {
  requireTablePermission(ctx.role, PURCHASE_ORDER_RESOURCE, changes);
  const suppliers = await db.select<Supplier[]>("SELECT * FROM suppliers WHERE company_id=? AND deleted_at IS NULL", [ctx.companyId]);
  const locations = await db.select<StockLocation[]>("SELECT * FROM stock_locations WHERE company_id=? AND deleted_at IS NULL", [ctx.companyId]);
  const known: Known = { supplierIds: new Set(suppliers.map((row) => row.id)), locationIds: new Set(locations.map((row) => row.id)) };
  const work: Work[] = [];

  for (const patch of changes.updated) {
    const order = await activeRow<PurchaseOrder>(db, "purchase_orders", ctx.companyId, patch.id);
    if (!order) throw rowError("Pedido", "pedido não encontrado; atualize a lista.");
    const label = formatSequence("purchase_orders", order.number);
    const fields = EDITABLE_FIELDS.filter((key) => has(patch, key));
    if (fields.length === 0) continue;
    if (order.status === "rascunho") {
      const items = itemInputs(await loadPurchaseOrderItems(db, ctx.companyId, order.id));
      if (has(patch, "first_item") || has(patch, "first_qty")) {
        const values = { ...(has(patch, "first_item") ? { ref: patch.first_item } : {}), ...(has(patch, "first_qty") ? { qty: patch.first_qty } : {}) };
        items[0] = lineInput(`${label}, item 1`, values, items[0]);
      }
      const input = headerInput(ctx, order, patch, items);
      checkHeader(label, input, known);
      work.push({ kind: "draft", order, input });
    } else if (AWAITING.has(order.status)) {
      if (fields.some((key) => !LATE_FIELDS.has(key))) throw rowError(label, "pedido aprovado só muda a previsão de entrega e as observações. Para mudar o resto, cancele e crie outro.");
      const late: { expected_date?: string | null; notes?: string | null } = {};
      if (has(patch, "expected_date")) {
        late.expected_date = text(patch.expected_date);
        if (late.expected_date && !isIsoDay(late.expected_date)) throw rowError(label, "previsão de entrega inválida.");
      }
      if (has(patch, "notes")) late.notes = text(patch.notes);
      work.push({ kind: "late", order, patch: late });
    } else {
      throw rowError(label, `pedido ${order.status === "cancelado" ? "cancelado" : "recebido"} não muda mais.`);
    }
  }

  for (const values of changes.created) {
    if (!text(values.first_item)) throw rowError("Pedido novo", "escolha o 1º item (os demais entram na tela do pedido).");
    const input: PurchaseOrderInput = {
      companyId: ctx.companyId,
      userId: ctx.userId,
      supplierId: text(values.supplier_id),
      orderDate: text(values.order_date) ?? todayIso(),
      expectedDate: text(values.expected_date),
      locationId: text(values.location_id),
      paymentTerms: text(values.payment_terms),
      installments: Number(values.installments ?? 1),
      discount: Number(values.discount ?? 0),
      shipping: Number(values.shipping ?? 0),
      notes: text(values.notes),
      items: [lineInput("Pedido novo, item 1", { ref: values.first_item, qty: values.first_qty })],
    };
    checkHeader("Pedido novo", input, known);
    work.push({ kind: "create", input });
  }

  const created: string[] = [];
  for (const item of work) {
    if (item.kind === "draft") {
      await updatePurchaseOrder(db, item.order.id, item.input);
      await log(ctx, "purchase_order.updated", item.order.id, `Pedido de compra ${formatSequence("purchase_orders", item.order.number)} alterado`);
    } else if (item.kind === "late") {
      await updateRow(db, "purchase_orders", ctx.companyId, item.order.id, { ...item.patch, updated_at: nowIso() });
      await log(ctx, "purchase_order.updated", item.order.id, `Pedido de compra ${formatSequence("purchase_orders", item.order.number)}: previsão ou observações alteradas`);
    } else {
      const id = await createPurchaseOrder(db, item.input);
      const order = await activeRow<PurchaseOrder>(db, "purchase_orders", ctx.companyId, id);
      await log(ctx, "purchase_order.created", id, order ? `Pedido de compra ${formatSequence("purchase_orders", order.number)} criado` : "Pedido de compra criado");
      created.push(id);
    }
  }
  return created;
}

async function log(ctx: EditContext, type: string, entityId: string, title: string): Promise<void> {
  await emit({ type, companyId: ctx.companyId, actorId: ctx.userId, entityType: "purchase_order", entityId, title, module: "purchasing" });
}
