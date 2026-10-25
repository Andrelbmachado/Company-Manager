// Recebimentos editados na própria tabela: a linha nova recebe tudo o que falta do pedido escolhido no local de entrada
// do pedido (recebimento parcial ou com local por item: botão Receber mercadoria na tela do pedido); nas linhas
// gravadas só a nota fiscal e as observações mudam. Exige "receive" em pedidos de compra, conferido aqui.
import type { EditableTableChanges } from "@/components/shared/EditableTable";
import type { DatabaseLike } from "@/lib/db/demo";
import { formatSequence } from "@/lib/db/sequence";
import { canReceive, loadPurchaseOrderItems, remainingQty, type ReceiveLineInput } from "@/lib/erp/receiving";
import { activeRow, cleanText, nowIso, updateRow } from "@/lib/erp/tradeDb";
import { emit } from "@/lib/events/bus";
import { todayIso } from "@/lib/utils";
import type { GoodsReceipt, GoodsReceiptStatus, PurchaseOrder, StockLocation } from "@/types";
import { requirePermission, requireTablePermission, rowError, type EditContext } from "@/modules/finance/data/guard";
import { receiveOrder } from "./orderActions";

export interface ReceiptRow {
  id: string;
  /** "REC-00001" (só leitura). */
  number: string;
  purchase_order_id: string | null;
  /** Nome do fornecedor (só leitura). */
  supplier: string | null;
  received_at: string | null;
  supplier_invoice_number: string | null;
  status: GoodsReceiptStatus | null;
  total: number | null;
  notes: string | null;
}

export function receiptRow(receipt: GoodsReceipt, supplierName: string | null): ReceiptRow {
  return {
    id: receipt.id,
    number: formatSequence("goods_receipts", receipt.number),
    purchase_order_id: receipt.purchase_order_id ?? null,
    supplier: supplierName,
    received_at: receipt.received_at ? todayIso(new Date(receipt.received_at)) : null,
    supplier_invoice_number: receipt.supplier_invoice_number ?? null,
    status: receipt.status,
    total: Number(receipt.total ?? 0),
    notes: receipt.notes ?? null,
  };
}

const has = <T extends object>(patch: T, key: keyof T) => Object.prototype.hasOwnProperty.call(patch, key);
const text = (value: unknown) => (value === null || value === undefined ? null : cleanText(String(value)));

type Work =
  | { kind: "update"; receipt: GoodsReceipt; patch: { supplier_invoice_number?: string | null; notes?: string | null } }
  | { kind: "receive"; order: PurchaseOrder; lines: ReceiveLineInput[]; invoice: string | null; notes: string | null };

/** Grava as alterações da tabela de recebimentos (todas as linhas conferidas antes da primeira gravação). */
export async function saveReceiptChanges(db: DatabaseLike, ctx: EditContext, changes: EditableTableChanges<ReceiptRow>): Promise<string[]> {
  requireTablePermission(ctx.role, "purchase_orders", changes);
  if (changes.updated.length > 0 || changes.created.length > 0) requirePermission(ctx.role, "receive", "purchase_orders");
  const work: Work[] = [];

  for (const patch of changes.updated) {
    const receipt = await activeRow<GoodsReceipt>(db, "goods_receipts", ctx.companyId, patch.id);
    if (!receipt) throw rowError("Recebimento", "recebimento não encontrado; atualize a lista.");
    const label = formatSequence("goods_receipts", receipt.number);
    if (has(patch, "purchase_order_id") && (patch.purchase_order_id ?? null) !== (receipt.purchase_order_id ?? null)) {
      throw rowError(label, "o pedido do recebimento não muda. Estorne e receba de novo pelo pedido certo.");
    }
    const update: { supplier_invoice_number?: string | null; notes?: string | null } = {};
    if (has(patch, "supplier_invoice_number")) update.supplier_invoice_number = text(patch.supplier_invoice_number);
    if (has(patch, "notes")) update.notes = text(patch.notes);
    if (Object.keys(update).length === 0) continue;
    if (receipt.status === "estornado") throw rowError(label, "recebimento estornado não muda mais.");
    work.push({ kind: "update", receipt, patch: update });
  }

  let locations: StockLocation[] | null = null;
  const picked = new Set<string>();
  for (const values of changes.created) {
    const orderId = text(values.purchase_order_id);
    if (!orderId) throw rowError("Recebimento novo", "escolha o pedido de compra.");
    const order = await activeRow<PurchaseOrder>(db, "purchase_orders", ctx.companyId, orderId);
    if (!order) throw rowError("Recebimento novo", "pedido de compra não encontrado.");
    const label = formatSequence("purchase_orders", order.number);
    if (picked.has(order.id)) throw rowError(label, "pedido repetido: um recebimento novo por pedido.");
    picked.add(order.id);
    if (order.status === "rascunho") throw rowError(label, "Aprove o pedido de compra antes de receber.");
    if (!canReceive(order)) throw rowError(label, order.status === "recebido" ? "o pedido já foi recebido por completo." : "pedido cancelado não recebe mercadoria.");
    locations ??= await db.select<StockLocation[]>("SELECT * FROM stock_locations WHERE company_id=? AND deleted_at IS NULL", [ctx.companyId]);
    const locationId = order.location_id ?? (locations.length === 1 ? locations[0].id : null);
    if (!locationId) throw rowError(label, "o pedido não tem local de entrada. Abra o pedido e use Receber mercadoria para escolher o local de cada item.");
    const pending = (await loadPurchaseOrderItems(db, ctx.companyId, order.id)).filter((line) => remainingQty(line) > 0);
    if (pending.length === 0) throw rowError(label, "não falta nada a receber.");
    work.push({
      kind: "receive",
      order,
      lines: pending.map((line) => ({ itemId: line.id, qty: remainingQty(line), locationId })),
      invoice: text(values.supplier_invoice_number),
      notes: text(values.notes),
    });
  }

  const created: string[] = [];
  for (const item of work) {
    if (item.kind === "update") {
      await updateRow(db, "goods_receipts", ctx.companyId, item.receipt.id, { ...item.patch, updated_at: nowIso() });
      await emit({ type: "goods_receipt.updated", companyId: ctx.companyId, actorId: ctx.userId, entityType: "goods_receipt", entityId: item.receipt.id, title: `Recebimento ${formatSequence("goods_receipts", item.receipt.number)} alterado`, module: "purchasing" });
    } else {
      const result = await receiveOrder(db, ctx, item.order.id, item.lines, { receivedDate: todayIso(), supplierInvoiceNumber: item.invoice, notes: item.notes });
      created.push(result.receiptId);
    }
  }
  return created;
}
