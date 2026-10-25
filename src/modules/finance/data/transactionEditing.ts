// Extrato da conciliação editado na própria tabela: Adicionar cria lançamento manual (pendente) e Editar muda data,
// descrição, valor e observação só do lançamento manual ainda pendente (o importado do banco só aceita observação;
// conciliado ou ignorado, desfaça antes). Permissão "bank" conferida na camada de dados.
import type { EditableTableChanges } from "@/components/shared/EditableTable";
import { assertIsoDay, type FinanceDb } from "@/lib/erp/financeCommon";
import { addManualTransaction } from "@/lib/erp/reconcile";
import { fromCents, toCents } from "@/lib/money";
import type { BankTransaction } from "@/types";
import { requireTablePermission, rowError, type EditContext } from "./guard";

export interface TransactionRow {
  id: string;
  posted_at: string;
  description: string | null;
  /** Com sinal: entrada positiva, saída negativa. */
  amount: number;
  memo: string | null;
  /** Conta, categoria ou "—" (só leitura). */
  linked: string;
  origin: string;
}

export const ORIGIN_LABELS: Record<string, string> = { manual: "Lançamento manual", ofx: "Extrato OFX", csv: "Extrato CSV" };

export function transactionRow(transaction: BankTransaction, linked: string): TransactionRow {
  return {
    id: transaction.id,
    posted_at: transaction.posted_at.slice(0, 10),
    description: transaction.description ?? transaction.memo ?? null,
    amount: Number(transaction.amount),
    memo: transaction.memo ?? null,
    linked,
    origin: ORIGIN_LABELS[transaction.source] ?? transaction.source,
  };
}

const has = <T extends object>(patch: T, key: keyof T) => Object.prototype.hasOwnProperty.call(patch, key);
const clean = (value: unknown) => (value === null || value === undefined ? "" : String(value).trim());

/** Grava as alterações da tabela do extrato de uma conta (todas as linhas conferidas antes da primeira gravação). */
export async function saveTransactionChanges(db: FinanceDb, ctx: EditContext, bankAccountId: string, changes: EditableTableChanges<TransactionRow>): Promise<string[]> {
  requireTablePermission(ctx.role, "bank", changes);
  const updates: { id: string; posted_at: string; description: string | null; amount: number; memo: string | null }[] = [];
  for (const patch of changes.updated) {
    const current = (await db.select<BankTransaction[]>("SELECT * FROM bank_transactions WHERE company_id=? AND id=?", [ctx.companyId, patch.id]))[0];
    if (!current || current.deleted_at) throw rowError(patch.description, "lançamento do extrato não encontrado.");
    const label = current.description || current.memo || "Lançamento";
    if (current.status !== "pendente") throw rowError(label, "lançamento já conciliado ou ignorado: desfaça antes de editar.");
    const bankData = has(patch, "posted_at") || has(patch, "description") || has(patch, "amount");
    if (bankData && current.source !== "manual") throw rowError(label, "lançamento importado do extrato: data, descrição e valor vêm do banco; só a observação muda.");
    const postedAt = has(patch, "posted_at") ? clean(patch.posted_at) : current.posted_at;
    const description = has(patch, "description") ? clean(patch.description) : (current.description ?? "");
    const amount = has(patch, "amount") ? Number(patch.amount) : Number(current.amount);
    if (current.source === "manual" && !description) throw rowError(label, "informe a descrição.");
    try {
      assertIsoDay(postedAt, "Data do lançamento");
    } catch (error) {
      throw rowError(label, error instanceof Error ? error.message : "data inválida.");
    }
    if (!Number.isFinite(amount) || toCents(amount) === 0) throw rowError(label, "informe um valor diferente de zero (saída com sinal de menos).");
    updates.push({ id: current.id, posted_at: postedAt, description: description || null, amount: fromCents(toCents(amount)), memo: has(patch, "memo") ? clean(patch.memo) || null : (current.memo ?? null) });
  }
  const creates = changes.created.map((values) => {
    const label = clean(values.description) || "Linha nova";
    if (!clean(values.description)) throw rowError(label, "informe a descrição.");
    if (!clean(values.posted_at)) throw rowError(label, "informe a data.");
    const amount = Number(values.amount);
    if (!Number.isFinite(amount) || toCents(amount) === 0) throw rowError(label, "informe um valor diferente de zero (saída com sinal de menos).");
    return { postedAt: clean(values.posted_at), description: clean(values.description), amount, memo: clean(values.memo) || null };
  });

  const ids: string[] = [];
  for (const update of updates) {
    await db.execute("UPDATE bank_transactions SET posted_at=?, description=?, amount=?, memo=?, updated_at=datetime('now') WHERE company_id=? AND id=?", [
      update.posted_at,
      update.description,
      update.amount,
      update.memo,
      ctx.companyId,
      update.id,
    ]);
    ids.push(update.id);
  }
  for (const create of creates) ids.push(await addManualTransaction(db, ctx.companyId, { bankAccountId, ...create }));
  return ids;
}
