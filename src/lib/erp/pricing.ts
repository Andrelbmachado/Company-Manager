// Preço de venda: tabela de preço (com faixas por quantidade mínima) → preço do catálogo. Linhas de pedido, fatura e
// compra com total por item (quantidade × preço − desconto em R$), sempre em centavos via src/lib/money.ts.
import type { DatabaseLike } from "@/lib/db/demo";
import { lineTotal, roundMoney, toCents } from "@/lib/money";
import { todayIso } from "@/lib/utils";
import type { Customer, PriceList, PriceListItem, Product } from "@/types";
import { activeRow, activeRows, activeRowsBy, cleanText, fail, isTrue } from "./tradeDb";

/** Tabela vale no dia: ativa, não excluída e dentro da vigência (início e fim inclusive). */
export function isPriceListValid(list: Pick<PriceList, "active" | "valid_from" | "valid_to" | "deleted_at">, day: string): boolean {
  if (list.deleted_at) return false;
  if (!isTrue(list.active)) return false;
  if (list.valid_from && day < list.valid_from.slice(0, 10)) return false;
  if (list.valid_to && day > list.valid_to.slice(0, 10)) return false;
  return true;
}

/** Faixa da tabela para a quantidade: a de maior quantidade mínima que a quantidade alcança. */
export function tierPrice(items: readonly PriceListItem[], productId: string, qty: number): PriceListItem | null {
  let best: PriceListItem | null = null;
  for (const item of items) {
    if (item.deleted_at || item.product_id !== productId) continue;
    const minQty = Number(item.min_qty ?? 1);
    if (qty + 1e-9 < minQty) continue;
    if (!best || minQty > Number(best.min_qty ?? 1)) best = item;
  }
  return best;
}

export interface PriceResolution {
  unitPrice: number;
  source: "tabela" | "catalogo";
  priceListItemId: string | null;
}

export function resolveUnitPrice(product: Pick<Product, "id" | "price">, priceListItems: readonly PriceListItem[] | null, qty: number): PriceResolution {
  const tier = priceListItems ? tierPrice(priceListItems, product.id, qty) : null;
  if (tier) return { unitPrice: roundMoney(Number(tier.price)), source: "tabela", priceListItemId: tier.id };
  return { unitPrice: roundMoney(Number(product.price ?? 0)), source: "catalogo", priceListItemId: null };
}

/**
 * Tabela que vale para o pedido: a escolhida, senão a do cliente, senão a padrão da empresa — cada uma só se estiver
 * válida no dia. Nenhuma: null (preço do catálogo).
 */
export async function effectivePriceList(
  db: DatabaseLike,
  companyId: string,
  options: { customerId?: string | null; priceListId?: string | null; day?: string },
): Promise<PriceList | null> {
  const day = options.day ?? todayIso();
  const lists = await activeRows<PriceList>(db, "price_lists", companyId);
  const valid = (id: string | null | undefined) => (id ? lists.find((list) => list.id === id && isPriceListValid(list, day)) ?? null : null);
  const chosen = valid(options.priceListId);
  if (chosen) return chosen;
  if (options.customerId) {
    const customer = await activeRow<Customer>(db, "customers", companyId, options.customerId);
    const ofCustomer = valid(customer?.price_list_id);
    if (ofCustomer) return ofCustomer;
  }
  return lists.filter((list) => isTrue(list.is_default) && isPriceListValid(list, day)).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))[0] ?? null;
}

export function loadPriceListItems(db: DatabaseLike, companyId: string, priceListId: string): Promise<PriceListItem[]> {
  return activeRowsBy<PriceListItem>(db, "price_list_items", companyId, "price_list_id", priceListId);
}

/** Linha pronta para gravar (pedido de venda, fatura, compra). Desconto em R$; taxRate em %. */
export interface LineDraft {
  productId: string | null;
  inventoryItemId?: string | null;
  description: string;
  unit: string;
  qty: number;
  unitPrice: number;
  discount: number;
  taxRate: number;
}

export interface ComputedLine extends LineDraft {
  total: number;
  position: number;
}

/** Valida e calcula o total de cada linha. Mensagens para a tela, com o número do item. */
export function computeLines(drafts: readonly LineDraft[]): ComputedLine[] {
  if (drafts.length === 0) fail("Inclua ao menos um item.");
  return drafts.map((draft, index) => {
    const label = `Item ${index + 1}`;
    const description = draft.description.trim();
    if (!description) fail(`${label}: informe a descrição.`);
    if (!Number.isFinite(draft.qty) || draft.qty <= 0) fail(`${label} (${description}): a quantidade deve ser maior que zero.`);
    if (!Number.isFinite(draft.unitPrice) || draft.unitPrice < 0) fail(`${label} (${description}): o preço não pode ser negativo.`);
    // Preço e desconto valem como gravados (2 casas): total da linha = subtotal do pedido (orderTotals usa unit_price gravado).
    const unitPrice = roundMoney(draft.unitPrice);
    const discount = roundMoney(Number.isFinite(draft.discount) ? draft.discount : 0);
    if (discount < 0) fail(`${label} (${description}): o desconto não pode ser negativo.`);
    if (toCents(discount) > toCents(draft.qty * unitPrice)) fail(`${label} (${description}): o desconto é maior que o valor do item.`);
    const taxRate = Number.isFinite(draft.taxRate) ? draft.taxRate : 0;
    if (taxRate < 0 || taxRate > 100) fail(`${label} (${description}): o imposto deve ficar entre 0% e 100%.`);
    return {
      ...draft,
      description,
      unit: cleanText(draft.unit) ?? "un",
      unitPrice,
      discount,
      taxRate,
      total: lineTotal(draft.qty, unitPrice, discount),
      position: index + 1,
    };
  });
}

/** Item de venda como vem da tela: produto do catálogo (preço da tabela se não informado) ou linha avulsa. */
export interface QuoteItemInput {
  productId?: string | null;
  description?: string | null;
  unit?: string | null;
  qty: number;
  unitPrice?: number | null;
  discount?: number | null;
  taxRate?: number | null;
}

/**
 * Monta as linhas de venda: produto ativo da empresa (descrição, unidade e imposto do catálogo, preço da tabela ou do
 * catálogo quando não digitado) ou linha avulsa com descrição e preço. Valida tudo (computeLines).
 */
export async function quoteItems(
  db: DatabaseLike,
  companyId: string,
  input: { items: readonly QuoteItemInput[]; priceListId?: string | null },
): Promise<ComputedLine[]> {
  const products = new Map((await activeRows<Product>(db, "products", companyId)).map((product) => [product.id, product]));
  const tiers = input.priceListId ? await loadPriceListItems(db, companyId, input.priceListId) : null;
  const drafts = input.items.map<LineDraft>((item, index) => {
    if (!item.productId) {
      if (item.unitPrice == null) fail(`Item ${index + 1}: informe o preço.`);
      return {
        productId: null,
        description: item.description ?? "",
        unit: item.unit ?? "un",
        qty: Number(item.qty),
        unitPrice: Number(item.unitPrice),
        discount: Number(item.discount ?? 0),
        taxRate: Number(item.taxRate ?? 0),
      };
    }
    const product = products.get(item.productId) ?? fail(`Item ${index + 1}: produto não encontrado no catálogo.`);
    if (!isTrue(product.active)) fail(`Item ${index + 1}: "${product.name}" está inativo no catálogo.`);
    const qty = Number(item.qty);
    const unitPrice = item.unitPrice != null ? Number(item.unitPrice) : resolveUnitPrice(product, tiers, qty).unitPrice;
    return {
      productId: product.id,
      inventoryItemId: product.kind === "produto" ? product.inventory_item_id ?? null : null,
      description: cleanText(item.description) ?? product.name,
      unit: cleanText(item.unit) ?? product.unit ?? "un",
      qty,
      unitPrice,
      discount: Number(item.discount ?? 0),
      taxRate: item.taxRate != null ? Number(item.taxRate) : Number(product.tax_rate ?? 0),
    };
  });
  return computeLines(drafts);
}

/** Margem sobre o preço de venda, em % com 2 casas; sem preço, null. */
export function marginPercent(price: number, cost: number): number | null {
  if (!Number.isFinite(price) || price <= 0) return null;
  return Math.round(((price - (Number(cost) || 0)) / price) * 10000) / 100;
}
