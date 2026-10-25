// Subpáginas dos módulos: rotas além da raiz de cada módulo. Fonte única para routes.tsx (rota + guarda de
// permissão), ModuleNav (abas no topo do módulo) e CommandMenu (busca). Cada subpágina já tem uma página provisória
// em src/modules/<módulo>/pages/; a tarefa de cada módulo troca o conteúdo da página sem mexer aqui.
// Rotas de lista ganham "/*" (subrotas ficam num <Routes> dentro da página); rotas com ":id" são detalhes e não
// aparecem nas abas nem na busca (":id" = "nova" abre o formulário de criação, quando a página tiver).
import { can, visibleModules, type Action, type Resource } from "@/lib/permissions/rbac";
import type { Role } from "@/types";

/** Permissão exigida além de ver o módulo (ação padrão: view). */
export interface Requirement {
  resource: Resource;
  action?: Action;
}

/** Módulo com abas: a raiz (já em routes.tsx com RequireModule) é a primeira aba. */
export interface ModuleSection {
  /** Chave em visibleModules. */
  module: string;
  /** Nome do módulo (rótulo da navegação e prefixo na busca). */
  title: string;
  rootPath: string;
  rootLabel: string;
}

export interface Subpage {
  module: string;
  /** Rota absoluta, dentro de rootPath do módulo. */
  path: string;
  /** Arquivo em src/modules (default export com o mesmo nome do arquivo). */
  page: string;
  /** Rótulo da aba e do comando de busca. */
  label: string;
  requires: readonly Requirement[];
}

export const MODULE_SECTIONS: readonly ModuleSection[] = [
  { module: "crm", title: "CRM", rootPath: "/crm", rootLabel: "Clientes" },
  { module: "catalog", title: "Catálogo", rootPath: "/catalog", rootLabel: "Produtos e serviços" },
  { module: "sales", title: "Vendas", rootPath: "/sales", rootLabel: "Pedidos de venda" },
  { module: "purchasing", title: "Compras", rootPath: "/purchasing", rootLabel: "Pedidos de compra" },
  { module: "inventory", title: "Estoque", rootPath: "/inventory", rootLabel: "Itens e saldos" },
  { module: "finance", title: "Financeiro", rootPath: "/finance", rootLabel: "Contas a pagar e receber" },
  { module: "hr", title: "Meu RH", rootPath: "/hr", rootLabel: "Meu RH" },
  { module: "hr_manage", title: "Gestão de RH", rootPath: "/hr/manage", rootLabel: "Gestão de RH" },
  { module: "imports", title: "Importar dados", rootPath: "/imports", rootLabel: "Nova importação" },
  { module: "reports", title: "Relatórios", rootPath: "/reports", rootLabel: "Visão geral" },
  { module: "settings", title: "Configurações", rootPath: "/settings", rootLabel: "Geral" },
];

const view = (resource: Resource): Requirement => ({ resource });

export const SUBPAGES: readonly Subpage[] = [
  // CRM (Tarefa 7)
  { module: "crm", path: "/crm/clientes/:id", page: "crm/pages/CustomerDetailPage.tsx", label: "Ficha do cliente", requires: [view("customers")] },
  { module: "crm", path: "/crm/contatos", page: "crm/pages/ContactsPage.tsx", label: "Contatos", requires: [view("customers")] },
  { module: "crm", path: "/crm/funil", page: "crm/pages/PipelineBoardPage.tsx", label: "Funil de vendas", requires: [view("opportunities")] },
  { module: "crm", path: "/crm/propostas", page: "crm/pages/ProposalsPage.tsx", label: "Propostas", requires: [view("proposals")] },
  { module: "crm", path: "/crm/propostas/:id", page: "crm/pages/ProposalEditorPage.tsx", label: "Proposta", requires: [view("proposals")] },
  { module: "crm", path: "/crm/atividades", page: "crm/pages/ActivitiesPage.tsx", label: "Atividades", requires: [view("crm_activities")] },
  { module: "crm", path: "/crm/duplicados", page: "crm/pages/DuplicatesPage.tsx", label: "Duplicados", requires: [{ resource: "customers", action: "edit" }] },

  // Catálogo, vendas e compras (Tarefa 8)
  { module: "catalog", path: "/catalog/tabelas-de-preco", page: "catalog/pages/PriceListsPage.tsx", label: "Tabelas de preço", requires: [view("products")] },
  { module: "sales", path: "/sales/pedidos/:id", page: "sales/pages/SalesOrderPage.tsx", label: "Pedido de venda", requires: [view("sales_orders")] },
  { module: "sales", path: "/sales/faturas", page: "sales/pages/InvoicesPage.tsx", label: "Faturas", requires: [view("invoices")] },
  { module: "sales", path: "/sales/faturas/:id", page: "sales/pages/InvoicePage.tsx", label: "Fatura", requires: [view("invoices")] },
  { module: "purchasing", path: "/purchasing/pedidos/:id", page: "purchasing/pages/PurchaseOrderPage.tsx", label: "Pedido de compra", requires: [view("purchase_orders")] },
  { module: "purchasing", path: "/purchasing/recebimentos", page: "purchasing/pages/GoodsReceiptsPage.tsx", label: "Recebimentos", requires: [view("purchase_orders")] },
  { module: "purchasing", path: "/purchasing/fornecedores", page: "purchasing/pages/SuppliersPage.tsx", label: "Fornecedores", requires: [view("suppliers")] },

  // Estoque (Tarefa 8)
  { module: "inventory", path: "/inventory/movimentacoes", page: "inventory/pages/StockMovementsPage.tsx", label: "Movimentações", requires: [view("inventory")] },
  { module: "inventory", path: "/inventory/transferencias", page: "inventory/pages/StockTransfersPage.tsx", label: "Transferências", requires: [view("inventory")] },
  { module: "inventory", path: "/inventory/inventarios", page: "inventory/pages/InventoryCountsPage.tsx", label: "Inventário", requires: [view("inventory")] },
  { module: "inventory", path: "/inventory/inventarios/:id", page: "inventory/pages/InventoryCountPage.tsx", label: "Contagem de inventário", requires: [view("inventory")] },
  { module: "inventory", path: "/inventory/reposicao", page: "inventory/pages/ReorderPage.tsx", label: "Reposição", requires: [view("inventory")] },
  { module: "inventory", path: "/inventory/locais", page: "inventory/pages/StockLocationsPage.tsx", label: "Locais", requires: [view("inventory")] },

  // Financeiro (Tarefa 8)
  { module: "finance", path: "/finance/fluxo-de-caixa", page: "finance/pages/CashflowPage.tsx", label: "Fluxo de caixa", requires: [view("finance")] },
  { module: "finance", path: "/finance/dre", page: "finance/pages/DrePage.tsx", label: "DRE", requires: [view("finance")] },
  { module: "finance", path: "/finance/contas-bancarias", page: "finance/pages/BankAccountsPage.tsx", label: "Contas bancárias", requires: [view("bank")] },
  { module: "finance", path: "/finance/conciliacao", page: "finance/pages/ReconciliationPage.tsx", label: "Conciliação", requires: [view("bank")] },
  { module: "finance", path: "/finance/categorias", page: "finance/pages/FinanceCategoriesPage.tsx", label: "Plano de contas", requires: [view("finance")] },
  { module: "finance", path: "/finance/recorrentes", page: "finance/pages/RecurringEntriesPage.tsx", label: "Recorrências", requires: [view("finance")] },

  // RH (Tarefa 9): banco de horas do próprio colaborador e gestão (ficha, banco de horas da equipe, admissões)
  { module: "hr", path: "/hr/banco-de-horas", page: "hr/pages/MyTimeBankPage.tsx", label: "Banco de horas", requires: [view("hr_self")] },
  { module: "hr_manage", path: "/hr/manage/colaboradores/:id", page: "hr/pages/EmployeeDetailPage.tsx", label: "Colaborador", requires: [view("hr_admin")] },
  { module: "hr_manage", path: "/hr/manage/banco-de-horas", page: "hr/pages/TimeBankPage.tsx", label: "Banco de horas", requires: [view("hr_admin")] },
  { module: "hr_manage", path: "/hr/manage/admissoes", page: "hr/pages/EmploymentCyclePage.tsx", label: "Admissões e desligamentos", requires: [view("hr_admin")] },

  // Importação (Tarefa 5)
  { module: "imports", path: "/imports/historico", page: "imports/pages/ImportHistoryPage.tsx", label: "Histórico", requires: [view("imports")] },

  // Relatórios (Tarefa 10): cada um também exige ver os dados de origem
  { module: "reports", path: "/reports/vendas", page: "reports/pages/SalesReportPage.tsx", label: "Vendas", requires: [view("reports"), view("sales_orders")] },
  { module: "reports", path: "/reports/contas", page: "reports/pages/AgingReportPage.tsx", label: "Contas a receber e a pagar", requires: [view("reports"), view("finance")] },
  { module: "reports", path: "/reports/estoque", page: "reports/pages/StockReportPage.tsx", label: "Giro de estoque", requires: [view("reports"), view("inventory")] },
  { module: "reports", path: "/reports/dre", page: "reports/pages/DreReportPage.tsx", label: "DRE", requires: [view("reports"), view("finance")] },

  // Área da empresa (redesign, Tarefa 2): perfil de área e rótulos de cards, gráficos e módulos
  { module: "settings", path: "/settings/area", page: "settings/pages/AreaProfilePage.tsx", label: "Área da empresa", requires: [view("settings")] },

  // Backup e restauração (Tarefa 10)
  { module: "settings", path: "/settings/backup", page: "settings/pages/BackupPage.tsx", label: "Backup e restauração", requires: [view("backups")] },
];

/** Detalhe (rota com parâmetro): fora das abas e da busca. */
export function isDetailPage(page: Subpage): boolean {
  return page.path.includes(":");
}

/** Caminho da rota: listas aceitam subrotas ("/*"); detalhes não. */
export function subpageRoutePath(page: Subpage): string {
  return isDetailPage(page) ? page.path : `${page.path}/*`;
}

export function sectionOf(module: string): ModuleSection | undefined {
  return MODULE_SECTIONS.find((section) => section.module === module);
}

function within(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

/** Seção da URL atual: a raiz mais longa que contém a URL (/hr/manage vence /hr). */
export function sectionForPath(pathname: string): ModuleSection | undefined {
  return MODULE_SECTIONS.filter((section) => within(pathname, section.rootPath)).sort((a, b) => b.rootPath.length - a.rootPath.length)[0];
}

/** Abre a subpágina quem vê o módulo e tem cada permissão exigida. */
export function canOpenSubpage(role: Role, page: Subpage): boolean {
  return visibleModules(role).includes(page.module) && page.requires.every((item) => can(role, item.action ?? "view", item.resource));
}

export interface ModuleNavItem {
  path: string;
  label: string;
}

/** Abas do módulo para o papel: a raiz e as subpáginas de lista que ele abre. Vazio se não vê o módulo. */
export function moduleNavItems(role: Role, module: string): ModuleNavItem[] {
  const section = sectionOf(module);
  if (!section || !visibleModules(role).includes(module)) return [];
  const pages = SUBPAGES.filter((page) => page.module === module && !isDetailPage(page) && canOpenSubpage(role, page));
  return [{ path: section.rootPath, label: section.rootLabel }, ...pages.map(({ path, label }) => ({ path, label }))];
}

/** Aba ativa: o caminho mais longo que contém a URL (o detalhe acende a lista dele). */
export function activeNavPath(paths: readonly string[], pathname: string): string | null {
  return paths.filter((path) => within(pathname, path)).sort((a, b) => b.length - a.length)[0] ?? null;
}
