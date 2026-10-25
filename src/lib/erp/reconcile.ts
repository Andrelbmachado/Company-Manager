// Conciliação bancária: importar o extrato (OFX/CSV) sem duplicar, casar lançamentos com contas a pagar/receber
// (gera a baixa com o lançamento ligado), conciliar direto numa categoria (tarifa, rendimento), ignorar e desfazer.
// Regras:
// - fitid é único por conta, inclusive excluídos (índice do SQLite); aqui ele é procurado antes de gravar porque o
//   banco demo não aplica UNIQUE. Lançamento sem FITID ganha um id estável (data + valor + descrição + ordem).
// - Conciliação automática só quando há exatamente UM candidato: mesmo sentido, saldo em aberto igual ao valor, até
//   `toleranceDays` do vencimento e sem outra conta bancária definida. Empate fica pendente, com sugestões.
// - Valor do extrato menor que o saldo baixa em parte; maior quita a conta e o excesso vira juros.
import { v4 as uuidv4 } from "uuid";
import { fromCents, toCents } from "@/lib/money";
import type { BankAccount, BankTransaction, BankTransactionSource, FinanceCategory, FinanceSettlement } from "@/types";
import { assertIsoDay, daysBetween, getEntry, isIsoDay, loadEntries, type EntryKind, type FinanceDb, type FinanceEntry } from "./financeCommon";
import { reverseSettlement, settleEntry } from "./settlements";
import { lineFitid, occurrenceCounter, type BankTx } from "./statement";

export type { BankTx } from "./statement";
export { decodeStatementBytes, parseOfx, parseOfxStatement, parseStatementCsv, parseStatementFile } from "./statement";

export interface ReconcileOptions {
  /** Empresa da sessão: conta de outra empresa é recusada como inexistente. As telas sempre passam. */
  companyId?: string;
  userId?: string | null;
  source?: BankTransactionSource;
  /** Casar sozinho os lançamentos com um único candidato exato. Padrão: sim. */
  autoMatch?: boolean;
  /** Distância máxima (dias) entre o lançamento e o vencimento para casar sozinho. Padrão: 7. */
  toleranceDays?: number;
}

export interface ReconcileResult {
  companyId: string;
  imported: number;
  /** Já importados antes (mesmo fitid na conta) ou repetidos no arquivo. */
  duplicates: number;
  /** Linhas sem data ou valor válido. */
  invalid: number;
  matched: number;
  /** Importados que continuam pendentes. */
  pending: number;
  transactionIds: string[];
}

export interface MatchTarget {
  kind: EntryKind;
  id: string;
}

async function getAccount(db: FinanceDb, accountId: string): Promise<BankAccount> {
  const account = (await db.select<BankAccount[]>("SELECT * FROM bank_accounts WHERE id=?", [accountId]))[0];
  if (!account || account.deleted_at) throw new Error("Conta bancária não encontrada.");
  return account;
}

async function getTransaction(db: FinanceDb, companyId: string, id: string): Promise<BankTransaction> {
  const transaction = (await db.select<BankTransaction[]>("SELECT * FROM bank_transactions WHERE company_id=? AND id=?", [companyId, id]))[0];
  if (!transaction || transaction.deleted_at) throw new Error("Lançamento do extrato não encontrado.");
  return transaction;
}

const directionOf = (amount: number): EntryKind => (amount < 0 ? "payable" : "receivable");

/** Importa os lançamentos do extrato na conta e, por padrão, concilia os que têm um único candidato exato. */
export async function reconcile(db: FinanceDb, accountId: string, txs: readonly BankTx[], options: ReconcileOptions = {}): Promise<ReconcileResult> {
  const account = await getAccount(db, accountId);
  if (options.companyId && account.company_id !== options.companyId) throw new Error("Conta bancária não encontrada.");
  const companyId = account.company_id;
  // Inclui excluídos: lançamento apagado não volta ao reimportar.
  const existing = await db.select<BankTransaction[]>("SELECT * FROM bank_transactions WHERE company_id=? AND bank_account_id=?", [companyId, accountId]);
  const known = new Set(existing.map((row) => row.fitid).filter((fitid): fitid is string => Boolean(fitid)));
  const nextOccurrence = occurrenceCounter();
  const inserted: { id: string; tx: BankTx }[] = [];
  let duplicates = 0;
  let invalid = 0;

  for (const tx of txs) {
    const amount = Number(tx.amount);
    if (!Number.isFinite(amount) || toCents(amount) === 0 || !isIsoDay(tx.postedAt)) {
      invalid++;
      continue;
    }
    const description = (tx.description ?? "").trim() || "Lançamento";
    const fitid = tx.fitid?.trim() || lineFitid("SEMID", tx.postedAt, amount, description, nextOccurrence(tx.postedAt, amount, description));
    if (known.has(fitid)) {
      duplicates++;
      continue;
    }
    known.add(fitid);
    const id = uuidv4();
    await db.execute(
      "INSERT INTO bank_transactions (id, company_id, bank_account_id, posted_at, amount, description, memo, fitid, check_number, balance_after, source, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      [id, companyId, accountId, tx.postedAt, fromCents(toCents(amount)), description.slice(0, 250), tx.memo ?? null, fitid, tx.checkNumber ?? null, tx.balanceAfter ?? null, options.source ?? "ofx", "pendente"],
    );
    inserted.push({ id, tx: { ...tx, amount: fromCents(toCents(amount)) } });
  }

  let matched = 0;
  if (options.autoMatch !== false && inserted.length > 0) {
    const tolerance = options.toleranceDays ?? 7;
    const open = (await loadEntries(db, companyId)).filter((entry) => entry.remaining > 0 && entry.status !== "cancelada");
    const claimed = new Set<string>();
    for (const { id, tx } of inserted) {
      const kind = directionOf(tx.amount);
      const candidates = open.filter(
        (entry) =>
          entry.kind === kind &&
          !claimed.has(`${entry.kind}:${entry.id}`) &&
          toCents(entry.remaining) === Math.abs(toCents(tx.amount)) &&
          (!entry.bankAccountId || entry.bankAccountId === accountId) &&
          entry.dueDate != null &&
          Math.abs(daysBetween(entry.dueDate, tx.postedAt)) <= tolerance,
      );
      if (candidates.length !== 1) continue;
      await matchTransaction(db, companyId, id, { kind, id: candidates[0].id }, options.userId ?? null);
      claimed.add(`${kind}:${candidates[0].id}`);
      matched++;
    }
  }

  return { companyId, imported: inserted.length, duplicates, invalid, matched, pending: inserted.length - matched, transactionIds: inserted.map((item) => item.id) };
}

/**
 * Concilia um lançamento pendente com uma conta: baixa no dia do lançamento, na conta bancária do extrato, ligada ao
 * lançamento. Valor menor que o saldo = baixa parcial; maior = quita e o excesso vira juros.
 */
export async function matchTransaction(db: FinanceDb, companyId: string, transactionId: string, target: MatchTarget, userId: string | null): Promise<{ settlementId: string }> {
  const transaction = await getTransaction(db, companyId, transactionId);
  if (transaction.status !== "pendente") throw new Error("Só lançamentos pendentes podem ser conciliados.");
  const cents = toCents(Number(transaction.amount));
  if (cents === 0) throw new Error("Lançamento sem valor não concilia com conta.");
  if (cents > 0 && target.kind !== "receivable") throw new Error("Lançamento de entrada só concilia com conta a receber.");
  if (cents < 0 && target.kind !== "payable") throw new Error("Lançamento de saída só concilia com conta a pagar.");
  const entry = await getEntry(db, companyId, target.kind, target.id);
  if (entry.status === "cancelada") throw new Error("Conta cancelada não recebe baixa.");
  if (entry.remaining <= 0) throw new Error("Esta conta já está quitada.");

  const cash = Math.abs(cents);
  const principal = Math.min(cash, toCents(entry.remaining));
  const { settlementId } = await settleEntry(db, companyId, {
    kind: target.kind,
    id: target.id,
    amount: fromCents(principal),
    interest: fromCents(cash - principal),
    paidAt: transaction.posted_at.slice(0, 10),
    bankAccountId: transaction.bank_account_id,
    bankTransactionId: transaction.id,
    notes: "Conciliação bancária",
    userId,
  });
  await db.execute(
    "UPDATE bank_transactions SET status=?, payable_id=?, receivable_id=?, reconciled_at=?, reconciled_by=?, updated_at=datetime('now') WHERE company_id=? AND id=?",
    ["conciliada", target.kind === "payable" ? target.id : null, target.kind === "receivable" ? target.id : null, new Date().toISOString(), userId, companyId, transactionId],
  );
  return { settlementId };
}

/** Concilia o lançamento direto numa categoria do plano de contas (tarifa, rendimento), sem conta a pagar/receber. */
export async function categorizeTransaction(db: FinanceDb, companyId: string, transactionId: string, categoryId: string, userId: string | null): Promise<void> {
  const transaction = await getTransaction(db, companyId, transactionId);
  if (transaction.payable_id || transaction.receivable_id) throw new Error("Desfaça a conciliação com a conta antes de categorizar.");
  if (transaction.status === "ignorada") throw new Error("Lançamento ignorado: desfaça antes de categorizar.");
  const category = (await db.select<FinanceCategory[]>("SELECT * FROM finance_categories WHERE company_id=? AND id=?", [companyId, categoryId]))[0];
  if (!category || category.deleted_at) throw new Error("Categoria não encontrada.");
  await db.execute("UPDATE bank_transactions SET status=?, category_id=?, reconciled_at=?, reconciled_by=?, updated_at=datetime('now') WHERE company_id=? AND id=?", [
    "conciliada",
    categoryId,
    new Date().toISOString(),
    userId,
    companyId,
    transactionId,
  ]);
}

/** Marca o lançamento como ignorado (ex.: transferência entre contas próprias): fica fora do caixa e da DRE. */
export async function ignoreTransaction(db: FinanceDb, companyId: string, transactionId: string): Promise<void> {
  const transaction = await getTransaction(db, companyId, transactionId);
  if (transaction.status !== "pendente") throw new Error("Só lançamentos pendentes podem ser ignorados.");
  await db.execute("UPDATE bank_transactions SET status=?, updated_at=datetime('now') WHERE company_id=? AND id=?", ["ignorada", companyId, transactionId]);
}

/** Volta o lançamento para pendente: estorna a baixa ligada (se houver) ou desfaz a categorização/o "ignorar". */
export async function undoTransaction(db: FinanceDb, companyId: string, transactionId: string): Promise<void> {
  const transaction = await getTransaction(db, companyId, transactionId);
  if (transaction.status === "pendente") return;
  const settlements = await db.select<FinanceSettlement[]>("SELECT * FROM finance_settlements WHERE company_id=? AND bank_transaction_id=? AND deleted_at IS NULL", [companyId, transactionId]);
  for (const settlement of settlements) await reverseSettlement(db, companyId, settlement.id);
  await db.execute(
    "UPDATE bank_transactions SET status=?, payable_id=?, receivable_id=?, reconciled_at=?, reconciled_by=?, updated_at=datetime('now') WHERE company_id=? AND id=?",
    ["pendente", null, null, null, null, companyId, transactionId],
  );
}

export interface ManualTransactionInput {
  bankAccountId: string;
  postedAt: string;
  /** Positivo = entrada; negativo = saída. */
  amount: number;
  description: string;
  memo?: string | null;
}

/** Lançamento digitado (ex.: caixa da empresa), pendente para conciliar. */
export async function addManualTransaction(db: FinanceDb, companyId: string, input: ManualTransactionInput): Promise<string> {
  const account = await getAccount(db, input.bankAccountId);
  if (account.company_id !== companyId) throw new Error("Conta bancária não encontrada.");
  assertIsoDay(input.postedAt, "Data do lançamento");
  const cents = toCents(Number(input.amount));
  if (!Number.isFinite(Number(input.amount)) || cents === 0) throw new Error("Informe um valor diferente de zero.");
  if (!input.description.trim()) throw new Error("Informe a descrição.");
  const id = uuidv4();
  await db.execute("INSERT INTO bank_transactions (id, company_id, bank_account_id, posted_at, amount, description, memo, source, status) VALUES (?,?,?,?,?,?,?,?,?)", [
    id,
    companyId,
    input.bankAccountId,
    input.postedAt,
    fromCents(cents),
    input.description.trim(),
    input.memo ?? null,
    "manual",
    "pendente",
  ]);
  return id;
}

export interface MatchSuggestion {
  entry: FinanceEntry;
  /** Saldo em aberto igual ao valor do lançamento. */
  exact: boolean;
  /** Dias entre o vencimento e o lançamento (null sem vencimento). */
  daysApart: number | null;
  /** Conta sem conta bancária definida ou na mesma conta do extrato. */
  sameAccount: boolean;
}

/** Contas que podem casar com o lançamento: valor exato primeiro, depois mesma conta, vencimento mais perto e valor mais perto. */
export async function suggestMatches(db: FinanceDb, companyId: string, transactionId: string, limit = 20): Promise<MatchSuggestion[]> {
  const transaction = await getTransaction(db, companyId, transactionId);
  const cents = toCents(Number(transaction.amount));
  if (cents === 0) return [];
  const kind = directionOf(cents);
  const entries = (await loadEntries(db, companyId)).filter((entry) => entry.kind === kind && entry.remaining > 0 && entry.status !== "cancelada");
  return entries
    .map((entry) => ({
      entry,
      exact: toCents(entry.remaining) === Math.abs(cents),
      daysApart: entry.dueDate ? Math.abs(daysBetween(entry.dueDate, transaction.posted_at.slice(0, 10))) : null,
      sameAccount: !entry.bankAccountId || entry.bankAccountId === transaction.bank_account_id,
      diff: Math.abs(toCents(entry.remaining) - Math.abs(cents)),
    }))
    .sort(
      (a, b) =>
        Number(b.exact) - Number(a.exact) ||
        Number(b.sameAccount) - Number(a.sameAccount) ||
        (a.daysApart ?? Number.MAX_SAFE_INTEGER) - (b.daysApart ?? Number.MAX_SAFE_INTEGER) ||
        a.diff - b.diff,
    )
    .slice(0, limit)
    .map(({ entry, exact, daysApart, sameAccount }) => ({ entry, exact, daysApart, sameAccount }));
}
