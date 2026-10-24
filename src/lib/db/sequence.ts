import type { DatabaseLike } from "./demo";

/** Tabelas com `number` sequencial por empresa (migration 0008). */
export const SEQUENCE_PREFIX = {
  sales_orders: "PV",
  invoices: "FAT",
  purchase_orders: "PC",
  goods_receipts: "REC",
  proposals: "PROP",
  inventory_counts: "INV",
} as const;

export type SequenceTable = keyof typeof SEQUENCE_PREFIX;

const WIDTH = 5;

/**
 * Próximo número do documento na empresa: maior número já usado + 1, contando os excluídos (soft delete),
 * para nunca reaproveitar um número. Sem MAX(): o banco demo só entende SELECT * com ORDER BY/LIMIT.
 * Duas gravações simultâneas podem pegar o mesmo número; o UNIQUE(company_id, number) recusa a segunda.
 */
export async function nextSequenceNumber(db: DatabaseLike, table: SequenceTable, companyId: string): Promise<number> {
  const rows = await db.select<{ number: number | null }[]>(
    `SELECT * FROM ${table} WHERE company_id=? AND number IS NOT NULL ORDER BY number DESC LIMIT 1`,
    [companyId]
  );
  const last = Number(rows[0]?.number ?? 0);
  return (Number.isFinite(last) ? Math.trunc(last) : 0) + 1;
}

/** "PV-00012"; sem número (proposta antiga) → "—". */
export function formatSequence(table: SequenceTable, number: number | null | undefined): string {
  if (number == null) return "—";
  return `${SEQUENCE_PREFIX[table]}-${String(number).padStart(WIDTH, "0")}`;
}
