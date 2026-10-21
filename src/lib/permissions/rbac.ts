import type { Role, Scope } from "@/types";

export type Action =
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

export type Resource =
  | "customers"
  | "leads"
  | "opportunities"
  | "proposals"
  | "tickets"
  | "work_orders"
  | "projects"
  | "tasks"
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

const PERMISSIONS: PermissionMap = {
  admin: {
    "*": ["view", "create", "edit", "delete", "approve", "export", "comment", "attach", "transfer", "request"],
  },
  gerente: {
    customers: ["view", "create", "edit", "export", "comment", "attach"],
    leads: ["view", "create", "edit", "delete", "export"],
    opportunities: ["view", "create", "edit", "delete", "approve"],
    proposals: ["view", "create", "edit", "approve"],
    tickets: ["view", "create", "edit", "approve", "comment"],
    work_orders: ["view", "create", "edit", "approve", "comment"],
    projects: ["view", "create", "edit", "approve", "comment"],
    tasks: ["view", "create", "edit", "delete"],
    inventory: ["view", "export"],
    custody: ["view"],
    finance: ["view", "approve", "export"],
    payables: ["view", "approve"],
    receivables: ["view"],
    documents: ["view", "attach", "export"],
    users: ["view"],
    settings: ["view"],
    audit_logs: ["view"],
    automations: ["view", "edit"],
  },
  tecnico: {
    customers: ["view"],
    tickets: ["view", "edit", "comment"],
    work_orders: ["view", "edit", "comment", "attach"],
    projects: ["view"],
    tasks: ["view", "edit", "comment"],
    inventory: ["view", "request"],
    custody: ["view", "request"],
    documents: ["view", "attach"],
  },
  estoquista: {
    customers: ["view"],
    inventory: ["view", "create", "edit", "transfer", "export"],
    custody: ["view", "create", "edit", "transfer"],
    work_orders: ["view"],
    documents: ["view", "attach"],
  },
  financeiro: {
    customers: ["view"],
    finance: ["view", "create", "edit", "export"],
    payables: ["view", "create", "edit", "approve", "export"],
    receivables: ["view", "create", "edit", "export"],
    documents: ["view", "attach", "export"],
    audit_logs: ["view", "export"],
  },
  comercial: {
    customers: ["view", "create", "edit", "comment", "attach"],
    leads: ["view", "create", "edit", "delete"],
    opportunities: ["view", "create", "edit"],
    proposals: ["view", "create", "edit"],
    documents: ["view", "attach"],
  },
  atendimento: {
    customers: ["view", "create", "edit", "comment"],
    tickets: ["view", "create", "edit", "comment"],
    work_orders: ["view", "create"],
    documents: ["view"],
  },
  auditor: {
    customers: ["view", "export"],
    tickets: ["view", "export"],
    work_orders: ["view", "export"],
    projects: ["view", "export"],
    inventory: ["view", "export"],
    custody: ["view", "export"],
    finance: ["view", "export"],
    payables: ["view", "export"],
    receivables: ["view", "export"],
    documents: ["view", "export"],
    audit_logs: ["view", "export"],
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
  const rolePerms = PERMISSIONS[role];
  if (!rolePerms) return false;

  // Admin wildcard
  if (rolePerms["*"]) return true;

  const allowed = rolePerms[resource] ?? [];
  return allowed.includes(action);
}

export function canAny(role: Role, actions: Action[], resource: Resource): boolean {
  return actions.some((a) => can(role, a, resource));
}

export function visibleModules(role: Role): string[] {
  const base = ["dashboard"];
  const rolePerms = PERMISSIONS[role];
  if (!rolePerms) return base;

  const moduleMap: Record<string, Resource> = {
    crm: "customers",
    support: "tickets",
    operations: "work_orders",
    projects: "projects",
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
