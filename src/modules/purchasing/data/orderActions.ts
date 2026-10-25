// Ações do pedido de compra e do recebimento com a permissão conferida na camada de dados (além dos botões que a
// tela esconde): aprovar exige "approve", enviar e cancelar "edit", excluir "delete", receber e estornar "receive".
// As regras de cada ação continuam em lib/erp/receiving; aqui só entram a permissão e o evento do histórico.
import type { DatabaseLike } from "@/lib/db/demo";
import { formatSequence } from "@/lib/db/sequence";
import {
  approvePurchaseOrder,
  cancelPurchaseOrder,
  deletePurchaseOrder,
  loadPurchaseOrder,
  receivePurchaseOrder,
  reverseGoodsReceipt,
  sendPurchaseOrder,
  type ReceiveLineInput,
  type ReceiveOptions,
  type ReceiveResult,
} from "@/lib/erp/receiving";
import { activeRow } from "@/lib/erp/tradeDb";
import { emit } from "@/lib/events/bus";
import type { GoodsReceipt } from "@/types";
import { requirePermission, type EditContext } from "@/modules/finance/data/guard";

const RESOURCE = "purchase_orders" as const;

async function orderLabel(db: DatabaseLike, ctx: EditContext, orderId: string): Promise<string> {
  return formatSequence("purchase_orders", (await loadPurchaseOrder(db, orderId, ctx.companyId)).number);
}

async function log(ctx: EditContext, type: string, entityType: string, entityId: string, title: string): Promise<void> {
  await emit({ type, companyId: ctx.companyId, actorId: ctx.userId, entityType, entityId, title, module: "purchasing" });
}

export async function approveOrder(db: DatabaseLike, ctx: EditContext, orderId: string): Promise<void> {
  requirePermission(ctx.role, "approve", RESOURCE);
  await approvePurchaseOrder(db, orderId, { companyId: ctx.companyId, userId: ctx.userId });
  await log(ctx, "purchase_order.approved", "purchase_order", orderId, `Pedido de compra ${await orderLabel(db, ctx, orderId)} aprovado`);
}

export async function sendOrder(db: DatabaseLike, ctx: EditContext, orderId: string): Promise<void> {
  requirePermission(ctx.role, "edit", RESOURCE);
  await sendPurchaseOrder(db, orderId, { companyId: ctx.companyId, userId: ctx.userId });
  await log(ctx, "purchase_order.sent", "purchase_order", orderId, `Pedido de compra ${await orderLabel(db, ctx, orderId)} enviado ao fornecedor`);
}

export async function cancelOrder(db: DatabaseLike, ctx: EditContext, orderId: string, reason: string): Promise<void> {
  requirePermission(ctx.role, "edit", RESOURCE);
  await cancelPurchaseOrder(db, orderId, { companyId: ctx.companyId, userId: ctx.userId, reason });
  await log(ctx, "purchase_order.cancelled", "purchase_order", orderId, `Pedido de compra ${await orderLabel(db, ctx, orderId)} cancelado: ${reason.trim()}`);
}

export async function deleteOrder(db: DatabaseLike, ctx: EditContext, orderId: string): Promise<void> {
  requirePermission(ctx.role, "delete", RESOURCE);
  const label = await orderLabel(db, ctx, orderId);
  await deletePurchaseOrder(db, orderId, { companyId: ctx.companyId, userId: ctx.userId });
  await log(ctx, "purchase_order.deleted", "purchase_order", orderId, `Pedido de compra ${label} excluído`);
}

export async function receiveOrder(db: DatabaseLike, ctx: EditContext, orderId: string, lines: readonly ReceiveLineInput[], options: Omit<ReceiveOptions, "companyId" | "userId">): Promise<ReceiveResult> {
  requirePermission(ctx.role, "receive", RESOURCE);
  const result = await receivePurchaseOrder(db, orderId, lines, { ...options, companyId: ctx.companyId, userId: ctx.userId });
  const invoice = options.supplierInvoiceNumber?.trim();
  await log(
    ctx,
    "goods_receipt.created",
    "goods_receipt",
    result.receiptId,
    `Recebimento do pedido ${await orderLabel(db, ctx, orderId)}${invoice ? ` (NF ${invoice})` : ""}: ${result.movementIds.length} entrada(s) no estoque, ${result.payableIds.length} conta(s) a pagar`,
  );
  return result;
}

export async function reverseReceipt(db: DatabaseLike, ctx: EditContext, receiptId: string): Promise<void> {
  requirePermission(ctx.role, "receive", RESOURCE);
  const receipt = await activeRow<GoodsReceipt>(db, "goods_receipts", ctx.companyId, receiptId);
  if (!receipt) throw new Error("Recebimento não encontrado.");
  await reverseGoodsReceipt(db, receiptId, { companyId: ctx.companyId, userId: ctx.userId });
  await log(ctx, "goods_receipt.reversed", "goods_receipt", receiptId, `Recebimento ${formatSequence("goods_receipts", receipt.number)} estornado`);
}
