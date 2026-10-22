const STORAGE_KEY = "cm_demo_database_v4";
const COMPANY_ID = "demo-company";
const ADMIN_ID = "demo-admin";

type Row = Record<string, unknown>;

export const DEMO_ACCOUNTS = [
  { id: ADMIN_ID, role: "admin", area: "Administracao", position: "Administrador", name: "Mariana Costa", email: "admin@techflow.com", password: "demo123" },
  { id: "demo-gerente", role: "gerente", area: "Gerencia Geral", position: "Gerente geral", name: "Ricardo Almeida", email: "gerencia@techflow.com", password: "demo123" },
  { id: "demo-tecnico-gerente", role: "tecnico", area: "TI / Operacoes", position: "Gerente do setor", name: "Renata Carvalho", email: "gerente.ti@techflow.com", password: "demo123" },
  { id: "demo-tecnico", role: "tecnico", area: "TI / Operacoes", position: "Funcionario", name: "Lucas Ribeiro", email: "ti@techflow.com", password: "demo123" },
  { id: "demo-estoquista-gerente", role: "estoquista", area: "Estoque", position: "Gerente do setor", name: "Rafael Moraes", email: "gerente.estoque@techflow.com", password: "demo123" },
  { id: "demo-estoquista", role: "estoquista", area: "Estoque", position: "Funcionario", name: "Patricia Gomes", email: "estoque@techflow.com", password: "demo123" },
  { id: "demo-financeiro-gerente", role: "financeiro", area: "Contabilidade / Financeiro", position: "Gerente do setor", name: "Carlos Mendes", email: "gerente.financeiro@techflow.com", password: "demo123" },
  { id: "demo-financeiro", role: "financeiro", area: "Contabilidade / Financeiro", position: "Funcionario", name: "Fernanda Lima", email: "financeiro@techflow.com", password: "demo123" },
  { id: "demo-comercial-gerente", role: "comercial", area: "Comercial", position: "Gerente do setor", name: "Diego Oliveira", email: "gerente.comercial@techflow.com", password: "demo123" },
  { id: "demo-comercial", role: "comercial", area: "Comercial", position: "Funcionario", name: "Camila Martins", email: "comercial@techflow.com", password: "demo123" },
  { id: "demo-atendimento-gerente", role: "atendimento", area: "Atendimento", position: "Gerente do setor", name: "Juliana Castro", email: "gerente.atendimento@techflow.com", password: "demo123" },
  { id: "demo-atendimento", role: "atendimento", area: "Atendimento", position: "Funcionario", name: "Joao Santos", email: "atendimento@techflow.com", password: "demo123" },
  { id: "demo-produtos-gerente", role: "produtos", area: "Desenvolvimento de Produtos", position: "Gerente do setor", name: "Aline Rocha", email: "gerente.produtos@techflow.com", password: "demo123" },
  { id: "demo-produtos", role: "produtos", area: "Desenvolvimento de Produtos", position: "Funcionario", name: "Bruno Martins", email: "produtos@techflow.com", password: "demo123" },
  { id: "demo-auditor-gerente", role: "auditor", area: "Auditoria", position: "Gerente do setor", name: "Marcelo Nunes", email: "gerente.auditoria@techflow.com", password: "demo123" },
  { id: "demo-auditor", role: "auditor", area: "Auditoria", position: "Funcionario", name: "Beatriz Souza", email: "auditoria@techflow.com", password: "demo123" },
] as const;

interface DemoTables {
  companies: Row[];
  users: Row[];
  memberships: Row[];
  customers: Row[];
  opportunities: Row[];
  tickets: Row[];
  work_orders: Row[];
  projects: Row[];
  inventory_items: Row[];
  suppliers: Row[];
  stock_balances: Row[];
  custodies: Row[];
  payables: Row[];
  receivables: Row[];
  documents: Row[];
  activities: Row[];
  audit_logs: Row[];
  // Tabelas da migration 0003 (+ tasks). Nascem vazias; o seed vem de lib/prospecting/seed.ts.
  leads: Row[];
  service_packages: Row[];
  package_prices: Row[];
  revenue_scenarios: Row[];
  revenue_forecasts: Row[];
  settings: Row[];
  tasks: Row[];
  project_stages: Row[];
}

const EXTRA_TABLES = ["leads", "service_packages", "package_prices", "revenue_scenarios", "revenue_forecasts", "settings", "tasks", "project_stages"] as const;

export interface DatabaseLike {
  select<T>(query: string, bindValues?: unknown[]): Promise<T>;
  execute(query: string, bindValues?: unknown[]): Promise<unknown>;
}

function iso(daysFromToday = 0, hour = 9): string {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

function createSeed(): DemoTables {
  return {
    companies: [
      {
        id: COMPANY_ID,
        name: "TechFlow Solucoes Empresariais",
        document: "12.345.678/0001-90",
        settings_json: "{}",
        created_at: iso(-365),
        updated_at: iso(-2),
        deleted_at: null,
      },
    ],
    users: DEMO_ACCOUNTS.map((account) => ({
      id: account.id,
      name: account.name,
      email: account.email,
      password_hash: `plain:${account.password}`,
      status: "active",
      locale: "pt-BR",
      last_login_at: iso(-1),
      created_at: iso(-365),
      updated_at: iso(-2),
      deleted_at: null,
    })),
    memberships: DEMO_ACCOUNTS.map((account) => ({
      id: `demo-membership-${account.id}`,
      company_id: COMPANY_ID,
      user_id: account.id,
      role: account.role,
      scope: account.role === "gerente" || account.role === "admin" ? "empresa" : "setor",
      created_at: iso(-365),
      updated_at: iso(-2),
      deleted_at: null,
    })),
    customers: [
      customer("customer-1", "NorteLog Transportes", "contato@nortelog.com.br", "(11) 3020-1188", -190),
      customer("customer-2", "Hospital Sao Lucas", "infra@saolucas.com.br", "(11) 4002-8922", -165),
      customer("customer-3", "Grupo Horizonte", "operacoes@horizonte.com.br", "(21) 3122-9090", -130),
      customer("customer-4", "Mercado Central", "administrativo@mercadocentral.com.br", "(31) 3222-7811", -92),
      customer("customer-5", "Conecta Educacao", "ti@conecta.edu.br", "(41) 3333-0198", -74),
      customer("customer-6", "Almeida & Ramos Consultoria", "contato@almeidaramos.com.br", "(51) 3021-5500", -48),
      customer("customer-7", "Studio Aurora", "financeiro@studioaurora.com.br", "(11) 99642-7100", -21, "PF"),
      customer("customer-8", "Viva Condominios", "atendimento@vivacondominios.com.br", "(19) 3234-2233", -8),
    ],
    opportunities: [
      opportunity("opp-1", "Expansao de rede - Hospital Sao Lucas", 78000, "proposta", 65, 12),
      opportunity("opp-2", "Contrato de suporte NorteLog", 36000, "negociacao", 80, 7),
      opportunity("opp-3", "Implantacao ERP Grupo Horizonte", 124000, "qualificacao", 35, 28),
      opportunity("opp-4", "Renovacao parque de maquinas", 48500, "novo", 20, 40),
      opportunity("opp-5", "Projeto Wi-Fi corporativo", 29500, "ganho", 100, -4),
      opportunity("opp-6", "Help desk mensal Conecta", 18500, "perdido", 0, -12),
    ],
    tickets: [
      ticket("ticket-1", "Oscilacao no link da matriz", "alta", "em_atendimento", -1, "customer-1", "TI / Operacoes", "demo-tecnico", null),
      ticket("ticket-2", "Impressora do financeiro sem conexao", "media", "aberto", -2, "customer-4", "Contabilidade / Financeiro", "demo-financeiro"),
      ticket("ticket-3", "Liberacao de acesso para novo colaborador", "baixa", "aguardando", -3, "customer-3", "Comercial", "demo-comercial"),
      ticket("ticket-4", "Servidor de arquivos indisponivel", "urgente", "resolvido", -5, "customer-2", "Atendimento", "demo-atendimento", "wo-2"),
      ticket("ticket-5", "Atualizacao dos terminais de atendimento", "media", "aberto", -6, "customer-5", "Atendimento", "demo-atendimento"),
      ticket("ticket-6", "Falha intermitente no backup", "alta", "fechado", -9, "customer-1", "Gerencia", "demo-gerente", "wo-3"),
    ],
    work_orders: [
      workOrder("wo-1", "OS-0001", "em_execucao", "alta", -3, 680, 240, "customer-1"),
      workOrder("wo-2", "OS-0002", "concluida", "urgente", -5, 920, 1350, "customer-2"),
      workOrder("wo-3", "OS-0003", "concluida", "alta", -9, 480, 0, "customer-1"),
      workOrder("wo-4", "OS-0004", "aguardando_peca", "media", -2, 120, 0, "customer-4"),
      workOrder("wo-5", "OS-0005", "atribuida", "baixa", -1, 0, 0, "customer-5"),
    ],
    projects: [
      project("project-1", "Modernizacao da infraestrutura NorteLog", "andamento", 145000, -45, 45),
      project("project-2", "Implantacao de chamados Conecta", "planejado", 42000, 7, 70),
      project("project-3", "Wi-Fi corporativo Mercado Central", "concluido", 29500, -80, -4),
      project("project-4", "Datacenter contingencia Grupo Horizonte", "pausado", 97000, -30, 60),
    ],
    inventory_items: [
      inventory("item-1", "Cabo de rede Cat6 - caixa 305m", "CAB-CAT6-305", "Cabos", "cx", 4, 890, "supplier-1"),
      inventory("item-2", "Switch gerenciavel 24 portas", "SW-GER-24", "Rede", "un", 3, 2180, "supplier-1"),
      inventory("item-3", "Access Point Wi-Fi 6", "AP-WIFI6", "Rede", "un", 5, 1240, "supplier-2"),
      inventory("item-4", "SSD NVMe 1 TB", "SSD-NVME-1T", "Armazenamento", "un", 6, 520, "supplier-3"),
      inventory("item-5", "Mouse USB corporativo", "MOUSE-USB", "Perifericos", "un", 10, 48, "supplier-3"),
      inventory("item-6", "Nobreak 1200 VA", "NOB-1200", "Energia", "un", 2, 930, "supplier-2"),
    ],
    suppliers: [
      supplier("supplier-1", "NetPrime Distribuidora", "41.805.229/0001-18", "vendas@netprime.com.br", "(11) 3090-8890", "Pagamento em 28 dias", 5),
      supplier("supplier-2", "InfraSafe Equipamentos", "22.680.114/0001-07", "comercial@infrasafe.com.br", "(11) 4102-7721", "Pagamento em 21 dias", 4),
      supplier("supplier-3", "ByteCenter Tecnologia", "08.214.665/0001-42", "pedidos@bytecenter.com.br", "(19) 3321-1190", "Pagamento em 35 dias", 4),
    ],
    stock_balances: [
      balance("balance-1", "item-1", 7),
      balance("balance-2", "item-2", 2),
      balance("balance-3", "item-3", 4),
      balance("balance-4", "item-4", 11),
      balance("balance-5", "item-5", 28),
      balance("balance-6", "item-6", 1),
    ],
    custodies: [
      custody("custody-1", "item-2", 1, "em_custodia", -3, 2),
      custody("custody-2", "item-3", 2, "em_custodia", -2, 5),
      custody("custody-3", "item-1", 1, "consumido", -8, null),
    ],
    payables: [
      payable("pay-1", "Licencas de software - mensalidade", 4850, "aberta", 5),
      payable("pay-2", "Compra de equipamentos de rede", 12740, "aprovada", 9),
      payable("pay-3", "Aluguel do escritorio", 6800, "paga", -3),
      payable("pay-4", "Servicos contabeis", 1900, "aberta", 12),
    ],
    receivables: [
      receivable("rec-1", "Contrato NorteLog - parcela 5/12", 12500, "aberta", 4),
      receivable("rec-2", "Projeto Wi-Fi Mercado Central", 14750, "aberta", 8),
      receivable("rec-3", "Suporte Hospital Sao Lucas", 8900, "recebida", -4),
      receivable("rec-4", "Consultoria Grupo Horizonte", 22000, "aberta", 15),
    ],
    documents: [
      documentRow("doc-1", "Contrato de suporte NorteLog.pdf", "PDF", 2, -15, "/Comercial/Contratos/Contrato de suporte NorteLog.pdf"),
      documentRow("doc-2", "Relatorio tecnico - servidor Hospital Sao Lucas.pdf", "PDF", 1, -5, "/TI e Operacoes/Relatorios/Relatorio tecnico - servidor Hospital Sao Lucas.pdf"),
      documentRow("doc-3", "Proposta comercial Grupo Horizonte.pdf", "PDF", 3, -3, "/Comercial/Propostas/Proposta comercial Grupo Horizonte.pdf"),
      documentRow("doc-4", "Checklist de instalacao Wi-Fi.docx", "DOCX", 1, -1, "/TI e Operacoes/Checklists/Checklist de instalacao Wi-Fi.docx"),
      documentRow("doc-5", "Fechamento mensal - abril.xlsx", "XLSX", 1, -8, "/Financeiro/Fechamentos/Fechamento mensal - abril.xlsx"),
      documentRow("doc-6", "Notas fiscais de entrada - maio.zip", "ZIP", 1, -6, "/Financeiro/Notas fiscais/Notas fiscais de entrada - maio.zip"),
      documentRow("doc-7", "Inventario de ativos.xlsx", "XLSX", 4, -4, "/Estoque/Inventarios/Inventario de ativos.xlsx"),
      documentRow("doc-8", "Tabela de fornecedores.xlsx", "XLSX", 2, -7, "/Estoque/Fornecedores/Tabela de fornecedores.xlsx"),
      documentRow("doc-9", "Manual de onboarding.pdf", "PDF", 1, -30, "/Compartilhados/Guias/Manual de onboarding.pdf"),
      documentRow("doc-10", "Politica de seguranca.pdf", "PDF", 2, -12, "/Compartilhados/Politicas/Politica de seguranca.pdf"),
      documentRow("doc-11", "Procedimento de triagem.docx", "DOCX", 3, -2, "/Atendimento/Processos/Procedimento de triagem.docx"),
      documentRow("doc-12", "Relatorio de auditoria Q1.pdf", "PDF", 1, -14, "/Auditoria/Relatorios/Relatorio de auditoria Q1.pdf"),
      documentRow("doc-13", "Roadmap de produtos Q3.xlsx", "XLSX", 2, -3, "/Desenvolvimento de Produtos/Roadmaps/Roadmap de produtos Q3.xlsx"),
      documentRow("doc-14", "Especificacao gateway industrial.pdf", "PDF", 1, -5, "/Desenvolvimento de Produtos/Especificacoes/Especificacao gateway industrial.pdf"),
    ],
    activities: [
      ticketActivity("activity-1", "ticket-1", "ticket.created", "Ticket aberto pela area de TI / Operacoes", "demo-tecnico", -1, 8),
      ticketActivity("activity-2", "ticket-1", "ticket.assigned", "Lucas Ribeiro assumiu o atendimento", "demo-tecnico", -1, 9),
      ticketActivity("activity-3", "ticket-1", "ticket.diagnosis", "Verificado historico de quedas e perda de pacotes no roteador principal.", "demo-tecnico", -1, 10),
      ticketActivity("activity-4", "ticket-1", "ticket.action", "Atualizado firmware do roteador e ajustado failover do link secundario.", "demo-tecnico", -1, 11),
      ticketActivity("activity-5", "ticket-4", "ticket.created", "Ticket aberto pela area de Atendimento", "demo-atendimento", -5, 8),
      ticketActivity("activity-6", "ticket-4", "ticket.diagnosis", "Identificado volume com falha apos queda de energia.", "demo-tecnico", -5, 9),
      ticketActivity("activity-7", "ticket-4", "ticket.resolved", "Volume reparado, servico validado e acesso normalizado.", "demo-tecnico", -5, 12),
    ],
    audit_logs: [
      audit("audit-1", "user.login", "user", -1),
      audit("audit-2", "payable.approved", "payable", -2),
      audit("audit-3", "document.downloaded", "document", -3),
      audit("audit-4", "work_order.closed", "work_order", -5),
      audit("audit-5", "settings.updated", "settings", -8),
    ],
    leads: [],
    service_packages: [],
    package_prices: [],
    revenue_scenarios: [],
    revenue_forecasts: [],
    settings: [],
    tasks: [],
    project_stages: [],
  };
}

function base(id: string, extra: Row, createdDays = -20): Row {
  return { id, company_id: COMPANY_ID, ...extra, created_at: iso(createdDays), updated_at: iso(createdDays), deleted_at: null };
}

function customer(id: string, name: string, email: string, phone: string, days: number, type = "PJ"): Row {
  return base(id, { type, name, email, phone, document: null, address_json: "{}", status: "active" }, days);
}

function opportunity(id: string, title: string, value: number, stage: string, probability: number, closeDays: number): Row {
  return base(id, { title, value, stage, probability, expected_close_date: iso(closeDays), status: stage === "ganho" ? "won" : stage === "perdido" ? "lost" : "open" });
}

function ticket(id: string, subject: string, priority: string, status: string, days: number, customerId: string, requesterArea: string, openedBy: string, workOrderId: string | null = null): Row {
  return base(id, { customer_id: customerId, subject, description: "Chamado registrado para acompanhamento da equipe tecnica.", channel: "portal", priority, status, agent_id: "demo-tecnico", opened_by: openedBy, requester_area: requesterArea, work_order_id: workOrderId }, days);
}

function workOrder(id: string, number: string, status: string, priority: string, days: number, laborCost: number, materialsCost: number, customerId: string): Row {
  return base(id, { number, status, priority, customer_id: customerId, technician_id: ADMIN_ID, opened_at: iso(days), checklist_json: "[]", labor_cost: laborCost, materials_cost: materialsCost }, days);
}

function project(id: string, name: string, status: string, budget: number, startDays: number, endDays: number): Row {
  return base(id, { name, status, budget, start_date: iso(startDays), end_date: iso(endDays), owner_id: ADMIN_ID }, startDays);
}

function inventory(id: string, name: string, sku: string, category: string, unit: string, minStock: number, cost: number, supplierId: string): Row {
  return base(id, { name, sku, category, unit, min_stock: minStock, max_stock: minStock * 4, cost, supplier_id: supplierId });
}

function supplier(id: string, name: string, document: string, email: string, phone: string, terms: string, rating: number): Row {
  return base(id, { name, document, email, phone, terms, rating });
}

function balance(id: string, itemId: string, quantity: number): Row {
  return { id, company_id: COMPANY_ID, item_id: itemId, location_id: "demo-stock-location", quantity, updated_at: iso(-1) };
}

function custody(id: string, itemId: string, quantity: number, status: string, checkedOutDays: number, dueDays: number | null): Row {
  return base(id, { item_id: itemId, holder_id: ADMIN_ID, quantity, status, checked_out_at: iso(checkedOutDays), due_back_at: dueDays === null ? null : iso(dueDays) }, checkedOutDays);
}

function payable(id: string, description: string, amount: number, status: string, dueDays: number): Row {
  return base(id, { description, amount, status, due_date: iso(dueDays) });
}

function receivable(id: string, refId: string, amount: number, status: string, dueDays: number): Row {
  return base(id, { ref_type: "Contrato", ref_id: refId, amount, status, due_date: iso(dueDays) });
}

function documentRow(id: string, title: string, type: string, version: number, days: number, filePath: string): Row {
  return base(id, { title, type, version, file_path: filePath, uploaded_by: ADMIN_ID }, days);
}

function audit(id: string, action: string, entityType: string, days: number): Row {
  return { id, company_id: COMPANY_ID, user_id: ADMIN_ID, action, entity_type: entityType, created_at: iso(days) };
}

function ticketActivity(id: string, entityId: string, action: string, title: string, actorId: string, days: number, hour: number): Row {
  return { id, company_id: COMPANY_ID, entity_type: "ticket", entity_id: entityId, action, title, actor_id: actorId, created_at: iso(days, hour) };
}

function normalize(query: string): string {
  return query.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Instante real (iso(0) fixa 09:00 local, bom para seed visual, ruim para comparar updated_at). */
function nowIso(): string {
  return new Date().toISOString();
}

/** "?" consome o próximo bind; datetime('now') vira agora; null/números/strings literais são convertidos. */
function literalOrBind(token: string, nextBind: () => unknown): unknown {
  if (token === "?") return nextBind() ?? null;
  if (token.startsWith("datetime(")) return nowIso();
  if (token === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(token)) return Number(token);
  return token.replace(/^'|'$/g, "");
}

/** Converte "a=? and b is null and c is not null" em predicado, consumindo binds na ordem. */
function parseWhere(clause: string, nextBind: () => unknown): (row: Row) => boolean {
  const checks = clause.split(/ and /).map<(row: Row) => boolean>((part) => {
    const isNull = part.match(/^(\w+) is null$/);
    if (isNull) return (row) => row[isNull[1]] == null;
    const notNull = part.match(/^(\w+) is not null$/);
    if (notNull) return (row) => row[notNull[1]] != null;
    const equals = part.match(/^(\w+) ?= ?\?$/);
    if (equals) {
      const value = nextBind();
      return (row) => row[equals[1]] === value;
    }
    throw new Error(`Condição demo não suportada: ${part}`);
  });
  return (row) => checks.every((check) => check(row));
}

function orderByColumn(rows: Row[], sql: string): Row[] {
  const match = sql.match(/order by ([a-z_]+)( asc| desc)?/);
  if (!match) return rows;
  const [, column, direction] = match;
  const factor = direction?.trim() === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const left = a[column];
    const right = b[column];
    if (left == null || right == null) return left == null && right == null ? 0 : left == null ? 1 : -1;
    if (typeof left === "number" && typeof right === "number") return (left - right) * factor;
    return String(left).localeCompare(String(right), "pt-BR") * factor;
  });
}

function matchesCompany(row: Row, companyId: unknown): boolean {
  return row.company_id === companyId && !row.deleted_at;
}

function createdAtDesc(a: Row, b: Row): number {
  return String(b.created_at).localeCompare(String(a.created_at));
}

class DemoDatabase implements DatabaseLike {
  private tables: DemoTables;

  constructor() {
    this.tables = this.load();
  }

  async select<T>(query: string, bindValues: unknown[] = []): Promise<T> {
    const sql = normalize(query);
    const companyId = bindValues[0];

    if (sql.includes("select id from companies")) {
      return this.tables.companies.filter((row) => !row.deleted_at).slice(0, 1) as T;
    }
    if (sql.includes("from users where email")) {
      return this.tables.users.filter((row) => row.email === bindValues[0] && !row.deleted_at).slice(0, 1) as T;
    }
    if (sql.includes("from memberships where user_id")) {
      return this.tables.memberships.filter((row) => row.user_id === bindValues[0] && !row.deleted_at).slice(0, 1) as T;
    }
    if (sql.includes("from companies where id")) {
      return this.tables.companies.filter((row) => row.id === bindValues[0] && !row.deleted_at).slice(0, 1) as T;
    }
    if (sql.includes("count(*) as n from customers")) return [{ n: this.active("customers", companyId).length }] as T;
    if (sql.includes("count(*) as n from opportunities")) {
      const rows = this.active("opportunities", companyId).filter((row) => row.status === "open");
      return [{ n: rows.length }] as T;
    }
    if (sql.includes("count(*) as n from tickets")) {
      const rows = this.active("tickets", companyId)
        .filter((row) => !sql.includes("opened_by=?") || row.opened_by === bindValues[1])
        .filter((row) => !["resolvido", "fechado"].includes(String(row.status)));
      return [{ n: rows.length }] as T;
    }
    if (sql.includes("count(*) as n from work_orders") && sql.includes("status not in")) {
      const rows = this.active("work_orders", companyId).filter((row) => !["concluida", "cancelada"].includes(String(row.status)));
      return [{ n: rows.length }] as T;
    }
    if (sql.includes("count(*) as n from work_orders")) return [{ n: this.active("work_orders", companyId).length }] as T;
    if (sql.includes("count(*) as n from inventory_items")) {
      const rows = this.inventoryWithBalance(companyId).filter((row) => Number(row.quantity) < Number(row.min_stock));
      return [{ n: rows.length }] as T;
    }
    if (sql.includes("count(*) as n from payables")) {
      const rows = this.active("payables", companyId).filter((row) => ["aberta", "aprovada"].includes(String(row.status)));
      return [{ n: rows.length }] as T;
    }
    if (sql.includes("count(*) as n from receivables")) {
      const rows = this.active("receivables", companyId).filter((row) => row.status === "aberta");
      return [{ n: rows.length }] as T;
    }
    if (sql.includes("count(*) as n from projects")) {
      const rows = this.active("projects", companyId).filter((row) => ["planejado", "andamento"].includes(String(row.status)));
      return [{ n: rows.length }] as T;
    }
    if (sql.includes("count(*) as n from custodies")) {
      const rows = this.active("custodies", companyId).filter((row) => row.status === "em_custodia");
      return [{ n: rows.length }] as T;
    }
    if (sql.includes("from tickets t left join users")) {
      return this.ticketsWithDetails(companyId)
        .filter((row) => !sql.includes("t.opened_by=?") || row.opened_by === bindValues[1]) as T;
    }
    if (sql.includes("from inventory_items i left join stock_balances")) return this.inventoryWithBalance(companyId) as T;
    if (sql.includes("from custodies c left join inventory_items")) return this.custodiesWithDetails(companyId) as T;
    if (sql.includes("from custodies c left join users")) return this.custodiesWithDetails(companyId) as T;
    if (sql.includes("from activities a left join users")) {
      return this.active("activities", companyId)
        .filter((row) => row.entity_type === "ticket" && row.entity_id === bindValues[1])
        .map<Row>((row) => ({
          ...row,
          actor_name: this.tables.users.find((user) => user.id === row.actor_id)?.name,
        }))
        .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))) as T;
    }

    const table = (Object.keys(this.tables) as (keyof DemoTables)[]).find((name) => sql.includes(`from ${name}`));
    if (!table) throw new Error(`Consulta demo nao suportada: ${query}`);

    // WHERE completo (col=?, col is null, ...) quando o interpretador entende; senão, o filtro antigo por empresa.
    let rows: Row[] | null = null;
    const whereClause = sql.match(/ where (.+?)(?: order by| limit|$)/)?.[1];
    if (whereClause && table !== "audit_logs") {
      try {
        let bindIndex = 0;
        rows = this.tables[table].filter(parseWhere(whereClause, () => bindValues[bindIndex++]));
      } catch {
        rows = null;
      }
    }
    rows ??= table === "audit_logs"
      ? this.tables[table].filter((row) => row.company_id === companyId)
      : this.active(table, companyId);

    if (sql.includes("order by name")) rows = [...rows].sort((a, b) => String(a.name).localeCompare(String(b.name)));
    if (sql.includes("order by created_at desc")) rows = [...rows].sort(createdAtDesc);
    if (sql.includes("order by due_date asc")) rows = [...rows].sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
    if (sql.includes("order by checked_out_at desc")) rows = [...rows].sort((a, b) => String(b.checked_out_at).localeCompare(String(a.checked_out_at)));
    if (EXTRA_TABLES.includes(table as (typeof EXTRA_TABLES)[number])) rows = orderByColumn(rows, sql);
    if (sql.includes("limit 200")) rows = rows.slice(0, 200);
    // Cópias: quem consulta não pode enxergar (nem mutar) as linhas vivas do banco.
    return rows.map((row) => ({ ...row })) as T;
  }

  async execute(query: string, bindValues: unknown[] = []): Promise<unknown> {
    const sql = normalize(query);

    // UPDATE que define updated_at explicitamente (importação de bundle) usa o caminho genérico.
    if (/^update \w+ set .*updated_at ?= ?\?/.test(sql)) {
      const generic = this.executeGeneric(sql, bindValues);
      if (generic) return generic;
    }

    if (sql.startsWith("update users set last_login_at")) {
      this.update("users", bindValues[0], { last_login_at: iso(0) });
      return { rowsAffected: 1 };
    }
    if (sql.startsWith("insert into customers")) {
      this.insert("customers", bindValues, ["id", "company_id", "type", "name", "email", "phone", "document"], { address_json: "{}", status: "active" });
      return { rowsAffected: 1 };
    }
    if (sql.startsWith("update customers set")) {
      this.update("customers", bindValues[5], { type: bindValues[0], name: bindValues[1], email: bindValues[2], phone: bindValues[3], document: bindValues[4], updated_at: iso(0) });
      return { rowsAffected: 1 };
    }
    if (sql.startsWith("insert into opportunities")) {
      this.insert("opportunities", bindValues, ["id", "company_id", "title", "value", "stage", "probability", "expected_close_date", "status"]);
      return { rowsAffected: 1 };
    }
    if (sql.startsWith("update opportunities set")) {
      this.update("opportunities", bindValues[6], { title: bindValues[0], value: bindValues[1], stage: bindValues[2], probability: bindValues[3], expected_close_date: bindValues[4], status: bindValues[5], updated_at: iso(0) });
      return { rowsAffected: 1 };
    }
    if (sql.startsWith("insert into projects")) {
      this.insert("projects", bindValues, ["id", "company_id", "name", "status", "budget", "start_date", "end_date", "owner_id"]);
      return { rowsAffected: 1 };
    }
    if (sql.startsWith("update projects set")) {
      this.update("projects", bindValues[5], { name: bindValues[0], status: bindValues[1], budget: bindValues[2], start_date: bindValues[3], end_date: bindValues[4], updated_at: iso(0) });
      return { rowsAffected: 1 };
    }
    if (sql.startsWith("insert into tickets")) {
      this.insert("tickets", bindValues, ["id", "company_id", "subject", "description", "priority", "opened_by", "requester_area"], { channel: "portal", status: "aberto", agent_id: null, work_order_id: null });
      return { rowsAffected: 1 };
    }
    if (sql.startsWith("insert into work_orders")) {
      if (sql.includes("status, priority, labor_cost")) {
        this.insert("work_orders", bindValues, ["id", "company_id", "number", "technician_id", "status", "priority", "labor_cost", "materials_cost"], { opened_at: iso(0), checklist_json: "[]" });
      } else {
        this.insert("work_orders", bindValues, ["id", "company_id", "number", "customer_id", "ticket_id", "technician_id", "priority"], { status: "aberta", opened_at: iso(0), checklist_json: "[]", labor_cost: 0, materials_cost: 0 });
      }
      return { rowsAffected: 1 };
    }
    if (sql.startsWith("update work_orders set")) {
      this.update("work_orders", bindValues[5], { number: bindValues[0], status: bindValues[1], priority: bindValues[2], labor_cost: bindValues[3], materials_cost: bindValues[4], updated_at: iso(0) });
      return { rowsAffected: 1 };
    }
    if (sql.startsWith("update tickets set work_order_id")) {
      this.update("tickets", bindValues[1], { work_order_id: bindValues[0], status: "resolvido", updated_at: iso(0) });
      return { rowsAffected: 1 };
    }
    if (sql.startsWith("update tickets set status='aberto'")) {
      this.update("tickets", bindValues[0], { status: "aberto", updated_at: iso(0) });
      return { rowsAffected: 1 };
    }
    if (sql.startsWith("update tickets set subject")) {
      this.update("tickets", bindValues[4], { subject: bindValues[0], description: bindValues[1], priority: bindValues[2], status: bindValues[3], updated_at: iso(0) });
      return { rowsAffected: 1 };
    }
    if (sql.startsWith("insert into inventory_items")) {
      this.insert("inventory_items", bindValues, ["id", "company_id", "name", "sku", "category", "supplier_id", "unit", "min_stock", "cost"]);
      return { rowsAffected: 1 };
    }
    if (sql.startsWith("update inventory_items set deleted_at")) {
      this.update("inventory_items", bindValues[0], { deleted_at: iso(0), updated_at: iso(0) });
      return { rowsAffected: 1 };
    }
    if (sql.startsWith("update inventory_items set")) {
      this.update("inventory_items", bindValues[7], { name: bindValues[0], sku: bindValues[1], category: bindValues[2], supplier_id: bindValues[3], unit: bindValues[4], min_stock: bindValues[5], cost: bindValues[6], updated_at: iso(0) });
      return { rowsAffected: 1 };
    }
    if (sql.startsWith("insert into custodies")) {
      this.insert("custodies", bindValues, ["id", "company_id", "item_id", "holder_id", "quantity", "status", "due_back_at"], { checked_out_at: iso(0) });
      return { rowsAffected: 1 };
    }
    if (sql.startsWith("update custodies set deleted_at")) {
      this.update("custodies", bindValues[0], { deleted_at: iso(0), updated_at: iso(0) });
      return { rowsAffected: 1 };
    }
    if (sql.startsWith("update custodies set")) {
      this.update("custodies", bindValues[4], { item_id: bindValues[0], quantity: bindValues[1], status: bindValues[2], due_back_at: bindValues[3], updated_at: iso(0) });
      return { rowsAffected: 1 };
    }
    if (sql.startsWith("insert into payables")) {
      this.insert("payables", bindValues, ["id", "company_id", "description", "amount", "due_date", "status"]);
      return { rowsAffected: 1 };
    }
    if (sql.startsWith("update payables set")) {
      this.update("payables", bindValues[4], { description: bindValues[0], amount: bindValues[1], due_date: bindValues[2], status: bindValues[3], updated_at: iso(0) });
      return { rowsAffected: 1 };
    }
    if (sql.startsWith("insert into receivables")) {
      this.insert("receivables", bindValues, ["id", "company_id", "ref_type", "ref_id", "amount", "due_date", "status"]);
      return { rowsAffected: 1 };
    }
    if (sql.startsWith("update receivables set")) {
      this.update("receivables", bindValues[4], { ref_id: bindValues[0], amount: bindValues[1], due_date: bindValues[2], status: bindValues[3], updated_at: iso(0) });
      return { rowsAffected: 1 };
    }
    if (sql.startsWith("insert into documents")) {
      this.insert("documents", bindValues, ["id", "company_id", "title", "type", "file_path", "version", "uploaded_by"]);
      return { rowsAffected: 1 };
    }
    if (sql.startsWith("update documents set")) {
      this.update("documents", bindValues[3], { title: bindValues[0], type: bindValues[1], file_path: bindValues[2], updated_at: iso(0) });
      return { rowsAffected: 1 };
    }
    if (sql.startsWith("insert into activities")) {
      this.insert("activities", bindValues, ["id", "company_id", "entity_type", "entity_id", "action", "title", "description", "actor_id", "old_value_json", "new_value_json", "metadata_json", "module"]);
      return { rowsAffected: 1 };
    }
    if (sql.startsWith("insert into companies")) {
      this.insert("companies", bindValues, ["id", "name", "document"], { settings_json: "{}" });
      return { rowsAffected: 1 };
    }
    if (sql.startsWith("insert into users")) {
      this.insert("users", bindValues, ["id", "name", "email", "password_hash"], { status: "active", locale: "pt-BR" });
      return { rowsAffected: 1 };
    }
    if (sql.startsWith("insert into memberships")) {
      this.insert("memberships", bindValues, ["id", "company_id", "user_id"], { role: "admin", scope: "empresa" });
      return { rowsAffected: 1 };
    }
    const generic = this.executeGeneric(sql, bindValues);
    if (generic) return generic;
    throw new Error(`Comando demo nao suportado: ${query}`);
  }

  /** Fallback genérico: INSERT [OR IGNORE|OR REPLACE] INTO t (cols) VALUES (...) e UPDATE t SET a=?, ... WHERE id=? em qualquer tabela demo. */
  private executeGeneric(sql: string, bindValues: unknown[]): { rowsAffected: number } | null {
    const insert = sql.match(/^insert(?: or (ignore|replace))? into (\w+) ?\(([^)]*)\) ?values ?\((.*)\)$/);
    if (insert && insert[2] in this.tables) {
      const table = insert[2] as keyof DemoTables;
      const columns = insert[3].split(",").map((column) => column.trim());
      let bindIndex = 0;
      const row: Row = {};
      insert[4].split(",").forEach((token, index) => {
        row[columns[index]] = literalOrBind(token.trim(), () => bindValues[bindIndex++]);
      });
      const rows = this.tables[table];
      const existing = rows.findIndex((candidate) => candidate.id === row.id);
      if (existing >= 0 && insert[1] === "ignore") return { rowsAffected: 0 };
      const stamped = { created_at: nowIso(), updated_at: nowIso(), deleted_at: null, ...row };
      if (existing >= 0) rows[existing] = stamped;
      else rows.push(stamped);
      this.save();
      return { rowsAffected: 1 };
    }

    const update = sql.match(/^update (\w+) set (.*?) where (.+)$/);
    if (update && update[1] in this.tables) {
      const patch: Row = {};
      let bindIndex = 0;
      const nextBind = () => bindValues[bindIndex++];
      for (const assignment of update[2].split(/, ?/)) {
        const [column, expression] = assignment.split(/ ?= ?/);
        patch[column.trim()] = literalOrBind(expression.trim(), nextBind);
      }
      const matched = this.tables[update[1] as keyof DemoTables].filter(parseWhere(update[3], nextBind));
      matched.forEach((row) => Object.assign(row, patch));
      this.save();
      return { rowsAffected: matched.length };
    }

    // DELETE físico: só para dados de catálogo substituídos pelo seed (o fluxo normal usa soft delete).
    const remove = sql.match(/^delete from (\w+) where (.+)$/);
    if (remove && remove[1] in this.tables) {
      let bindIndex = 0;
      const rows = this.tables[remove[1] as keyof DemoTables];
      const doomed = new Set(rows.filter(parseWhere(remove[2], () => bindValues[bindIndex++])));
      this.tables[remove[1] as keyof DemoTables] = rows.filter((row) => !doomed.has(row)) as Row[];
      this.save();
      return { rowsAffected: doomed.size };
    }
    return null;
  }

  private load(): DemoTables {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return createSeed();
      const tables = JSON.parse(saved) as DemoTables;
      for (const name of EXTRA_TABLES) tables[name] ??= [];
      return tables;
    } catch {
      return createSeed();
    }
  }

  private save(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.tables));
  }

  private active(table: keyof DemoTables, companyId: unknown): Row[] {
    return this.tables[table].filter((row) => matchesCompany(row, companyId));
  }

  private inventoryWithBalance(companyId: unknown): Row[] {
    return this.active("inventory_items", companyId)
      .map<Row>((item) => ({
        ...item,
        supplier_name: this.tables.suppliers.find((supplierRow) => supplierRow.id === item.supplier_id)?.name,
        supplier_document: this.tables.suppliers.find((supplierRow) => supplierRow.id === item.supplier_id)?.document,
        supplier_email: this.tables.suppliers.find((supplierRow) => supplierRow.id === item.supplier_id)?.email,
        supplier_phone: this.tables.suppliers.find((supplierRow) => supplierRow.id === item.supplier_id)?.phone,
        supplier_terms: this.tables.suppliers.find((supplierRow) => supplierRow.id === item.supplier_id)?.terms,
        supplier_rating: this.tables.suppliers.find((supplierRow) => supplierRow.id === item.supplier_id)?.rating,
        quantity: this.tables.stock_balances
          .filter((balanceRow) => balanceRow.company_id === companyId && balanceRow.item_id === item.id)
          .reduce((sum, balanceRow) => sum + Number(balanceRow.quantity), 0),
      }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }

  private ticketsWithDetails(companyId: unknown): Row[] {
    return this.active("tickets", companyId)
      .map<Row>((ticketRow) => ({
        ...ticketRow,
        opener_name: this.tables.users.find((user) => user.id === ticketRow.opened_by)?.name,
        agent_name: this.tables.users.find((user) => user.id === ticketRow.agent_id)?.name,
      }))
      .sort(createdAtDesc);
  }

  private custodiesWithDetails(companyId: unknown): Row[] {
    return this.active("custodies", companyId)
      .map<Row>((custodyRow) => ({
        ...custodyRow,
        item_name: this.tables.inventory_items.find((item) => item.id === custodyRow.item_id)?.name,
        holder_name: this.tables.users.find((user) => user.id === custodyRow.holder_id)?.name,
      }))
      .sort((a, b) => String(b.checked_out_at).localeCompare(String(a.checked_out_at)));
  }

  private insert(table: keyof DemoTables, values: unknown[], columns: string[], defaults: Row = {}): void {
    const row = columns.reduce<Row>((result, column, index) => {
      result[column] = values[index] ?? null;
      return result;
    }, { ...defaults });
    this.tables[table].push({ ...row, created_at: iso(0), updated_at: iso(0), deleted_at: null });
    this.save();
  }

  private update(table: keyof DemoTables, id: unknown, patch: Row): void {
    const row = this.tables[table].find((candidate) => candidate.id === id);
    if (row) Object.assign(row, patch);
    this.save();
  }
}

let database: DemoDatabase | null = null;

export function getDemoDb(): DatabaseLike {
  if (!database) database = new DemoDatabase();
  return database;
}
