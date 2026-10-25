// Permissão conferida na camada de dados (além dos botões desativados na EditableTable): quem grava alterações de
// uma tabela passa o papel da sessão e a gravação é recusada antes de tocar o banco. Usado por financeiro, folha e
// compras.
import { can, type Action, type Resource } from "@/lib/permissions/rbac";
import type { Role } from "@/types";

/** Quem está gravando: empresa, papel (RBAC) e usuário (autor nos eventos e nas baixas). */
export interface EditContext {
  companyId: string;
  role: Role;
  userId: string;
}

const DENIED: Partial<Record<Action, string>> = {
  create: "Seu perfil não tem permissão para adicionar neste cadastro.",
  edit: "Seu perfil não tem permissão para editar este cadastro.",
  delete: "Seu perfil não tem permissão para excluir neste cadastro.",
  receive: "Seu perfil não tem permissão para dar entrada de mercadoria.",
};

export class PermissionError extends Error {
  constructor(action: Action) {
    super(DENIED[action] ?? "Seu perfil não tem permissão para esta ação.");
    this.name = "PermissionError";
  }
}

export function requirePermission(role: Role, action: Action, resource: Resource): void {
  if (!can(role, action, resource)) throw new PermissionError(action);
}

/** Alterações de uma EditableTable: editar exige "edit" e adicionar exige "create" no recurso. */
export function requireTablePermission(role: Role, resource: Resource, changes: { updated: readonly unknown[]; created: readonly unknown[] }): void {
  if (changes.updated.length > 0) requirePermission(role, "edit", resource);
  if (changes.created.length > 0) requirePermission(role, "create", resource);
}

/** Prefixo das mensagens de erro de uma linha ("Aluguel: ..."), para a pessoa achar a linha na tabela. */
export function rowError(label: string | null | undefined, message: string): Error {
  const name = (label ?? "").trim();
  return new Error(name ? `${name}: ${message}` : message);
}
