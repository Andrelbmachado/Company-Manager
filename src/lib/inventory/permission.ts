// Permissão conferida também na camada de dados (não só nos botões da tela): as gravações das tabelas editáveis de
// Logística (estoque, locais, contagens, movimentações, custódia, ordens de serviço e fornecedores) recebem quem está
// gravando e recusam o que o papel não pode fazer, com mensagem pronta para a tela.
import { can, type Action, type Resource } from "@/lib/permissions/rbac";
import type { Role } from "@/types";

/** Quem está gravando: papel (RBAC) e conta (histórico, responsável padrão). */
export interface Actor {
  role: Role;
  userId: string;
}

export class PermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermissionError";
  }
}

const VERBS: Partial<Record<Action, string>> = {
  create: "adicionar",
  edit: "editar",
  delete: "excluir",
  transfer: "transferir",
};

/** Recusa (PermissionError) se o papel não tem a ação no recurso. `what` = o que é gravado ("itens do estoque"). */
export function assertCan(actor: Actor, action: Action, resource: Resource, what: string): void {
  if (can(actor.role, action, resource)) return;
  throw new PermissionError(`Seu perfil não tem permissão para ${VERBS[action] ?? action} ${what}.`);
}

/** Linhas da EditableTable: editar exige `edit`, adicionar exige `create` (só confere o que vai ser gravado). */
export function assertCanSaveRows(actor: Actor, resource: Resource, what: string, changes: { updated: readonly unknown[]; created: readonly unknown[] }): void {
  if (changes.updated.length > 0) assertCan(actor, "edit", resource, what);
  if (changes.created.length > 0) assertCan(actor, "create", resource, what);
}
