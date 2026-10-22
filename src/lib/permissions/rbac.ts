import type { Role, Scope } from "@/types";

type Action =
  | "view"
  | "create"
  | "edit"
  | "delete"
  | "approve"
  | "export"
  | "comment"
  | "attach"
  | "transfer"
  | "request";

type Resource =
  | "customers"
  | "leads"
  | "opportunities"
  | "proposals"
  | "tickets"
  | "work_orders"
  | "projects"
  | "tasks"
  | "product_development"
  | "inventory"
  | "custody"
  | "finance"
  | "payables"
  | "receivables"
  | "documents"
  | "users"
  | "settings"
  | "audit_logs"
  | "automations";

interface PermissionMap {
  [role: string]: {
    [resource: string]: Action[];
  };
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administracao",
  gerente: "Gerencia",
  tecnico: "TI / Operacoes",
  estoquista: "Estoque",
  financeiro: "Contabilidade / Financeiro",
  comercial: "Comercial",
  atendimento: "Atendimento",
  produtos: "Desenvolvimento de Produtos",
  auditor: "Auditoria",
};

const PERMISSIONS: PermissionMap = {
  admin: {
    "*": ["view", "create", "edit", "delete", "approve", "export", "comment", "attach", "transfer", "request"],
  },
  gerente: {
    leads: ["view", "create", "edit", "delete", "export"],
    opportunities: ["view", "create", "edit", "delete", "approve"],
    proposals: ["view", "create", "edit", "approve"],
    tickets: ["view", "create", "edit", "approve", "comment"],
    work_orders: ["view", "create", "edit", "approve", "comment"],
    projects: ["view", "create", "edit", "approve", "comment"],
    tasks: ["view", "create", "edit", "delete"],
    product_development: ["view", "approve", "comment"],
    inventory: ["view", "export"],
    custody: ["view"],
    finance: ["view", "approve", "export"],
    payables: ["view", "approve"],
    receivables: ["view"],
    documents: ["view", "create", "edit", "attach", "export"],
    users: ["view"],
    settings: ["view"],
    automations: ["view", "edit"],
  },
  tecnico: {
    tickets: ["view", "create", "edit", "comment"],
    work_orders: ["view", "edit", "comment", "attach"],
    projects: ["view"],
    tasks: ["view", "edit", "comment"],
    inventory: ["view", "request"],
    custody: ["view", "request"],
    documents: ["view", "create", "edit", "attach"],
    audit_logs: ["view"],
    settings: ["view"],
  },
  estoquista: {
    tickets: ["view", "create"],
    inventory: ["view", "create", "edit", "delete", "transfer", "export"],
    custody: ["view", "create", "edit", "delete", "transfer"],
    documents: ["view", "create", "edit", "attach"],
    settings: ["view"],
  },
  financeiro: {
    tickets: ["view", "create"],
    finance: ["view", "create", "edit", "export"],
    payables: ["view", "create", "edit", "approve", "export"],
    receivables: ["view", "create", "edit", "export"],
    documents: ["view", "create", "edit", "attach", "export"],
    settings: ["view"],
  },
  comercial: {
    customers: ["view", "create", "edit", "comment", "attach"],
    tickets: ["view", "create"],
    leads: ["view", "create", "edit", "delete"],
    opportunities: ["view", "create", "edit"],
    proposals: ["view", "create", "edit"],
    documents: ["view", "create", "edit", "attach"],
    settings: ["view"],
  },
  atendimento: {
    tickets: ["view", "create", "edit", "comment"],
    work_orders: ["view", "create"],
    documents: ["view", "create", "edit", "attach"],
    settings: ["view"],
  },
  produtos: {
    tickets: ["view", "create"],
    projects: ["view", "create", "edit", "comment"],
    tasks: ["view", "create", "edit", "comment"],
    product_development: ["view", "create", "edit", "comment", "attach"],
    documents: ["view", "create", "edit", "attach"],
    settings: ["view"],
  },
  auditor: {
    tickets: ["view", "create", "export"],
    work_orders: ["view", "export"],
    projects: ["view", "export"],
    product_development: ["view", "export"],
    inventory: ["view", "export"],
    custody: ["view", "export"],
    finance: ["view", "export"],
    payables: ["view", "export"],
    receivables: ["view", "export"],
    documents: ["view", "export"],
    users: ["view"],
    settings: ["view"],
  },
};

export function can(
  role: Role,
  action: Action,
  resource: Resource,
  _scope?: Scope
): boolean {
  if (resource === "customers" && role !== "comercial") return false;
  if (resource === "audit_logs" && role !== "tecnico") return false;

  const rolePerms = PERMISSIONS[role];
  if (!rolePerms) return false;

  // Admin wildcard
  if (rolePerms["*"]) return true;

  const allowed = rolePerms[resource] ?? [];
  return allowed.includes(action);
}

export function hasFullTicketAccess(role: Role): boolean {
  return role === "tecnico";
}

export function canAny(role: Role, actions: Action[], resource: Resource): boolean {
  return actions.some((a) => can(role, a, resource));
}

export function visibleModules(role: Role): string[] {
  const base = ["dashboard", "assistant"];
  const rolePerms = PERMISSIONS[role];
  if (!rolePerms) return base;

  const moduleMap: Record<string, Resource> = {
    crm: "customers",
    leads: "leads",
    opportunities: "opportunities",
    support: "tickets",
    operations: "work_orders",
    projects: "projects",
    products: "product_development",
    inventory: "inventory",
    custody: "custody",
    finance: "finance",
    documents: "documents",
    settings: "settings",
    audit: "audit_logs",
  };

  const visible = [
    ...base,
    ...Object.entries(moduleMap)
      .filter(([, res]) => can(role, "view", res))
      .map(([mod]) => mod),
  ];

  return visible;
}
