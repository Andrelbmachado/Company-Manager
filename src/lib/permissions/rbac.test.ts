import { describe, expect, it } from "vitest";
import { ACTIONS, can, canAny, PERMISSIONS, RESOURCES as RBAC_RESOURCES, ROLE_LABELS, visibleModules, type Action, type Resource } from "./rbac";
import type { Role } from "@/types";

const ROLES = Object.keys(ROLE_LABELS) as Role[];

/**
 * Quem VÊ cada recurso. É a especificação de acesso do app: mudar uma linha aqui é mudar quem enxerga um módulo,
 * então a mudança tem de ser deliberada (e refletida em PERMISSIONS).
 */
const VIEW_MATRIX: Record<string, Role[]> = {
  customers: ["ceo", "admin", "gerente", "comercial", "atendimento"],
  leads: ["ceo", "admin", "gerente", "comercial"],
  opportunities: ["ceo", "admin", "gerente", "comercial"],
  proposals: ["ceo", "admin", "gerente", "comercial"],
  tickets: ROLES,
  work_orders: ["ceo", "admin", "gerente", "tecnico", "atendimento", "auditor"],
  projects: ["ceo", "admin", "gerente", "tecnico", "produtos", "auditor"],
  tasks: ["ceo", "admin", "gerente", "tecnico", "produtos"],
  product_development: ["ceo", "admin", "gerente", "produtos", "auditor"],
  inventory: ["ceo", "admin", "gerente", "tecnico", "estoquista", "auditor"],
  custody: ["ceo", "admin", "gerente", "tecnico", "estoquista", "auditor"],
  finance: ["ceo", "admin", "gerente", "financeiro", "auditor"],
  payables: ["ceo", "admin", "gerente", "financeiro", "auditor"],
  receivables: ["ceo", "admin", "gerente", "financeiro", "auditor"],
  documents: ROLES,
  users: ["ceo", "admin", "gerente", "rh", "auditor"],
  settings: ROLES,
  audit_logs: ["ceo", "admin", "tecnico", "auditor"],
  automations: ["ceo", "admin", "gerente"],
  hr_self: ROLES,
  hr_admin: ["ceo", "admin", "rh"],
  payroll: ["ceo", "admin"],
  // CRM/ERP (0008): comercial vende, estoque cuida do catálogo e recebe compras, financeiro fatura e concilia,
  // gerência vê o geral e auditoria vê tudo (menos a folha).
  products: ["ceo", "admin", "gerente", "tecnico", "estoquista", "financeiro", "comercial", "atendimento", "produtos", "auditor"],
  sales_orders: ["ceo", "admin", "gerente", "financeiro", "comercial", "atendimento", "auditor"],
  invoices: ["ceo", "admin", "gerente", "financeiro", "comercial", "auditor"],
  purchase_orders: ["ceo", "admin", "gerente", "estoquista", "financeiro", "auditor"],
  bank: ["ceo", "admin", "gerente", "financeiro", "auditor"],
  reports: ["ceo", "admin", "gerente", "estoquista", "financeiro", "comercial", "auditor"],
  imports: ["ceo", "admin", "gerente", "estoquista", "financeiro", "rh", "comercial", "produtos", "auditor"],
  crm_activities: ["ceo", "admin", "gerente", "comercial", "atendimento", "auditor"],
};

/** Todos os recursos do RBAC, da matriz ou citados em PERMISSIONS (recursos novos entram sozinhos no teste de espelho). */
const RESOURCES = [...new Set([...RBAC_RESOURCES, ...Object.keys(VIEW_MATRIX), ...Object.values(PERMISSIONS).flatMap((perms) => Object.keys(perms))])]
  .filter((resource) => resource !== "*") as Resource[];

/** O que a tabela PERMISSIONS diz, sem passar por can(). "Meu RH" é a única regra comum a todos os papéis. */
function fromTable(role: Role, action: Action, resource: Resource): boolean {
  if (resource === "hr_self") return action === "view" || action === "create" || action === "comment";
  const perms = PERMISSIONS[role];
  return (perms["*"] ?? perms[resource] ?? []).includes(action);
}

describe("can()", () => {
  it("a matriz tem uma linha para cada recurso do RBAC (recurso novo precisa decidir quem vê)", () => {
    expect(Object.keys(VIEW_MATRIX).sort()).toEqual([...RBAC_RESOURCES].sort());
  });

  it("PERMISSIONS só cita papéis, recursos e ações que existem (erro de digitação não vira acesso calado)", () => {
    expect(Object.keys(PERMISSIONS).sort()).toEqual([...ROLES].sort());
    for (const [role, perms] of Object.entries(PERMISSIONS)) {
      for (const [resource, actions] of Object.entries(perms)) {
        expect(resource === "*" || (RBAC_RESOURCES as readonly string[]).includes(resource), `${role} → ${resource}`).toBe(true);
        for (const action of actions) expect(ACTIONS, `${role} → ${resource} → ${action}`).toContain(action);
      }
    }
  });

  it("cada papel vê exatamente os recursos da matriz", () => {
    for (const [resource, roles] of Object.entries(VIEW_MATRIX)) {
      for (const role of ROLES) {
        expect(can(role, "view", resource as Resource), `${role} × ${resource}`).toBe(roles.includes(role));
      }
    }
  });

  it("espelha PERMISSIONS em todo papel × recurso × ação (nenhuma exceção escondida em can())", () => {
    expect(RESOURCES.length).toBeGreaterThanOrEqual(Object.keys(VIEW_MATRIX).length);
    for (const role of ROLES) {
      for (const resource of RESOURCES) {
        for (const action of ACTIONS) {
          expect(can(role, action, resource), `${role} ${action} ${resource}`).toBe(fromTable(role, action, resource));
        }
      }
    }
  });

  it("CEO e Administração veem clientes e auditoria (as exceções antigas acabaram)", () => {
    expect(can("ceo", "view", "customers")).toBe(true);
    expect(can("admin", "view", "customers")).toBe(true);
    expect(can("ceo", "view", "audit_logs")).toBe(true);
    expect(can("admin", "view", "audit_logs")).toBe(true);
  });

  it("Gerência e Atendimento veem clientes; RH, Estoque, Financeiro e Auditoria não", () => {
    expect(can("gerente", "view", "customers")).toBe(true);
    expect(can("atendimento", "view", "customers")).toBe(true);
    expect(can("comercial", "create", "customers")).toBe(true);
    expect(can("atendimento", "create", "customers")).toBe(false);
    for (const role of ["rh", "estoquista", "financeiro", "auditor", "tecnico", "produtos"] as Role[]) {
      expect(can(role, "view", "customers"), role).toBe(false);
    }
  });

  it("Auditoria vê e exporta a trilha de auditoria, sem alterar", () => {
    expect(can("auditor", "view", "audit_logs")).toBe(true);
    expect(can("auditor", "export", "audit_logs")).toBe(true);
    expect(canAny("auditor", ["create", "edit", "delete"], "audit_logs")).toBe(false);
    expect(can("tecnico", "view", "audit_logs")).toBe(true);
    expect(can("gerente", "view", "audit_logs")).toBe(false);
  });

  it("folha de pagamento só para CEO e Administração", () => {
    expect(can("estoquista", "view", "payroll")).toBe(false);
    expect(can("financeiro", "view", "payroll")).toBe(false);
    expect(can("rh", "view", "payroll")).toBe(false);
    expect(ROLES.filter((role) => can(role, "view", "payroll"))).toEqual(["ceo", "admin"]);
  });

  it("papel desconhecido não acessa nada", () => {
    expect(can("estagiario" as Role, "view", "tickets")).toBe(false);
    expect(visibleModules("estagiario" as Role)).toEqual(["dashboard", "assistant"]);
  });
});

describe("visibleModules()", () => {
  const MODULE_RESOURCE: Record<string, Resource> = { crm: "customers", audit: "audit_logs", payroll: "payroll", hr_manage: "hr_admin", hr: "hr_self", finance: "finance" };

  it("mostra o módulo só para quem pode ver o recurso", () => {
    for (const role of ROLES) {
      const modules = visibleModules(role);
      expect(modules).toContain("dashboard");
      expect(modules).toContain("assistant");
      for (const [module, resource] of Object.entries(MODULE_RESOURCE)) {
        expect(modules.includes(module), `${role} → ${module}`).toBe(can(role, "view", resource));
      }
    }
  });

  it("CRM para CEO, Administração, Gerência, Comercial e Atendimento", () => {
    expect(ROLES.filter((role) => visibleModules(role).includes("crm"))).toEqual(["ceo", "admin", "gerente", "comercial", "atendimento"]);
  });

  it("Auditoria para CEO, Administração, TI e Auditoria", () => {
    expect(ROLES.filter((role) => visibleModules(role).includes("audit"))).toEqual(["ceo", "admin", "tecnico", "auditor"]);
  });
});
