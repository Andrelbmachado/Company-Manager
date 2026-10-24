// Leituras das telas de estoque: itens com saldo por local, movimentações com nomes e transferências agrupadas.
// SQL só nos padrões do banco demo (SELECT * com WHERE col=?); junções, somas e ordenação por data em TypeScript.
import type { DatabaseLike } from "@/lib/db/demo";
import type { InventoryItem, StockBalance, StockLocation, StockMovement, StockMovementType, Supplier } from "@/types";
import { roundQty } from "./stock";

export function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, "pt-BR");
}

/** Nome de cada conta (users.id → name), uma consulta por id distinto. */
export async function userNames(db: DatabaseLike, ids: Iterable<string | null | undefined>): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (const id of new Set(ids)) {
    if (!id) continue;
    const rows = await db.select<{ id: string; name: string }[]>("SELECT id, name FROM users WHERE id=?", [id]);
    if (rows[0]?.name) names.set(id, rows[0].name);
  }
  return names;
}

/** Instante (ms) de um timestamp ISO ou do formato do SQLite ("YYYY-MM-DD HH:MM:SS", UTC). */
export function instant(value: string | null | undefined): number {
  if (!value) return 0;
  const text = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value) && !/(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? `${value.replace(" ", "T")}Z` : value;
  const time = Date.parse(text);
  return Number.isNaN(time) ? 0 : time;
}

/** Ponto de reposição: item com mínimo definido e saldo igual ou abaixo dele. */
export function isAtReorderPoint(quantity: number, minStock: number | null | undefined): boolean {
  const min = Number(minStock ?? 0);
  return min > 0 && roundQty(quantity) <= min;
}

export interface StockItemRow extends InventoryItem {
  supplier: Pick<Supplier, "id" | "name" | "document" | "email" | "phone" | "terms" | "rating"> | null;
  /** Saldo somado de todos os locais. */
  total: number;
  /** Saldo por local (location_id → quantidade). */
  byLocation: Record<string, number>;
}

export interface StockSnapshot {
  items: StockItemRow[];
  /** Locais ativos, por nome. */
  locations: StockLocation[];
}

/** Itens ativos com saldo total e por local, mais os locais ativos. */
export async function loadStockSnapshot(db: DatabaseLike, companyId: string): Promise<StockSnapshot> {
  const items = await db.select<InventoryItem[]>("SELECT * FROM inventory_items WHERE company_id=? AND deleted_at IS NULL", [companyId]);
  const suppliers = await db.select<Supplier[]>("SELECT * FROM suppliers WHERE company_id=?", [companyId]);
  const balances = await db.select<StockBalance[]>("SELECT * FROM stock_balances WHERE company_id=?", [companyId]);
  const locations = await db.select<StockLocation[]>("SELECT * FROM stock_locations WHERE company_id=? AND deleted_at IS NULL", [companyId]);
  const supplierById = new Map(suppliers.map((row) => [row.id, row]));
  const perItem = new Map<string, Record<string, number>>();
  for (const row of balances) {
    const entry = perItem.get(row.item_id) ?? {};
    entry[row.location_id] = roundQty((entry[row.location_id] ?? 0) + Number(row.quantity ?? 0));
    perItem.set(row.item_id, entry);
  }
  return {
    items: items
      .map<StockItemRow>((item) => {
        const byLocation = perItem.get(item.id) ?? {};
        const supplier = item.supplier_id ? supplierById.get(item.supplier_id) : undefined;
        return {
          ...item,
          min_stock: Number(item.min_stock ?? 0),
          max_stock: item.max_stock == null ? null : Number(item.max_stock),
          cost: Number(item.cost ?? 0),
          supplier: supplier
            ? { id: supplier.id, name: supplier.name, document: supplier.document, email: supplier.email, phone: supplier.phone, terms: supplier.terms, rating: supplier.rating }
            : null,
          total: roundQty(Object.values(byLocation).reduce((sum, value) => sum + value, 0)),
          byLocation,
        };
      })
      .sort(byName),
    locations: [...locations].sort(byName),
  };
}

export interface MovementRow extends StockMovement {
  item_name: string;
  item_unit: string;
  sku: string | null;
  from_name: string | null;
  to_name: string | null;
  user_name: string | null;
}

/** Movimentações da empresa, da mais recente para a mais antiga (até `limit`). */
export async function listStockMovements(db: DatabaseLike, companyId: string, options: { limit?: number } = {}): Promise<MovementRow[]> {
  const movements = await db.select<StockMovement[]>("SELECT * FROM stock_movements WHERE company_id=?", [companyId]);
  const items = await db.select<InventoryItem[]>("SELECT * FROM inventory_items WHERE company_id=?", [companyId]);
  const locations = await db.select<StockLocation[]>("SELECT * FROM stock_locations WHERE company_id=?", [companyId]);
  const itemById = new Map(items.map((row) => [row.id, row]));
  const locationName = new Map(locations.map((row) => [row.id, row.name]));
  const sorted = [...movements].sort((a, b) => instant(b.created_at) - instant(a.created_at) || String(b.id).localeCompare(String(a.id)));
  const limited = options.limit && options.limit > 0 ? sorted.slice(0, Math.trunc(options.limit)) : sorted;
  const users = await userNames(db, limited.map((row) => row.user_id));
  return limited.map((row) => {
    const item = itemById.get(row.item_id);
    return {
      ...row,
      quantity: Number(row.quantity),
      item_name: item?.name ?? "Item removido",
      item_unit: item?.unit ?? "un",
      sku: item?.sku ?? null,
      from_name: row.from_location_id ? locationName.get(row.from_location_id) ?? "Local removido" : null,
      to_name: row.to_location_id ? locationName.get(row.to_location_id) ?? "Local removido" : null,
      user_name: row.user_id ? users.get(row.user_id) ?? null : null,
    };
  });
}

export interface TransferSummary {
  /** ref_id da transferência (ou o id da movimentação, nas antigas sem ref_id). */
  id: string;
  created_at: string;
  from_location_id: string | null;
  to_location_id: string | null;
  from_name: string | null;
  to_name: string | null;
  user_name: string | null;
  note: string | null;
  lines: { movement_id: string; item_id: string; item_name: string; unit: string; quantity: number }[];
}

/** Agrupa as movimentações de transferência pela transferência (ref_id), mantendo a ordem (mais recente primeiro). */
export function groupTransfers(movements: readonly MovementRow[]): TransferSummary[] {
  const groups = new Map<string, TransferSummary>();
  for (const row of movements) {
    if (row.type !== "transferencia") continue;
    const key = row.ref_type === "transfer" && row.ref_id ? row.ref_id : row.id;
    const group =
      groups.get(key) ??
      {
        id: key,
        created_at: row.created_at,
        from_location_id: row.from_location_id ?? null,
        to_location_id: row.to_location_id ?? null,
        from_name: row.from_name,
        to_name: row.to_name,
        user_name: row.user_name,
        note: row.note ?? null,
        lines: [],
      };
    group.lines.push({ movement_id: row.id, item_id: row.item_id, item_name: row.item_name, unit: row.item_unit, quantity: row.quantity });
    groups.set(key, group);
  }
  return [...groups.values()];
}

export const MOVEMENT_TYPE_LABELS: Record<StockMovementType, string> = {
  entrada: "Entrada",
  saida: "Saída",
  transferencia: "Transferência",
  ajuste: "Ajuste",
};

/** Rótulo da origem do lançamento (ref_type). */
export function movementOriginLabel(refType: string | null | undefined): string {
  switch (refType) {
    case "goods_receipt":
      return "Recebimento de compra";
    case "sales_order":
      return "Pedido de venda";
    case "inventory_count":
      return "Inventário";
    case "transfer":
      return "Transferência";
    case "manual":
    case null:
    case undefined:
    case "":
      return "Lançamento manual";
    default:
      return refType;
  }
}

/** Link da origem do lançamento, quando a origem tem tela. */
export function movementOriginPath(refType: string | null | undefined, refId: string | null | undefined): string | null {
  if (!refId) return null;
  if (refType === "inventory_count") return `/inventory/inventarios/${refId}`;
  if (refType === "sales_order") return `/sales/pedidos/${refId}`;
  if (refType === "goods_receipt") return "/purchasing/recebimentos";
  return null;
}

/** Efeito da movimentação no saldo do local dado: + entrada, − saída (0 se não envolve o local). */
export function signedQuantityAt(movement: Pick<StockMovement, "quantity" | "from_location_id" | "to_location_id">, locationId: string): number {
  if (movement.to_location_id === locationId) return Number(movement.quantity);
  if (movement.from_location_id === locationId) return -Number(movement.quantity);
  return 0;
}
