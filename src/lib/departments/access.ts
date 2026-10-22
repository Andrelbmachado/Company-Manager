/**
 * Modelo de permissões por departamento.
 *
 * Regras (avaliadas nesta ordem):
 *  1. Admin da empresa (memberships.role = 'admin') vê e gerencia tudo.
 *  2. Membro de um departamento acessa apenas o próprio departamento:
 *       - chefe:      view, create, edit, delete, approve, manage_members
 *       - assistente: view, create, edit
 *       - membro:     view
 *  3. Acesso entre departamentos só existe via CROSS_DEPARTMENT_GRANTS
 *     (lista explícita, deny-by-default, sempre somente leitura).
 *
 * Esta mesma matriz é espelhada em SQL (migrations SQLite + Supabase RLS)
 * para que a regra valha também fora da UI.
 */
import { DEPARTMENTS, type DepartmentSlug, getDepartment } from "./catalog";

export type DepartmentRole = "chefe" | "assistente" | "membro";
export type DepartmentAction = "view" | "create" | "edit" | "delete" | "approve" | "manage_members";

export interface DepartmentMembership {
  department: DepartmentSlug;
  role: DepartmentRole;
}

export interface AccessContext {
  isAdmin: boolean;
  memberships: DepartmentMembership[];
}

export interface CrossDepartmentGrant {
  /** Departamento que RECEBE o acesso. */
  grantee: DepartmentSlug;
  /** Departamento dono do dado. */
  owner: DepartmentSlug;
  /** Recursos (cards) liberados. Nunca use "*". */
  resources: string[];
  /** Campos visíveis do recurso (projeção limitada). */
  fields?: string[];
  reason: string;
}

export const ROLE_ACTIONS: Record<DepartmentRole, DepartmentAction[]> = {
  chefe: ["view", "create", "edit", "delete", "approve", "manage_members"],
  assistente: ["view", "create", "edit"],
  membro: ["view"],
};

/**
 * Configuração central de visibilidade cruzada. Padrão: ninguém vê nada de
 * outro departamento. Cada linha é uma exceção explícita, somente leitura.
 */
export const CROSS_DEPARTMENT_GRANTS: readonly CrossDepartmentGrant[] = [
  {
    grantee: "marketing",
    owner: "rh",
    resources: ["ferias_ausencias"],
    fields: ["colaborador_nome", "tipo", "data_inicio", "data_fim"],
    reason: "Planejar campanhas e entregas considerando férias/ausências do time.",
  },
];

export function membershipFor(ctx: AccessContext, dept: DepartmentSlug): DepartmentMembership | undefined {
  return ctx.memberships.find((m) => m.department === dept);
}

export function findGrant(
  ctx: AccessContext,
  owner: DepartmentSlug,
  resource: string,
  grants: readonly CrossDepartmentGrant[] = CROSS_DEPARTMENT_GRANTS
): CrossDepartmentGrant | undefined {
  return grants.find(
    (g) => g.owner === owner && g.resources.includes(resource) && ctx.memberships.some((m) => m.department === g.grantee)
  );
}

/** Pode executar `action` sobre `resource` do departamento `owner`? */
export function canDepartment(
  ctx: AccessContext,
  owner: DepartmentSlug,
  action: DepartmentAction,
  resource?: string,
  grants: readonly CrossDepartmentGrant[] = CROSS_DEPARTMENT_GRANTS
): boolean {
  if (ctx.isAdmin) return true;
  const own = membershipFor(ctx, owner);
  if (own) {
    if (!ROLE_ACTIONS[own.role].includes(action)) return false;
    if (resource) {
      const def = getDepartment(owner);
      if (!def?.cards.some((c) => c.resource === resource)) return false;
    }
    return true;
  }
  // Cross-department: somente leitura e somente recursos liberados.
  if (action !== "view" || !resource) return false;
  return findGrant(ctx, owner, resource, grants) !== undefined;
}

export type DepartmentAccessLevel = "full" | "own" | "shared" | "none";

/** Nível de acesso à página do departamento. */
export function departmentAccess(ctx: AccessContext, owner: DepartmentSlug): DepartmentAccessLevel {
  if (ctx.isAdmin) return "full";
  if (membershipFor(ctx, owner)) return "own";
  const shared = CROSS_DEPARTMENT_GRANTS.some(
    (g) => g.owner === owner && ctx.memberships.some((m) => m.department === g.grantee)
  );
  return shared ? "shared" : "none";
}

/** Cards que o usuário pode ver numa página de departamento. */
export function visibleCards(ctx: AccessContext, owner: DepartmentSlug) {
  const def = getDepartment(owner);
  if (!def) return [];
  return def.cards.filter((card) => canDepartment(ctx, owner, "view", card.resource));
}

/** Departamentos que aparecem na sidebar (próprios + compartilhados). */
export function visibleDepartments(ctx: AccessContext) {
  return DEPARTMENTS.filter((d) => departmentAccess(ctx, d.slug) !== "none").map((d) => ({
    ...d,
    access: departmentAccess(ctx, d.slug),
  }));
}

export class DepartmentAccessError extends Error {
  constructor(owner: string, action: string, resource?: string) {
    super(`Acesso negado: ${action} em ${owner}${resource ? `/${resource}` : ""}`);
    this.name = "DepartmentAccessError";
  }
}

export function assertCanDepartment(
  ctx: AccessContext,
  owner: DepartmentSlug,
  action: DepartmentAction,
  resource?: string
): void {
  if (!canDepartment(ctx, owner, action, resource)) {
    throw new DepartmentAccessError(owner, action, resource);
  }
}

/** Remove campos não liberados quando o acesso é via grant cruzado. */
export function projectFields<T extends Record<string, unknown>>(
  ctx: AccessContext,
  owner: DepartmentSlug,
  resource: string,
  rows: T[]
): Partial<T>[] {
  if (ctx.isAdmin || membershipFor(ctx, owner)) return rows;
  const grant = findGrant(ctx, owner, resource);
  if (!grant) return [];
  if (!grant.fields) return rows;
  return rows.map((row) => {
    const out: Partial<T> = {};
    for (const f of grant.fields!) if (f in row) (out as Record<string, unknown>)[f] = row[f];
    return out;
  });
}
