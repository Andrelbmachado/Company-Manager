// Movimentação de estoque das vendas (saída na entrega) e compras (entrada no recebimento, saída no estorno).
// Toda gravação passa pelo motor de estoque (src/lib/inventory/stock.ts, `recordStockMovementUndoable`): ele confere
// item e local ativos, grava o saldo com compare-and-set (nunca negativo, nunca por cima de outra janela) e o custo em
// centavos. Aqui ficam só a conferência de várias saídas de uma vez (antes de gravar) e a tradução do erro do motor.
import type { DatabaseLike } from "@/lib/db/demo";
import { formatQty, recordStockMovementUndoable, roundQty, StockError } from "@/lib/inventory/stock";
import type { InventoryItem, StockBalance, StockLocation, StockMovementType } from "@/types";
import { fail } from "./tradeDb";

export { formatQty, roundQty };

/** Saldos da empresa (stock_balances não tem deleted_at). */
export function companyBalances(db: DatabaseLike, companyId: string): Promise<StockBalance[]> {
  return db.select<StockBalance[]>("SELECT * FROM stock_balances WHERE company_id=?", [companyId]);
}

export function balanceAt(balances: readonly StockBalance[], itemId: string, locationId: string): number {
  return Number(balances.find((row) => row.item_id === itemId && row.location_id === locationId)?.quantity ?? 0);
}

export interface StockNeed {
  itemId: string;
  locationId: string;
  quantity: number;
}

/**
 * Confere de uma vez se as saídas cabem nos saldos (somando as do mesmo item e local) e recusa com a lista do que
 * falta, antes de qualquer gravação.
 */
export async function assertStockAvailable(db: DatabaseLike, companyId: string, needs: readonly StockNeed[]): Promise<void> {
  if (needs.length === 0) return;
  const balances = await companyBalances(db, companyId);
  const items = new Map((await db.select<InventoryItem[]>("SELECT * FROM inventory_items WHERE company_id=?", [companyId])).map((item) => [item.id, item]));
  const locations = new Map((await db.select<StockLocation[]>("SELECT * FROM stock_locations WHERE company_id=?", [companyId])).map((location) => [location.id, location]));
  const totals = new Map<string, StockNeed>();
  for (const need of needs) {
    const key = `${need.itemId}|${need.locationId}`;
    const current = totals.get(key);
    totals.set(key, { ...need, quantity: roundQty((current?.quantity ?? 0) + need.quantity) });
  }
  const missing = [...totals.values()]
    .filter((need) => balanceAt(balances, need.itemId, need.locationId) + 1e-9 < need.quantity)
    .map((need) => {
      const item = items.get(need.itemId);
      const unit = item?.unit ?? "un";
      return `${item?.name ?? "Item"} em ${locations.get(need.locationId)?.name ?? "local"} (precisa de ${formatQty(need.quantity)} ${unit}, tem ${formatQty(balanceAt(balances, need.itemId, need.locationId))} ${unit})`;
    });
  if (missing.length > 0) fail(`Saldo insuficiente: ${missing.join("; ")}.`);
}

export interface StockMoveInput {
  itemId: string;
  type: StockMovementType;
  quantity: number;
  fromLocationId?: string | null;
  toLocationId?: string | null;
  unitCost?: number | null;
  refType?: string | null;
  refId?: string | null;
  userId?: string | null;
  note?: string | null;
}

export interface PostedMove {
  id: string;
  /** Desfaz a movimentação (saldos de volta e a linha removida): só para gravação parcial que falhou. */
  undo: () => Promise<void>;
}

/**
 * Grava a movimentação pelo motor de estoque e devolve como desfazer. Erro de regra do estoque (saldo insuficiente,
 * item ou local excluído, saldo mexido por outra janela) vira TradeRuleError com a mesma mensagem.
 */
export async function postStockMovement(db: DatabaseLike, companyId: string, move: StockMoveInput): Promise<PostedMove> {
  try {
    return await recordStockMovementUndoable(db, {
      companyId,
      itemId: move.itemId,
      type: move.type,
      quantity: move.quantity,
      fromLocationId: move.fromLocationId ?? null,
      toLocationId: move.toLocationId ?? null,
      unitCost: move.unitCost ?? null,
      refType: move.refType ?? null,
      refId: move.refId ?? null,
      userId: move.userId ?? null,
      note: move.note ?? null,
    });
  } catch (error) {
    if (error instanceof StockError) fail(error.message);
    throw error;
  }
}
