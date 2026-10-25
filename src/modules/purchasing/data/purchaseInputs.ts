// Conversões comuns das tabelas de Compras: itens gravados e linhas digitadas no formato de entrada de
// lib/erp/receiving (para regravar o rascunho de uma vez) e a conferência de cada linha com o nome dela na mensagem.
import type { PurchaseItemInput, PurchaseOrderInput } from "@/lib/erp/receiving";
import { cleanText } from "@/lib/erp/tradeDb";
import { todayIso } from "@/lib/utils";
import type { PurchaseOrder, PurchaseOrderItem } from "@/types";
import { rowError, type EditContext } from "@/modules/finance/data/guard";

export const has = <T extends object>(patch: T, key: keyof T) => Object.prototype.hasOwnProperty.call(patch, key);
export const text = (value: unknown) => (value === null || value === undefined ? null : cleanText(String(value)));

/** "p:<produto>", "i:<item de estoque>" ou vazio (linha avulsa). */
export function itemRef(item: Pick<PurchaseOrderItem, "product_id" | "inventory_item_id">): string {
  return item.product_id ? `p:${item.product_id}` : item.inventory_item_id ? `i:${item.inventory_item_id}` : "";
}

export function refIds(ref: string | null): Pick<PurchaseItemInput, "productId" | "inventoryItemId"> {
  if (ref?.startsWith("p:")) return { productId: ref.slice(2), inventoryItemId: null };
  if (ref?.startsWith("i:")) return { productId: null, inventoryItemId: ref.slice(2) };
  return { productId: null, inventoryItemId: null };
}

/** Itens gravados no formato de entrada do pedido (para regravar o rascunho sem mudar os itens). */
export function itemInputs(items: readonly PurchaseOrderItem[]): PurchaseItemInput[] {
  return items.map((item) => ({
    productId: item.product_id ?? null,
    inventoryItemId: item.inventory_item_id ?? null,
    description: item.description,
    unit: item.unit,
    qty: Number(item.qty),
    unitPrice: Number(item.unit_price),
    discount: Number(item.discount ?? 0),
    taxRate: Number(item.tax_rate ?? 0),
  }));
}

/** Campos do cabeçalho que as tabelas editam (nomes das colunas). */
export interface HeaderFields {
  supplier_id: string | null;
  order_date: string | null;
  expected_date: string | null;
  location_id: string | null;
  payment_terms: string | null;
  installments: number | null;
  discount: number | null;
  shipping: number | null;
  notes: string | null;
}

/** Cabeçalho gravado + o que mudou, no formato de entrada (categoria e centro de custo ficam como estão). */
export function headerInput(ctx: EditContext, order: PurchaseOrder, patch: Partial<HeaderFields>, items: PurchaseItemInput[]): PurchaseOrderInput {
  const pick = <K extends keyof HeaderFields>(key: K, current: unknown) => (has(patch, key) ? patch[key] : current);
  return {
    companyId: ctx.companyId,
    userId: ctx.userId,
    supplierId: text(pick("supplier_id", order.supplier_id)),
    orderDate: text(pick("order_date", order.order_date?.slice(0, 10))) ?? todayIso(),
    expectedDate: text(pick("expected_date", order.expected_date?.slice(0, 10))),
    locationId: text(pick("location_id", order.location_id)),
    paymentTerms: text(pick("payment_terms", order.payment_terms)),
    installments: Number(pick("installments", order.installments) ?? 1),
    discount: Number(pick("discount", order.discount) ?? 0),
    shipping: Number(pick("shipping", order.shipping) ?? 0),
    notes: text(pick("notes", order.notes)),
    items,
  };
}

/** Valores digitados de uma linha de item (nomes das colunas da tabela de itens). */
export interface LineValues {
  ref?: string | null;
  description?: string | null;
  unit?: string | null;
  qty?: number | null;
  unit_price?: number | null;
  discount?: number | null;
  tax_rate?: number | null;
}

/**
 * Linha conferida no formato de entrada. Com `base` (item gravado), só muda o que veio em `values`; trocar o produto
 * volta descrição, unidade e custo aos do novo produto, a menos que tenham sido digitados. Custo vazio = custo atual.
 */
export function lineInput(label: string, values: LineValues, base?: PurchaseItemInput): PurchaseItemInput {
  const refChanged = !base || has(values, "ref");
  const ids = refChanged ? refIds(text(values.ref)) : { productId: base.productId ?? null, inventoryItemId: base.inventoryItemId ?? null };
  const pick = <K extends keyof LineValues>(key: K, current: unknown): unknown => (has(values, key) ? values[key] : refChanged ? null : current);
  const qty = Number(pick("qty", base?.qty));
  const price = pick("unit_price", base?.unitPrice);
  const unitPrice = price === null || price === undefined || price === "" ? null : Number(price);
  const discount = Number(pick("discount", base?.discount) ?? 0);
  const taxRate = Number(pick("tax_rate", base?.taxRate) ?? 0);
  const description = text(pick("description", base?.description));
  if (!Number.isFinite(qty) || qty <= 0) throw rowError(label, "informe a quantidade (maior que zero).");
  if (unitPrice !== null && (!Number.isFinite(unitPrice) || unitPrice < 0)) throw rowError(label, "o custo unitário não pode ser negativo.");
  if (!Number.isFinite(discount) || discount < 0) throw rowError(label, "o desconto não pode ser negativo.");
  if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) throw rowError(label, "o imposto deve ficar entre 0% e 100%.");
  if (!ids.productId && !ids.inventoryItemId) {
    if (!description) throw rowError(label, "linha avulsa precisa de descrição (ou escolha o produto).");
    if (unitPrice === null) throw rowError(label, "linha avulsa precisa do custo unitário.");
  }
  return { ...ids, description, unit: text(pick("unit", base?.unit)), qty, unitPrice, discount, taxRate };
}
