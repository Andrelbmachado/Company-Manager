// Ponto de reposição e sugestão de compra. O ponto de reposição é o estoque mínimo do item (`min_stock`): quando a
// posição (saldo de todos os locais + o que já está em pedido de compra aberto) chega nele ou abaixo, sugere comprar
// até o estoque máximo (`max_stock`; sem máximo, o dobro do mínimo), em unidades inteiras.
// SQL nos padrões do banco demo; somas e agrupamentos em TypeScript.
import { v4 as uuidv4 } from "uuid";
import type { DatabaseLike } from "@/lib/db/demo";
import { lineTotal, orderTotals, roundMoney } from "@/lib/money";
import { todayIso } from "@/lib/utils";
import type { InventoryItem, Product, PurchaseOrder, PurchaseOrderItem, StockBalance, Supplier } from "@/types";
import { insertWithNextNumber } from "./numbering";
import { activeItem, activeLocation, roundQty, StockError, validQuantity } from "./stock";

/** Pedidos de compra que ainda vão trazer mercadoria. */
export const OPEN_PURCHASE_STATUSES: readonly string[] = ["rascunho", "aprovado", "enviado", "recebido_parcial"];

export interface ReorderInput {
  onHand: number;
  onOrder: number;
  minStock: number | null | undefined;
  maxStock: number | null | undefined;
}

/** Quantidade a comprar (0 = não precisa). */
export function suggestReorderQty({ onHand, onOrder, minStock, maxStock }: ReorderInput): number {
  const min = Number(minStock ?? 0);
  if (!(min > 0)) return 0;
  const position = roundQty(Number(onHand) + Number(onOrder));
  if (position > min) return 0;
  const max = maxStock != null && Number(maxStock) > min ? Number(maxStock) : min * 2;
  return Math.max(1, Math.ceil(roundQty(max - position)));
}

/** Quantidade ainda por receber em pedidos de compra abertos, por item de estoque. */
export async function onOrderByItem(db: DatabaseLike, companyId: string): Promise<Map<string, number>> {
  const orders = await db.select<PurchaseOrder[]>("SELECT * FROM purchase_orders WHERE company_id=? AND deleted_at IS NULL", [companyId]);
  const open = new Set(orders.filter((order) => OPEN_PURCHASE_STATUSES.includes(order.status)).map((order) => order.id));
  const lines = await db.select<PurchaseOrderItem[]>("SELECT * FROM purchase_order_items WHERE company_id=? AND deleted_at IS NULL", [companyId]);
  const pending = new Map<string, number>();
  for (const line of lines) {
    if (!line.inventory_item_id || !open.has(line.order_id)) continue;
    const missing = Math.max(0, roundQty(Number(line.qty ?? 0) - Number(line.received_qty ?? 0)));
    if (missing > 0) pending.set(line.inventory_item_id, roundQty((pending.get(line.inventory_item_id) ?? 0) + missing));
  }
  return pending;
}

export interface ReorderSuggestion {
  item_id: string;
  name: string;
  sku: string | null;
  unit: string;
  /** Preço unitário que vai no pedido de compra: o custo do item em centavos (ver purchaseUnitPrice). */
  cost: number;
  supplier_id: string | null;
  supplier_name: string | null;
  min_stock: number;
  max_stock: number | null;
  /** Saldo somado de todos os locais. */
  on_hand: number;
  /** Ainda por receber em pedidos de compra abertos. */
  on_order: number;
  suggested_qty: number;
  /** suggested_qty × cost: o mesmo total que o pedido gerado vai ter. */
  estimated_cost: number;
}

/** Preço unitário da compra: custo do item arredondado a centavos (o custo pode ter mais casas). */
function purchaseUnitPrice(item: Pick<InventoryItem, "cost">): number {
  return roundMoney(Number(item.cost ?? 0) || 0);
}

async function activeSuppliers(db: DatabaseLike, companyId: string): Promise<Map<string, Supplier>> {
  const rows = await db.select<Supplier[]>("SELECT * FROM suppliers WHERE company_id=? AND deleted_at IS NULL", [companyId]);
  return new Map(rows.map((row) => [row.id, row]));
}

/** Fornecedor por nome; "sem fornecedor" por último; depois o item por nome. */
function bySupplierThenName(a: { supplier_name: string | null; name: string }, b: { supplier_name: string | null; name: string }): number {
  if (a.supplier_name !== b.supplier_name) {
    if (a.supplier_name == null) return 1;
    if (b.supplier_name == null) return -1;
    return a.supplier_name.localeCompare(b.supplier_name, "pt-BR");
  }
  return a.name.localeCompare(b.name, "pt-BR");
}

/** Itens no ponto de reposição, com a quantidade sugerida e o custo estimado. */
export async function reorderSuggestions(db: DatabaseLike, companyId: string): Promise<ReorderSuggestion[]> {
  const items = await db.select<InventoryItem[]>("SELECT * FROM inventory_items WHERE company_id=? AND deleted_at IS NULL", [companyId]);
  const balances = await db.select<StockBalance[]>("SELECT * FROM stock_balances WHERE company_id=?", [companyId]);
  const suppliers = await activeSuppliers(db, companyId);
  const onOrder = await onOrderByItem(db, companyId);
  const onHand = new Map<string, number>();
  for (const row of balances) onHand.set(row.item_id, roundQty((onHand.get(row.item_id) ?? 0) + Number(row.quantity ?? 0)));

  const suggestions: ReorderSuggestion[] = [];
  for (const item of items) {
    const hand = onHand.get(item.id) ?? 0;
    const ordered = onOrder.get(item.id) ?? 0;
    const maxStock = item.max_stock == null ? null : Number(item.max_stock);
    const suggested = suggestReorderQty({ onHand: hand, onOrder: ordered, minStock: item.min_stock, maxStock });
    if (suggested <= 0) continue;
    const supplier = item.supplier_id ? suppliers.get(item.supplier_id) : undefined;
    const cost = purchaseUnitPrice(item);
    suggestions.push({
      item_id: item.id,
      name: item.name,
      sku: item.sku ?? null,
      unit: item.unit || "un",
      cost,
      supplier_id: supplier?.id ?? null,
      supplier_name: supplier?.name ?? null,
      min_stock: Number(item.min_stock ?? 0),
      max_stock: maxStock,
      on_hand: hand,
      on_order: ordered,
      suggested_qty: suggested,
      estimated_cost: lineTotal(suggested, cost),
    });
  }
  return suggestions.sort(bySupplierThenName);
}

export interface ReorderOrderInput {
  companyId: string;
  userId?: string | null;
  /** Local onde a mercadoria vai entrar (purchase_orders.location_id). */
  locationId?: string | null;
  lines: readonly { itemId: string; qty: number }[];
  notes?: string | null;
}

export interface CreatedPurchaseOrder {
  id: string;
  number: number;
  supplier_id: string | null;
  supplier_name: string | null;
  total: number;
  item_count: number;
}

/**
 * Gera pedidos de compra em **rascunho**, um por fornecedor do item (itens sem fornecedor vão num pedido sem fornecedor),
 * com o custo do item como preço. Quem compra revisa, aprova e envia na tela de Compras.
 * TODO(integração): quando o módulo de Compras (Tarefa 8, vendas/compras) tiver `createPurchaseOrder` em
 * src/lib/erp/orders.ts, gravar por ele para manter uma regra só de totais e numeração.
 */
export async function createReorderPurchaseOrders(db: DatabaseLike, input: ReorderOrderInput): Promise<CreatedPurchaseOrder[]> {
  const { companyId } = input;
  if (input.lines.length === 0) throw new StockError("sem_itens", "Escolha pelo menos um item para comprar.");
  const quantities = new Map<string, number>();
  for (const line of input.lines) quantities.set(line.itemId, roundQty((quantities.get(line.itemId) ?? 0) + validQuantity(line.qty)));
  const location = input.locationId ? await activeLocation(db, companyId, input.locationId) : null;
  const items: InventoryItem[] = [];
  for (const itemId of quantities.keys()) items.push(await activeItem(db, companyId, itemId));

  const suppliers = await activeSuppliers(db, companyId);
  const products = await db.select<Product[]>("SELECT * FROM products WHERE company_id=? AND deleted_at IS NULL", [companyId]);
  const productOf = new Map<string, string>();
  for (const product of products) if (product.inventory_item_id && !productOf.has(product.inventory_item_id)) productOf.set(product.inventory_item_id, product.id);

  const groups = new Map<string, { supplier: Supplier | null; items: InventoryItem[] }>();
  for (const item of items) {
    const supplier = item.supplier_id ? suppliers.get(item.supplier_id) ?? null : null;
    const key = supplier?.id ?? "";
    const group = groups.get(key) ?? { supplier, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  const ordered = [...groups.values()].sort((a, b) =>
    bySupplierThenName({ supplier_name: a.supplier?.name ?? null, name: "" }, { supplier_name: b.supplier?.name ?? null, name: "" }),
  );

  const created: CreatedPurchaseOrder[] = [];
  for (const group of ordered) {
    const lines = [...group.items]
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
      .map((item) => {
        const qty = quantities.get(item.id)!;
        const unitPrice = purchaseUnitPrice(item);
        return { item, qty, unit_price: unitPrice, total: lineTotal(qty, unitPrice) };
      });
    const totals = orderTotals(lines.map((line) => ({ qty: line.qty, unit_price: line.unit_price })));
    const orderId = uuidv4();
    const number = await insertWithNextNumber(db, "purchase_orders", companyId, (candidate) =>
      db.execute(
        `INSERT INTO purchase_orders (id, company_id, number, supplier_id, status, order_date, location_id, installments, subtotal, discount, shipping, tax_total, total, notes, created_by)
         VALUES (?, ?, ?, ?, 'rascunho', ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderId,
          companyId,
          candidate,
          group.supplier?.id ?? null,
          todayIso(),
          location?.id ?? null,
          totals.subtotal,
          totals.discount,
          totals.shipping,
          totals.tax_total,
          totals.total,
          input.notes?.trim() || "Gerado pela reposição de estoque.",
          input.userId ?? null,
        ],
      ),
    );
    for (const [index, line] of lines.entries()) {
      await db.execute(
        `INSERT INTO purchase_order_items (id, company_id, order_id, product_id, inventory_item_id, description, unit, qty, unit_price, discount, tax_rate, total, received_qty, position)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, 0, ?)`,
        [uuidv4(), companyId, orderId, productOf.get(line.item.id) ?? null, line.item.id, line.item.name, line.item.unit || "un", line.qty, line.unit_price, line.total, index + 1],
      );
    }
    created.push({ id: orderId, number, supplier_id: group.supplier?.id ?? null, supplier_name: group.supplier?.name ?? null, total: totals.total, item_count: lines.length });
  }
  return created;
}
