// Movimentação de estoque das vendas (saída na entrega) e compras (entrada no recebimento, saída no estorno).
// `quantity` é sempre positiva; o sentido vem dos locais (AGENTS.md §4): entrada = to_location_id, saída =
// from_location_id. O saldo (stock_balances) é acertado aqui, lido de novo antes de cada gravação, e nunca fica negativo.
import { v4 as uuidv4 } from "uuid";
import type { DatabaseLike } from "@/lib/db/demo";
import type { InventoryItem, StockBalance, StockLocation, StockMovementType } from "@/types";
import { fail, insertRow, nowIso, updateRow } from "./tradeDb";

/** Quantidade com 3 casas (evita 0,1 + 0,2 nas somas de saldo). */
export function roundQty(value: number): number {
  return Math.round(value * 1000) / 1000 || 0;
}

export function formatQty(value: number): string {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(value);
}

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

/** Grava a movimentação e acerta os saldos de origem e destino. Recusa saída maior que o saldo do local. */
export async function postStockMovement(db: DatabaseLike, companyId: string, move: StockMoveInput): Promise<PostedMove> {
  const quantity = roundQty(move.quantity);
  if (!(quantity > 0)) fail("A quantidade da movimentação deve ser maior que zero.");
  const from = move.fromLocationId ?? null;
  const to = move.toLocationId ?? null;
  if (!from && !to) fail("A movimentação precisa de um local de origem ou de destino.");

  const balances = await db.select<StockBalance[]>("SELECT * FROM stock_balances WHERE company_id=? AND item_id=?", [companyId, move.itemId]);
  const fromRow = from ? balances.find((row) => row.location_id === from) : undefined;
  if (from && Number(fromRow?.quantity ?? 0) + 1e-9 < quantity) fail("Saldo insuficiente no local de origem.");
  const toRow = to ? balances.find((row) => row.location_id === to) : undefined;

  const id = uuidv4();
  const now = nowIso();
  await insertRow(db, "stock_movements", {
    id,
    company_id: companyId,
    item_id: move.itemId,
    type: move.type,
    quantity,
    from_location_id: from,
    to_location_id: to,
    ref_type: move.refType ?? null,
    ref_id: move.refId ?? null,
    user_id: move.userId ?? null,
    note: move.note ?? null,
    unit_cost: move.unitCost ?? null,
    created_at: now,
  });
  const restore: (() => Promise<void>)[] = [async () => void (await db.execute("DELETE FROM stock_movements WHERE company_id=? AND id=?", [companyId, id]))];
  if (fromRow) {
    await updateRow(db, "stock_balances", companyId, fromRow.id, { quantity: roundQty(Number(fromRow.quantity) - quantity), updated_at: now });
    restore.push(() => updateRow(db, "stock_balances", companyId, fromRow.id, { quantity: Number(fromRow.quantity), updated_at: nowIso() }));
  }
  if (to) {
    if (toRow) {
      await updateRow(db, "stock_balances", companyId, toRow.id, { quantity: roundQty(Number(toRow.quantity) + quantity), updated_at: now });
      restore.push(() => updateRow(db, "stock_balances", companyId, toRow.id, { quantity: Number(toRow.quantity), updated_at: nowIso() }));
    } else {
      const balanceId = uuidv4();
      await insertRow(db, "stock_balances", { id: balanceId, company_id: companyId, item_id: move.itemId, location_id: to, quantity, updated_at: now });
      restore.push(() => updateRow(db, "stock_balances", companyId, balanceId, { quantity: 0, updated_at: nowIso() }));
    }
  }
  return {
    id,
    undo: async () => {
      for (const step of restore.reverse()) await step();
    },
  };
}
