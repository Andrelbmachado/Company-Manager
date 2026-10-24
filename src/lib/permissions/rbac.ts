import type { Role, Scope } from "@/types";

/** Ações do RBAC. `receive` = dar entrada de mercadoria (recebimento de pedido de compra). */
export const ACTIONS = ["view", "create", "edit", "delete", "approve", "export", "comment", "attach", "transfer", "request", "receive"] as const;
export type Action = (typeof ACTIONS)[number];

export const RESOURCES = [
  "customers",
  "leads",
  "opportunities",
  "proposals",
  "tickets",
  "work_orders",
  "projects",
  "tasks",
  "product_development",
  "inventory",
  "custody",
  "finance",
  "payables",
  "receivables",
  "documents",
  "users",
  "settings",
  "audit_logs",
  "automations",
  "hr_self",
  "hr_admin",
  "payroll",
  // CRM/ERP (migration 0008)
  "products",
  "sales_orders",
  "invoices",
  "purchase_orders",
  "bank",
  "reports",
  "imports",
  "crm_activities",
] as const;
export type Resource = (typeof RESOURCES)[number];

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
    "*": [...ACTIONS],
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
    "*": [...ACTIONS],
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

/**
 * CRM/ERP (migration 0008), mesclado em PERMISSIONS por papel. CEO e admin já têm tudo pelo "*".
 * `reports` libera o módulo de Relatórios; cada relatório ainda confere `view` no recurso de origem
 * (ex.: DRE exige `finance`). `imports` libera a tela de importação; importar uma entidade também exige
 * `create` no recurso dela (ex.: importar clientes exige `create` em `customers`).
 */
const ERP_PERMISSIONS: PermissionMap = {
  gerente: {
    products: ["view", "export"],
    sales_orders: ["view", "approve", "export"],
    invoices: ["view", "export"],
    purchase_orders: ["view", "approve", "export"],
    bank: ["view"],
    reports: ["view", "export"],
    imports: ["view", "create"],
    crm_activities: ["view", "create", "edit", "comment"],
  },
  tecnico: {
    products: ["view"],
  },
  estoquista: {
    products: ["view", "create", "edit", "delete", "export"],
    purchase_orders: ["view", "create", "edit", "receive", "request", "export"],
    reports: ["view"],
    imports: ["view", "create"],
  },
  financeiro: {
    products: ["view"],
    sales_orders: ["view", "export"],
    invoices: ["view", "create", "edit", "delete", "approve", "export"],
    purchase_orders: ["view", "export"],
    bank: ["view", "create", "edit", "delete", "approve", "export"],
    reports: ["view", "export"],
    imports: ["view", "create"],
  },
  comercial: {
    products: ["view"],
    sales_orders: ["view", "create", "edit", "delete", "export"],
    invoices: ["view"],
    crm_activities: ["view", "create", "edit", "delete", "comment"],
    reports: ["view"],
    imports: ["view", "create"],
  },
  atendimento: {
    products: ["view"],
    sales_orders: ["view"],
    crm_activities: ["view", "create", "edit", "comment"],
  },
  produtos: {
    products: ["view", "create", "edit", "export"],
    imports: ["view", "create"],
  },
  rh: {
    imports: ["view", "create"],
  },
  auditor: {
    products: ["view", "export"],
    sales_orders: ["view", "export"],
    invoices: ["view", "export"],
    purchase_orders: ["view", "export"],
    bank: ["view", "export"],
    reports: ["view", "export"],
    crm_activities: ["view", "export"],
    imports: ["view"],
  },
};

for (const [role, resources] of Object.entries(ERP_PERMISSIONS)) {
  Object.assign((PERMISSIONS[role] ??= {}), resources);
}

export function can(
  role: Role,
  action: Action,
  resource: Resource,
  _scope?: Scope
): boolean {
  const rolePerms = PERMISSIONS[role];
  if (!rolePerms) return false;

  // CEO enxerga tudo (as exceções de setor abaixo não se aplicam a ele).
  if (role === "ceo") return true;

  // "Meu RH": todo colaborador, de qualquer setor, vê e abre solicitações do próprio RH.
  if (resource === "hr_self") return action === "view" || action === "create" || action === "comment";

  if (resource === "customers" && role !== "comercial") return false;
  if (resource === "audit_logs" && role !== "tecnico") return false;

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
    catalog: "products",
    sales: "sales_orders",
    purchasing: "purchase_orders",
    reports: "reports",
    imports: "imports",
  };

  const visible = [
    ...base,
    ...Object.entries(moduleMap)
      .filter(([, res]) => can(role, "view", res))
      .map(([mod]) => mod),
  ];

  return visible;
}
