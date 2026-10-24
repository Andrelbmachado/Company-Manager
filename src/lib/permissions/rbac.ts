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
  | "automations"
  | "hr_self"
  | "hr_admin"
  | "payroll";

interface PermissionMap {
  [role: string]: {
    [resource: string]: Action[];
  };
}

export const ROLE_LABELS: Record<Role, string> = {
  ceo: "Diretoria (CEO)",
  admin: "Administração",
  gerente: "Gerência",
  tecnico: "TI / Operações",
  estoquista: "Estoque",
  financeiro: "Contabilidade / Financeiro",
  rh: "Recursos Humanos",
  comercial: "Comercial",
  atendimento: "Atendimento",
  produtos: "Desenvolvimento de Produtos",
  auditor: "Auditoria",
};

export const PERMISSIONS: PermissionMap = {
  // CEO: controle geral (vê todos os setores, inclusive CRM, auditoria e gestão de RH).
  ceo: {
    "*": ["view", "create", "edit", "delete", "approve", "export", "comment", "attach", "transfer", "request"],
  },
  // RH: gerencia pessoas (colaboradores, solicitações, comunicados). Não vê CRM, financeiro, estoque nem auditoria.
  rh: {
    hr_admin: ["view", "create", "edit", "delete", "approve", "export", "comment", "attach"],
    tickets: ["view", "create"],
    documents: ["view", "create", "edit", "attach"],
    users: ["view"],
    settings: ["view"],
  },
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
  // Financeiro: tudo do financeiro (contas a pagar e a receber), exceto questões administrativo-financeiras como a folha de pagamento (`payroll`).
  financeiro: {
    tickets: ["view", "create"],
    finance: ["view", "create", "edit", "delete", "approve", "export"],
    payables: ["view", "create", "edit", "delete", "approve", "export"],
    receivables: ["view", "create", "edit", "delete", "approve", "export"],
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
    // Atendimento consulta o cliente do chamado e atualiza contato; quem cadastra cliente é o Comercial.
    customers: ["view", "edit", "comment"],
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
    audit_logs: ["view", "export"],
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

  // "Meu RH": todo colaborador, de qualquer setor, vê e abre solicitações do próprio RH.
  if (resource === "hr_self") return action === "view" || action === "create" || action === "comment";

  // Todo o resto vem da tabela PERMISSIONS, sem exceção por papel aqui ("*" = CEO e Administração veem tudo).
  const allowed = rolePerms["*"] ?? rolePerms[resource] ?? [];
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
    hr: "hr_self",
    hr_manage: "hr_admin",
    payroll: "payroll",
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
