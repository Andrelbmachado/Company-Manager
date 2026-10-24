// Fluxo de caixa: movimentos realizados (baixas, extrato conciliado direto numa categoria, contas antigas quitadas sem
// baixa registrada) e previstos (saldo em aberto das contas a pagar e a receber), com o saldo acumulado dia a dia.
// Regras:
// - Realizado de uma baixa = principal + juros + multa − desconto, no dia do pagamento, na conta bancária da baixa.
// - Lançamento do extrato conciliado com uma conta já tem a baixa: não conta de novo. Pendentes e ignorados não contam.
// - Conta quitada (ou paga em parte) pela tela antiga, sem baixa: a diferença entra no dia de pagamento/vencimento.
// - Previsto: saldo em aberto no vencimento; o que já venceu e não foi pago entra hoje (ainda é dinheiro esperado).
// - Saldo inicial de cada conta bancária vale a partir de opening_date; movimento da conta antes disso já está nele.
import { fromCents, toCents } from "@/lib/money";
import { todayIso } from "@/lib/utils";
import {
  addDays,
  assertIsoDay,
  daysBetween,
  isTrue,
  loadBankAccounts,
  loadBankTransactions,
  loadEntries,
  loadSettlements,
  localDay,
  settledCentsByEntry,
  settlementCash,
  type EntryKind,
  type FinanceDb,
} from "./financeCommon";

export type CashEventKind = "realized" | "forecast";
export type CashEventSource = "settlement" | "legacy" | "bank" | "payable" | "receivable";

export interface CashEvent {
  date: string;
  /** Positivo = entrada; negativo = saída. */
  amount: number;
  kind: CashEventKind;
  source: CashEventSource;
  /** Conta a pagar/receber (baixa, legado, previsto) ou lançamento do extrato (bank). */
  refId: string;
  entryKind: EntryKind | null;
  description: string;
  bankAccountId: string | null;
  categoryId: string | null;
  settlementId?: string;
}

export interface CashEventsOptions {
  /** Hoje ('YYYY-MM-DD', dia local); padrão: todayIso(). */
  today?: string;
  /** Incluir o previsto (contas em aberto). Padrão: sim. */
  includeForecast?: boolean;
  /** Só os movimentos desta conta bancária. */
  bankAccountId?: string | null;
}

/** Todos os movimentos de caixa da empresa (sem limite de datas), em ordem de data. */
export async function cashEvents(db: FinanceDb, companyId: string, options: CashEventsOptions = {}): Promise<CashEvent[]> {
  const today = assertIsoDay(options.today ?? todayIso(), "Data de hoje");
  const [entries, settlements, transactions] = [await loadEntries(db, companyId), await loadSettlements(db, companyId), await loadBankTransactions(db, companyId)];
  const byKey = new Map(entries.map((entry) => [`${entry.kind}:${entry.id}`, entry]));
  const settledCents = settledCentsByEntry(settlements);
  const events: CashEvent[] = [];

  for (const settlement of settlements) {
    const entryKind: EntryKind = settlement.payable_id ? "payable" : "receivable";
    const entryId = settlement.payable_id ?? settlement.receivable_id;
    if (!entryId) continue;
    const entry = byKey.get(`${entryKind}:${entryId}`);
    const cash = settlementCash(settlement);
    events.push({
      date: settlement.paid_at.slice(0, 10),
      amount: entryKind === "payable" ? -cash : cash,
      kind: "realized",
      source: "settlement",
      refId: entryId,
      entryKind,
      description: entry?.description ?? (entryKind === "payable" ? "Pagamento" : "Recebimento"),
      bankAccountId: settlement.bank_account_id ?? entry?.bankAccountId ?? null,
      categoryId: entry?.categoryId ?? null,
      settlementId: settlement.id,
    });
  }

  for (const entry of entries) {
    const unexplained = toCents(entry.paid) - (settledCents.get(`${entry.kind}:${entry.id}`) ?? 0);
    if (unexplained > 0) {
      events.push({
        date: localDay(entry.settledAt) ?? entry.dueDate ?? localDay(entry.createdAt) ?? today,
        amount: fromCents(entry.kind === "payable" ? -unexplained : unexplained),
        kind: "realized",
        source: "legacy",
        refId: entry.id,
        entryKind: entry.kind,
        description: entry.description,
        bankAccountId: entry.bankAccountId,
        categoryId: entry.categoryId,
      });
    }
    if (options.includeForecast !== false && entry.remaining > 0) {
      const due = entry.dueDate ?? today;
      events.push({
        date: due < today ? today : due,
        amount: entry.kind === "payable" ? -entry.remaining : entry.remaining,
        kind: "forecast",
        source: entry.kind,
        refId: entry.id,
        entryKind: entry.kind,
        description: entry.description,
        bankAccountId: entry.bankAccountId,
        categoryId: entry.categoryId,
      });
    }
  }

  const linkedTransactions = new Set(settlements.map((settlement) => settlement.bank_transaction_id).filter(Boolean));
  for (const transaction of transactions) {
    if (transaction.status !== "conciliada" || transaction.payable_id || transaction.receivable_id || linkedTransactions.has(transaction.id)) continue;
    events.push({
      date: transaction.posted_at.slice(0, 10),
      amount: fromCents(toCents(Number(transaction.amount) || 0)),
      kind: "realized",
      source: "bank",
      refId: transaction.id,
      entryKind: null,
      description: transaction.description ?? transaction.memo ?? "Lançamento do extrato",
      bankAccountId: transaction.bank_account_id,
      categoryId: transaction.category_id ?? null,
    });
  }

  const filtered = options.bankAccountId ? events.filter((event) => event.bankAccountId === options.bankAccountId) : events;
  return filtered.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === b.kind ? 0 : a.kind === "realized" ? -1 : 1) || a.refId.localeCompare(b.refId));
}

export interface CashflowDay {
  date: string;
  in: number;
  out: number;
  /** Saldo no fim do dia. */
  balance: number;
  inRealized: number;
  inForecast: number;
  outRealized: number;
  outForecast: number;
}

export interface CashflowOptions extends CashEventsOptions {}

/** Corta movimentos de uma conta anteriores à abertura dela (já estão no saldo inicial). */
function afterOpening(openings: Map<string, string | null | undefined>) {
  return (event: CashEvent) => {
    const opening = event.bankAccountId ? openings.get(event.bankAccountId) : null;
    return !opening || event.date >= opening;
  };
}

/** Fluxo de caixa dia a dia de `from` a `to` (inclusive), com o saldo acumulado das contas bancárias. */
export async function cashflow(db: FinanceDb, companyId: string, from: string, to: string, options: CashflowOptions = {}): Promise<CashflowDay[]> {
  assertIsoDay(from, "Data inicial");
  assertIsoDay(to, "Data final");
  if (to < from) throw new Error("Período inválido: a data final vem antes da inicial.");
  if (daysBetween(from, to) > 1830) throw new Error("Período muito longo: escolha até 5 anos.");

  const accounts = (await loadBankAccounts(db, companyId)).filter((account) => !options.bankAccountId || account.id === options.bankAccountId);
  const openings = new Map(accounts.map((account) => [account.id, account.opening_date ? account.opening_date.slice(0, 10) : null]));
  const events = (await cashEvents(db, companyId, options)).filter(afterOpening(openings));

  let balance = 0;
  const jumps = new Map<string, number>();
  for (const account of accounts) {
    const opening = toCents(Number(account.opening_balance) || 0);
    const date = openings.get(account.id);
    if (!date || date < from) balance += opening;
    else if (date <= to) jumps.set(date, (jumps.get(date) ?? 0) + opening);
  }

  const perDay = new Map<string, { inRealized: number; inForecast: number; outRealized: number; outForecast: number }>();
  for (const event of events) {
    const cents = toCents(event.amount);
    if (event.date < from) {
      balance += cents;
      continue;
    }
    if (event.date > to) continue;
    const day = perDay.get(event.date) ?? { inRealized: 0, inForecast: 0, outRealized: 0, outForecast: 0 };
    if (cents >= 0) day[event.kind === "realized" ? "inRealized" : "inForecast"] += cents;
    else day[event.kind === "realized" ? "outRealized" : "outForecast"] -= cents;
    perDay.set(event.date, day);
  }

  const days: CashflowDay[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const day = perDay.get(date) ?? { inRealized: 0, inForecast: 0, outRealized: 0, outForecast: 0 };
    const inCents = day.inRealized + day.inForecast;
    const outCents = day.outRealized + day.outForecast;
    balance += inCents - outCents + (jumps.get(date) ?? 0);
    days.push({
      date,
      in: fromCents(inCents),
      out: fromCents(outCents),
      balance: fromCents(balance),
      inRealized: fromCents(day.inRealized),
      inForecast: fromCents(day.inForecast),
      outRealized: fromCents(day.outRealized),
      outForecast: fromCents(day.outForecast),
    });
  }
  return days;
}

export interface CashflowPeriod {
  /** Semana (segunda-feira) ou mês ('YYYY-MM-01') do período. */
  key: string;
  /** Primeiro e último dia do período dentro do intervalo pedido. */
  from: string;
  to: string;
  in: number;
  out: number;
  /** Saldo no fim do período. */
  balance: number;
}

/** Agrupa os dias do fluxo por semana (segunda a domingo) ou por mês. */
export function groupCashflow(days: readonly CashflowDay[], period: "week" | "month"): CashflowPeriod[] {
  const groups: CashflowPeriod[] = [];
  for (const day of days) {
    const [year, month, date] = day.date.split("-").map(Number);
    const weekday = (new Date(Date.UTC(year, month - 1, date)).getUTCDay() + 6) % 7;
    const key = period === "month" ? `${day.date.slice(0, 7)}-01` : addDays(day.date, -weekday);
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.to = day.date;
      last.in = fromCents(toCents(last.in) + toCents(day.in));
      last.out = fromCents(toCents(last.out) + toCents(day.out));
      last.balance = day.balance;
    } else {
      groups.push({ key, from: day.date, to: day.date, in: day.in, out: day.out, balance: day.balance });
    }
  }
  return groups;
}

export interface AccountBalance {
  accountId: string;
  name: string;
  kind: string;
  isDefault: boolean;
  active: boolean;
  opening: number;
  inflow: number;
  outflow: number;
  /** Saldo realizado até a data. */
  balance: number;
  /** Último saldo informado no extrato importado (para conferir), se houver. */
  statementBalance: number | null;
  statementDate: string | null;
}

/** Saldo realizado de cada conta bancária até `asOf` (padrão: hoje), da conta padrão para as demais. */
export async function accountBalances(db: FinanceDb, companyId: string, asOf: string = todayIso()): Promise<AccountBalance[]> {
  assertIsoDay(asOf, "Data");
  const accounts = await loadBankAccounts(db, companyId);
  const openings = new Map(accounts.map((account) => [account.id, account.opening_date ? account.opening_date.slice(0, 10) : null]));
  const events = (await cashEvents(db, companyId, { today: asOf, includeForecast: false })).filter(afterOpening(openings)).filter((event) => event.date <= asOf);
  const transactions = await loadBankTransactions(db, companyId);

  return accounts
    .map((account) => {
      const own = events.filter((event) => event.bankAccountId === account.id);
      const inflow = own.reduce((sum, event) => sum + Math.max(0, toCents(event.amount)), 0);
      const outflow = own.reduce((sum, event) => sum + Math.max(0, -toCents(event.amount)), 0);
      const openingDate = openings.get(account.id);
      const opening = !openingDate || openingDate <= asOf ? toCents(Number(account.opening_balance) || 0) : 0;
      const statement = transactions
        .filter((transaction) => transaction.bank_account_id === account.id && transaction.balance_after != null && transaction.posted_at <= asOf)
        .sort((a, b) => b.posted_at.localeCompare(a.posted_at) || b.created_at.localeCompare(a.created_at))[0];
      return {
        accountId: account.id,
        name: account.name,
        kind: account.kind,
        isDefault: isTrue(account.is_default),
        active: isTrue(account.active),
        opening: fromCents(opening),
        inflow: fromCents(inflow),
        outflow: fromCents(outflow),
        balance: fromCents(opening + inflow - outflow),
        statementBalance: statement ? Number(statement.balance_after) : null,
        statementDate: statement ? statement.posted_at : null,
      };
    })
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "pt-BR"));
}
