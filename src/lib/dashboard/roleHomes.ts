// Home (Dashboard) por setor: que indicadores, listas, gráficos e atalhos cada um dos 11 papéis vê ao entrar.
// Puro (sem banco): os números vêm de metrics.ts. Cada widget declara as permissões de que precisa e roleHome() ainda
// filtra pelo RBAC, então um papel nunca recebe widget de recurso que não pode ver (roleHomes.test.ts confere isso,
// e também que o link de cada widget abre para o papel).
import { can, type Action, type Resource } from "@/lib/permissions/rbac";
import type { Role } from "@/types";

/** kpi = número grande; list = pendências com itens; chart = série dos últimos/próximos dias; shortcut = atalho. */
export type HomeWidgetKind = "kpi" | "list" | "chart" | "shortcut";

/** Ícone (a página mapeia para lucide-react; aqui fica só o nome para a lib continuar sem React). */
export type HomeIcon =
  | "alert"
  | "archive"
  | "bank"
  | "box"
  | "calendar"
  | "chart"
  | "clipboard"
  | "clock"
  | "coins"
  | "file"
  | "folder"
  | "headset"
  | "megaphone"
  | "package"
  | "receipt"
  | "shield"
  | "shopping"
  | "tags"
  | "target"
  | "truck"
  | "upload"
  | "user"
  | "userPlus"
  | "users"
  | "wallet"
  | "wrench";

export interface HomeRequirement {
  resource: Resource;
  /** Ação exigida além de ver (padrão: view). Ex.: atalho "Nova admissão" exige create em hr_admin. */
  action?: Action;
}

export interface HomeWidget {
  id: string;
  kind: HomeWidgetKind;
  title: string;
  /** Uma linha sobre o que o número/lista significa. */
  description: string;
  /** Chave do módulo em visibleModules (para o teste conferir que o link abre). */
  module: string;
  /** Para onde o widget leva. */
  path: string;
  /** Tudo o que o papel precisa ter para ver o widget; o primeiro é o recurso principal. */
  requires: readonly HomeRequirement[];
  icon: HomeIcon;
}

const view = (resource: Resource): HomeRequirement => ({ resource });
const act = (action: Action, resource: Resource): HomeRequirement => ({ resource, action });

function widget(id: string, kind: HomeWidgetKind, title: string, description: string, module: string, path: string, requires: HomeRequirement[], icon: HomeIcon): HomeWidget {
  return { id, kind, title, description, module, path, requires, icon };
}

const LIST: HomeWidget[] = [
  // ── Meu RH (todos os papéis) ────────────────────────────────────────────────────────────────────────────────
  widget("hr.vacation", "kpi", "Minhas férias disponíveis", "Saldo do ano: direito menos aprovadas e em análise.", "hr", "/hr", [view("hr_self")], "calendar"),
  widget("hr.myTodos", "kpi", "Minhas pendências de RH", "Itens que o RH pediu para você.", "hr", "/hr", [view("hr_self")], "clipboard"),
  widget("hr.myTimeBank", "kpi", "Meu banco de horas", "Saldo aprovado (extras menos compensações).", "hr", "/hr/banco-de-horas", [view("hr_self")], "clock"),

  // ── Comercial / CRM ───────────────────────────────────────────────────────────────────────────────────────────
  widget("crm.pipeline", "kpi", "Funil em aberto", "Valor das oportunidades abertas e o valor ponderado pela probabilidade.", "crm", "/crm/funil", [view("opportunities"), view("customers")], "target"),
  widget("crm.followups", "list", "Follow-ups vencidos", "Atividades de CRM com prazo passado e ainda não feitas.", "crm", "/crm/atividades", [view("crm_activities"), view("customers")], "alert"),
  widget("crm.openProposals", "kpi", "Propostas em aberto", "Rascunhos e propostas enviadas aguardando o cliente.", "crm", "/crm/propostas", [view("proposals"), view("customers")], "file"),
  widget("crm.customers", "kpi", "Clientes ativos", "Clientes cadastrados e ativos.", "crm", "/crm", [view("customers")], "users"),
  widget("leads.new", "kpi", "Leads novos", "Leads ainda não abordados.", "leads", "/leads", [view("leads")], "megaphone"),
  widget("sales.monthOrders", "kpi", "Vendas do mês", "Pedidos confirmados, faturados ou entregues neste mês.", "sales", "/sales", [view("sales_orders")], "shopping"),
  widget("sales.toApprove", "kpi", "Pedidos de venda em rascunho", "Pedidos ainda não confirmados.", "sales", "/sales", [act("approve", "sales_orders")], "shopping"),
  widget("invoices.open", "kpi", "Faturas em aberto", "Faturas emitidas com saldo a receber.", "sales", "/sales/faturas", [view("invoices"), view("sales_orders")], "receipt"),

  // ── Financeiro ────────────────────────────────────────────────────────────────────────────────────────────────
  widget("fin.overdueReceivables", "kpi", "A receber vencido", "Saldo de contas a receber com vencimento passado.", "finance", "/finance", [view("receivables"), view("finance")], "coins"),
  widget("fin.overduePayables", "kpi", "A pagar vencido", "Saldo de contas a pagar com vencimento passado.", "finance", "/finance", [view("payables"), view("finance")], "wallet"),
  widget("fin.payablesToApprove", "kpi", "Contas a pagar a aprovar", "Contas abertas esperando aprovação.", "finance", "/finance", [act("approve", "payables"), view("finance")], "wallet"),
  widget("fin.dueNext7", "list", "Vencimentos dos próximos 7 dias", "Contas a pagar e a receber que vencem nesta semana.", "finance", "/finance", [view("payables"), view("receivables"), view("finance")], "calendar"),
  widget("fin.cashflow7", "chart", "Fluxo dos próximos 7 dias", "Entradas e saídas previstas por dia (saldo das contas em aberto).", "finance", "/finance/fluxo-de-caixa", [view("finance"), view("payables"), view("receivables")], "chart"),
  widget("bank.pendingReconciliation", "kpi", "Extrato a conciliar", "Lançamentos do extrato ainda sem conta ligada.", "finance", "/finance/conciliacao", [view("bank"), view("finance")], "bank"),

  // ── Estoque e compras ─────────────────────────────────────────────────────────────────────────────────────────
  widget("inv.belowMin", "list", "Itens abaixo do mínimo", "Saldo total menor que o estoque mínimo do item.", "inventory", "/inventory/reposicao", [view("inventory")], "package"),
  widget("inv.openCounts", "kpi", "Inventários em andamento", "Contagens abertas, ainda sem ajuste.", "inventory", "/inventory/inventarios", [view("inventory")], "clipboard"),
  widget("pur.toReceive", "kpi", "Compras a receber", "Pedidos aprovados ou enviados ao fornecedor, ainda não recebidos por completo.", "purchasing", "/purchasing/recebimentos", [view("purchase_orders")], "truck"),
  widget("pur.toApprove", "kpi", "Compras a aprovar", "Pedidos de compra em rascunho.", "purchasing", "/purchasing", [act("approve", "purchase_orders")], "truck"),
  widget("custody.active", "kpi", "Custódias ativas", "Peças retiradas e ainda não devolvidas.", "custody", "/custody", [view("custody")], "archive"),
  widget("catalog.active", "kpi", "Produtos e serviços ativos", "Itens ativos do catálogo de vendas.", "catalog", "/catalog", [view("products")], "tags"),

  // ── Operações, TI e auditoria ─────────────────────────────────────────────────────────────────────────────────
  widget("support.openTickets", "kpi", "Chamados abertos", "Chamados ainda não resolvidos.", "support", "/support", [view("tickets")], "headset"),
  widget("ops.openWorkOrders", "kpi", "OS em aberto", "Ordens de serviço não concluídas nem canceladas.", "operations", "/work-orders", [view("work_orders")], "wrench"),
  widget("ops.week", "chart", "OS abertas nos últimos 7 dias", "Ordens de serviço (e chamados, para a TI) abertas por dia.", "operations", "/work-orders", [view("work_orders")], "chart"),
  widget("audit.recent", "list", "Últimas ações", "Trilha de auditoria e eventos dos módulos que você vê.", "audit", "/audit", [view("audit_logs")], "shield"),

  // ── Projetos e produtos ───────────────────────────────────────────────────────────────────────────────────────
  widget("projects.active", "kpi", "Projetos ativos", "Projetos planejados ou em andamento.", "projects", "/projects", [view("projects")], "folder"),
  widget("tasks.open", "kpi", "Tarefas abertas", "Tarefas de projetos ainda não concluídas.", "projects", "/projects", [view("tasks"), view("projects")], "clipboard"),

  // ── Gestão de RH e folha ──────────────────────────────────────────────────────────────────────────────────────
  widget("hr.pendingRequests", "list", "Solicitações de RH a decidir", "Férias, folgas e atestados aguardando o RH.", "hr_manage", "/hr/manage", [view("hr_admin")], "users"),
  widget("hr.timeBankPending", "kpi", "Horas a aprovar", "Lançamentos de banco de horas pendentes.", "hr_manage", "/hr/manage/banco-de-horas", [view("hr_admin")], "clock"),
  widget("hr.cycle", "kpi", "Admissões e desligamentos", "Colaboradores com checklist de entrada ou saída em aberto.", "hr_manage", "/hr/manage/admissoes", [view("hr_admin")], "userPlus"),
  widget("hr.activeEmployees", "kpi", "Colaboradores ativos", "Cadastro de colaboradores não desligados.", "hr_manage", "/hr/manage", [view("hr_admin")], "users"),
  widget("hr.lateTasks", "kpi", "Pendências de RH em atraso", "Itens pedidos aos colaboradores com prazo vencido.", "hr_manage", "/hr/manage", [view("hr_admin")], "alert"),
  widget("payroll.monthly", "kpi", "Folha mensal", "Soma dos salários base de quem não está desligado.", "payroll", "/payroll", [view("payroll")], "coins"),

  // ── Atalhos ───────────────────────────────────────────────────────────────────────────────────────────────────
  widget("go.newSalesOrder", "shortcut", "Novo pedido de venda", "Criar um pedido para um cliente.", "sales", "/sales/pedidos/nova", [act("create", "sales_orders")], "shopping"),
  widget("go.crmActivities", "shortcut", "Atividades de CRM", "Ligações, reuniões e tarefas de follow-up.", "crm", "/crm/atividades", [view("crm_activities"), view("customers")], "calendar"),
  widget("go.pipeline", "shortcut", "Funil de vendas", "Arrastar oportunidades entre etapas.", "crm", "/crm/funil", [view("opportunities"), view("customers")], "target"),
  widget("go.customers", "shortcut", "Clientes", "Consultar a ficha do cliente.", "crm", "/crm", [view("customers")], "users"),
  widget("go.dre", "shortcut", "DRE", "Resultado do mês por grupo.", "finance", "/finance/dre", [view("finance")], "chart"),
  widget("go.cashflow", "shortcut", "Fluxo de caixa", "Entradas, saídas e saldo por dia.", "finance", "/finance/fluxo-de-caixa", [view("finance")], "chart"),
  widget("go.reconcile", "shortcut", "Conciliação bancária", "Ligar o extrato às contas.", "finance", "/finance/conciliacao", [view("bank"), view("finance")], "bank"),
  widget("go.receive", "shortcut", "Receber mercadoria", "Dar entrada de um pedido de compra.", "purchasing", "/purchasing/recebimentos", [act("receive", "purchase_orders")], "truck"),
  widget("go.transfer", "shortcut", "Transferir estoque", "Mover itens entre locais.", "inventory", "/inventory/transferencias", [act("transfer", "inventory")], "package"),
  widget("go.reorder", "shortcut", "Reposição", "Sugestão de compra pelo ponto de reposição.", "inventory", "/inventory/reposicao", [view("inventory")], "package"),
  widget("go.support", "shortcut", "Abrir chamado", "Pedir ajuda à TI ou registrar um problema.", "support", "/support", [act("create", "tickets")], "headset"),
  widget("go.workOrders", "shortcut", "Ordens de serviço", "Abrir e acompanhar OS.", "operations", "/work-orders", [view("work_orders")], "wrench"),
  widget("go.audit", "shortcut", "Auditoria", "Trilha completa de ações sensíveis.", "audit", "/audit", [view("audit_logs")], "shield"),
  widget("go.reports", "shortcut", "Relatórios", "Vendas, contas, estoque e DRE.", "reports", "/reports", [view("reports")], "chart"),
  widget("go.imports", "shortcut", "Importar planilhas", "Trazer dados de CSV ou Excel.", "imports", "/imports", [act("create", "imports")], "upload"),
  widget("go.documents", "shortcut", "Documentos", "Arquivos e versões da empresa.", "documents", "/documents", [view("documents")], "file"),
  widget("go.projects", "shortcut", "Project Manager", "Projetos, etapas e quadro de tarefas.", "projects", "/projects", [view("projects")], "folder"),
  widget("go.productDev", "shortcut", "Desenvolvimento de produtos", "Iniciativas e próximos marcos.", "products", "/products", [view("product_development")], "box"),
  widget("go.admission", "shortcut", "Nova admissão", "Cadastrar quem está entrando, com checklist.", "hr_manage", "/hr/manage/admissoes", [act("create", "hr_admin")], "userPlus"),
  widget("go.timeBank", "shortcut", "Banco de horas da equipe", "Lançar e aprovar horas.", "hr_manage", "/hr/manage/banco-de-horas", [view("hr_admin")], "clock"),
  widget("go.users", "shortcut", "Usuários e acessos", "Criar contas e trocar papéis.", "settings", "/settings", [act("create", "users"), view("settings")], "user"),
  widget("go.backup", "shortcut", "Backup e restauração", "Cópia do banco e dos arquivos.", "settings", "/settings/backup", [view("backups"), view("settings")], "archive"),
];

/** Catálogo de widgets por id. */
export const HOME_WIDGETS: Readonly<Record<string, HomeWidget>> = Object.fromEntries(LIST.map((item) => [item.id, item]));

/** Meu RH: vem em toda home (é o único recurso comum a todos os papéis). */
const PERSONAL = ["hr.vacation", "hr.myTodos", "hr.myTimeBank"] as const;

/** Widgets por papel, na ordem em que aparecem (indicadores, listas, gráfico e atalhos são agrupados na tela). */
export const ROLE_HOMES: Readonly<Record<Role, readonly string[]>> = {
  ceo: [
    "fin.overdueReceivables", "fin.overduePayables", "sales.monthOrders", "crm.pipeline", "payroll.monthly", "hr.activeEmployees", "ops.openWorkOrders", "projects.active",
    "inv.belowMin", "hr.pendingRequests", "fin.cashflow7", "audit.recent",
    "go.reports", "go.dre", "go.users", "go.backup",
    ...PERSONAL,
  ],
  admin: [
    "fin.overdueReceivables", "fin.overduePayables", "fin.payablesToApprove", "payroll.monthly", "hr.activeEmployees", "ops.openWorkOrders",
    "hr.pendingRequests", "audit.recent", "fin.dueNext7",
    "go.users", "go.backup", "go.imports", "go.reports",
    ...PERSONAL,
  ],
  gerente: [
    "crm.pipeline", "sales.monthOrders", "sales.toApprove", "pur.toApprove", "fin.payablesToApprove", "ops.openWorkOrders", "projects.active",
    "crm.followups", "fin.dueNext7", "ops.week",
    "go.pipeline", "go.reports", "go.imports", "go.documents",
    ...PERSONAL,
  ],
  tecnico: [
    "support.openTickets", "ops.openWorkOrders", "custody.active", "tasks.open",
    "audit.recent", "ops.week",
    "go.workOrders", "go.support", "go.audit", "go.documents",
    ...PERSONAL,
  ],
  estoquista: [
    "pur.toReceive", "inv.openCounts", "custody.active", "catalog.active",
    "inv.belowMin",
    "go.receive", "go.transfer", "go.reorder", "go.imports",
    ...PERSONAL,
  ],
  financeiro: [
    "fin.overdueReceivables", "fin.overduePayables", "fin.payablesToApprove", "invoices.open", "bank.pendingReconciliation",
    "fin.dueNext7", "fin.cashflow7",
    "go.cashflow", "go.dre", "go.reconcile", "go.reports", "go.imports",
    ...PERSONAL,
  ],
  rh: [
    "hr.timeBankPending", "hr.cycle", "hr.activeEmployees", "hr.lateTasks",
    "hr.pendingRequests",
    "go.admission", "go.timeBank", "go.imports", "go.documents",
    ...PERSONAL,
  ],
  comercial: [
    "crm.pipeline", "crm.openProposals", "sales.monthOrders", "leads.new", "crm.customers",
    "crm.followups",
    "go.newSalesOrder", "go.pipeline", "go.crmActivities", "go.imports",
    ...PERSONAL,
  ],
  atendimento: [
    "support.openTickets", "ops.openWorkOrders", "crm.customers",
    "crm.followups",
    "go.support", "go.workOrders", "go.customers", "go.documents",
    ...PERSONAL,
  ],
  produtos: [
    "projects.active", "tasks.open", "catalog.active",
    "go.productDev", "go.projects", "go.imports", "go.documents",
    ...PERSONAL,
  ],
  auditor: [
    "fin.overdueReceivables", "fin.overduePayables", "invoices.open", "bank.pendingReconciliation", "ops.openWorkOrders",
    "audit.recent", "inv.belowMin",
    "go.audit", "go.reports", "go.documents",
    ...PERSONAL,
  ],
};

/** Subtítulo da home de cada setor. */
export const ROLE_HOME_INTRO: Readonly<Record<Role, string>> = {
  ceo: "Visão geral: caixa, vendas, funil, pessoas e operação.",
  admin: "Administração: contas a pagar, pessoas, acessos e backup.",
  gerente: "Gerência: funil, aprovações de vendas, compras e contas, e a operação.",
  tecnico: "TI e operações: chamados, ordens de serviço, custódias e trilha de ações.",
  estoquista: "Estoque: reposição, recebimentos, inventários e custódias.",
  financeiro: "Financeiro: vencidos, aprovações, faturas, conciliação e fluxo da semana.",
  rh: "Recursos Humanos: solicitações, banco de horas, admissões e desligamentos.",
  comercial: "Comercial: funil, follow-ups, propostas e vendas do mês.",
  atendimento: "Atendimento: chamados, ordens de serviço e clientes.",
  produtos: "Produtos: projetos, tarefas e catálogo.",
  auditor: "Auditoria: últimas ações, vencidos, faturas e conciliação.",
};

/** O papel tem cada permissão que o widget exige (view no recurso e a ação pedida). */
export function widgetVisible(role: Role, item: HomeWidget): boolean {
  return item.requires.length > 0 && item.requires.every((requirement) => can(role, "view", requirement.resource) && can(role, requirement.action ?? "view", requirement.resource));
}

/** Widget do Meu RH (dados do próprio colaborador), mostrado à parte dos do setor. */
export function isPersonalWidget(item: HomeWidget): boolean {
  return item.requires.every((requirement) => requirement.resource === "hr_self");
}

/** Widgets de RH e folha (consultas invalidadas pelas telas de RH e da folha: queryKey ["hr", ...]). */
export function isHrWidget(item: HomeWidget): boolean {
  return item.requires.some((requirement) => requirement.resource === "hr_self" || requirement.resource === "hr_admin" || requirement.resource === "payroll");
}

/** Home do papel: os widgets configurados, sempre filtrados pelo RBAC. */
export function roleHome(role: Role): HomeWidget[] {
  return (ROLE_HOMES[role] ?? []).map((id) => HOME_WIDGETS[id]).filter((item): item is HomeWidget => !!item && widgetVisible(role, item));
}
