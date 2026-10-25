// CRM: consultas e gravações de clientes, contatos, oportunidades e propostas, regras do funil e resumo financeiro.
// SQL só nos padrões do banco demo (SELECT * com WHERE col=? AND ..., ORDER BY coluna; INSERT/UPDATE simples):
// junção, soma e agrupamento ficam aqui no TypeScript. O primeiro bind é sempre o company_id.
// customers e opportunities são tabelas "lenientes" no demo: WHERE fora do padrão viraria filtro só por empresa,
// por isso aqui toda condição é col=?, col IS NULL ou col IS NOT NULL.
import { v4 as uuidv4 } from "uuid";
import type { DatabaseLike } from "@/lib/db/demo";
import { roundMoney, sumMoney, toCents, fromCents } from "@/lib/money";
import type { Contact, Customer, Opportunity, Product, Proposal, Role } from "@/types";

// ---------------------------------------------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------------------------------------------

export type Stage = Opportunity["stage"];

export const OPPORTUNITY_STAGES: readonly Stage[] = ["novo", "qualificacao", "proposta", "negociacao", "ganho", "perdido"];
export const OPEN_STAGES: readonly Stage[] = ["novo", "qualificacao", "proposta", "negociacao"];

export const STAGE_LABELS: Record<Stage, string> = {
  novo: "Novo",
  qualificacao: "Qualificação",
  proposta: "Proposta",
  negociacao: "Negociação",
  ganho: "Ganho",
  perdido: "Perdido",
};

/** Probabilidade padrão de fechamento por etapa (%), usada ao criar e ao mover no funil. */
export const STAGE_PROBABILITY: Record<Stage, number> = {
  novo: 10,
  qualificacao: 25,
  proposta: 50,
  negociacao: 75,
  ganho: 100,
  perdido: 0,
};

export function statusForStage(stage: Stage): Opportunity["status"] {
  return stage === "ganho" ? "won" : stage === "perdido" ? "lost" : "open";
}

export function isStage(value: unknown): value is Stage {
  return typeof value === "string" && (OPPORTUNITY_STAGES as readonly string[]).includes(value);
}

/** Instante atual (UTC, ISO), como os timestamps do resto do app. */
export function nowIso(): string {
  return new Date().toISOString();
}

/** Texto aparado; vazio vira null. */
export function clean(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

/** Minúsculas e sem acento, para busca. */
export function fold(value: string | null | undefined): string {
  return (value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Valor em reais digitado pela pessoa: "1.234,56", "1234,56", "1234.56", "R$ 10" ou número. Vazio → null.
 * Ponto só como milhar quando o padrão é de milhar ("1.500" = 1500); sem vírgula, "1.5" = 1,5.
 */
export function parseMoneyInput(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? roundMoney(value) : null;
  let text = String(value).replace(/R\$/i, "").replace(/\s/g, "");
  if (!text) return null;
  const negative = text.startsWith("-");
  text = text.replace(/^[-+]/, "");
  if (text.includes(",")) {
    // Com vírgula, ponto só como milhar antes dela: "1,234.56" (americano) ou "1.23,45" seriam lidos errado em silêncio.
    if (!/^(\d{1,3}(\.\d{3})+|\d*),\d*$/.test(text)) throw new Error(`Valor inválido: ${String(value)}`);
    text = text.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(text)) text = text.replace(/\./g, "");
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error(`Valor inválido: ${String(value)}`);
  return roundMoney(Number(text) * (negative ? -1 : 1));
}

function sortByName<T extends { name: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

// ---------------------------------------------------------------------------------------------------------------
// Usuários e catálogo
// ---------------------------------------------------------------------------------------------------------------

export interface CompanyUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

/** Contas ativas da empresa com o papel (para responsável de cliente, oportunidade e atividade). */
export async function fetchCompanyUsers(db: DatabaseLike, companyId: string): Promise<CompanyUser[]> {
  const memberships = await db.select<{ user_id: string; role: Role; company_id: string; deleted_at?: string | null }[]>(
    "SELECT * FROM memberships WHERE company_id=? AND deleted_at IS NULL",
    [companyId],
  );
  const users = await db.select<{ id: string; name: string; email: string; status?: string; deleted_at?: string | null }[]>(
    "SELECT * FROM users WHERE deleted_at IS NULL",
  );
  const byId = new Map(users.filter((user) => !user.deleted_at && user.status !== "suspended").map((user) => [user.id, user]));
  const result = new Map<string, CompanyUser>();
  for (const membership of memberships) {
    if (membership.company_id !== companyId || membership.deleted_at) continue;
    const user = byId.get(membership.user_id);
    if (user && !result.has(user.id)) result.set(user.id, { id: user.id, name: user.name, email: user.email, role: membership.role });
  }
  return sortByName([...result.values()]);
}

/** Produtos e serviços ativos do catálogo (itens da proposta). */
export async function fetchProducts(db: DatabaseLike, companyId: string): Promise<Product[]> {
  const rows = await db.select<Product[]>("SELECT * FROM products WHERE company_id=? AND deleted_at IS NULL ORDER BY name", [companyId]);
  return rows.filter((row) => Number(row.active) !== 0);
}

export interface PriceListRow {
  id: string;
  name: string;
  is_default: number;
  active: number;
}

/** Tabelas de preço ativas (o cliente pode ter uma; os itens da proposta usam o preço dela). */
export async function fetchPriceLists(db: DatabaseLike, companyId: string): Promise<PriceListRow[]> {
  const rows = await db.select<(PriceListRow & { deleted_at?: string | null })[]>("SELECT * FROM price_lists WHERE company_id=? AND deleted_at IS NULL ORDER BY name", [companyId]);
  return sortByName(rows.filter((row) => !row.deleted_at && Number(row.active) !== 0));
}

// ---------------------------------------------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------------------------------------------

export async function fetchCustomers(db: DatabaseLike, companyId: string): Promise<Customer[]> {
  const rows = await db.select<Customer[]>("SELECT * FROM customers WHERE company_id=? AND deleted_at IS NULL ORDER BY name", [companyId]);
  return sortByName(rows.filter((row) => !row.deleted_at));
}

/** Cliente pelo id (inclusive excluído/mesclado, para a ficha poder avisar). */
export async function fetchCustomer(db: DatabaseLike, companyId: string, id: string): Promise<Customer | null> {
  const rows = await db.select<Customer[]>("SELECT * FROM customers WHERE company_id=? AND id=?", [companyId, id]);
  return rows.find((row) => row.id === id) ?? null;
}

export interface CustomerInput {
  name: string;
  type: Customer["type"] | string;
  document?: string | null;
  email?: string | null;
  phone?: string | null;
  segment?: string | null;
  owner_id?: string | null;
  status?: Customer["status"] | string;
  trade_name?: string | null;
  state_registration?: string | null;
  website?: string | null;
  source?: string | null;
  notes?: string | null;
  payment_terms?: string | null;
  credit_limit?: string | number | null;
  price_list_id?: string | null;
  address_json?: string | null;
}

const CUSTOMER_FIELDS = ["type", "name", "document", "email", "phone", "segment", "owner_id", "status", "trade_name", "state_registration", "website", "source", "notes", "payment_terms", "credit_limit", "price_list_id"] as const;

function customerValues(input: CustomerInput): Record<(typeof CUSTOMER_FIELDS)[number], string | number | null> {
  const name = clean(input.name);
  if (!name) throw new Error("Informe o nome do cliente.");
  const type = input.type === "PF" ? "PF" : "PJ";
  const status = input.status === "inactive" ? "inactive" : "active";
  return {
    type,
    name,
    document: clean(input.document),
    email: clean(input.email)?.toLowerCase() ?? null,
    phone: clean(input.phone),
    segment: clean(input.segment),
    owner_id: clean(input.owner_id),
    status,
    trade_name: clean(input.trade_name),
    state_registration: clean(input.state_registration),
    website: clean(input.website),
    source: clean(input.source),
    notes: clean(input.notes),
    payment_terms: clean(input.payment_terms),
    credit_limit: parseMoneyInput(input.credit_limit),
    price_list_id: clean(input.price_list_id),
  };
}

/** Cria (sem `id`) ou atualiza o cliente. Devolve o id. */
export async function saveCustomer(db: DatabaseLike, companyId: string, input: CustomerInput, id?: string): Promise<string> {
  const values = customerValues(input);
  const address = input.address_json ?? null;
  if (id) {
    const assignments = CUSTOMER_FIELDS.map((field) => `${field}=?`);
    const binds: unknown[] = CUSTOMER_FIELDS.map((field) => values[field]);
    if (address != null) {
      assignments.push("address_json=?");
      binds.push(address);
    }
    await db.execute(`UPDATE customers SET ${assignments.join(", ")}, updated_at=? WHERE company_id=? AND id=?`, [...binds, nowIso(), companyId, id]);
    return id;
  }
  const newId = uuidv4();
  const columns = ["id", "company_id", ...CUSTOMER_FIELDS, "address_json"];
  await db.execute(
    `INSERT INTO customers (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
    [newId, companyId, ...CUSTOMER_FIELDS.map((field) => values[field]), address ?? "{}"],
  );
  return newId;
}

// ---------------------------------------------------------------------------------------------------------------
// Contatos
// ---------------------------------------------------------------------------------------------------------------

/** Contatos ativos (de um cliente ou de todos): principal primeiro, depois por nome. */
export async function fetchContacts(db: DatabaseLike, companyId: string, customerId?: string): Promise<Contact[]> {
  const rows = customerId
    ? await db.select<Contact[]>("SELECT * FROM contacts WHERE company_id=? AND customer_id=? AND deleted_at IS NULL", [companyId, customerId])
    : await db.select<Contact[]>("SELECT * FROM contacts WHERE company_id=? AND deleted_at IS NULL", [companyId]);
  return rows
    .filter((row) => !row.deleted_at)
    .sort((a, b) => Number(b.is_primary ?? 0) - Number(a.is_primary ?? 0) || a.name.localeCompare(b.name, "pt-BR"));
}

export interface ContactInput {
  customer_id?: string | null;
  name: string;
  email?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  role?: string | null;
  notes?: string | null;
}

/**
 * Cria ou edita um contato. O primeiro contato ativo do cliente vira o principal. Ao trocar de cliente, o contato
 * não leva a marca de principal: o cliente antigo promove o próximo e o novo só o adota se não tiver principal.
 */
export async function saveContact(db: DatabaseLike, companyId: string, input: ContactInput, id?: string): Promise<string> {
  const name = clean(input.name);
  if (!name) throw new Error("Informe o nome do contato.");
  const customerId = clean(input.customer_id);
  const values = [customerId, name, clean(input.email)?.toLowerCase() ?? null, clean(input.phone), clean(input.whatsapp), clean(input.role), clean(input.notes)];
  if (id) {
    const [current] = (await db.select<Contact[]>("SELECT * FROM contacts WHERE company_id=? AND id=?", [companyId, id])).filter((row) => row.id === id);
    const now = nowIso();
    await db.execute("UPDATE contacts SET customer_id=?, name=?, email=?, phone=?, whatsapp=?, role=?, notes=?, updated_at=? WHERE company_id=? AND id=?", [...values, now, companyId, id]);
    const previousCustomerId = current?.customer_id ?? null;
    if (current && !current.deleted_at && previousCustomerId !== customerId) {
      const wasPrimary = Number(current.is_primary ?? 0) === 1;
      if (wasPrimary) await db.execute("UPDATE contacts SET is_primary=?, updated_at=? WHERE company_id=? AND id=?", [0, now, companyId, id]);
      if (wasPrimary && previousCustomerId) {
        const [next] = await fetchContacts(db, companyId, previousCustomerId);
        if (next) await setPrimaryContact(db, companyId, next.id);
      }
      if (customerId) {
        const others = (await fetchContacts(db, companyId, customerId)).filter((row) => row.id !== id);
        if (!others.some((row) => Number(row.is_primary ?? 0) === 1)) await setPrimaryContact(db, companyId, id);
      }
    }
    return id;
  }
  const isFirst = customerId ? (await fetchContacts(db, companyId, customerId)).length === 0 : false;
  const newId = uuidv4();
  await db.execute(
    "INSERT INTO contacts (id, company_id, customer_id, name, email, phone, whatsapp, role, notes, is_primary) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [newId, companyId, ...values, isFirst ? 1 : 0],
  );
  return newId;
}

/** Marca o contato como principal do cliente dele e desmarca os outros. */
export async function setPrimaryContact(db: DatabaseLike, companyId: string, contactId: string): Promise<void> {
  const [contact] = await db.select<Contact[]>("SELECT * FROM contacts WHERE company_id=? AND id=?", [companyId, contactId]);
  if (!contact) throw new Error("Contato não encontrado.");
  const now = nowIso();
  if (contact.customer_id) {
    await db.execute("UPDATE contacts SET is_primary=?, updated_at=? WHERE company_id=? AND customer_id=?", [0, now, companyId, contact.customer_id]);
  }
  await db.execute("UPDATE contacts SET is_primary=?, updated_at=? WHERE company_id=? AND id=?", [1, now, companyId, contactId]);
}

/** Exclui (soft delete). Se era o principal, o próximo contato do cliente assume. */
export async function deleteContact(db: DatabaseLike, companyId: string, contactId: string): Promise<void> {
  const [contact] = await db.select<Contact[]>("SELECT * FROM contacts WHERE company_id=? AND id=?", [companyId, contactId]);
  if (!contact) return;
  const now = nowIso();
  await db.execute("UPDATE contacts SET deleted_at=?, is_primary=?, updated_at=? WHERE company_id=? AND id=?", [now, 0, now, companyId, contactId]);
  if (contact.customer_id && Number(contact.is_primary) === 1) {
    const [next] = await fetchContacts(db, companyId, contact.customer_id);
    if (next) await setPrimaryContact(db, companyId, next.id);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Oportunidades e funil
// ---------------------------------------------------------------------------------------------------------------

export async function fetchOpportunities(db: DatabaseLike, companyId: string, filter: { customerId?: string } = {}): Promise<Opportunity[]> {
  const rows = filter.customerId
    ? await db.select<Opportunity[]>("SELECT * FROM opportunities WHERE company_id=? AND customer_id=? AND deleted_at IS NULL ORDER BY created_at DESC", [companyId, filter.customerId])
    : await db.select<Opportunity[]>("SELECT * FROM opportunities WHERE company_id=? AND deleted_at IS NULL ORDER BY created_at DESC", [companyId]);
  return rows.filter((row) => !row.deleted_at);
}

export async function fetchOpportunity(db: DatabaseLike, companyId: string, id: string): Promise<Opportunity | null> {
  const rows = await db.select<Opportunity[]>("SELECT * FROM opportunities WHERE company_id=? AND id=?", [companyId, id]);
  return rows.find((row) => row.id === id) ?? null;
}

export interface OpportunityInput {
  title: string;
  value?: string | number | null;
  stage?: Stage;
  probability?: string | number | null;
  expected_close_date?: string | null;
  customer_id?: string | null;
  contact_id?: string | null;
  owner_id?: string | null;
  source?: string | null;
  notes?: string | null;
}

/**
 * Cria ou edita uma oportunidade. Ganhar e perder têm fluxo próprio (winOpportunity/loseOpportunity em convert.ts):
 * aqui uma etapa fechada só vale se a oportunidade já estava nela (editar título/valor de uma ganha). Voltar uma fechada
 * para uma etapa aberta a reabre. Sem probabilidade, vale a padrão da etapa.
 */
export async function saveOpportunity(db: DatabaseLike, companyId: string, userId: string, input: OpportunityInput, id?: string): Promise<string> {
  const title = clean(input.title);
  if (!title) throw new Error("Informe o título da oportunidade.");
  const stage = input.stage ?? "novo";
  if (!isStage(stage)) throw new Error(`Etapa inválida: ${String(stage)}`);
  const existing = id ? await fetchOpportunity(db, companyId, id) : null;
  if (id && !existing) throw new Error("Oportunidade não encontrada.");
  const closing = !(OPEN_STAGES as readonly string[]).includes(stage);
  if (closing && existing?.stage !== stage) throw new Error("Use Ganhar ou Perder para fechar a oportunidade.");
  const rawProbability = input.probability === "" || input.probability == null ? null : Number(input.probability);
  const probability = rawProbability == null || !Number.isFinite(rawProbability) ? STAGE_PROBABILITY[stage] : Math.min(100, Math.max(0, Math.round(rawProbability)));
  const value = parseMoneyInput(input.value) ?? 0;
  if (value < 0) throw new Error("O valor não pode ser negativo.");
  const values = [title, value, stage, probability, clean(input.expected_close_date), clean(input.customer_id), clean(input.contact_id), clean(input.owner_id) ?? userId, clean(input.source), clean(input.notes)];
  if (id && existing) {
    const reopening = !closing && existing.status !== "open";
    await db.execute(
      "UPDATE opportunities SET title=?, value=?, stage=?, probability=?, expected_close_date=?, customer_id=?, contact_id=?, owner_id=?, source=?, notes=?, status=?, closed_at=?, lost_reason=?, updated_at=? WHERE company_id=? AND id=?",
      [...values, statusForStage(stage), reopening ? null : existing.closed_at ?? null, reopening ? null : existing.lost_reason ?? null, nowIso(), companyId, id],
    );
    return id;
  }
  const newId = uuidv4();
  await db.execute(
    "INSERT INTO opportunities (id, company_id, title, value, stage, probability, expected_close_date, customer_id, contact_id, owner_id, source, notes, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [newId, companyId, ...values, "open"],
  );
  return newId;
}

/** Exclui a oportunidade (soft delete). Propostas, atividades e pedidos ligados ficam como estão. */
export async function deleteOpportunity(db: DatabaseLike, companyId: string, id: string): Promise<void> {
  const now = nowIso();
  await db.execute("UPDATE opportunities SET deleted_at=?, updated_at=? WHERE company_id=? AND id=?", [now, now, companyId, id]);
}

export interface StageTotals {
  count: number;
  total: number;
  /** Soma de valor × probabilidade. */
  weighted: number;
}

export interface PipelineSummary {
  byStage: Record<Stage, StageTotals>;
  /** Só as etapas abertas (novo → negociação). */
  open: StageTotals;
  /** Ganhas / (ganhas + perdidas); null sem nenhuma fechada. */
  winRate: number | null;
}

/** Totais do funil em centavos (sem erro de ponto flutuante). */
export function pipelineSummary(opportunities: readonly Pick<Opportunity, "stage" | "value" | "probability">[]): PipelineSummary {
  const cents = Object.fromEntries(OPPORTUNITY_STAGES.map((stage) => [stage, { count: 0, total: 0, weighted: 0 }])) as Record<Stage, StageTotals>;
  for (const opp of opportunities) {
    const bucket = cents[opp.stage];
    if (!bucket) continue;
    const value = toCents(Number(opp.value ?? 0));
    bucket.count += 1;
    bucket.total += value;
    bucket.weighted += Math.round((value * Number(opp.probability ?? 0)) / 100);
  }
  const toMoney = (totals: StageTotals): StageTotals => ({ count: totals.count, total: fromCents(totals.total), weighted: fromCents(totals.weighted) });
  const byStage = Object.fromEntries(OPPORTUNITY_STAGES.map((stage) => [stage, toMoney(cents[stage])])) as Record<Stage, StageTotals>;
  const open = OPEN_STAGES.reduce<StageTotals>((sum, stage) => ({ count: sum.count + cents[stage].count, total: sum.total + cents[stage].total, weighted: sum.weighted + cents[stage].weighted }), { count: 0, total: 0, weighted: 0 });
  const closed = cents.ganho.count + cents.perdido.count;
  return { byStage, open: toMoney(open), winRate: closed ? cents.ganho.count / closed : null };
}

// ---------------------------------------------------------------------------------------------------------------
// Propostas (lista); itens e fluxo ficam em proposals.ts
// ---------------------------------------------------------------------------------------------------------------

export async function fetchProposals(db: DatabaseLike, companyId: string, filter: { customerId?: string; opportunityId?: string } = {}): Promise<Proposal[]> {
  let rows: Proposal[];
  if (filter.opportunityId) rows = await db.select<Proposal[]>("SELECT * FROM proposals WHERE company_id=? AND opportunity_id=? AND deleted_at IS NULL", [companyId, filter.opportunityId]);
  else if (filter.customerId) rows = await db.select<Proposal[]>("SELECT * FROM proposals WHERE company_id=? AND customer_id=? AND deleted_at IS NULL", [companyId, filter.customerId]);
  else rows = await db.select<Proposal[]>("SELECT * FROM proposals WHERE company_id=? AND deleted_at IS NULL", [companyId]);
  return rows.sort((a, b) => Number(b.number ?? 0) - Number(a.number ?? 0) || String(b.created_at).localeCompare(String(a.created_at)));
}

// ---------------------------------------------------------------------------------------------------------------
// Resumo financeiro do cliente (aba Financeiro da ficha)
// ---------------------------------------------------------------------------------------------------------------

export interface CustomerFinanceSummary {
  /** Faturas não canceladas. */
  invoiced: number;
  /** Recebido nas parcelas. */
  received: number;
  /** Saldo das parcelas não quitadas. */
  open: number;
  /** Parte do saldo com vencimento antes de hoje. */
  overdue: number;
}

interface ReceivableRow {
  amount: number;
  received_amount?: number | null;
  status: string;
  due_date?: string | null;
  deleted_at?: string | null;
}

/** `today` = 'YYYY-MM-DD' no dia local (todayIso()). */
export async function customerFinance(db: DatabaseLike, companyId: string, customerId: string, today: string): Promise<CustomerFinanceSummary> {
  const invoices = await db.select<{ total: number; status: string; deleted_at?: string | null }[]>(
    "SELECT * FROM invoices WHERE company_id=? AND customer_id=? AND deleted_at IS NULL",
    [companyId, customerId],
  );
  const receivables = (await db.select<ReceivableRow[]>("SELECT * FROM receivables WHERE company_id=? AND customer_id=? AND deleted_at IS NULL", [companyId, customerId])).filter(
    (row) => !row.deleted_at && !["cancelada", "cancelado"].includes(row.status),
  );
  const invoiced = sumMoney(invoices.filter((row) => !row.deleted_at && row.status !== "cancelada").map((row) => Number(row.total ?? 0)));
  // received_amount é NOT NULL DEFAULT 0: conta marcada "recebida" sem baixa (tela antiga do Financeiro) vale o valor
  // cheio, como já some do "em aberto"; assim recebido + em aberto fecha com o total das parcelas.
  const received = sumMoney(
    receivables.map((row) => (row.status === "recebida" ? Math.max(Number(row.amount ?? 0), Number(row.received_amount ?? 0)) : Number(row.received_amount ?? 0))),
  );
  const outstanding = receivables
    .filter((row) => row.status !== "recebida")
    .map((row) => ({ due: row.due_date ?? null, cents: Math.max(0, toCents(Number(row.amount ?? 0)) - toCents(Number(row.received_amount ?? 0))) }));
  const open = fromCents(outstanding.reduce((sum, row) => sum + row.cents, 0));
  const overdue = fromCents(outstanding.filter((row) => row.due != null && row.due < today).reduce((sum, row) => sum + row.cents, 0));
  return { invoiced, received, open, overdue };
}
