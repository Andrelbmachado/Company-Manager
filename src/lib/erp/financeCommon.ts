// Base comum do financeiro (baixas, fluxo de caixa, DRE, conciliação e recorrências).
// SQL só nos padrões do banco demo (SELECT * com WHERE col=? AND ..., sem JOIN/SUM): filtro, soma e agrupamento ficam
// aqui, em TypeScript. Dinheiro sempre em centavos inteiros (src/lib/money.ts) para não acumular erro de ponto flutuante.
import type { DatabaseLike } from "@/lib/db/demo";
import { fromCents, toCents } from "@/lib/money";
import { todayIso } from "@/lib/utils";
import type { BankAccount, BankTransaction, FinanceCategory, FinanceSettlement, Payable, Receivable } from "@/types";

export type FinanceDb = DatabaseLike;
export type EntryKind = "payable" | "receivable";

/** 0/1 do SQLite, booleano do demo ou o texto 'true' que o plugin grava para booleanos. */
export const isTrue = (value: unknown): boolean => value === 1 || value === true || value === "1" || value === "true";

/** rowsAffected do resultado do execute (SQLite e demo devolvem `{ rowsAffected }`). */
export function rowsAffected(result: unknown): number {
  const value = (result as { rowsAffected?: unknown } | null)?.rowsAffected;
  return typeof value === "number" ? value : 0;
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 'YYYY-MM-DD' de um dia que existe no calendário. */
export function isIsoDay(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = ISO_DAY.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(`${match[1]}-${match[2]}`) && year > 0;
}

export function assertIsoDay(value: unknown, label = "Data"): string {
  if (!isIsoDay(value)) throw new Error(`${label} inválida: use o formato AAAA-MM-DD.`);
  return value;
}

/** 'YYYY-MM' válido. */
export function isIsoMonth(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** Dias do mês 'YYYY-MM' (28 a 31). */
export function daysInMonth(month: string): number {
  const [year, monthIndex] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
}

/** Soma dias a 'YYYY-MM-DD' pelo calendário (UTC só como aritmética de datas, sem fuso). */
export function addDays(day: string, days: number): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
}

/** Soma meses a 'YYYY-MM'. */
export function addMonths(month: string, months: number): string {
  const [year, monthIndex] = month.split("-").map(Number);
  const total = year * 12 + (monthIndex - 1) + months;
  return `${String(Math.floor(total / 12)).padStart(4, "0")}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/** Meses de `from` até `to` ('YYYY-MM'); negativo se `to` vem antes. */
export function monthsBetween(from: string, to: string): number {
  const [fromYear, fromMonth] = from.split("-").map(Number);
  const [toYear, toMonth] = to.split("-").map(Number);
  return (toYear - fromYear) * 12 + (toMonth - fromMonth);
}

/** Dias corridos de `from` até `to` ('YYYY-MM-DD'). */
export function daysBetween(from: string, to: string): number {
  const toUtc = (day: string) => {
    const [year, month, date] = day.split("-").map(Number);
    return Date.UTC(year, month - 1, date);
  };
  return Math.round((toUtc(to) - toUtc(from)) / 86_400_000);
}

/** "2026-10" → "10/2026". */
export function monthLabel(month: string): string {
  const [year, monthIndex] = month.split("-");
  return `${monthIndex}/${year}`;
}

/**
 * Dia local ('YYYY-MM-DD') de uma data ou de um timestamp. Timestamp sem fuso (datetime('now') do SQLite) é UTC.
 * Valor vazio ou inválido devolve `fallback`.
 */
export function localDay(value: string | null | undefined, fallback: string | null = null): string | null {
  if (!value) return fallback;
  if (ISO_DAY.test(value)) return value;
  const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value.replace(" ", "T")}Z`;
  const parsed = new Date(withZone);
  return Number.isNaN(parsed.getTime()) ? fallback : todayIso(parsed);
}

export const SETTLED_STATUS: Record<EntryKind, "paga" | "recebida"> = { payable: "paga", receivable: "recebida" };
export const PARTIAL_STATUS: Record<EntryKind, "paga_parcial" | "recebida_parcial"> = { payable: "paga_parcial", receivable: "recebida_parcial" };
export const ENTRY_TABLE: Record<EntryKind, "payables" | "receivables"> = { payable: "payables", receivable: "receivables" };

/** Conta a pagar ou a receber normalizada (mesma forma para as duas). */
export interface FinanceEntry {
  kind: EntryKind;
  id: string;
  description: string;
  amount: number;
  /** Principal já baixado (paid_amount / received_amount; conta quitada = valor inteiro). */
  paid: number;
  /** Saldo em aberto: 0 se quitada ou cancelada. */
  remaining: number;
  status: string;
  dueDate: string | null;
  issueDate: string | null;
  /** Competência efetiva 'YYYY-MM' (competence → emissão → vencimento → criação). */
  competenceMonth: string | null;
  categoryId: string | null;
  costCenterId: string | null;
  bankAccountId: string | null;
  /** Fornecedor (pagar) ou cliente (receber). */
  partyId: string | null;
  /** paid_at / received_at. */
  settledAt: string | null;
  approverId: string | null;
  recurringEntryId: string | null;
  createdAt: string | null;
  raw: Payable | Receivable;
}

const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Descrição de uma conta a receber antiga: a tela legada gravava o texto em ref_id. */
export function receivableDescription(row: Pick<Receivable, "description" | "ref_id">): string {
  return row.description ?? row.ref_id ?? "Recebimento";
}

export function toEntry(kind: EntryKind, row: Payable | Receivable): FinanceEntry {
  const amount = num(row.amount);
  const status = String(row.status ?? "aberta");
  const settled = status === SETTLED_STATUS[kind];
  const cancelled = status === "cancelada";
  const paidColumn = kind === "payable" ? (row as Payable).paid_amount : (row as Receivable).received_amount;
  const paidCents = settled ? toCents(amount) : Math.min(toCents(amount), Math.max(0, toCents(num(paidColumn))));
  const remainingCents = settled || cancelled ? 0 : Math.max(0, toCents(amount) - paidCents);
  const competenceSource = row.competence ?? row.issue_date ?? row.due_date ?? localDay(row.created_at);
  return {
    kind,
    id: row.id,
    description: kind === "payable" ? (row as Payable).description : receivableDescription(row as Receivable),
    amount,
    paid: fromCents(paidCents),
    remaining: fromCents(remainingCents),
    status,
    dueDate: row.due_date ? row.due_date.slice(0, 10) : null,
    issueDate: row.issue_date ?? null,
    competenceMonth: competenceSource ? competenceSource.slice(0, 7) : null,
    categoryId: row.category_id ?? null,
    costCenterId: row.cost_center_id ?? null,
    bankAccountId: row.bank_account_id ?? null,
    partyId: kind === "payable" ? ((row as Payable).supplier_id ?? null) : ((row as Receivable).customer_id ?? null),
    settledAt: kind === "payable" ? ((row as Payable).paid_at ?? null) : ((row as Receivable).received_at ?? null),
    approverId: kind === "payable" ? ((row as Payable).approver_id ?? null) : null,
    recurringEntryId: row.recurring_entry_id ?? null,
    createdAt: row.created_at ?? null,
    raw: row,
  };
}

/** Em aberto e vencida (vencimento antes de hoje, com saldo). */
export function isOverdue(entry: FinanceEntry, today: string): boolean {
  return entry.remaining > 0 && entry.dueDate != null && entry.dueDate < today;
}

/** Status para a tela: conta aberta/aprovada com vencimento passado aparece como "vencida". */
export function displayStatus(entry: FinanceEntry, today: string): string {
  if (isOverdue(entry, today) && ["aberta", "aprovada", "vencida"].includes(entry.status)) return "vencida";
  return entry.status;
}

export async function loadPayables(db: FinanceDb, companyId: string): Promise<Payable[]> {
  return db.select<Payable[]>("SELECT * FROM payables WHERE company_id=? AND deleted_at IS NULL", [companyId]);
}

export async function loadReceivables(db: FinanceDb, companyId: string): Promise<Receivable[]> {
  return db.select<Receivable[]>("SELECT * FROM receivables WHERE company_id=? AND deleted_at IS NULL", [companyId]);
}

/** Contas a pagar e a receber ativas (sem as excluídas), normalizadas. */
export async function loadEntries(db: FinanceDb, companyId: string): Promise<FinanceEntry[]> {
  const payables = await loadPayables(db, companyId);
  const receivables = await loadReceivables(db, companyId);
  return [...payables.map((row) => toEntry("payable", row)), ...receivables.map((row) => toEntry("receivable", row))];
}

/** Uma conta (ativa) da empresa; erro legível se não existir. */
export async function getEntry(db: FinanceDb, companyId: string, kind: EntryKind, id: string): Promise<FinanceEntry> {
  const rows = await db.select<(Payable | Receivable)[]>(`SELECT * FROM ${ENTRY_TABLE[kind]} WHERE company_id=? AND id=?`, [companyId, id]);
  const row = rows[0];
  if (!row || row.deleted_at) throw new Error(kind === "payable" ? "Conta a pagar não encontrada." : "Conta a receber não encontrada.");
  return toEntry(kind, row);
}

export async function loadSettlements(db: FinanceDb, companyId: string): Promise<FinanceSettlement[]> {
  return db.select<FinanceSettlement[]>("SELECT * FROM finance_settlements WHERE company_id=? AND deleted_at IS NULL", [companyId]);
}

export async function loadBankTransactions(db: FinanceDb, companyId: string): Promise<BankTransaction[]> {
  return db.select<BankTransaction[]>("SELECT * FROM bank_transactions WHERE company_id=? AND deleted_at IS NULL", [companyId]);
}

export async function loadBankAccounts(db: FinanceDb, companyId: string): Promise<BankAccount[]> {
  return db.select<BankAccount[]>("SELECT * FROM bank_accounts WHERE company_id=? AND deleted_at IS NULL", [companyId]);
}

export async function loadCategories(db: FinanceDb, companyId: string): Promise<FinanceCategory[]> {
  return db.select<FinanceCategory[]>("SELECT * FROM finance_categories WHERE company_id=? AND deleted_at IS NULL", [companyId]);
}

/** Dinheiro que entrou ou saiu numa baixa: principal + juros + multa − desconto. */
export function settlementCash(settlement: Pick<FinanceSettlement, "amount" | "interest" | "fine" | "discount">): number {
  return fromCents(toCents(num(settlement.amount)) + toCents(num(settlement.interest)) + toCents(num(settlement.fine)) - toCents(num(settlement.discount)));
}

/** Principal baixado por conta (soma das baixas ativas), em centavos, por "kind:id". */
export function settledCentsByEntry(settlements: readonly FinanceSettlement[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const settlement of settlements) {
    const key = settlement.payable_id ? `payable:${settlement.payable_id}` : settlement.receivable_id ? `receivable:${settlement.receivable_id}` : null;
    if (!key) continue;
    totals.set(key, (totals.get(key) ?? 0) + toCents(num(settlement.amount)));
  }
  return totals;
}

/** Converte texto de valor digitado ("1.234,56", "1234.56", "R$ 10") em número; NaN se não for número. */
export function parseMoneyInput(value: string | number | null | undefined): number {
  if (typeof value === "number") return value;
  if (value == null) return Number.NaN;
  let text = String(value).replace(/[R$\s]/g, "");
  if (!text) return Number.NaN;
  const negative = /^\(.*\)$/.test(text) || text.startsWith("-");
  text = text.replace(/[()+-]/g, "");
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    text = lastComma > lastDot ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  } else if (lastComma >= 0) {
    text = text.replace(/\./g, "").replace(",", ".");
  } else if ((text.match(/\./g) ?? []).length > 1) {
    text = text.replace(/\./g, "");
  }
  if (!/^\d+(\.\d+)?$/.test(text)) return Number.NaN;
  const parsed = Number(text);
  return negative ? -parsed : parsed;
}
