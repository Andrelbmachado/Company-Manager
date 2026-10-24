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
