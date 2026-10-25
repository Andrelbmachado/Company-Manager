// Números do topo do Dashboard: resultado do mês, contas a pagar e a receber da semana, trabalhos ativos e o balanço
// anual (realizado, acumulado e previsão). Regime de caixa, com as mesmas regras do fluxo de caixa (src/lib/erp/cashflow.ts):
// - Realizado = baixas (principal + juros + multa − desconto), contas antigas quitadas sem baixa e extrato conciliado
//   direto numa categoria. Recebido entra positivo e pago negativo.
// - Previsto = saldo em aberto no vencimento (o que já venceu e não foi pago conta como esperado hoje) + as recorrências
//   ainda não lançadas (mesmo calendário do runRecurring, sem gravar nada).
// SQL só nos padrões do banco demo (SELECT * ... WHERE col=? AND ...): soma e agrupamento ficam aqui, em TypeScript.
import type { DatabaseLike } from "@/lib/db/demo";
import { fromCents, toCents } from "@/lib/money";
import { todayIso } from "@/lib/utils";
import { cashEvents } from "@/lib/erp/cashflow";
import { addDays, addMonths, assertIsoDay, isIsoMonth, isTrue, loadEntries, type EntryKind } from "@/lib/erp/financeCommon";
import { competencesDue } from "@/lib/erp/recurring";
import { loadAreaLabels } from "@/lib/labels/store";
import type { AreaProfile, Customer, Payable, Project, Receivable, RecurringEntry } from "@/types";

export interface MonthResult {
  month: string;
  /** Recebido no mês. */
  income: number;
  /** Pago no mês (positivo). */
  expense: number;
  /** income − expense: positivo = lucro, negativo = dívida. */
  result: number;
}

export interface WeekTotal {
  /** Hoje e o domingo da semana ('YYYY-MM-DD', inclusive). */
  from: string;
  to: string;
  /** Saldo em aberto das contas que vencem no período. */
  total: number;
  count: number;
}

export interface AnnualBalancePoint {
  /** 'YYYY-MM'. */
  month: string;
  /** Resultado realizado do mês; null nos meses que ainda não começaram. */
  realizado: number | null;
  /** Soma do realizado de janeiro até o mês; null nos meses que ainda não começaram. */
  acumulado: number | null;
  /** Resultado esperado do mês: realizado + em aberto + recorrências não lançadas (meses passados = realizado). */
  previsto: number;
}

export interface AnnualBalanceOptions {
  /** Hoje ('YYYY-MM-DD', dia local); padrão: todayIso(). */
  today?: string;
}

const MONTH_RE = /^\d{4}-\d{2}$/;

function assertMonth(month: string): string {
  if (!isIsoMonth(month)) throw new Error("Mês inválido: use o formato AAAA-MM.");
  return month;
}

/** Hoje até o domingo da mesma semana (no domingo, só o próprio dia). */
export function weekRange(today: string): { from: string; to: string } {
  assertIsoDay(today, "Data de hoje");
  const [year, month, day] = today.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return { from: today, to: addDays(today, weekday === 0 ? 0 : 7 - weekday) };
}

/** Recebido − pago no mês 'YYYY-MM' (regime de caixa). */
export async function monthResult(db: DatabaseLike, companyId: string, month: string): Promise<MonthResult> {
  assertMonth(month);
  let income = 0;
  let expense = 0;
  for (const event of await cashEvents(db, companyId, { includeForecast: false })) {
    if (event.kind !== "realized" || event.date.slice(0, 7) !== month) continue;
    const cents = toCents(event.amount);
    if (cents >= 0) income += cents;
    else expense -= cents;
  }
  return { month, income: fromCents(income), expense: fromCents(expense), result: fromCents(income - expense) };
}

async function weekTotal(db: DatabaseLike, companyId: string, today: string, kind: EntryKind): Promise<WeekTotal> {
  const { from, to } = weekRange(today);
  const due = (await loadEntries(db, companyId)).filter((entry) => entry.kind === kind && entry.remaining > 0 && entry.dueDate != null && entry.dueDate >= from && entry.dueDate <= to);
  return { from, to, total: fromCents(due.reduce((sum, entry) => sum + toCents(entry.remaining), 0)), count: due.length };
}

/** Contas a pagar em aberto com vencimento de hoje até domingo (saldo que falta pagar). */
export function weekPayables(db: DatabaseLike, companyId: string, today: string): Promise<WeekTotal> {
  return weekTotal(db, companyId, today, "payable");
}

/** Contas a receber em aberto com vencimento de hoje até domingo (saldo que falta receber). */
export function weekReceivables(db: DatabaseLike, companyId: string, today: string): Promise<WeekTotal> {
  return weekTotal(db, companyId, today, "receivable");
}

/** Projeto conta como trabalho ativo: planejado ou em andamento (o mesmo que o indicador "Projetos ativos"). */
const INACTIVE_PROJECT = new Set(["pausado", "concluido", "cancelado"]);

/**
 * Trabalhos ativos da empresa: projetos planejados ou em andamento. No perfil advocacia (o card vira "Clientes ativos"),
 * clientes com pelo menos um processo/caso ativo, cada um uma vez. Sem `profile`, lê a área gravada em Configurações.
 */
export async function activeWorkCount(db: DatabaseLike, companyId: string, profile?: AreaProfile): Promise<number> {
  const area = profile ?? (await loadAreaLabels(db, companyId)).profile;
  const projects = (await db.select<Project[]>("SELECT * FROM projects WHERE company_id=? AND deleted_at IS NULL", [companyId])).filter((project) => !project.deleted_at && !INACTIVE_PROJECT.has(project.status));
  if (area !== "advocacia") return projects.length;
  const customers = await db.select<Customer[]>("SELECT * FROM customers WHERE company_id=? AND deleted_at IS NULL", [companyId]);
  const live = new Set(customers.filter((customer) => !customer.deleted_at).map((customer) => customer.id));
  return new Set(projects.map((project) => project.customer_id).filter((id): id is string => !!id && live.has(id))).size;
}

/**
 * Recorrências ativas ainda não lançadas até dezembro de `lastYear`, em centavos por mês do vencimento
 * (receber positivo, pagar negativo). Mesmo calendário do runRecurring: sem histórico começa no mês de hoje; o que
 * venceria antes de hoje conta no mês de hoje (como a conta vencida no fluxo de caixa). Competência já lançada,
 * mesmo excluída, não entra de novo.
 */
async function recurringForecast(db: DatabaseLike, companyId: string, today: string, lastYear: number): Promise<Map<string, number>> {
  const byMonth = new Map<string, number>();
  const currentMonth = today.slice(0, 7);
  if (lastYear < Number(today.slice(0, 4))) return byMonth;
  const entries = (await db.select<RecurringEntry[]>("SELECT * FROM recurring_entries WHERE company_id=? AND deleted_at IS NULL", [companyId])).filter(
    (entry) => !entry.deleted_at && isTrue(entry.active),
  );
  if (entries.length === 0) return byMonth;
  // Inclui as excluídas: a competência apagada continua "lançada" (o runRecurring também não a recria).
  const launched = new Set<string>();
  for (const table of ["payables", "receivables"] as const) {
    for (const row of await db.select<(Payable | Receivable)[]>(`SELECT * FROM ${table} WHERE company_id=?`, [companyId])) {
      if (row.recurring_entry_id && row.competence) launched.add(`${row.recurring_entry_id}:${row.competence}`);
    }
  }
  for (const entry of entries) {
    const schedule = { ...entry, last_competence: entry.last_competence ?? addMonths(currentMonth, -1) };
    const sign = entry.kind === "receber" ? 1 : -1;
    const cents = toCents(Number(entry.amount) || 0) * sign;
    for (const occurrence of competencesDue(schedule, `${lastYear}-12-31`, 600)) {
      if (launched.has(`${entry.id}:${occurrence.competence}`)) continue;
      const month = occurrence.dueDate < today ? currentMonth : occurrence.dueDate.slice(0, 7);
      byMonth.set(month, (byMonth.get(month) ?? 0) + cents);
    }
  }
  return byMonth;
}

/** Balanço do ano: realizado e acumulado mês a mês até o mês de hoje, e a previsão de cada mês. */
export async function annualBalance(db: DatabaseLike, companyId: string, year: number, options: AnnualBalanceOptions = {}): Promise<AnnualBalancePoint[]> {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) throw new Error("Ano inválido: use quatro dígitos.");
  const today = assertIsoDay(options.today ?? todayIso(), "Data de hoje");
  const currentMonth = today.slice(0, 7);
  const realized = new Map<string, number>();
  const forecast = await recurringForecast(db, companyId, today, year);
  for (const event of await cashEvents(db, companyId, { today })) {
    const month = event.date.slice(0, 7);
    if (!MONTH_RE.test(month) || !month.startsWith(`${year}-`)) continue;
    const target = event.kind === "realized" ? realized : forecast;
    target.set(month, (target.get(month) ?? 0) + toCents(event.amount));
  }

  let accumulated = 0;
  return Array.from({ length: 12 }, (_, index) => {
    const month = `${year}-${String(index + 1).padStart(2, "0")}`;
    const done = realized.get(month) ?? 0;
    const started = month <= currentMonth;
    if (started) accumulated += done;
    return {
      month,
      realizado: started ? fromCents(done) : null,
      acumulado: started ? fromCents(accumulated) : null,
      previsto: fromCents(done + (month >= currentMonth ? (forecast.get(month) ?? 0) : 0)),
    };
  });
}

export type Loaded<T> = { ok: true; value: T } | { ok: false; error: string };

export interface DashboardOverview {
  month?: Loaded<MonthResult>;
  payables?: Loaded<WeekTotal>;
  receivables?: Loaded<WeekTotal>;
  activeWork?: Loaded<number>;
  balance?: Loaded<AnnualBalancePoint[]>;
}

export interface DashboardOverviewOptions {
  /** Hoje ('YYYY-MM-DD', dia local). */
  today: string;
  /** Carregar os números do financeiro (resultado, semana e balanço). */
  finance: boolean;
  /** Carregar os trabalhos ativos. */
  work: boolean;
  /** Área da empresa (a tela já leu); sem ela, activeWorkCount lê de Configurações. */
  profile?: AreaProfile;
}

async function settle<T>(load: () => Promise<T>): Promise<Loaded<T>> {
  try {
    return { ok: true, value: await load() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Leituras repetidas na mesma carga (contas, baixas e extrato são lidos pelo resultado, pela semana e pelo balanço)
 * saem do mesmo SELECT. Só para leitura: execute passa direto.
 */
function sharedReads(db: DatabaseLike): DatabaseLike {
  const cache = new Map<string, Promise<unknown>>();
  return {
    select: <T,>(query: string, bindValues: unknown[] = []) => {
      const key = `${query}\u0000${JSON.stringify(bindValues)}`;
      if (!cache.has(key)) {
        const pending = db.select<T>(query, bindValues);
        // Falha não fica guardada: quem pedir de novo tenta outra vez.
        pending.catch(() => cache.delete(key));
        cache.set(key, pending);
      }
      return cache.get(key) as Promise<T>;
    },
    execute: (query, bindValues) => db.execute(query, bindValues),
  };
}

/** Os números do topo do Dashboard que o papel pode ver; um que falha mostra o erro só no card dele. */
export async function loadDashboardOverview(db: DatabaseLike, companyId: string, options: DashboardOverviewOptions): Promise<DashboardOverview> {
  const reads = sharedReads(db);
  const { today } = options;
  const overview: DashboardOverview = {};
  if (options.finance) {
    const [month, payables, receivables, balance] = await Promise.all([
      settle(() => monthResult(reads, companyId, today.slice(0, 7))),
      settle(() => weekPayables(reads, companyId, today)),
      settle(() => weekReceivables(reads, companyId, today)),
      settle(() => annualBalance(reads, companyId, Number(today.slice(0, 4)), { today })),
    ]);
    Object.assign(overview, { month, payables, receivables, balance });
  }
  if (options.work) overview.activeWork = await settle(() => activeWorkCount(reads, companyId, options.profile));
  return overview;
}
