// Tickets (Suporte): gravação feita pela tabela editável e pela ficha do ticket. A permissão é conferida aqui também
// (não só nos botões): criar exige `create` e alterar exige `edit` em `tickets`. SQL nos padrões do banco demo.
import { v4 as uuidv4 } from "uuid";
import type { DatabaseLike } from "@/lib/db/demo";
import { can, ROLE_LABELS } from "@/lib/permissions/rbac";
import type { Priority, Role, Ticket, TicketStatus } from "@/types";

export const TICKET_PRIORITY_OPTIONS: { value: Priority; label: string }[] = [
  { value: "baixa", label: "Baixa" },
  { value: "media", label: "Média" },
  { value: "alta", label: "Alta" },
  { value: "urgente", label: "Urgente" },
];

export const TICKET_STATUS_OPTIONS: { value: TicketStatus; label: string }[] = [
  { value: "aberto", label: "Aberto" },
  { value: "em_atendimento", label: "Em atendimento" },
  { value: "aguardando", label: "Aguardando" },
  { value: "resolvido", label: "Resolvido" },
  { value: "fechado", label: "Fechado" },
];

/** Campos que a tela edita. */
export type TicketFields = Partial<Pick<Ticket, "subject" | "description" | "priority" | "status">>;

export interface TicketChanges {
  updated: (TicketFields & { id: string })[];
  created: TicketFields[];
}

export interface TicketActor {
  role: Role;
  userId: string;
}

const EDITABLE = ["subject", "description", "priority", "status"] as const;

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const clean = String(value).trim();
  return clean ? clean : null;
}

function checkFields(fields: TicketFields): void {
  if ("subject" in fields && !text(fields.subject)) throw new Error("Informe o assunto do ticket.");
  if (fields.priority != null && !TICKET_PRIORITY_OPTIONS.some((option) => option.value === fields.priority)) throw new Error("Prioridade inválida.");
  if (fields.status != null && !TICKET_STATUS_OPTIONS.some((option) => option.value === fields.status)) throw new Error("Status inválido.");
}

/**
 * Cria e altera tickets. Ticket novo: assunto obrigatório, quem abriu = a pessoa, área = o papel dela, status
 * "aberto" (quem tem `edit` pode já criar em outro status). Alteração: só os campos enviados, só tickets da empresa.
 */
export async function saveTicketChanges(db: DatabaseLike, companyId: string, actor: TicketActor, changes: TicketChanges): Promise<{ created: string[] }> {
  const canEdit = can(actor.role, "edit", "tickets");
  if (changes.created.length && !can(actor.role, "create", "tickets")) throw new Error("Seu perfil não tem permissão para abrir tickets.");
  if (changes.updated.length && !canEdit) throw new Error("Seu perfil não tem permissão para editar tickets.");
  for (const fields of changes.created) checkFields({ subject: fields.subject ?? "", ...fields });
  for (const fields of changes.updated) checkFields(fields);

  for (const fields of changes.updated) {
    const [current] = await db.select<Ticket[]>("SELECT * FROM tickets WHERE company_id=? AND id=? AND deleted_at IS NULL", [companyId, fields.id]);
    if (!current) throw new Error("Ticket não encontrado (pode ter sido excluído ou ser de outra empresa).");
    const keys = EDITABLE.filter((key) => key in fields);
    if (!keys.length) continue;
    const values = keys.map((key) => (key === "subject" || key === "description" ? text(fields[key]) : fields[key]));
    await db.execute(`UPDATE tickets SET ${keys.map((key) => `${key}=?`).join(", ")}, updated_at=datetime('now') WHERE id=? AND company_id=? AND deleted_at IS NULL`, [
      ...values,
      fields.id,
      companyId,
    ]);
  }

  const created: string[] = [];
  for (const fields of changes.created) {
    const id = uuidv4();
    const status = canEdit && fields.status ? fields.status : "aberto";
    await db.execute("INSERT INTO tickets (id, company_id, subject, description, priority, status, opened_by, requester_area) VALUES (?,?,?,?,?,?,?,?)", [
      id,
      companyId,
      text(fields.subject),
      text(fields.description),
      fields.priority ?? "media",
      status,
      actor.userId,
      ROLE_LABELS[actor.role],
    ]);
    created.push(id);
  }
  return { created };
}
