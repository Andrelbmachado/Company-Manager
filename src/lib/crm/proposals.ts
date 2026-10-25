// Propostas comerciais: itens do catálogo (ou avulsos), totais em centavos, numeração PROP-00001 e fluxo de status
// rascunho → enviada → aceita | recusada (expirada = enviada com validade vencida; "Revisar" volta ao rascunho com
// versão + 1, mantendo o número). SQL nos padrões do banco demo.
import { v4 as uuidv4 } from "uuid";
import type { DatabaseLike } from "@/lib/db/demo";
import { nextSequenceNumber } from "@/lib/db/sequence";
import { lineTotal, orderTotals, roundMoney, toCents } from "@/lib/money";
import type { Opportunity, Proposal, ProposalItem, ProposalStatus } from "@/types";
import { logActivity } from "./activities";
import { clean, nowIso, parseMoneyInput, STAGE_PROBABILITY } from "./queries";

export interface ProposalItemInput {
  product_id?: string | null;
  description: string;
  unit?: string | null;
  qty: number | string;
  unit_price: number | string;
  /** Desconto do item em R$. */
  discount?: number | string | null;
  /** Imposto do item em % (5 = 5%). */
  tax_rate?: number | string | null;
}

export interface ProposalInput {
  title?: string | null;
  customer_id?: string | null;
  contact_id?: string | null;
  opportunity_id?: string | null;
  /** 'YYYY-MM-DD' (dia local). */
  valid_until?: string | null;
  payment_terms?: string | null;
  notes?: string | null;
  /** Desconto geral em R$. */
  discount?: number | string | null;
  items: ProposalItemInput[];
}

interface NormalizedItem {
  product_id: string | null;
  description: string;
  unit: string;
  qty: number;
  unit_price: number;
  discount: number;
  tax_rate: number;
  total: number;
}

function toNumber(value: number | string | null | undefined): number {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return value;
  const text = value.trim().replace(/\s/g, "");
  return Number(text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text);
}

function normalizeItems(items: ProposalItemInput[]): NormalizedItem[] {
  if (items.length === 0) throw new Error("Inclua ao menos um item na proposta.");
  return items.map((item, index) => {
    const line = `Item ${index + 1}`;
    const description = clean(item.description);
    if (!description) throw new Error(`${line}: informe a descrição.`);
    const qty = toNumber(item.qty);
    if (!Number.isFinite(qty) || qty <= 0) throw new Error(`${line}: a quantidade precisa ser maior que zero.`);
    const unitPrice = parseMoneyInput(item.unit_price) ?? 0;
    if (unitPrice < 0) throw new Error(`${line}: o preço não pode ser negativo.`);
    const discount = parseMoneyInput(item.discount ?? 0) ?? 0;
    if (discount < 0) throw new Error(`${line}: o desconto não pode ser negativo.`);
    // lineTotal zera o item quando o desconto passa do valor; aqui isso é erro de digitação, não item de graça.
    if (toCents(discount) > toCents(qty * unitPrice)) throw new Error(`${line}: o desconto não pode ser maior que o valor do item.`);
    const taxRate = toNumber(item.tax_rate);
    if (!Number.isFinite(taxRate) || taxRate < 0) throw new Error(`${line}: imposto inválido.`);
    return {
      product_id: clean(item.product_id),
      description,
      unit: clean(item.unit) ?? "un",
      qty,
      unit_price: unitPrice,
      discount,
      tax_rate: taxRate,
      total: lineTotal(qty, unitPrice, discount),
    };
  });
}

/** Totais da proposta (os mesmos de pedido e fatura: subtotal − desconto + impostos dos itens). */
export function proposalTotals(items: ProposalItemInput[], discount: number | string | null | undefined) {
  const lines = items.map((item) => ({ qty: toNumber(item.qty) || 0, unit_price: parseMoneyInput(item.unit_price) ?? 0, discount: parseMoneyInput(item.discount ?? 0) ?? 0, tax_rate: toNumber(item.tax_rate) || 0 }));
  return orderTotals(lines, { discount: parseMoneyInput(discount ?? 0) ?? 0 });
}

async function fetchProposalRow(db: DatabaseLike, companyId: string, id: string): Promise<Proposal> {
  const [row] = (await db.select<Proposal[]>("SELECT * FROM proposals WHERE company_id=? AND id=? AND deleted_at IS NULL", [companyId, id])).filter((item) => item.id === id && !item.deleted_at);
  if (!row) throw new Error("Proposta não encontrada (ou excluída).");
  return row;
}

export async function fetchProposal(db: DatabaseLike, companyId: string, id: string): Promise<Proposal | null> {
  return fetchProposalRow(db, companyId, id).catch(() => null);
}

export async function fetchProposalItems(db: DatabaseLike, companyId: string, proposalId: string): Promise<ProposalItem[]> {
  const rows = await db.select<ProposalItem[]>("SELECT * FROM proposal_items WHERE company_id=? AND proposal_id=? AND deleted_at IS NULL ORDER BY position", [companyId, proposalId]);
  return rows.filter((row) => !row.deleted_at).sort((a, b) => Number(a.position) - Number(b.position));
}

async function opportunityOf(db: DatabaseLike, companyId: string, id: string | null): Promise<Opportunity | null> {
  if (!id) return null;
  const rows = await db.select<Opportunity[]>("SELECT * FROM opportunities WHERE company_id=? AND id=?", [companyId, id]);
  return rows.find((row) => row.id === id) ?? null;
}

/** Cria (sem `id`) ou edita o rascunho da proposta, trocando os itens. Devolve o id. */
export async function saveProposal(db: DatabaseLike, companyId: string, userId: string, input: ProposalInput, id?: string): Promise<string> {
  const items = normalizeItems(input.items);
  const totals = orderTotals(items, { discount: parseMoneyInput(input.discount ?? 0) ?? 0 });
  if (totals.discount < 0) throw new Error("O desconto não pode ser negativo.");
  // Sem isso o total ficaria travado em zero e o PDF mostraria impostos errados (total − subtotal + desconto).
  if (toCents(totals.discount) > toCents(totals.subtotal)) throw new Error("O desconto geral não pode ser maior que o subtotal.");
  const opportunityId = clean(input.opportunity_id);
  const opp = await opportunityOf(db, companyId, opportunityId);
  const customerId = clean(input.customer_id) ?? opp?.customer_id ?? null;
  const title = clean(input.title) ?? opp?.title ?? null;
  const now = nowIso();
  const fields = [title, customerId, clean(input.contact_id), opportunityId, clean(input.valid_until), clean(input.payment_terms), clean(input.notes), totals.subtotal, totals.discount, totals.total];

  let proposalId = id;
  if (proposalId) {
    const current = await fetchProposalRow(db, companyId, proposalId);
    if (current.status !== "rascunho") throw new Error("Só o rascunho pode ser editado. Use Revisar para abrir uma nova versão.");
    await db.execute(
      "UPDATE proposals SET title=?, customer_id=?, contact_id=?, opportunity_id=?, valid_until=?, payment_terms=?, notes=?, subtotal=?, discount=?, value=?, updated_at=? WHERE company_id=? AND id=?",
      [...fields, now, companyId, proposalId],
    );
    await db.execute("UPDATE proposal_items SET deleted_at=?, updated_at=? WHERE company_id=? AND proposal_id=? AND deleted_at IS NULL", [now, now, companyId, proposalId]);
  } else {
    proposalId = uuidv4();
    const number = await nextSequenceNumber(db, "proposals", companyId);
    await db.execute(
      "INSERT INTO proposals (id, company_id, number, title, customer_id, contact_id, opportunity_id, valid_until, payment_terms, notes, subtotal, discount, value, items_json, version, status, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [proposalId, companyId, number, ...fields, "[]", 1, "rascunho", userId],
    );
  }
  let position = 1;
  for (const item of items) {
    await db.execute(
      "INSERT INTO proposal_items (id, company_id, proposal_id, product_id, description, unit, qty, unit_price, discount, tax_rate, total, position) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      [uuidv4(), companyId, proposalId, item.product_id, item.description, item.unit, item.qty, item.unit_price, item.discount, item.tax_rate, item.total, position++],
    );
  }
  return proposalId;
}

export type ProposalAction = "send" | "accept" | "decline" | "revise";

const TRANSITIONS: Record<ProposalAction, { from: ProposalStatus[]; to: ProposalStatus; subject: string }> = {
  send: { from: ["rascunho"], to: "enviada", subject: "Proposta enviada" },
  accept: { from: ["enviada", "expirada"], to: "aceita", subject: "Proposta aceita" },
  decline: { from: ["enviada", "expirada"], to: "recusada", subject: "Proposta recusada" },
  revise: { from: ["enviada", "recusada", "expirada"], to: "rascunho", subject: "Proposta em revisão" },
};

export const PROPOSAL_ACTION_LABELS: Record<ProposalAction, string> = {
  send: "Marcar como enviada",
  accept: "Aceita pelo cliente",
  decline: "Recusada pelo cliente",
  revise: "Revisar (nova versão)",
};

/** Ações possíveis no status atual (o expirada da tela conta como enviada). */
export function proposalActions(status: ProposalStatus): ProposalAction[] {
  return (Object.keys(TRANSITIONS) as ProposalAction[]).filter((action) => TRANSITIONS[action].from.includes(status));
}

/**
 * Muda o status da proposta e registra na linha do tempo. Enviar leva a oportunidade ligada para a etapa Proposta
 * (só se ela ainda estava antes disso). Revisar volta ao rascunho com versão + 1.
 */
export async function setProposalStatus(db: DatabaseLike, companyId: string, id: string, action: ProposalAction, userId: string): Promise<void> {
  const proposal = await fetchProposalRow(db, companyId, id);
  const transition = TRANSITIONS[action];
  if (!transition.from.includes(proposal.status)) throw new Error(`Não dá para "${PROPOSAL_ACTION_LABELS[action]}" uma proposta ${proposal.status}.`);
  const now = nowIso();
  if (action === "send") {
    await db.execute("UPDATE proposals SET status=?, sent_at=?, decided_at=?, updated_at=? WHERE company_id=? AND id=?", [transition.to, now, null, now, companyId, id]);
    const opp = await opportunityOf(db, companyId, proposal.opportunity_id ?? null);
    if (opp && opp.status === "open" && (opp.stage === "novo" || opp.stage === "qualificacao")) {
      await db.execute("UPDATE opportunities SET stage=?, probability=?, updated_at=? WHERE company_id=? AND id=?", ["proposta", Math.max(Number(opp.probability ?? 0), STAGE_PROBABILITY.proposta), now, companyId, opp.id]);
    }
  } else if (action === "revise") {
    await db.execute("UPDATE proposals SET status=?, version=?, sent_at=?, decided_at=?, updated_at=? WHERE company_id=? AND id=?", [transition.to, Number(proposal.version ?? 1) + 1, null, null, now, companyId, id]);
  } else {
    await db.execute("UPDATE proposals SET status=?, decided_at=?, updated_at=? WHERE company_id=? AND id=?", [transition.to, now, now, companyId, id]);
  }
  await logActivity(db, companyId, userId, { entity_type: "proposal", entity_id: id, customer_id: proposal.customer_id ?? null, subject: transition.subject, body: proposal.title ?? null });
}

/** Soft delete da proposta e dos itens. */
export async function deleteProposal(db: DatabaseLike, companyId: string, id: string): Promise<void> {
  const now = nowIso();
  await db.execute("UPDATE proposal_items SET deleted_at=?, updated_at=? WHERE company_id=? AND proposal_id=? AND deleted_at IS NULL", [now, now, companyId, id]);
  await db.execute("UPDATE proposals SET deleted_at=?, updated_at=? WHERE company_id=? AND id=?", [now, now, companyId, id]);
}

/** Status para a tela: enviada com validade vencida aparece como expirada (`today` = 'YYYY-MM-DD' local). */
export function displayProposalStatus(proposal: Pick<Proposal, "status" | "valid_until">, today: string): ProposalStatus {
  if (proposal.status === "enviada" && proposal.valid_until && proposal.valid_until.slice(0, 10) < today) return "expirada";
  return proposal.status;
}

/**
 * Preço unitário do produto na tabela de preço do cliente: o item da tabela com a maior quantidade mínima atingida;
 * sem item na tabela, o preço do produto.
 * TODO(integração): usar src/lib/erp/pricing.ts (Tarefa 8) quando os branches se juntarem.
 */
export function priceFor(productId: string, basePrice: number, qty: number, listItems: readonly { product_id: string; price: number; min_qty: number }[]): number {
  const match = listItems
    .filter((item) => item.product_id === productId && Number(item.min_qty ?? 1) <= qty)
    .sort((a, b) => Number(b.min_qty ?? 1) - Number(a.min_qty ?? 1))[0];
  return roundMoney(match ? Number(match.price) : basePrice);
}
