// Funil do CRM: lead → oportunidade → cliente (+ pedido de venda da proposta aceita), perda e troca de etapa.
// Sem transação: o tauri-plugin-sql usa um pool de conexões e não garante BEGIN/COMMIT na mesma conexão. Por isso cada
// passo é idempotente (converter ou ganhar de novo reaproveita o que já foi criado) e a ordem deixa o banco coerente
// se algo falhar no meio. SQL nos padrões do banco demo.
import { v4 as uuidv4 } from "uuid";
import type { DatabaseLike } from "@/lib/db/demo";
import { nextSequenceNumber } from "@/lib/db/sequence";
import { orderTotals, lineTotal } from "@/lib/money";
import { referralStatusFor } from "@/lib/prospecting/referral";
import { todayIso } from "@/lib/utils";
import type { Customer, Lead, Opportunity, Proposal, ProposalItem } from "@/types";
import { logActivity } from "./activities";
import { normalizeDocument, normalizeEmail, normalizePhone } from "./dedupe";
import { clean, nowIso, OPEN_STAGES, STAGE_LABELS, STAGE_PROBABILITY, type Stage } from "./queries";

async function fetchLead(db: DatabaseLike, leadId: string): Promise<Lead> {
  const rows = await db.select<Lead[]>("SELECT * FROM leads WHERE id=? AND deleted_at IS NULL", [leadId]);
  const lead = rows.find((row) => row.id === leadId && !row.deleted_at);
  if (!lead) throw new Error("Lead não encontrado (ou excluído).");
  return lead;
}

async function requireOpportunity(db: DatabaseLike, oppId: string): Promise<Opportunity> {
  const rows = await db.select<Opportunity[]>("SELECT * FROM opportunities WHERE id=? AND deleted_at IS NULL", [oppId]);
  const opp = rows.find((row) => row.id === oppId && !row.deleted_at);
  if (!opp) throw new Error("Oportunidade não encontrada (ou excluída).");
  return opp;
}

/**
 * Converte o lead em oportunidade (etapa Qualificação) e marca o lead como `convertido`. Converter de novo devolve a
 * oportunidade que já existe. A indicação continua pendente: o benefício só vale quando o indicado fecha.
 */
export async function convertLeadToOpportunity(db: DatabaseLike, leadId: string, userId: string): Promise<{ opportunityId: string }> {
  const lead = await fetchLead(db, leadId);
  const companyId = lead.company_id;
  const existing = (await db.select<Opportunity[]>("SELECT * FROM opportunities WHERE company_id=? AND lead_id=? AND deleted_at IS NULL", [companyId, leadId])).find(
    (row) => row.lead_id === leadId && !row.deleted_at,
  );
  let opportunityId = existing?.id;
  if (!opportunityId) {
    opportunityId = uuidv4();
    await db.execute(
      "INSERT INTO opportunities (id, company_id, customer_id, lead_id, title, value, stage, probability, owner_id, source, notes, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      [
        opportunityId,
        companyId,
        lead.customer_id ?? null,
        leadId,
        lead.name,
        Number(lead.estimated_revenue ?? 0) || 0,
        "qualificacao",
        STAGE_PROBABILITY.qualificacao,
        lead.owner_id ?? userId,
        clean(lead.source),
        clean(lead.notes),
        "open",
      ],
    );
    await logActivity(db, companyId, userId, {
      entity_type: "opportunity",
      entity_id: opportunityId,
      customer_id: lead.customer_id ?? null,
      subject: "Oportunidade criada a partir do lead",
      body: `Lead: ${lead.name}`,
    });
  }
  if (lead.status !== "convertido" && lead.status !== "fechado") {
    await db.execute("UPDATE leads SET status=?, referral_status=?, updated_at=? WHERE company_id=? AND id=?", [
      "convertido",
      referralStatusFor("convertido", lead.referred_by),
      nowIso(),
      companyId,
      leadId,
    ]);
  }
  return { opportunityId };
}

/** Cliente ativo da empresa com o mesmo documento, e-mail ou telefone (normalizados). */
async function findMatchingCustomer(db: DatabaseLike, companyId: string, probe: { document?: string | null; email?: string | null; phone?: string | null }): Promise<Customer | null> {
  const document = normalizeDocument(probe.document);
  const email = normalizeEmail(probe.email);
  const phone = normalizePhone(probe.phone);
  if (!document && !email && !phone) return null;
  const customers = (await db.select<Customer[]>("SELECT * FROM customers WHERE company_id=? AND deleted_at IS NULL", [companyId])).filter((row) => !row.deleted_at);
  const by = (match: (customer: Customer) => boolean) => customers.filter(match).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))[0];
  return (
    (document && by((customer) => normalizeDocument(customer.document) === document)) ||
    (email && by((customer) => normalizeEmail(customer.email) === email)) ||
    (phone && by((customer) => normalizePhone(customer.phone) === phone)) ||
    null
  );
}

async function activeCustomer(db: DatabaseLike, companyId: string, customerId: string | null | undefined): Promise<Customer | null> {
  if (!customerId) return null;
  const rows = await db.select<Customer[]>("SELECT * FROM customers WHERE company_id=? AND id=?", [companyId, customerId]);
  const customer = rows.find((row) => row.id === customerId) ?? null;
  if (!customer) return null;
  // Cliente mesclado: segue para o que ficou.
  if (customer.deleted_at) return customer.merged_into_id ? activeCustomer(db, companyId, customer.merged_into_id) : null;
  return customer;
}

async function insertCustomer(db: DatabaseLike, companyId: string, values: Record<string, string | number | null>): Promise<string> {
  const id = uuidv4();
  const row = { id, company_id: companyId, type: "PJ", status: "active", address_json: "{}", ...values };
  const columns = Object.keys(row);
  await db.execute(`INSERT INTO customers (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`, columns.map((column) => row[column as keyof typeof row]));
  return id;
}

export interface WinOptions {
  /** Cliente escolhido na hora (tem prioridade sobre o da oportunidade). */
  customerId?: string | null;
  /** Nome do cliente novo quando não há cliente nem lead. Padrão: título da oportunidade. */
  customerName?: string | null;
  /** Proposta que fecha o negócio: vira `aceita`. Padrão: a proposta aceita mais recente da oportunidade. */
  proposalId?: string | null;
  /** Gerar o pedido de venda (rascunho) a partir da proposta. Padrão: true (a tela passa false sem permissão de vendas). */
  createSalesOrder?: boolean;
}

/**
 * Ganha a oportunidade: garante o cliente (o da oportunidade, o do lead, um que já existe com o mesmo documento/e-mail/
 * telefone, ou um novo), fecha a oportunidade (ganho, 100%), fecha o lead (indicação concedida), registra a atividade e,
 * havendo proposta aceita, gera o pedido de venda em rascunho com os itens dela. Ganhar de novo reaproveita o pedido.
 */
export async function winOpportunity(db: DatabaseLike, oppId: string, userId: string, options: WinOptions = {}): Promise<{ customerId: string; salesOrderId: string | null }> {
  const opp = await requireOpportunity(db, oppId);
  const companyId = opp.company_id;
  const lead = opp.lead_id ? (await db.select<Lead[]>("SELECT * FROM leads WHERE company_id=? AND id=?", [companyId, opp.lead_id])).find((row) => row.id === opp.lead_id) ?? null : null;

  // 1. Cliente
  let customer =
    (await activeCustomer(db, companyId, options.customerId)) ??
    (await activeCustomer(db, companyId, opp.customer_id)) ??
    (await activeCustomer(db, companyId, lead?.customer_id));
  if (!customer && lead) customer = await findMatchingCustomer(db, companyId, { email: lead.email, phone: lead.phone ?? lead.whatsapp });
  let customerId = customer?.id ?? null;
  if (!customerId && lead) {
    customerId = await insertCustomer(db, companyId, {
      name: lead.name,
      email: normalizeEmail(lead.email),
      phone: clean(lead.phone) ?? clean(lead.whatsapp),
      segment: clean(lead.category),
      source: clean(lead.source) ?? "Prospecção",
      notes: clean(lead.notes),
      owner_id: lead.owner_id ?? opp.owner_id ?? userId,
      address_json: lead.address ? JSON.stringify({ logradouro: lead.address }) : "{}",
    });
  }
  if (!customerId) {
    customerId = await insertCustomer(db, companyId, { name: clean(options.customerName) ?? opp.title, source: clean(opp.source), owner_id: opp.owner_id ?? userId });
  }

  // 2. Proposta que fecha o negócio
  const proposals = (await db.select<Proposal[]>("SELECT * FROM proposals WHERE company_id=? AND opportunity_id=? AND deleted_at IS NULL", [companyId, oppId])).filter((row) => !row.deleted_at);
  let proposal: Proposal | null = null;
  const now = nowIso();
  if (options.proposalId) {
    proposal = proposals.find((row) => row.id === options.proposalId) ?? null;
    if (!proposal) throw new Error("A proposta escolhida não é desta oportunidade.");
    if (proposal.status !== "aceita") {
      await db.execute("UPDATE proposals SET status=?, decided_at=?, customer_id=?, updated_at=? WHERE company_id=? AND id=?", ["aceita", now, proposal.customer_id ?? customerId, now, companyId, proposal.id]);
      proposal = { ...proposal, status: "aceita", decided_at: now };
    }
  } else {
    proposal = proposals.filter((row) => row.status === "aceita").sort((a, b) => String(b.decided_at ?? b.updated_at).localeCompare(String(a.decided_at ?? a.updated_at)))[0] ?? null;
  }

  // 3. Oportunidade e lead
  const wasWon = opp.status === "won" && opp.stage === "ganho";
  await db.execute("UPDATE opportunities SET stage=?, status=?, probability=?, customer_id=?, closed_at=?, lost_reason=?, updated_at=? WHERE company_id=? AND id=?", [
    "ganho",
    "won",
    100,
    customerId,
    wasWon && opp.closed_at ? opp.closed_at : now,
    null,
    now,
    companyId,
    oppId,
  ]);
  if (lead) {
    await db.execute("UPDATE leads SET status=?, customer_id=?, referral_status=?, updated_at=? WHERE company_id=? AND id=?", [
      "fechado",
      customerId,
      referralStatusFor("fechado", lead.referred_by),
      now,
      companyId,
      lead.id,
    ]);
  }

  // 4. Pedido de venda (rascunho) da proposta
  let salesOrderId: string | null = null;
  const existingOrder = (await db.select<{ id: string; deleted_at?: string | null; status?: string }[]>("SELECT * FROM sales_orders WHERE company_id=? AND opportunity_id=? AND deleted_at IS NULL", [companyId, oppId])).find(
    (row) => !row.deleted_at && row.status !== "cancelado",
  );
  if (existingOrder) salesOrderId = existingOrder.id;
  else if (proposal && options.createSalesOrder !== false) salesOrderId = await createDraftSalesOrder(db, companyId, userId, { opp, proposal, customerId });

  if (!wasWon) {
    await logActivity(db, companyId, userId, {
      entity_type: "opportunity",
      entity_id: oppId,
      customer_id: customerId,
      subject: "Oportunidade ganha",
      body: proposal ? `Proposta aceita: ${proposal.title ?? proposal.number ?? proposal.id}` : null,
    });
  }
  return { customerId, salesOrderId };
}

/**
 * Pedido de venda em rascunho com os itens da proposta (totais recalculados em centavos).
 * TODO(integração): trocar por createSalesOrder de src/lib/erp/orders.ts (Tarefa 8) quando os branches se juntarem.
 */
async function createDraftSalesOrder(db: DatabaseLike, companyId: string, userId: string, source: { opp: Opportunity; proposal: Proposal; customerId: string }): Promise<string> {
  const { opp, proposal, customerId } = source;
  const items = (await db.select<ProposalItem[]>("SELECT * FROM proposal_items WHERE company_id=? AND proposal_id=? AND deleted_at IS NULL ORDER BY position", [companyId, proposal.id])).filter((row) => !row.deleted_at);
  const totals = orderTotals(
    items.map((item) => ({ qty: Number(item.qty), unit_price: Number(item.unit_price), discount: Number(item.discount ?? 0), tax_rate: Number(item.tax_rate ?? 0) })),
    { discount: Number(proposal.discount ?? 0) },
  );
  const customer = (await db.select<Customer[]>("SELECT * FROM customers WHERE company_id=? AND id=?", [companyId, customerId]))[0];
  const id = uuidv4();
  const number = await nextSequenceNumber(db, "sales_orders", companyId);
  await db.execute(
    "INSERT INTO sales_orders (id, company_id, number, customer_id, contact_id, opportunity_id, proposal_id, price_list_id, seller_id, status, order_date, payment_terms, subtotal, discount, shipping, tax_total, total, notes, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [
      id,
      companyId,
      number,
      customerId,
      proposal.contact_id ?? opp.contact_id ?? null,
      opp.id,
      proposal.id,
      customer?.price_list_id ?? null,
      opp.owner_id ?? userId,
      "rascunho",
      todayIso(),
      clean(proposal.payment_terms),
      totals.subtotal,
      totals.discount,
      totals.shipping,
      totals.tax_total,
      totals.total,
      clean(proposal.notes),
      userId,
    ],
  );
  let position = 1;
  for (const item of items) {
    await db.execute(
      "INSERT INTO sales_order_items (id, company_id, order_id, product_id, description, unit, qty, unit_price, discount, tax_rate, total, position) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      [
        uuidv4(),
        companyId,
        id,
        item.product_id ?? null,
        item.description,
        item.unit || "un",
        Number(item.qty),
        Number(item.unit_price),
        Number(item.discount ?? 0),
        Number(item.tax_rate ?? 0),
        lineTotal(Number(item.qty), Number(item.unit_price), Number(item.discount ?? 0)),
        position++,
      ],
    );
  }
  return id;
}

/** Perde a oportunidade com o motivo (etapa Perdido, 0%) e registra a atividade. */
export async function loseOpportunity(db: DatabaseLike, oppId: string, userId: string, reason: string | null): Promise<void> {
  const opp = await requireOpportunity(db, oppId);
  const now = nowIso();
  const why = clean(reason);
  await db.execute("UPDATE opportunities SET stage=?, status=?, probability=?, lost_reason=?, closed_at=?, updated_at=? WHERE company_id=? AND id=?", [
    "perdido",
    "lost",
    0,
    why,
    now,
    now,
    opp.company_id,
    oppId,
  ]);
  await logActivity(db, opp.company_id, userId, { entity_type: "opportunity", entity_id: oppId, customer_id: opp.customer_id ?? null, subject: "Oportunidade perdida", body: why });
}

/**
 * Move a oportunidade para uma etapa aberta (arrastar no funil), com a probabilidade padrão da etapa. Se estava ganha ou
 * perdida, reabre (o cliente e o pedido já criados ficam). Ganho e perda usam winOpportunity/loseOpportunity.
 */
export async function moveOpportunityStage(db: DatabaseLike, oppId: string, stage: Stage, userId: string): Promise<void> {
  if (stage === "ganho") throw new Error("Para ganhar a oportunidade use winOpportunity (cria o cliente e o pedido).");
  if (stage === "perdido") throw new Error("Para perder a oportunidade use loseOpportunity (pede o motivo).");
  if (!(OPEN_STAGES as readonly string[]).includes(stage)) throw new Error(`Etapa inválida: ${String(stage)}`);
  const opp = await requireOpportunity(db, oppId);
  if (opp.stage === stage && opp.status === "open") return;
  const now = nowIso();
  await db.execute("UPDATE opportunities SET stage=?, status=?, probability=?, closed_at=?, lost_reason=?, updated_at=? WHERE company_id=? AND id=?", [
    stage,
    "open",
    STAGE_PROBABILITY[stage],
    null,
    null,
    now,
    opp.company_id,
    oppId,
  ]);
  if (opp.status !== "open") {
    await logActivity(db, opp.company_id, userId, {
      entity_type: "opportunity",
      entity_id: oppId,
      customer_id: opp.customer_id ?? null,
      subject: "Oportunidade reaberta",
      body: `${STAGE_LABELS[opp.stage]} → ${STAGE_LABELS[stage]}`,
    });
  }
}

