// Gravação das tabelas editáveis do CRM: clientes, contatos, oportunidades, atividades (follow-ups) e propostas.
// Cada função recebe o que a EditableTable entregou (existentes só com os campos alterados), confere a permissão,
// valida TODAS as linhas e só então grava, para um erro na segunda linha não deixar a primeira gravada e duplicar no
// "Salvar" seguinte. A regra de negócio continua nas funções de lib/crm (saveCustomer, saveOpportunity...).
import type { DatabaseLike } from "@/lib/db/demo";
import { createActivity, completeActivity, reopenActivity, updateActivity, ACTIVITY_KINDS, type ActivityPatch } from "@/lib/crm/activities";
import { saveProposal } from "@/lib/crm/proposals";
import { clean, fetchCustomer, fetchOpportunity, isStage, nowIso, OPEN_STAGES, parseMoneyInput, saveContact, saveCustomer, saveOpportunity, setPrimaryContact, type CustomerInput, type OpportunityInput } from "@/lib/crm/queries";
import type { Contact, CrmActivity, CrmActivityKind, CrmEntityType, Customer, Opportunity, Proposal } from "@/types";
import { assertChanges, isOn, lineError, type EditActor, type RowChanges, type SaveResult } from "./guard";

type Row = Record<string, unknown>;

async function activeRow<T extends { id: string; deleted_at?: string | null }>(db: DatabaseLike, table: string, companyId: string, id: string, missing: string): Promise<T> {
  const rows = await db.select<T[]>(`SELECT * FROM ${table} WHERE company_id=? AND id=?`, [companyId, id]);
  const row = rows.find((item) => item.id === id && !item.deleted_at);
  if (!row) throw new Error(missing);
  return row;
}

// ---------------------------------------------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------------------------------------------

function customerInput(row: Partial<Customer>): CustomerInput {
  return {
    name: String(row.name ?? ""),
    type: row.type ?? "PJ",
    document: row.document,
    email: row.email,
    phone: row.phone,
    segment: row.segment,
    owner_id: row.owner_id,
    status: row.status ?? "active",
    trade_name: row.trade_name,
    state_registration: row.state_registration,
    website: row.website,
    source: row.source,
    notes: row.notes,
    payment_terms: row.payment_terms,
    credit_limit: row.credit_limit,
    price_list_id: row.price_list_id,
  };
}

/** Clientes: existentes mesclam o atual com o alterado; novos nascem PJ, ativos e com quem cadastrou de responsável. */
export async function saveCustomerRows(db: DatabaseLike, companyId: string, actor: EditActor, changes: RowChanges<Customer>): Promise<SaveResult> {
  assertChanges(actor, changes, "customers");
  const updates: { id: string; input: CustomerInput }[] = [];
  for (const patch of changes.updated) {
    const current = await activeRow<Customer>(db, "customers", companyId, patch.id, "Cliente não encontrado (ou excluído). Atualize a lista.");
    const merged = { ...current, ...patch };
    const input = customerInput(merged);
    if (!clean(input.name)) throw new Error(`Informe o nome do cliente (${current.name}).`);
    parseMoneyInput(input.credit_limit);
    if ("address_json" in patch) input.address_json = patch.address_json ?? "{}";
    updates.push({ id: patch.id, input });
  }
  const creations = changes.created.map((row, index) => {
    const input = customerInput({ ...row, owner_id: row.owner_id ?? actor.userId });
    if (!clean(input.name)) throw lineError(index, changes.created.length, "informe o nome do cliente.");
    parseMoneyInput(input.credit_limit);
    if (row.address_json) input.address_json = row.address_json;
    return input;
  });
  for (const { id, input } of updates) await saveCustomer(db, companyId, input, id);
  const created: string[] = [];
  for (const input of creations) created.push(await saveCustomer(db, companyId, input));
  return { created, updated: updates.map((item) => item.id) };
}

// ---------------------------------------------------------------------------------------------------------------
// Contatos (permissão do recurso customers)
// ---------------------------------------------------------------------------------------------------------------

const CONTACT_FIELDS = ["customer_id", "name", "email", "phone", "whatsapp", "role", "notes"] as const;

/**
 * Contatos. "Principal" ligado marca o contato como principal do cliente (desmarca os outros); desligar o principal
 * sem marcar outro do mesmo cliente é recusado. `customerId` fixa o cliente das linhas novas (aba da ficha).
 */
export async function saveContactRows(db: DatabaseLike, companyId: string, actor: EditActor, changes: RowChanges<Contact>, options: { customerId?: string | null } = {}): Promise<SaveResult> {
  assertChanges(actor, changes, "customers");
  const updates: { id: string; merged: Contact; fields: boolean; primary: boolean }[] = [];
  for (const patch of changes.updated) {
    const current = await activeRow<Contact>(db, "contacts", companyId, patch.id, "Contato não encontrado (ou excluído). Atualize a lista.");
    const merged = { ...current, ...patch } as Contact;
    if (!clean(merged.name)) throw new Error(`Informe o nome do contato (${current.name}).`);
    const wasPrimary = isOn(current.is_primary);
    const primary = "is_primary" in patch ? isOn(patch.is_primary) : false;
    if ("is_primary" in patch && !primary && wasPrimary) {
      const replaced = changes.updated.some((other) => other.id !== patch.id && isOn(other.is_primary));
      if (!replaced) throw new Error(`Marque outro contato como principal antes de desmarcar ${current.name}.`);
    }
    updates.push({ id: patch.id, merged, fields: CONTACT_FIELDS.some((field) => field in patch), primary: primary && !wasPrimary });
  }
  const creations = changes.created.map((row, index) => {
    if (!clean(row.name)) throw lineError(index, changes.created.length, "informe o nome do contato.");
    return { row, customerId: clean(row.customer_id) ?? clean(options.customerId) };
  });
  for (const { id, merged, fields } of updates) if (fields) await saveContact(db, companyId, merged, id);
  for (const { id, primary } of updates) if (primary) await setPrimaryContact(db, companyId, id);
  const created: string[] = [];
  for (const { row, customerId } of creations) {
    const id = await saveContact(db, companyId, { ...row, name: String(row.name), customer_id: customerId });
    if (isOn(row.is_primary)) await setPrimaryContact(db, companyId, id);
    created.push(id);
  }
  return { created, updated: updates.map((item) => item.id) };
}

// ---------------------------------------------------------------------------------------------------------------
// Oportunidades
// ---------------------------------------------------------------------------------------------------------------

function opportunityInput(row: Partial<Opportunity>): OpportunityInput {
  return {
    title: String(row.title ?? ""),
    value: row.value ?? 0,
    stage: row.stage ?? "novo",
    probability: row.probability ?? null,
    expected_close_date: row.expected_close_date,
    customer_id: row.customer_id,
    contact_id: row.contact_id,
    owner_id: row.owner_id,
    source: row.source,
    notes: row.notes,
  };
}

function checkOpportunity(input: OpportunityInput, currentStage: string | null, label: () => string): void {
  if (!clean(input.title)) throw new Error(`${label()}informe o título da oportunidade.`);
  if (!isStage(input.stage)) throw new Error(`${label()}etapa inválida.`);
  const closing = !(OPEN_STAGES as readonly string[]).includes(input.stage);
  if (closing && currentStage !== input.stage) throw new Error("Use Ganhar ou Perder para fechar a oportunidade.");
  const value = parseMoneyInput(input.value);
  if (value != null && value < 0) throw new Error(`${label()}o valor não pode ser negativo.`);
}

/** Oportunidades: trocar a etapa sem informar a probabilidade volta para a padrão da etapa; fechar só por Ganhar/Perder. */
export async function saveOpportunityRows(db: DatabaseLike, companyId: string, actor: EditActor, changes: RowChanges<Opportunity>): Promise<SaveResult> {
  assertChanges(actor, changes, "opportunities");
  const updates: { id: string; input: OpportunityInput }[] = [];
  for (const patch of changes.updated) {
    const current = await fetchOpportunity(db, companyId, patch.id);
    if (!current || current.deleted_at) throw new Error("Oportunidade não encontrada (ou excluída). Atualize a lista.");
    const input = opportunityInput({ ...current, ...patch });
    if ("stage" in patch && patch.stage !== current.stage && !("probability" in patch)) input.probability = null;
    checkOpportunity(input, current.stage, () => `${current.title}: `);
    updates.push({ id: patch.id, input });
  }
  const creations = changes.created.map((row, index) => {
    const input = opportunityInput({ ...row, owner_id: row.owner_id ?? actor.userId });
    checkOpportunity(input, null, () => (changes.created.length > 1 ? `Linha nova ${index + 1}: ` : ""));
    return input;
  });
  for (const { id, input } of updates) await saveOpportunity(db, companyId, actor.userId, input, id);
  const created: string[] = [];
  for (const input of creations) created.push(await saveOpportunity(db, companyId, actor.userId, input));
  return { created, updated: updates.map((item) => item.id) };
}

// ---------------------------------------------------------------------------------------------------------------
// Atividades / follow-ups
// ---------------------------------------------------------------------------------------------------------------

/** Linha da tabela de atividades: o prazo vira dia + hora (no fuso local) e a conclusão vira a coluna Feita (1/0). */
export type ActivityRow = CrmActivity & { due_day: string | null; due_time: string | null; done: number };

const pad = (value: number) => String(value).padStart(2, "0");

export function activityRowFrom(activity: CrmActivity): ActivityRow {
  const due = activity.due_at ? new Date(activity.due_at) : null;
  const valid = due && !Number.isNaN(due.getTime()) ? due : null;
  return {
    ...activity,
    due_day: valid ? `${valid.getFullYear()}-${pad(valid.getMonth() + 1)}-${pad(valid.getDate())}` : null,
    due_time: valid ? `${pad(valid.getHours())}:${pad(valid.getMinutes())}` : null,
    done: activity.done_at ? 1 : 0,
  };
}

/** "14:30", "14h30", "14h" ou "9" → "14:30"/"09:00"; vazio = 09:00. */
function parseTime(text: unknown): string {
  const value = clean(text);
  if (!value) return "09:00";
  const match = /^(\d{1,2})(?:[:h](\d{2})?)?$/i.exec(value);
  const hours = match ? Number(match[1]) : NaN;
  const minutes = match?.[2] ? Number(match[2]) : 0;
  if (!match || hours > 23 || minutes > 59) throw new Error(`Hora inválida: "${value}". Use HH:MM (ex.: 14:30).`);
  return `${pad(hours)}:${pad(minutes)}`;
}

/** Dia 'YYYY-MM-DD' + hora local → instante ISO (o due_at gravado). Sem dia, sem prazo. */
export function dueAtFrom(day: unknown, time: unknown): string | null {
  const date = clean(day);
  if (!date) {
    if (clean(time)) throw new Error("Informe o dia do prazo antes da hora.");
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Data inválida: ${date}`);
  const instant = new Date(`${date}T${parseTime(time)}`);
  if (Number.isNaN(instant.getTime())) throw new Error(`Data inválida: ${date}`);
  return instant.toISOString();
}

function checkKind(kind: unknown): CrmActivityKind {
  if (!(ACTIVITY_KINDS as readonly unknown[]).includes(kind)) throw new Error("Escolha o tipo da atividade.");
  return kind as CrmActivityKind;
}

export interface ActivityEntity {
  type: CrmEntityType;
  id: string;
  customerId?: string | null;
}

type ActivityPlan =
  | { mode: "update"; id: string; patch: ActivityPatch; done: boolean | null; outcome: string | null; customerId: string | null | undefined }
  | { mode: "create"; entity: ActivityEntity; row: Partial<ActivityRow>; kind: CrmActivityKind; dueAt: string | null };

/**
 * Atividades. `entity` fixa a quem as linhas novas pertencem (linha do tempo da ficha ou da oportunidade); sem ele, a
 * linha nova é do cliente escolhido na coluna Cliente. Feita liga = concluir (com o resultado), desliga = reabrir.
 * Trocar o cliente só vale para atividade do próprio cliente: nas demais, o cliente vem do registro ligado.
 */
export async function saveActivityRows(db: DatabaseLike, companyId: string, actor: EditActor, changes: RowChanges<ActivityRow>, options: { entity?: ActivityEntity } = {}): Promise<SaveResult> {
  assertChanges(actor, changes, "crm_activities");
  const plans: ActivityPlan[] = [];
  for (const patch of changes.updated) {
    const current = activityRowFrom(await activeRow<CrmActivity>(db, "crm_activities", companyId, patch.id, "Atividade não encontrada (ou excluída). Atualize a lista."));
    const merged = { ...current, ...patch };
    const update: ActivityPatch = {};
    if ("kind" in patch) update.kind = checkKind(patch.kind);
    for (const field of ["subject", "body", "outcome", "user_id", "contact_id"] as const) if (field in patch) update[field] = (patch[field] as string | null | undefined) ?? null;
    if ("due_day" in patch || "due_time" in patch) update.due_at = dueAtFrom(merged.due_day, merged.due_time);
    if (!clean(merged.subject) && !clean(merged.body)) throw new Error("Informe o assunto da atividade.");
    let customerId: string | null | undefined;
    if ("customer_id" in patch && (patch.customer_id ?? null) !== (current.customer_id ?? null)) {
      if (current.entity_type !== "customer") throw new Error("Esta atividade é de outro registro: o cliente vem dele.");
      customerId = clean(patch.customer_id);
      if (!customerId) throw new Error("Escolha o cliente da atividade.");
      await activeRow<Customer>(db, "customers", companyId, customerId, "Cliente não encontrado (ou excluído).");
    }
    const done = "done" in patch && isOn(patch.done) !== isOn(current.done) ? isOn(patch.done) : null;
    plans.push({ mode: "update", id: patch.id, patch: update, done, outcome: (merged.outcome as string | null | undefined) ?? null, customerId });
  }
  for (const row of changes.created) {
    let entity = options.entity;
    if (!entity) {
      const customerId = clean(row.customer_id);
      if (!customerId) throw new Error("Escolha o cliente da atividade nova.");
      await activeRow<Customer>(db, "customers", companyId, customerId, "Cliente não encontrado (ou excluído).");
      entity = { type: "customer", id: customerId, customerId };
    }
    if (!clean(row.subject) && !clean(row.body)) throw new Error("Informe o assunto da atividade nova.");
    plans.push({ mode: "create", entity, row, kind: checkKind(row.kind ?? "tarefa"), dueAt: dueAtFrom(row.due_day, row.due_time) });
  }
  const result: SaveResult = { created: [], updated: [] };
  for (const plan of plans) {
    if (plan.mode === "update") {
      await updateActivity(db, companyId, plan.id, plan.patch);
      if (plan.customerId) await db.execute("UPDATE crm_activities SET entity_id=?, customer_id=?, updated_at=? WHERE company_id=? AND id=?", [plan.customerId, plan.customerId, nowIso(), companyId, plan.id]);
      if (plan.done === true) await completeActivity(db, companyId, plan.id, plan.outcome);
      if (plan.done === false) await reopenActivity(db, companyId, plan.id);
      result.updated.push(plan.id);
    } else {
      const { entity, row } = plan;
      result.created.push(
        await createActivity(db, companyId, actor.userId, {
          entity_type: entity.type,
          entity_id: entity.id,
          customer_id: entity.customerId ?? null,
          contact_id: row.contact_id ?? null,
          kind: plan.kind,
          subject: row.subject ?? null,
          body: row.body ?? null,
          due_at: plan.dueAt,
          user_id: row.user_id ?? null,
          done: isOn(row.done),
          outcome: row.outcome ?? null,
        }),
      );
    }
  }
  return result;
}

// ---------------------------------------------------------------------------------------------------------------
// Propostas (cabeçalho do rascunho; itens ficam no editor da proposta)
// ---------------------------------------------------------------------------------------------------------------

const PROPOSAL_HEADER = ["title", "customer_id", "contact_id", "opportunity_id", "valid_until", "payment_terms", "notes"] as const;

/**
 * Propostas pela tabela: no rascunho muda o cabeçalho (título, cliente, oportunidade, validade, condições). O total vem
 * dos itens, então não muda aqui. Adicionar cria um rascunho com um item avulso (título × 1 × valor) para abrir e
 * detalhar depois; sem condição de pagamento, vale a do cliente.
 */
export async function saveProposalRows(db: DatabaseLike, companyId: string, actor: EditActor, changes: RowChanges<Proposal>): Promise<SaveResult> {
  assertChanges(actor, changes, "proposals");
  const updates: { id: string; fields: (typeof PROPOSAL_HEADER)[number][]; values: (string | null)[] }[] = [];
  for (const patch of changes.updated) {
    const current = await activeRow<Proposal>(db, "proposals", companyId, patch.id, "Proposta não encontrada (ou excluída). Atualize a lista.");
    if (current.status !== "rascunho") throw new Error(`A proposta ${current.title ?? ""} já saiu do rascunho. Use Revisar na proposta para abrir uma nova versão.`.replace("  ", " "));
    if ("value" in patch && Math.round(Number(patch.value ?? 0) * 100) !== Math.round(Number(current.value ?? 0) * 100)) {
      throw new Error("O total vem dos itens: abra a proposta para alterar os itens.");
    }
    const fields = PROPOSAL_HEADER.filter((field) => field in patch);
    updates.push({ id: patch.id, fields, values: fields.map((field) => clean((patch as Row)[field])) });
  }
  const creations: { title: string; value: number; row: Partial<Proposal>; paymentTerms: string | null }[] = [];
  for (const [index, row] of changes.created.entries()) {
    const title = clean(row.title);
    if (!title) throw lineError(index, changes.created.length, "informe o título da proposta.");
    const value = parseMoneyInput(row.value) ?? 0;
    if (value < 0) throw lineError(index, changes.created.length, "o valor não pode ser negativo.");
    const customerId = clean(row.customer_id);
    const customer = customerId ? await fetchCustomer(db, companyId, customerId) : null;
    creations.push({ title, value, row, paymentTerms: clean(row.payment_terms) ?? customer?.payment_terms ?? null });
  }
  for (const { id, fields, values } of updates) {
    if (fields.length === 0) continue;
    await db.execute(`UPDATE proposals SET ${fields.map((field) => `${field}=?`).join(", ")}, updated_at=? WHERE company_id=? AND id=?`, [...values, nowIso(), companyId, id]);
  }
  const created: string[] = [];
  for (const { title, value, row, paymentTerms } of creations) {
    created.push(
      await saveProposal(db, companyId, actor.userId, {
        title,
        customer_id: row.customer_id ?? null,
        contact_id: row.contact_id ?? null,
        opportunity_id: row.opportunity_id ?? null,
        valid_until: row.valid_until ?? null,
        payment_terms: paymentTerms,
        notes: row.notes ?? null,
        items: [{ description: title, qty: 1, unit_price: value }],
      }),
    );
  }
  return { created, updated: updates.map((item) => item.id) };
}
