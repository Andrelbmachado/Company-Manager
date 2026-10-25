// Atividades de CRM (crm_activities): linha do tempo de cliente, contato, lead, oportunidade e proposta, e follow-ups.
// Pendente = done_at NULL; atrasada = pendente com due_at (instante ISO) no passado. SQL nos padrões do banco demo.
import { v4 as uuidv4 } from "uuid";
import type { DatabaseLike } from "@/lib/db/demo";
import type { CrmActivity, CrmActivityKind, CrmEntityType } from "@/types";
import { clean, nowIso } from "./queries";

export const ACTIVITY_KINDS: readonly CrmActivityKind[] = ["ligacao", "email", "reuniao", "tarefa", "nota"];

export const ACTIVITY_KIND_LABELS: Record<CrmActivityKind, string> = {
  ligacao: "Ligação",
  email: "E-mail",
  reuniao: "Reunião",
  tarefa: "Tarefa",
  nota: "Nota",
};

export type ActivityState = "feita" | "atrasada" | "hoje" | "pendente";

function sameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Situação para a linha do tempo: feita, atrasada (prazo já passou), hoje (vence mais tarde hoje, no dia local) ou pendente. */
export function activityState(activity: Pick<CrmActivity, "done_at" | "due_at">, now = new Date()): ActivityState {
  if (activity.done_at) return "feita";
  if (!activity.due_at) return "pendente";
  const due = new Date(activity.due_at);
  if (Number.isNaN(due.getTime())) return "pendente";
  if (due.getTime() < now.getTime()) return "atrasada";
  return sameLocalDay(due, now) ? "hoje" : "pendente";
}

export interface ActivityInput {
  entity_type: CrmEntityType;
  entity_id: string;
  kind: CrmActivityKind;
  subject?: string | null;
  body?: string | null;
  /** Instante ISO do prazo (follow-up). */
  due_at?: string | null;
  customer_id?: string | null;
  contact_id?: string | null;
  /** Responsável; padrão = quem cria. */
  user_id?: string | null;
  /** Já feita (ex.: registro de uma ligação que aconteceu). Nota sempre nasce feita. */
  done?: boolean;
  outcome?: string | null;
}

const ENTITY_TABLE: Partial<Record<CrmEntityType, string>> = {
  opportunity: "opportunities",
  proposal: "proposals",
  contact: "contacts",
  lead: "leads",
};

/** Cliente ligado à entidade (para a atividade aparecer na ficha do cliente). */
async function customerOf(db: DatabaseLike, companyId: string, entityType: CrmEntityType, entityId: string): Promise<string | null> {
  if (entityType === "customer") return entityId;
  const table = ENTITY_TABLE[entityType];
  if (!table) return null;
  const rows = await db.select<{ id: string; customer_id?: string | null }[]>(`SELECT * FROM ${table} WHERE company_id=? AND id=?`, [companyId, entityId]);
  return rows.find((row) => row.id === entityId)?.customer_id ?? null;
}

export async function createActivity(db: DatabaseLike, companyId: string, userId: string, input: ActivityInput): Promise<string> {
  const subject = clean(input.subject);
  const body = clean(input.body);
  if (!subject && !body) throw new Error("Informe o assunto ou a descrição da atividade.");
  const customerId = clean(input.customer_id) ?? (await customerOf(db, companyId, input.entity_type, input.entity_id));
  const contactId = clean(input.contact_id) ?? (input.entity_type === "contact" ? input.entity_id : null);
  const done = input.kind === "nota" || input.done === true;
  const id = uuidv4();
  const now = nowIso();
  await db.execute(
    "INSERT INTO crm_activities (id, company_id, entity_type, entity_id, customer_id, contact_id, kind, subject, body, due_at, done_at, outcome, user_id, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [id, companyId, input.entity_type, input.entity_id, customerId, contactId, input.kind, subject, body, clean(input.due_at), done ? now : null, clean(input.outcome), clean(input.user_id) ?? userId, userId, now, now],
  );
  return id;
}

export interface ActivityPatch {
  kind?: CrmActivityKind;
  subject?: string | null;
  body?: string | null;
  due_at?: string | null;
  user_id?: string | null;
  contact_id?: string | null;
  outcome?: string | null;
}

const PATCH_FIELDS = ["kind", "subject", "body", "due_at", "user_id", "contact_id", "outcome"] as const;

export async function updateActivity(db: DatabaseLike, companyId: string, id: string, patch: ActivityPatch): Promise<void> {
  const fields = PATCH_FIELDS.filter((field) => field in patch);
  if (fields.length === 0) return;
  const values: unknown[] = fields.map((field) => (field === "kind" ? patch.kind : clean(patch[field])));
  const columns: string[] = [...fields];
  const now = nowIso();
  // Nota é registro, não pendência (createActivity a cria feita): virar nota marca como feita, sem mexer em data já gravada.
  if (patch.kind === "nota") {
    const rows = await db.select<CrmActivity[]>("SELECT * FROM crm_activities WHERE company_id=? AND id=?", [companyId, id]);
    if (rows.find((row) => row.id === id)?.done_at == null) {
      columns.push("done_at");
      values.push(now);
    }
  }
  await db.execute(`UPDATE crm_activities SET ${columns.map((field) => `${field}=?`).join(", ")}, updated_at=? WHERE company_id=? AND id=?`, [...values, now, companyId, id]);
}

export async function completeActivity(db: DatabaseLike, companyId: string, id: string, outcome?: string | null): Promise<void> {
  const now = nowIso();
  await db.execute("UPDATE crm_activities SET done_at=?, outcome=?, updated_at=? WHERE company_id=? AND id=?", [now, clean(outcome), now, companyId, id]);
}

export async function reopenActivity(db: DatabaseLike, companyId: string, id: string): Promise<void> {
  await db.execute("UPDATE crm_activities SET done_at=?, updated_at=? WHERE company_id=? AND id=?", [null, nowIso(), companyId, id]);
}

/** Soft delete. */
export async function deleteActivity(db: DatabaseLike, companyId: string, id: string): Promise<void> {
  const now = nowIso();
  await db.execute("UPDATE crm_activities SET deleted_at=?, updated_at=? WHERE company_id=? AND id=?", [now, now, companyId, id]);
}

export interface ActivityFilter {
  /** Linha do tempo do cliente (inclui as atividades das oportunidades, propostas e contatos dele). */
  customerId?: string;
  entityType?: CrmEntityType;
  entityId?: string;
}

/** Atividades ativas, mais recentes primeiro (prazo ou criação). Sem filtro, todas da empresa. */
export async function fetchActivities(db: DatabaseLike, companyId: string, filter: ActivityFilter = {}): Promise<CrmActivity[]> {
  let rows: CrmActivity[];
  if (filter.customerId) {
    rows = await db.select<CrmActivity[]>("SELECT * FROM crm_activities WHERE company_id=? AND customer_id=? AND deleted_at IS NULL", [companyId, filter.customerId]);
  } else if (filter.entityType && filter.entityId) {
    rows = await db.select<CrmActivity[]>("SELECT * FROM crm_activities WHERE company_id=? AND entity_type=? AND entity_id=? AND deleted_at IS NULL", [companyId, filter.entityType, filter.entityId]);
  } else {
    rows = await db.select<CrmActivity[]>("SELECT * FROM crm_activities WHERE company_id=? AND deleted_at IS NULL", [companyId]);
  }
  const when = (row: CrmActivity) => row.done_at ?? row.due_at ?? row.created_at ?? "";
  return rows.filter((row) => !row.deleted_at).sort((a, b) => String(when(b)).localeCompare(String(when(a))) || String(b.created_at).localeCompare(String(a.created_at)));
}

/**
 * Follow-ups atrasados (pendentes com prazo no passado), mais antigos primeiro. `userId` = só os desse responsável;
 * null = de todos. Usado no CRM e no início do comercial.
 */
export async function fetchOverdueFollowUps(db: DatabaseLike, companyId: string, userId: string | null, now = new Date()): Promise<CrmActivity[]> {
  const rows = userId
    ? await db.select<CrmActivity[]>("SELECT * FROM crm_activities WHERE company_id=? AND user_id=? AND done_at IS NULL AND deleted_at IS NULL", [companyId, userId])
    : await db.select<CrmActivity[]>("SELECT * FROM crm_activities WHERE company_id=? AND done_at IS NULL AND deleted_at IS NULL", [companyId]);
  return rows
    .filter((row) => !row.deleted_at && activityState(row, now) === "atrasada")
    .sort((a, b) => new Date(String(a.due_at)).getTime() - new Date(String(b.due_at)).getTime());
}

/** Registro automático (nota já feita) de um fato do funil: conversão, ganho, perda, envio de proposta... */
export async function logActivity(
  db: DatabaseLike,
  companyId: string,
  userId: string,
  entry: { entity_type: CrmEntityType; entity_id: string; customer_id?: string | null; subject: string; body?: string | null },
): Promise<string> {
  return createActivity(db, companyId, userId, { ...entry, kind: "nota" });
}
