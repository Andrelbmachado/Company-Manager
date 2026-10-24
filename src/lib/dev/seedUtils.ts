// TEMPORÁRIO (login rápido de desenvolvimento): utilitários dos dados de exemplo (devSeed.ts e seeds/<area>.ts).
// SQL só nos padrões que o banco demo do navegador entende (INSERT OR IGNORE e SELECT * com WHERE col=?).
import { getDb } from "@/lib/db/client";
import { todayIso } from "@/lib/utils";
import type { Role } from "@/types";

/** Meia-noite local de hoje + `offset` dias, na hora dada (conta por calendário: não escorrega em horário de verão). */
function localDate(offset: number, hour = 0): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, hour);
}

/** 'YYYY-MM-DD' a `offset` dias de hoje, no dia local (como todayIso; o dia UTC vira depois das 21h no Brasil). */
export const day = (offset: number) => todayIso(localDate(offset));
/** Timestamp ISO (UTC, como o resto do app) a `offset` dias de hoje, na hora local dada. */
export const ts = (offset: number, hour = 9) => localDate(offset, hour).toISOString();
/** Id da conta de desenvolvimento de cada papel (criada pelo login rápido). */
export const devUserId = (role: Role) => `dev-user-${role}`;

export type SeedRow = Record<string, string | number | null>;

/** INSERT OR IGNORE linha a linha (ids fixos: rodar de novo não duplica). */
export async function insertRows(table: string, companyId: string | null, rows: SeedRow[]): Promise<void> {
  const db = await getDb();
  for (const row of rows) {
    const data = companyId ? { company_id: companyId, ...row } : row;
    const cols = Object.keys(data);
    await db.execute(
      `INSERT OR IGNORE INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
      cols.map((col) => data[col]),
    );
  }
}

/** Linhas ativas da empresa, ordenadas por id (ordenação feita aqui, não no SQL). */
export async function selectRows<T extends { id: string }>(table: string, companyId: string): Promise<T[]> {
  const db = await getDb();
  const rows = await db.select<T[]>(`SELECT * FROM ${table} WHERE company_id=? AND deleted_at IS NULL`, [companyId]);
  return [...rows].sort((a, b) => a.id.localeCompare(b.id));
}

const flagKey = (area: string) => `seed.dev.${area}.v1`;

/** Cada seed de área tem a sua flag em `settings` (independente da flag do seed principal). */
export async function hasSeedFlag(area: string, companyId: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db.select<unknown[]>("SELECT * FROM settings WHERE company_id=? AND key=?", [companyId, flagKey(area)]);
  return rows.length > 0;
}

export async function setSeedFlag(area: string, companyId: string): Promise<void> {
  const db = await getDb();
  await db.execute("INSERT OR IGNORE INTO settings (id, company_id, key, value_json) VALUES (?,?,?,?)", [
    `dev-flag-${area}-${companyId}`,
    companyId,
    flagKey(area),
    "{}",
  ]);
}

/** Linhas da empresa de uma tabela sem `deleted_at` (ex.: stock_balances, stock_movements), ordenadas por id. */
export async function selectAll<T extends { id: string }>(table: string, companyId: string): Promise<T[]> {
  const db = await getDb();
  const rows = await db.select<T[]>(`SELECT * FROM ${table} WHERE company_id=?`, [companyId]);
  return [...rows].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Conta (user_id) de cada papel na empresa, pelos vínculos (memberships): a primeira por id. Serve tanto para as
 * contas do login rápido (dev-user-<papel>) quanto para as contas do banco demo do navegador.
 */
export async function membersByRole(companyId: string): Promise<Map<Role, string>> {
  const db = await getDb();
  const rows = await db.select<{ id: string; user_id: string; role: Role; deleted_at?: string | null }[]>(
    "SELECT * FROM memberships WHERE company_id=?",
    [companyId],
  );
  const members = new Map<Role, string>();
  for (const row of [...rows].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!row.deleted_at && row.user_id && !members.has(row.role)) members.set(row.role, row.user_id);
  }
  return members;
}

/** A conta do primeiro papel da lista que existir na empresa; senão, null. */
export function memberFor(members: Map<Role, string>, ...roles: Role[]): string | null {
  for (const role of roles) {
    const userId = members.get(role);
    if (userId) return userId;
  }
  return null;
}

interface BalanceRow {
  id: string;
  item_id: string;
  location_id: string;
  quantity: number;
}

/**
 * Grava uma movimentação de estoque e acerta os saldos (stock_balances) dos locais de origem e destino, uma vez só:
 * se a movimentação já existe, não faz nada. `quantity` é sempre positiva; sai de `from_location_id` e entra em
 * `to_location_id`. Devolve false (sem gravar) quando a origem não tem saldo suficiente.
 */
export async function applyStockMovement(companyId: string, movement: SeedRow & { id: string; item_id: string; quantity: number }): Promise<boolean> {
  const db = await getDb();
  const existing = await db.select<unknown[]>("SELECT * FROM stock_movements WHERE company_id=? AND id=?", [companyId, movement.id]);
  if (existing.length > 0) return true;

  const balances = await selectAll<BalanceRow>("stock_balances", companyId);
  const balanceAt = (locationId: string) => balances.find((row) => row.item_id === movement.item_id && row.location_id === locationId);
  const from = typeof movement.from_location_id === "string" ? movement.from_location_id : null;
  const to = typeof movement.to_location_id === "string" ? movement.to_location_id : null;
  if (from && Number(balanceAt(from)?.quantity ?? 0) < movement.quantity) return false;

  await insertRows("stock_movements", companyId, [movement]);
  const now = new Date().toISOString();
  if (from) {
    const row = balanceAt(from)!;
    await db.execute("UPDATE stock_balances SET quantity=?, updated_at=? WHERE company_id=? AND id=?", [Number(row.quantity) - movement.quantity, now, companyId, row.id]);
  }
  if (to) {
    const row = balanceAt(to);
    if (row) await db.execute("UPDATE stock_balances SET quantity=?, updated_at=? WHERE company_id=? AND id=?", [Number(row.quantity) + movement.quantity, now, companyId, row.id]);
    else await insertRows("stock_balances", companyId, [{ id: `dev-balance-${movement.item_id}-${to}`, item_id: movement.item_id, location_id: to, quantity: movement.quantity }]);
  }
  return true;
}
