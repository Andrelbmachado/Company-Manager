// Números da home por setor (widgets de roleHomes.ts). Cada widget de dado tem um loader que lê as tabelas da empresa
// e calcula no TypeScript: o banco demo do navegador não tem JOIN, SUM, IN nem "<" (AGENTS.md §4), então todo SQL
// aqui é "SELECT * FROM t WHERE company_id=? [AND deleted_at IS NULL] [ORDER BY created_at DESC LIMIT n]".
// Leituras são compartilhadas entre os loaders de uma carga (uma consulta por tabela) e um loader que falha não
// derruba os outros (o card mostra o erro).
import type { DatabaseLike } from "@/lib/db/demo";
import { hasFullTicketAccess, visibleModules } from "@/lib/permissions/rbac";
import { roundMoney, sumMoney } from "@/lib/money";
import { formatCurrency, formatDay, todayIso } from "@/lib/utils";
import { REQUEST_TYPE_LABEL, isOnVacation, vacationBalance } from "@/lib/hr/rules";
import { formatMinutes, timeBankSummary } from "@/lib/hr/timebank";
import { monthlyPayroll } from "@/lib/payroll/queries";
import type {
  Activity,
  BadgeTone,
  BankTransaction,
  CrmActivity,
  Custody,
  Customer,
  Employee,
  EmployeeCompensation,
  HrRequest,
  HrTask,
  HrTimeEntry,
  InventoryCount,
  InventoryItem,
  Invoice,
  Lead,
  Opportunity,
  Payable,
  Product,
  Project,
  Proposal,
  PurchaseOrder,
  Receivable,
  Role,
  SalesOrder,
  StockBalance,
  Task,
  Ticket,
  WorkOrder,
} from "@/types";
import type { HomeWidget } from "./roleHomes";

export interface HomeContext {
  companyId: string;
  userId: string;
  role: Role;
  /** Hoje no fuso local ('YYYY-MM-DD'). */
  today: string;
  now: Date;
}

/** count = inteiro; money = R$; days = dias; minutes = banco de horas (+2h30). */
export type MetricFormat = "count" | "money" | "days" | "minutes";
export type MetricTone = "neutral" | "success" | "warning" | "danger";

export interface HomeListItem {
  id: string;
  title: string;
  detail?: string;
  /** Selo: `status` vai para o StatusBadge (rótulo e cor de lá, ou o próprio texto com `tone`). */
  badge?: { status: string; tone?: BadgeTone };
}

export interface HomeChartSeries {
  key: string;
  label: string;
}

/** Um ponto por dia: `label` no eixo e um número por série (chave = HomeChartSeries.key). */
export type HomeChartPoint = { label: string; day: string } & Record<string, number | string>;

export interface HomeChart {
  series: HomeChartSeries[];
  points: HomeChartPoint[];
}

export interface HomeMetric {
  value: number;
  format: MetricFormat;
  hint?: string;
  tone?: MetricTone;
  items?: HomeListItem[];
  chart?: HomeChart;
}

export type HomeMetricResult = { ok: true; metric: HomeMetric } | { ok: false; error: string };

// ── Leitura das tabelas ──────────────────────────────────────────────────────────────────────────────────────

/** Tabelas sem soft delete (o filtro `deleted_at IS NULL` não existe nelas). */
const WITHOUT_SOFT_DELETE = new Set(["stock_balances"]);

export interface HomeReader {
  /** Linhas ativas da empresa (uma consulta por tabela, compartilhada). */
  rows<T>(table: string): Promise<T[]>;
  /** As `limit` linhas mais recentes por created_at (trilhas grandes: auditoria, atividades). */
  recent<T>(table: string, limit: number): Promise<T[]>;
}

export function createHomeReader(db: DatabaseLike, companyId: string): HomeReader {
  const cache = new Map<string, Promise<unknown[]>>();
  const memo = <T,>(key: string, load: () => Promise<T[]>): Promise<T[]> => {
    if (!cache.has(key)) cache.set(key, load());
    return cache.get(key) as Promise<T[]>;
  };
  return {
    rows: <T,>(table: string) =>
      memo<T>(`rows:${table}`, () =>
        db.select<T[]>(WITHOUT_SOFT_DELETE.has(table) ? `SELECT * FROM ${table} WHERE company_id=?` : `SELECT * FROM ${table} WHERE company_id=? AND deleted_at IS NULL`, [companyId]),
      ),
    recent: <T,>(table: string, limit: number) =>
      memo<T>(`recent:${table}:${limit}`, () => db.select<T[]>(`SELECT * FROM ${table} WHERE company_id=? ORDER BY created_at DESC LIMIT ${Math.floor(limit)}`, [companyId])),
  };
}

// ── Datas e números ──────────────────────────────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** 'YYYY-MM-DD' + n dias (sem fuso: conta no calendário). */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.slice(0, 10).split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day) + days * DAY_MS);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}

/** Instante de um timestamp do banco: ISO com fuso, ou "YYYY-MM-DD HH:MM:SS" do SQLite (UTC). */
function instant(value: string): Date | null {
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Dia local de uma data ('YYYY-MM-DD' fica como está) ou de um timestamp. */
export function localDay(value: string | null | undefined): string | null {
  if (!value) return null;
  if (DATE_ONLY.test(value)) return value;
  const date = instant(value);
  return date ? todayIso(date) : null;
}

/** Ordem cronológica: data sem horário vale até o fim do dia. */
function sortKey(value: string | null | undefined): number {
  if (!value) return Number.POSITIVE_INFINITY;
  if (DATE_ONLY.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day, 23, 59, 59).getTime();
  }
  return instant(value)?.getTime() ?? Number.POSITIVE_INFINITY;
}

/** Prazo vencido: data sem horário vence no fim do dia; timestamp, no instante. */
function isPast(value: string | null | undefined, ctx: HomeContext): boolean {
  if (!value) return false;
  if (DATE_ONLY.test(value)) return value < ctx.today;
  const date = instant(value);
  return !!date && date.getTime() < ctx.now.getTime();
}

const count = (value: number, one: string, many: string) => `${value} ${value === 1 ? one : many}`;
const money = (value: number) => formatCurrency(roundMoney(value));
const quantity = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });
const truthy = (value: unknown) => value === 1 || value === true || value === "1" || value === "true";

function dayLabel(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return `${WEEKDAYS[new Date(year, month - 1, day).getDay()]} ${String(day).padStart(2, "0")}`;
}

/** Saldo em aberto de uma conta (valor − baixado), nunca negativo. */
function openBalance(amount: number, settled: number | null | undefined): number {
  return Math.max(0, roundMoney(Number(amount || 0) - Number(settled || 0)));
}

const RECEIVABLE_CLOSED = new Set(["recebida", "cancelada"]);
const PAYABLE_CLOSED = new Set(["paga", "cancelada"]);

async function openReceivables(reader: HomeReader): Promise<(Receivable & { open: number })[]> {
  return (await reader.rows<Receivable>("receivables"))
    .filter((row) => !RECEIVABLE_CLOSED.has(row.status))
    .map((row) => ({ ...row, open: openBalance(row.amount, row.received_amount) }))
    .filter((row) => row.open > 0);
}

async function openPayables(reader: HomeReader): Promise<(Payable & { open: number })[]> {
  return (await reader.rows<Payable>("payables"))
    .filter((row) => !PAYABLE_CLOSED.has(row.status))
    .map((row) => ({ ...row, open: openBalance(row.amount, row.paid_amount) }))
    .filter((row) => row.open > 0);
}

async function myEmployee(reader: HomeReader, ctx: HomeContext): Promise<Employee | null> {
  return (await reader.rows<Employee>("employees")).find((employee) => employee.user_id === ctx.userId) ?? null;
}

const NO_EMPLOYEE_HINT = "Seu cadastro de colaborador ainda não foi criado: abra o Meu RH.";

// ── Loaders ──────────────────────────────────────────────────────────────────────────────────────────────────

type Loader = (reader: HomeReader, ctx: HomeContext) => Promise<HomeMetric>;

/** Quem vê as pendências da equipe inteira; os demais veem as próprias (follow-ups). */
const SEES_TEAM: ReadonlySet<Role> = new Set<Role>(["ceo", "admin", "gerente"]);

const OPEN_TICKET = (ticket: Ticket) => ticket.status !== "resolvido" && ticket.status !== "fechado";
const OPEN_WORK_ORDER = (order: WorkOrder) => order.status !== "concluida" && order.status !== "cancelada";

export const METRIC_LOADERS: Readonly<Record<string, Loader>> = {
  // ── Meu RH ─────────────────────────────────────────────────────────────────────────────────────────────────
  "hr.vacation": async (reader, ctx) => {
    const me = await myEmployee(reader, ctx);
    if (!me) return { value: 0, format: "days", hint: NO_EMPLOYEE_HINT };
    const requests = (await reader.rows<HrRequest>("hr_requests")).filter((request) => request.employee_id === me.id);
    const balance = vacationBalance(me, requests, Number(ctx.today.slice(0, 4)));
    return { value: balance.available, format: "days", hint: `${balance.entitled} de direito · ${balance.used} aprovados · ${balance.pending} em análise` };
  },
  "hr.myTodos": async (reader, ctx) => {
    const me = await myEmployee(reader, ctx);
    if (!me) return { value: 0, format: "count", hint: NO_EMPLOYEE_HINT };
    const open = (await reader.rows<HrTask>("hr_tasks")).filter((task) => task.employee_id === me.id && task.status === "pendente");
    const late = open.filter((task) => isPast(task.due_date, ctx)).length;
    return { value: open.length, format: "count", tone: late ? "warning" : "neutral", hint: late ? `${count(late, "com prazo vencido", "com prazo vencido")}` : open.length ? "Nada vencido" : "Nada pendente" };
  },
  "hr.myTimeBank": async (reader, ctx) => {
    const me = await myEmployee(reader, ctx);
    if (!me) return { value: 0, format: "minutes", hint: NO_EMPLOYEE_HINT };
    const summary = timeBankSummary((await reader.rows<HrTimeEntry>("hr_time_entries")).filter((entry) => entry.employee_id === me.id));
    return { value: summary.balance, format: "minutes", hint: summary.pendingCount ? `${formatMinutes(summary.pending)} em análise` : "Nenhum lançamento em análise" };
  },

  // ── Comercial ──────────────────────────────────────────────────────────────────────────────────────────────
  "crm.pipeline": async (reader) => {
    const open = (await reader.rows<Opportunity>("opportunities")).filter((opportunity) => opportunity.status === "open");
    const total = sumMoney(open.map((opportunity) => Number(opportunity.value) || 0));
    const weighted = sumMoney(open.map((opportunity) => ((Number(opportunity.value) || 0) * (Number(opportunity.probability) || 0)) / 100));
    return { value: total, format: "money", hint: `${count(open.length, "oportunidade", "oportunidades")} · ponderado ${money(weighted)}` };
  },
  "crm.followups": async (reader, ctx) => {
    const [activities, customers] = await Promise.all([reader.rows<CrmActivity>("crm_activities"), reader.rows<Customer>("customers")]);
    const names = new Map(customers.map((customer) => [customer.id, customer.name]));
    const mine = (activity: CrmActivity) => activity.user_id === ctx.userId || (!activity.user_id && activity.created_by === ctx.userId);
    const overdue = activities
      .filter((activity) => !activity.done_at && isPast(activity.due_at, ctx) && (SEES_TEAM.has(ctx.role) || mine(activity)))
      .sort((a, b) => sortKey(a.due_at) - sortKey(b.due_at));
    return {
      value: overdue.length,
      format: "count",
      tone: overdue.length ? "danger" : "success",
      hint: overdue.length ? (SEES_TEAM.has(ctx.role) ? "Da equipe toda" : "Seus follow-ups") : "Nenhum follow-up vencido",
      items: overdue.slice(0, 6).map((activity) => ({
        id: activity.id,
        title: activity.subject?.trim() || activity.body?.trim() || "Atividade sem assunto",
        detail: [activity.customer_id ? names.get(activity.customer_id) : null, `venceu em ${formatDay(activity.due_at)}`].filter(Boolean).join(" · "),
        badge: { status: activity.kind },
      })),
    };
  },
  "crm.openProposals": async (reader, ctx) => {
    const open = (await reader.rows<Proposal>("proposals")).filter((proposal) => proposal.status === "rascunho" || proposal.status === "enviada");
    const expired = open.filter((proposal) => proposal.status === "enviada" && isPast(proposal.valid_until, ctx)).length;
    const total = sumMoney(open.map((proposal) => Number(proposal.value) || 0));
    return { value: open.length, format: "count", tone: expired ? "warning" : "neutral", hint: expired ? `${money(total)} · ${count(expired, "enviada com validade vencida", "enviadas com validade vencida")}` : `${money(total)} em propostas` };
  },
  "crm.customers": async (reader, ctx) => {
    const active = (await reader.rows<Customer>("customers")).filter((customer) => customer.status !== "inactive");
    const month = ctx.today.slice(0, 7);
    const fresh = active.filter((customer) => localDay(customer.created_at)?.slice(0, 7) === month).length;
    return { value: active.length, format: "count", hint: `${count(fresh, "novo", "novos")} neste mês` };
  },
  "leads.new": async (reader, ctx) => {
    const fresh = (await reader.rows<Lead>("leads")).filter((lead) => lead.status === "novo");
    const today = fresh.filter((lead) => lead.outreach_date === ctx.today).length;
    return { value: fresh.length, format: "count", hint: `${today} com abordagem prevista para hoje` };
  },
  "sales.monthOrders": async (reader, ctx) => {
    const month = ctx.today.slice(0, 7);
    const orders = (await reader.rows<SalesOrder>("sales_orders")).filter((order) => ["confirmado", "faturado", "entregue"].includes(order.status) && order.order_date?.slice(0, 7) === month);
    const total = sumMoney(orders.map((order) => Number(order.total) || 0));
    return { value: total, format: "money", hint: orders.length ? `${count(orders.length, "pedido", "pedidos")} · ticket médio ${money(total / orders.length)}` : "Nenhum pedido confirmado neste mês" };
  },
  "sales.toApprove": async (reader) => {
    const drafts = (await reader.rows<SalesOrder>("sales_orders")).filter((order) => order.status === "rascunho");
    return { value: drafts.length, format: "count", hint: `${money(sumMoney(drafts.map((order) => Number(order.total) || 0)))} em rascunho` };
  },
  "invoices.open": async (reader, ctx) => {
    const open = (await reader.rows<Invoice>("invoices")).filter((invoice) => ["emitida", "paga_parcial", "vencida"].includes(invoice.status));
    const balance = sumMoney(open.map((invoice) => openBalance(invoice.total, invoice.paid_amount)));
    const late = open.filter((invoice) => invoice.status === "vencida" || isPast(invoice.due_date, ctx)).length;
    return { value: balance, format: "money", tone: late ? "warning" : "neutral", hint: `${count(open.length, "fatura", "faturas")}${late ? ` · ${count(late, "vencida", "vencidas")}` : ""}` };
  },

  // ── Financeiro ─────────────────────────────────────────────────────────────────────────────────────────────
  "fin.overdueReceivables": async (reader, ctx) => {
    const overdue = (await openReceivables(reader)).filter((row) => isPast(row.due_date, ctx));
    const total = sumMoney(overdue.map((row) => row.open));
    return { value: total, format: "money", tone: overdue.length ? "danger" : "success", hint: overdue.length ? count(overdue.length, "conta vencida", "contas vencidas") : "Nada vencido" };
  },
  "fin.overduePayables": async (reader, ctx) => {
    const overdue = (await openPayables(reader)).filter((row) => isPast(row.due_date, ctx));
    const total = sumMoney(overdue.map((row) => row.open));
    return { value: total, format: "money", tone: overdue.length ? "danger" : "success", hint: overdue.length ? count(overdue.length, "conta vencida", "contas vencidas") : "Nada vencido" };
  },
  "fin.payablesToApprove": async (reader) => {
    const waiting = (await reader.rows<Payable>("payables")).filter((row) => row.status === "aberta");
    return { value: waiting.length, format: "count", tone: waiting.length ? "warning" : "neutral", hint: `${money(sumMoney(waiting.map((row) => Number(row.amount) || 0)))} esperando aprovação` };
  },
  "fin.dueNext7": async (reader, ctx) => {
    const end = addDays(ctx.today, 6);
    const inWindow = (date: string | null | undefined) => !!date && date >= ctx.today && date <= end;
    const [receivables, payables] = await Promise.all([openReceivables(reader), openPayables(reader)]);
    const entries = [
      ...payables.filter((row) => inWindow(row.due_date)).map((row) => ({ id: `payable:${row.id}`, kind: "pagar" as const, date: row.due_date!, text: row.description, open: row.open })),
      ...receivables.filter((row) => inWindow(row.due_date)).map((row) => ({ id: `receivable:${row.id}`, kind: "receber" as const, date: row.due_date!, text: row.description ?? row.ref_id ?? "Conta a receber", open: row.open })),
    ].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    const inflow = sumMoney(entries.filter((entry) => entry.kind === "receber").map((entry) => entry.open));
    const outflow = sumMoney(entries.filter((entry) => entry.kind === "pagar").map((entry) => entry.open));
    return {
      value: entries.length,
      format: "count",
      hint: `A receber ${money(inflow)} · a pagar ${money(outflow)}`,
      items: entries.slice(0, 8).map((entry) => ({
        id: entry.id,
        title: `${entry.kind === "pagar" ? "A pagar" : "A receber"} · ${entry.text}`,
        detail: `${formatDay(entry.date)} · ${money(entry.open)}`,
        badge: { status: entry.kind === "pagar" ? "A pagar" : "A receber", tone: entry.kind === "pagar" ? "orange" : "success" },
      })),
    };
  },
  "fin.cashflow7": async (reader, ctx) => {
    const days = Array.from({ length: 7 }, (_, index) => addDays(ctx.today, index));
    const [receivables, payables] = await Promise.all([openReceivables(reader), openPayables(reader)]);
    const points = days.map<HomeChartPoint>((date) => ({
      day: date,
      label: dayLabel(date),
      entradas: sumMoney(receivables.filter((row) => row.due_date === date).map((row) => row.open)),
      saidas: sumMoney(payables.filter((row) => row.due_date === date).map((row) => row.open)),
    }));
    const inflow = sumMoney(points.map((point) => Number(point.entradas)));
    const outflow = sumMoney(points.map((point) => Number(point.saidas)));
    const net = roundMoney(inflow - outflow);
    return {
      value: net,
      format: "money",
      tone: net < 0 ? "danger" : "success",
      hint: `Entradas ${money(inflow)} · saídas ${money(outflow)}`,
      chart: { series: [{ key: "entradas", label: "Entradas" }, { key: "saidas", label: "Saídas" }], points },
    };
  },
  "bank.pendingReconciliation": async (reader) => {
    const pending = (await reader.rows<BankTransaction>("bank_transactions")).filter((row) => row.status === "pendente");
    const inflow = sumMoney(pending.filter((row) => row.amount > 0).map((row) => row.amount));
    const outflow = sumMoney(pending.filter((row) => row.amount < 0).map((row) => -row.amount));
    return { value: pending.length, format: "count", tone: pending.length ? "warning" : "success", hint: pending.length ? `Entradas ${money(inflow)} · saídas ${money(outflow)}` : "Extrato em dia" };
  },

  // ── Estoque e compras ──────────────────────────────────────────────────────────────────────────────────────
  "inv.belowMin": async (reader) => {
    const [items, balances] = await Promise.all([reader.rows<InventoryItem>("inventory_items"), reader.rows<StockBalance>("stock_balances")]);
    const stock = new Map<string, number>();
    for (const balance of balances) stock.set(balance.item_id, (stock.get(balance.item_id) ?? 0) + (Number(balance.quantity) || 0));
    const below = items
      .map((item) => ({ item, qty: stock.get(item.id) ?? 0, min: Number(item.min_stock) || 0 }))
      .filter((entry) => entry.min > 0 && entry.qty < entry.min)
      .sort((a, b) => a.qty / a.min - b.qty / b.min || a.item.name.localeCompare(b.item.name, "pt-BR"));
    return {
      value: below.length,
      format: "count",
      tone: below.length ? "warning" : "success",
      hint: below.length ? "Sugestão de compra em Reposição" : "Estoque acima do mínimo",
      items: below.slice(0, 6).map(({ item, qty, min }) => ({
        id: item.id,
        title: item.name,
        detail: `Saldo ${quantity.format(qty)} de mínimo ${quantity.format(min)} ${item.unit ?? ""}`.trim(),
        badge: { status: qty <= 0 ? "Sem saldo" : "Abaixo", tone: qty <= 0 ? "danger" : "warning" },
      })),
    };
  },
  "inv.openCounts": async (reader) => {
    const open = (await reader.rows<InventoryCount>("inventory_counts")).filter((row) => row.status === "aberta");
    return { value: open.length, format: "count", hint: open.length ? "Contagens esperando conferência" : "Nenhuma contagem aberta" };
  },
  "pur.toReceive": async (reader, ctx) => {
    const waiting = (await reader.rows<PurchaseOrder>("purchase_orders")).filter((row) => ["aprovado", "enviado", "recebido_parcial"].includes(row.status));
    const late = waiting.filter((row) => isPast(row.expected_date, ctx)).length;
    return { value: waiting.length, format: "count", tone: late ? "warning" : "neutral", hint: late ? count(late, "atrasado", "atrasados") : "Nenhum atrasado" };
  },
  "pur.toApprove": async (reader) => {
    const drafts = (await reader.rows<PurchaseOrder>("purchase_orders")).filter((row) => row.status === "rascunho");
    return { value: drafts.length, format: "count", hint: `${money(sumMoney(drafts.map((row) => Number(row.total) || 0)))} em pedidos` };
  },
  "custody.active": async (reader, ctx) => {
    const active = (await reader.rows<Custody>("custodies")).filter((row) => row.status === "em_custodia");
    const late = active.filter((row) => isPast(row.due_back_at, ctx)).length;
    return { value: active.length, format: "count", tone: late ? "warning" : "neutral", hint: late ? count(late, "com devolução atrasada", "com devolução atrasada") : "Nenhuma devolução atrasada" };
  },
  "catalog.active": async (reader) => {
    const active = (await reader.rows<Product>("products")).filter((row) => truthy(row.active));
    const services = active.filter((row) => row.kind === "servico").length;
    return { value: active.length, format: "count", hint: `${count(active.length - services, "produto", "produtos")} · ${count(services, "serviço", "serviços")}` };
  },

  // ── Operações, TI e auditoria ──────────────────────────────────────────────────────────────────────────────
  "support.openTickets": async (reader, ctx) => {
    const all = hasFullTicketAccess(ctx.role);
    const open = (await reader.rows<Ticket>("tickets")).filter((ticket) => OPEN_TICKET(ticket) && (all || ticket.opened_by === ctx.userId));
    const urgent = open.filter((ticket) => ticket.priority === "urgente" || ticket.priority === "alta").length;
    return { value: open.length, format: "count", tone: urgent ? "warning" : "neutral", hint: `${all ? "Todos os chamados" : "Chamados que você abriu"}${urgent ? ` · ${count(urgent, "urgente ou alto", "urgentes ou altos")}` : ""}` };
  },
  "ops.openWorkOrders": async (reader, ctx) => {
    const open = (await reader.rows<WorkOrder>("work_orders")).filter(OPEN_WORK_ORDER);
    const late = open.filter((order) => isPast(order.sla_due_at, ctx)).length;
    return { value: open.length, format: "count", tone: late ? "warning" : "neutral", hint: late ? `${count(late, "atrasada", "atrasadas")} pelo SLA` : "Nenhuma fora do SLA" };
  },
  "ops.week": async (reader, ctx) => {
    const days = Array.from({ length: 7 }, (_, index) => addDays(ctx.today, index - 6));
    const withTickets = hasFullTicketAccess(ctx.role);
    const orders = await reader.rows<WorkOrder>("work_orders");
    const tickets = withTickets ? await reader.rows<Ticket>("tickets") : [];
    const points = days.map<HomeChartPoint>((date) => {
      const point: HomeChartPoint = { day: date, label: dayLabel(date), os: orders.filter((order) => localDay(order.opened_at || order.created_at) === date).length };
      if (withTickets) point.chamados = tickets.filter((ticket) => localDay(ticket.created_at) === date).length;
      return point;
    });
    const total = points.reduce((sum, point) => sum + Number(point.os), 0);
    const ticketTotal = withTickets ? points.reduce((sum, point) => sum + Number(point.chamados), 0) : 0;
    return {
      value: total,
      format: "count",
      hint: withTickets ? `${count(total, "OS", "OS")} e ${count(ticketTotal, "chamado", "chamados")} em 7 dias` : `${count(total, "OS aberta", "OS abertas")} em 7 dias`,
      chart: { series: withTickets ? [{ key: "os", label: "OS" }, { key: "chamados", label: "Chamados" }] : [{ key: "os", label: "OS" }], points },
    };
  },
  "audit.recent": async (reader, ctx) => {
    const modules = new Set(visibleModules(ctx.role));
    const everything = ctx.role === "ceo" || ctx.role === "admin";
    const [logs, activities] = await Promise.all([
      reader.recent<{ id: string; entity_type: string; action: string; created_at: string }>("audit_logs", 20),
      reader.recent<Activity>("activities", 60),
    ]);
    const events = [
      ...logs.map((log) => ({ id: `audit:${log.id}`, title: log.action, detail: log.entity_type, at: log.created_at, source: "Auditoria" })),
      // Evento só de módulo que o papel vê (o auditor não vê folha nem gestão de RH); sem módulo, só CEO e admin.
      ...activities
        .filter((activity) => (activity.module ? modules.has(activity.module) : everything))
        .map((activity) => ({ id: `activity:${activity.id}`, title: activity.title?.trim() || activity.action, detail: activity.entity_type, at: activity.created_at, source: "Evento" })),
    ].sort((a, b) => sortKey(b.at) - sortKey(a.at));
    const today = events.filter((event) => localDay(event.at) === ctx.today).length;
    return {
      value: today,
      format: "count",
      hint: `${count(today, "ação hoje", "ações hoje")}`,
      items: events.slice(0, 6).map((event) => ({ id: event.id, title: event.title, detail: `${event.detail} · ${formatDay(event.at)}`, badge: { status: event.source, tone: event.source === "Auditoria" ? "violet" : "neutral" } })),
    };
  },
  "projects.active": async (reader) => {
    const active = (await reader.rows<Project>("projects")).filter((project) => project.status === "planejado" || project.status === "andamento");
    const running = active.filter((project) => project.status === "andamento").length;
    return { value: active.length, format: "count", hint: `${running} em andamento · ${active.length - running} planejado(s)` };
  },
  "tasks.open": async (reader, ctx) => {
    const open = (await reader.rows<Task>("tasks")).filter((task) => task.status !== "concluida");
    const late = open.filter((task) => isPast(task.due_date, ctx)).length;
    const blocked = open.filter((task) => task.status === "bloqueada").length;
    return { value: open.length, format: "count", tone: late || blocked ? "warning" : "neutral", hint: `${count(late, "atrasada", "atrasadas")} · ${count(blocked, "bloqueada", "bloqueadas")}` };
  },

  // ── Gestão de RH e folha ───────────────────────────────────────────────────────────────────────────────────
  "hr.pendingRequests": async (reader) => {
    const [requests, employees] = await Promise.all([reader.rows<HrRequest>("hr_requests"), reader.rows<Employee>("employees")]);
    const names = new Map(employees.map((employee) => [employee.id, employee.name]));
    const pending = requests.filter((request) => request.status === "pendente").sort((a, b) => a.start_date.localeCompare(b.start_date) || a.id.localeCompare(b.id));
    return {
      value: pending.length,
      format: "count",
      tone: pending.length ? "warning" : "success",
      hint: pending.length ? "Aguardando decisão do RH" : "Nada aguardando",
      items: pending.slice(0, 6).map((request) => ({
        id: request.id,
        title: `${names.get(request.employee_id) ?? "Colaborador"} · ${REQUEST_TYPE_LABEL[request.type] ?? request.type}`,
        detail: `${formatDay(request.start_date)} a ${formatDay(request.end_date)} · ${count(request.days, "dia", "dias")}`,
        badge: { status: "pendente" },
      })),
    };
  },
  "hr.timeBankPending": async (reader) => {
    const summary = timeBankSummary(await reader.rows<HrTimeEntry>("hr_time_entries"));
    return { value: summary.pendingCount, format: "count", tone: summary.pendingCount ? "warning" : "neutral", hint: summary.pendingCount ? `${formatMinutes(summary.pending)} em análise` : "Nada aguardando" };
  },
  "hr.cycle": async (reader) => {
    const open = (await reader.rows<HrTask>("hr_tasks")).filter((task) => task.status === "pendente" && (task.category === "admissao" || task.category === "desligamento"));
    const admissions = new Set(open.filter((task) => task.category === "admissao").map((task) => task.employee_id));
    const terminations = new Set(open.filter((task) => task.category === "desligamento").map((task) => task.employee_id));
    const people = new Set([...admissions, ...terminations]);
    return {
      value: people.size,
      format: "count",
      hint: `${count(admissions.size, "admissão", "admissões")} · ${count(terminations.size, "desligamento", "desligamentos")} · ${count(open.length, "tarefa aberta", "tarefas abertas")}`,
    };
  },
  "hr.activeEmployees": async (reader, ctx) => {
    const [employees, requests] = await Promise.all([reader.rows<Employee>("employees"), reader.rows<HrRequest>("hr_requests")]);
    const active = employees.filter((employee) => employee.status !== "desligado");
    const away = active.filter((employee) => isOnVacation(requests, employee.id, ctx.today)).length;
    return { value: active.length, format: "count", hint: `${away} de férias hoje` };
  },
  "hr.lateTasks": async (reader, ctx) => {
    const late = (await reader.rows<HrTask>("hr_tasks")).filter((task) => task.status === "pendente" && isPast(task.due_date, ctx));
    return { value: late.length, format: "count", tone: late.length ? "danger" : "success", hint: late.length ? "Cobrar os colaboradores" : "Nada em atraso" };
  },
  "payroll.monthly": async (reader) => {
    const [employees, compensation] = await Promise.all([reader.rows<Employee>("employees"), reader.rows<EmployeeCompensation>("employee_compensation")]);
    const active = employees.filter((employee) => employee.status !== "desligado").length;
    return { value: roundMoney(monthlyPayroll(employees, compensation)), format: "money", hint: `${count(active, "colaborador ativo", "colaboradores ativos")}` };
  },
};

/** Carrega os widgets de dado (atalhos não têm número). Um loader que falha vira { ok: false } só para ele. */
export async function loadHomeMetrics(db: DatabaseLike, ctx: HomeContext, widgets: readonly HomeWidget[]): Promise<Record<string, HomeMetricResult>> {
  const reader = createHomeReader(db, ctx.companyId);
  const entries = await Promise.all(
    widgets
      .filter((widget) => widget.kind !== "shortcut" && METRIC_LOADERS[widget.id])
      .map(async (widget): Promise<[string, HomeMetricResult]> => {
        try {
          return [widget.id, { ok: true, metric: await METRIC_LOADERS[widget.id](reader, ctx) }];
        } catch (cause) {
          return [widget.id, { ok: false, error: cause instanceof Error ? cause.message : String(cause) }];
        }
      }),
  );
  return Object.fromEntries(entries);
}

/** Valor formatado para o card (R$, dias, banco de horas ou número). */
export function formatMetricValue(metric: Pick<HomeMetric, "value" | "format">): string {
  switch (metric.format) {
    case "money":
      return money(metric.value);
    case "days":
      return `${metric.value} ${metric.value === 1 ? "dia" : "dias"}`;
    case "minutes":
      return formatMinutes(metric.value);
    default:
      return new Intl.NumberFormat("pt-BR").format(metric.value);
  }
}
