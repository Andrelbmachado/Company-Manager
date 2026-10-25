// Itens do pedido de compra editados na própria tabela da tela do pedido: só em rascunho (depois de aprovado, cancele e
// crie outro), permissão conferida na camada de dados e o pedido regravado de uma vez (lib/erp/receiving recalcula
// totais; preço vazio = custo atual do item de estoque ou do produto).
import type { EditableTableChanges } from "@/components/shared/EditableTable";
import type { DatabaseLike } from "@/lib/db/demo";
import { formatSequence } from "@/lib/db/sequence";
import { loadPurchaseOrder, loadPurchaseOrderItems, updatePurchaseOrder, type PurchaseItemInput } from "@/lib/erp/receiving";
import { formatQty } from "@/lib/erp/stockPosting";
import { emit } from "@/lib/events/bus";
import type { PurchaseOrder, PurchaseOrderItem } from "@/types";
import { requirePermission, requireTablePermission, rowError, type EditContext } from "@/modules/finance/data/guard";
import { headerInput, itemInputs, itemRef, lineInput, text } from "./purchaseInputs";

const PURCHASE_ORDER_RESOURCE = "purchase_orders" as const;

export interface PurchaseItemRow {
  id: string;
  /** "p:<produto>", "i:<item de estoque>" ou vazio (linha avulsa). */
  ref: string | null;
  description: string | null;
  unit: string | null;
  qty: number | null;
  unit_price: number | null;
  discount: number | null;
  tax_rate: number | null;
  total: number | null;
  /** "4 de 10" (só leitura). */
  received: string | null;
}

export function purchaseItemRow(item: PurchaseOrderItem): PurchaseItemRow {
  return {
    id: item.id,
    ref: itemRef(item),
    description: item.description,
    unit: item.unit,
    qty: Number(item.qty),
    unit_price: Number(item.unit_price),
    discount: Number(item.discount ?? 0),
    tax_rate: Number(item.tax_rate ?? 0),
    total: Number(item.total),
    received: `${formatQty(Number(item.received_qty ?? 0))} de ${formatQty(Number(item.qty))}`,
  };
}

async function draftOrder(db: DatabaseLike, ctx: EditContext, orderId: string): Promise<PurchaseOrder> {
  const order = await loadPurchaseOrder(db, orderId, ctx.companyId);
  if (order.deleted_at) throw new Error("Pedido excluído.");
  if (order.status !== "rascunho") throw new Error("Só pedido em rascunho muda os itens. Depois de aprovado, cancele e crie outro.");
  return order;
}

async function rewrite(db: DatabaseLike, ctx: EditContext, order: PurchaseOrder, items: PurchaseItemInput[]): Promise<void> {
  await updatePurchaseOrder(db, order.id, headerInput(ctx, order, {}, items));
  const label = formatSequence("purchase_orders", order.number);
  await emit({ type: "purchase_order.updated", companyId: ctx.companyId, actorId: ctx.userId, entityType: "purchase_order", entityId: order.id, title: `Itens do pedido de compra ${label} alterados`, module: "purchasing" });
}

/** Grava as alterações da tabela de itens (todas as linhas conferidas antes de regravar o pedido). */
export async function savePurchaseItemChanges(db: DatabaseLike, ctx: EditContext, orderId: string, changes: EditableTableChanges<PurchaseItemRow>): Promise<void> {
  requireTablePermission(ctx.role, PURCHASE_ORDER_RESOURCE, changes);
  if (changes.updated.length === 0 && changes.created.length === 0) return;
  const order = await draftOrder(db, ctx, orderId);
  const current = await loadPurchaseOrderItems(db, ctx.companyId, orderId);
  const inputs = itemInputs(current);
  const patches = new Map(changes.updated.map((patch) => [patch.id, patch]));
  for (const id of patches.keys()) {
    if (!current.some((item) => item.id === id)) throw rowError("Item", "item não encontrado; atualize a tabela.");
  }
  const lines = current.map((item, index) => {
    const patch = patches.get(item.id);
    return patch ? lineInput(item.description || `Item ${index + 1}`, patch, inputs[index]) : inputs[index];
  });
  changes.created.forEach((values, index) => lines.push(lineInput(text(values.description) ?? `Item novo ${index + 1}`, values)));
  await rewrite(db, ctx, order, lines);
}

/** Remove um item do rascunho (exige "edit" no pedido). */
export async function removePurchaseItem(db: DatabaseLike, ctx: EditContext, orderId: string, itemId: string): Promise<void> {
  requirePermission(ctx.role, "edit", PURCHASE_ORDER_RESOURCE);
  const order = await draftOrder(db, ctx, orderId);
  const current = await loadPurchaseOrderItems(db, ctx.companyId, orderId);
  if (!current.some((item) => item.id === itemId)) throw new Error("Item não encontrado; atualize a tabela.");
  if (current.length === 1) throw new Error("O pedido precisa de ao menos um item; para desistir dele, exclua o rascunho.");
  await rewrite(db, ctx, order, itemInputs(current.filter((item) => item.id !== itemId)));
}
