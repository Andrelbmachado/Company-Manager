// Base das gravações das tabelas editáveis do comercial (CRM, leads, catálogo e vendas): quem grava, o formato das
// alterações que a EditableTable entrega e a conferência de permissão na camada de dados. O botão desabilitado na tela
// é só aviso: aqui a mesma regra (can de rbac.ts) é conferida antes de qualquer escrita.
import { can, type Action, type Resource } from "@/lib/permissions/rbac";
import type { Role } from "@/types";

/** Quem está gravando (papel para a permissão, id para responsável/criado por). */
export interface EditActor {
  role: Role;
  userId: string;
}

/** Mesmo formato do onSave da EditableTable: existentes só com os campos alterados (e o id); novas com o digitado. */
export interface RowChanges<T> {
  updated: (Partial<T> & { id: string })[];
  created: Partial<T>[];
}

/** Ids gravados, para a tela registrar auditoria e selecionar o que acabou de criar. */
export interface SaveResult {
  created: string[];
  updated: string[];
}

const VERBS: Partial<Record<Action, string>> = { view: "ver", create: "criar", edit: "editar", delete: "excluir", approve: "aprovar" };

const NOUNS: Partial<Record<Resource, string>> = {
  customers: "clientes e contatos",
  leads: "leads",
  opportunities: "oportunidades",
  proposals: "propostas",
  crm_activities: "atividades",
  products: "produtos e tabelas de preço",
  sales_orders: "pedidos de venda",
  invoices: "faturas",
};

/** Lança erro em português quando o papel não pode fazer a ação no recurso. */
export function assertCan(actor: Pick<EditActor, "role">, action: Action, resource: Resource): void {
  if (can(actor.role, action, resource)) return;
  throw new Error(`Seu perfil não tem permissão para ${VERBS[action] ?? action} ${NOUNS[resource] ?? resource}.`);
}

/** Editar exige `edit`; Adicionar exige `create`. Confere os dois antes de gravar qualquer linha. */
export function assertChanges<T>(actor: Pick<EditActor, "role">, changes: RowChanges<T>, resource: Resource): void {
  if (changes.updated.length > 0) assertCan(actor, "edit", resource);
  if (changes.created.length > 0) assertCan(actor, "create", resource);
}

/** Valor ligado de uma coluna bool (a tabela devolve 1/0 para colunas numéricas e true/false nas demais). */
export function isOn(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

/** "Linha 2: ..." para o erro apontar qual das novas linhas está errada. */
export function lineError(index: number, total: number, message: string): Error {
  return new Error(total > 1 ? `Linha nova ${index + 1}: ${message}` : message);
}
