// Baixas de contas a pagar e a receber (total ou parcial), estorno, aprovação, cancelamento e exclusão (soft delete).
// Cada baixa é uma linha em finance_settlements; paid_amount / received_amount guardam o principal já baixado.
// O banco do app (tauri-plugin-sql) não tem transação entre comandos: a baixa é gravada antes da conta, e o estorno
// marca a baixa antes de devolver o saldo, para que uma falha no meio nunca deixe dinheiro "sumir" da conta.
import { v4 as uuidv4 } from "uuid";
import { formatCurrency } from "@/lib/utils";
import { fromCents, toCents } from "@/lib/money";
import type { FinanceSettlement, FinancialStatus } from "@/types";
import {
  ENTRY_TABLE,
  PARTIAL_STATUS,
  SETTLED_STATUS,
  assertIsoDay,
  getEntry,
  settlementCash,
  type EntryKind,
  type FinanceDb,
  type FinanceEntry,
} from "./financeCommon";

export interface SettleInput {
  kind: EntryKind;
  id: string;
  /** Principal baixado (abate do saldo). */
  amount: number;
  /** Dia do pagamento/recebimento ('YYYY-MM-DD', dia local). */
  paidAt: string;
  bankAccountId?: string | null;
  paymentMethod?: string | null;
  interest?: number | null;
  fine?: number | null;
  discount?: number | null;
  notes?: string | null;
  userId?: string | null;
  /** Lançamento do extrato que originou a baixa (conciliação). */
  bankTransactionId?: string | null;
}

export interface SettleResult {
  settlementId: string;
  status: FinancialStatus;
  paid: number;
  remaining: number;
  /** Dinheiro movimentado: principal + juros + multa − desconto. */
  cash: number;
  entry: FinanceEntry;
}

function nonNegativeCents(value: number | null | undefined, label: string): number {
  const cents = toCents(Number(value ?? 0));
  if (cents < 0) throw new Error(`${label} não pode ser negativo.`);
  return cents;
}

/** Baixa (total ou parcial) de uma conta a pagar ou a receber. */
export async function settleEntry(db: FinanceDb, companyId: string, input: SettleInput): Promise<SettleResult> {
  const paidAt = assertIsoDay(input.paidAt, "Data do pagamento");
  if (!Number.isFinite(Number(input.amount))) throw new Error("Informe um valor maior que zero.");
  const entry = await getEntry(db, companyId, input.kind, input.id);
  if (entry.status === "cancelada") throw new Error("Conta cancelada não recebe baixa.");
  if (entry.remaining <= 0) throw new Error("Esta conta já está quitada.");

  const principal = toCents(Number(input.amount));
  if (principal <= 0) throw new Error("Informe um valor maior que zero.");
  if (principal > toCents(entry.remaining)) throw new Error(`O valor passa do saldo em aberto (${formatCurrency(entry.remaining)}).`);
  const interest = nonNegativeCents(input.interest, "Juros");
  const fine = nonNegativeCents(input.fine, "Multa");
  const discount = nonNegativeCents(input.discount, "Desconto");
  if (principal + interest + fine - discount < 0) throw new Error("O desconto não pode ser maior que o valor pago.");

  const paidCents = toCents(entry.paid) + principal;
  const settled = paidCents >= toCents(entry.amount);
  const status: FinancialStatus = settled ? SETTLED_STATUS[input.kind] : PARTIAL_STATUS[input.kind];
  const settlementId = uuidv4();

  await db.execute(
    "INSERT INTO finance_settlements (id, company_id, payable_id, receivable_id, amount, paid_at, bank_account_id, bank_transaction_id, payment_method, interest, fine, discount, notes, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [
      settlementId,
      companyId,
      input.kind === "payable" ? entry.id : null,
      input.kind === "receivable" ? entry.id : null,
      fromCents(principal),
      paidAt,
      input.bankAccountId ?? null,
      input.bankTransactionId ?? null,
      input.paymentMethod || null,
      fromCents(interest),
      fromCents(fine),
      fromCents(discount),
      input.notes || null,
      input.userId ?? null,
    ],
  );
  await writeEntryPayment(db, companyId, entry, fromCents(paidCents), status, settled ? paidAt : null);

  return {
    settlementId,
    status,
    paid: fromCents(paidCents),
    remaining: fromCents(Math.max(0, toCents(entry.amount) - paidCents)),
    cash: fromCents(principal + interest + fine - discount),
    entry,
  };
}

/** Grava o principal pago, o status e a data de quitação da conta. */
async function writeEntryPayment(db: FinanceDb, companyId: string, entry: FinanceEntry, paid: number, status: FinancialStatus | string, settledAt: string | null): Promise<void> {
  const [paidColumn, dateColumn] = entry.kind === "payable" ? ["paid_amount", "paid_at"] : ["received_amount", "received_at"];
  await db.execute(`UPDATE ${ENTRY_TABLE[entry.kind]} SET ${paidColumn}=?, status=?, ${dateColumn}=?, updated_at=datetime('now') WHERE company_id=? AND id=?`, [
    paid,
    status,
    settledAt,
    companyId,
    entry.id,
  ]);
}

/** Status de uma conta sem baixa: a pagar aprovada continua aprovada. */
function openStatus(entry: FinanceEntry): FinancialStatus {
  return entry.kind === "payable" && entry.approverId ? "aprovada" : "aberta";
}

async function getSettlement(db: FinanceDb, companyId: string, settlementId: string): Promise<FinanceSettlement> {
  const rows = await db.select<FinanceSettlement[]>("SELECT * FROM finance_settlements WHERE company_id=? AND id=?", [companyId, settlementId]);
  const settlement = rows[0];
  if (!settlement || settlement.deleted_at) throw new Error("Baixa não encontrada.");
  return settlement;
}

/**
 * Estorna uma baixa: marca a baixa como excluída, devolve o principal ao saldo da conta e, se a baixa veio da
 * conciliação, devolve o lançamento do extrato para pendente.
 */
export async function reverseSettlement(db: FinanceDb, companyId: string, settlementId: string): Promise<void> {
  const settlement = await getSettlement(db, companyId, settlementId);
  const kind: EntryKind = settlement.payable_id ? "payable" : "receivable";
  const entryId = settlement.payable_id ?? settlement.receivable_id;
  if (!entryId) throw new Error("Baixa sem conta ligada.");
  const entry = await getEntry(db, companyId, kind, entryId);

  await db.execute("UPDATE finance_settlements SET deleted_at=datetime('now'), updated_at=datetime('now') WHERE company_id=? AND id=?", [companyId, settlementId]);
  const paidCents = Math.max(0, toCents(entry.paid) - toCents(Number(settlement.amount)));
  const status = paidCents > 0 ? PARTIAL_STATUS[kind] : openStatus(entry);
  await writeEntryPayment(db, companyId, entry, fromCents(paidCents), status, null);

  if (settlement.bank_transaction_id) {
    await db.execute(
      "UPDATE bank_transactions SET status=?, payable_id=?, receivable_id=?, reconciled_at=?, reconciled_by=?, updated_at=datetime('now') WHERE company_id=? AND id=?",
      ["pendente", null, null, null, null, companyId, settlement.bank_transaction_id],
    );
  }
}

/** Baixas ativas de uma conta, da mais antiga para a mais nova. */
export async function listSettlements(db: FinanceDb, companyId: string, kind: EntryKind, id: string): Promise<FinanceSettlement[]> {
  const column = kind === "payable" ? "payable_id" : "receivable_id";
  const rows = await db.select<FinanceSettlement[]>(`SELECT * FROM finance_settlements WHERE company_id=? AND ${column}=? AND deleted_at IS NULL`, [companyId, id]);
  return [...rows].sort((a, b) => a.paid_at.localeCompare(b.paid_at) || a.created_at.localeCompare(b.created_at));
}

/** Aprova uma conta a pagar em aberto (sem baixa). */
export async function approvePayable(db: FinanceDb, companyId: string, id: string, userId: string): Promise<void> {
  const entry = await getEntry(db, companyId, "payable", id);
  if (!["aberta", "vencida"].includes(entry.status) || entry.paid > 0) throw new Error("Só contas em aberto, sem pagamento, podem ser aprovadas.");
  await db.execute("UPDATE payables SET status=?, approver_id=?, updated_at=datetime('now') WHERE company_id=? AND id=?", ["aprovada", userId, companyId, id]);
}

async function assertNoSettlements(db: FinanceDb, companyId: string, entry: FinanceEntry, action: string): Promise<void> {
  const settlements = await listSettlements(db, companyId, entry.kind, entry.id);
  if (settlements.length > 0) throw new Error(`Estorne as baixas antes de ${action} a conta.`);
}

/** Cancela uma conta sem baixas (continua na lista, fora dos totais). */
export async function cancelEntry(db: FinanceDb, companyId: string, kind: EntryKind, id: string): Promise<void> {
  const entry = await getEntry(db, companyId, kind, id);
  await assertNoSettlements(db, companyId, entry, "cancelar");
  if (entry.status === SETTLED_STATUS[kind]) throw new Error("Conta quitada não pode ser cancelada.");
  await db.execute(`UPDATE ${ENTRY_TABLE[kind]} SET status=?, updated_at=datetime('now') WHERE company_id=? AND id=?`, ["cancelada", companyId, id]);
}

/** Exclui (soft delete) uma conta sem baixas ativas. */
export async function deleteEntry(db: FinanceDb, companyId: string, kind: EntryKind, id: string): Promise<void> {
  const entry = await getEntry(db, companyId, kind, id);
  await assertNoSettlements(db, companyId, entry, "excluir");
  await db.execute(`UPDATE ${ENTRY_TABLE[kind]} SET deleted_at=datetime('now'), updated_at=datetime('now') WHERE company_id=? AND id=?`, [companyId, id]);
}

export { settlementCash };
