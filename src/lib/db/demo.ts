// Banco demo do navegador: localStorage + SQL emulado por padrões de texto. Só para visualização; o app desktop usa SQLite.
// Tabelas, colunas e DEFAULT vêm das próprias migrations (demoSchema.ts), então tabela ou coluna nova já existe aqui.
// Padrões entendidos (SQL fora deles é erro com "demo" na mensagem, nunca dado errado):
// - SELECT * | SELECT col, col | SELECT count(*) AS x  FROM tabela  [WHERE ...] [ORDER BY col [ASC|DESC], ...] [LIMIT n]
// - INSERT [OR IGNORE | OR REPLACE] INTO tabela (cols) VALUES (...)  (uma linha; sem ON CONFLICT nem RETURNING)
// - UPDATE tabela SET col=valor, ... [WHERE ...]   e   DELETE FROM tabela [WHERE ...]
// - WHERE: col=? | col='texto' | col=número | col IS NULL | col IS NOT NULL, ligados por AND.
// - valores: ?, 'texto', número, NULL, datetime('now'), date('now') (dia UTC), date('now','localtime') (dia local).
// JOIN, soma, agrupamento, IN, LIKE, <, OR e expressões (quantity + ?) não existem aqui: faça no TypeScript.
// As 17 tabelas do demo original (LENIENT_TABLES) mantêm o comportamento antigo das telas legadas (consultas fixas
// com JOIN/COUNT tratadas abaixo e, se o WHERE não for entendido, filtro por empresa); as demais são estritas.
import { LOCAL_DATE_EXPRESSION, nowIso, parseMigrations, splitTopLevel, todayLocal, todayUtc, type DemoSchema } from "./demoSchema";

const STORAGE_KEY = "cm_demo_database_v4";
const COMPANY_ID = "demo-company";
const ADMIN_ID = "demo-admin";

/** Chave do banco demo no localStorage. */
export const DEMO_STORAGE_KEY = STORAGE_KEY;
/** Empresa fictícia do banco demo (TechFlow). */
export const DEMO_COMPANY_ID = COMPANY_ID;

const MIGRATION_SOURCES = import.meta.glob<string>("/src-tauri/migrations/*.sql", { query: "?raw", import: "default", eager: true });
const SCHEMA: DemoSchema = parseMigrations(
  Object.keys(MIGRATION_SOURCES)
    .sort()
    .map((file) => MIGRATION_SOURCES[file])
);

type Row = Record<string, unknown>;

export const DEMO_ACCOUNTS = [
  { id: "demo-ceo", role: "ceo", area: "Diretoria", position: "CEO", name: "André Machado", email: "ceo@techflow.com", password: "demo123" },
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
  { id: "demo-rh-gerente", role: "rh", area: "Recursos Humanos", position: "Gerente do setor", name: "Patrícia Duarte", email: "gerente.rh@techflow.com", password: "demo123" },
  { id: "demo-rh", role: "rh", area: "Recursos Humanos", position: "Funcionario", name: "Tiago Freitas", email: "rh@techflow.com", password: "demo123" },
  { id: "demo-auditor-gerente", role: "auditor", area: "Auditoria", position: "Gerente do setor", name: "Marcelo Nunes", email: "gerente.auditoria@techflow.com", password: "demo123" },
  { id: "demo-auditor", role: "auditor", area: "Auditoria", position: "Funcionario", name: "Beatriz Souza", email: "auditoria@techflow.com", password: "demo123" },
] as const;

/** Tabela → linhas. Toda tabela das migrations existe (vazia quando o seed não a preenche). */
type DemoTables = Record<string, Row[]>;

/** Tabelas do demo original: as telas legadas dependem do comportamento antigo (ver o topo do arquivo). */
const LENIENT_TABLES = new Set([
  "companies",
  "users",
  "memberships",
  "customers",
  "opportunities",
  "tickets",
  "work_orders",
  "projects",
  "inventory_items",
  "suppliers",
  "stock_balances",
  "custodies",
  "payables",
  "receivables",
  "documents",
  "activities",
  "audit_logs",
]);

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

/** Local de estoque dos saldos do seed (stock_balances.location_id). */
const DEMO_STOCK_LOCATION: Row = {
  id: "demo-stock-location",
  company_id: COMPANY_ID,
  name: "Depósito principal",
  type: "deposito",
  address: null,
  created_at: iso(-365),
  updated_at: iso(-365),
  deleted_at: null,
};

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
    users: DEMO_ACCOUNTS.map(demoUserRow),
    memberships: DEMO_ACCOUNTS.map(demoMembershipRow),
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
    stock_locations: [{ ...DEMO_STOCK_LOCATION }],
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
      documentRow("doc-15", "Politica de ferias.pdf", "PDF", 1, -20, "/Recursos Humanos/Politicas/Politica de ferias.pdf"),
      documentRow("doc-16", "Ficha de cadastro de colaborador.docx", "DOCX", 2, -45, "/Recursos Humanos/Modelos/Ficha de cadastro de colaborador.docx"),
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
    ...hrSeed(),
    employee_compensation: payrollSeed(),
  };
}

function demoUserRow(account: (typeof DEMO_ACCOUNTS)[number]): Row {
  return {
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
  };
}

function demoMembershipRow(account: (typeof DEMO_ACCOUNTS)[number]): Row {
  return {
    id: `demo-membership-${account.id}`,
    company_id: COMPANY_ID,
    user_id: account.id,
    role: account.role,
    scope: account.role === "gerente" || account.role === "admin" || account.role === "ceo" ? "empresa" : "setor",
    created_at: iso(-365),
    updated_at: iso(-2),
    deleted_at: null,
  };
}

/** "YYYY-MM-DD" a partir de hoje (fuso local). */
function dateOnly(daysFromToday: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Remuneração de exemplo (empresa fictícia). Valores inventados só para a demonstração. */
function payrollSeed(): Row[] {
  return DEMO_ACCOUNTS.map<Row>((account, index) => {
    const salary = account.role === "ceo" ? 38000
      : account.role === "admin" ? 14000
      : account.role === "gerente" ? 16500
      : account.position === "Gerente do setor" ? 9800
      : 4200 + (index % 6) * 260;
    return {
      id: `comp-${account.id}`, company_id: COMPANY_ID, employee_id: `employee-${account.id}`, base_salary: salary,
      effective_from: dateOnly(-300), notes: null, updated_by: null, created_at: iso(-300), updated_at: iso(-300), deleted_at: null,
    };
  });
}

/** Dados de exemplo de RH (empresa fictícia TechFlow): colaboradores das contas demo, solicitações, comunicados e pendências. */
function hrSeed(): Pick<DemoTables, "employees" | "hr_requests" | "hr_announcements" | "hr_tasks"> {
  const tenure = [-4100, -3650, -2900, -2200, -1500, -1100, -2500, -800, -1900, -600, -2100, -450, -1300, -300, -1700, -200, -1000, -150, -900];
  const employees = DEMO_ACCOUNTS.map<Row>((account, index) => ({
    id: `employee-${account.id}`,
    company_id: COMPANY_ID,
    user_id: account.id,
    name: account.name,
    email: account.email,
    department: account.area,
    position: account.position === "Funcionario" ? "Funcionário" : account.position,
    hire_date: dateOnly(tenure[index % tenure.length]),
    vacation_days_entitled: 30,
    status: "ativo",
    created_at: iso(-365),
    updated_at: iso(-30),
    deleted_at: null,
  }));
  const request = (id: string, accountId: string, type: string, start: number, end: number, status: string, reason: string | null): Row => ({
    id, company_id: COMPANY_ID, employee_id: `employee-${accountId}`, type, start_date: dateOnly(start), end_date: dateOnly(end),
    days: end - start + 1, reason, status, decided_by: status === "pendente" ? null : "demo-rh-gerente",
    decided_at: status === "pendente" ? null : iso(-3), decision_note: null, created_at: iso(-6), updated_at: iso(-3), deleted_at: null,
  });
  const announcement = (id: string, title: string, body: string, category: string, pinned: number, daysAgo: number): Row => ({
    id, company_id: COMPANY_ID, title, body, category, pinned, published_by: "demo-rh-gerente",
    published_at: iso(-daysAgo), created_at: iso(-daysAgo), updated_at: iso(-daysAgo), deleted_at: null,
  });
  const todo = (id: string, accountId: string, title: string, dueDays: number, status: string): Row => ({
    id, company_id: COMPANY_ID, employee_id: `employee-${accountId}`, title, description: null, due_date: dateOnly(dueDays), status,
    created_by: "demo-rh-gerente", created_at: iso(-10), updated_at: iso(-4), deleted_at: null,
  });
  return {
    employees,
    hr_requests: [
      request("hrreq-1", "demo-comercial", "ferias", 53, 62, "pendente", "Férias de fim de ano"),
      request("hrreq-2", "demo-tecnico", "ferias", 18, 22, "aprovada", null),
      request("hrreq-3", "demo-atendimento", "folga", 8, 8, "pendente", "Compromisso pessoal"),
      request("hrreq-4", "demo-financeiro", "atestado", -7, -7, "aprovada", "Consulta médica"),
      request("hrreq-5", "demo-produtos", "ferias", -108, -99, "aprovada", null),
    ],
    hr_announcements: [
      announcement("hrann-1", "Solicitações de férias e folgas pelo Meu RH", "Abra a solicitação na página Meu RH, escolha o período e acompanhe a resposta ali mesmo. O RH aprova ou recusa pelo sistema.", "comunicado", 1, 5),
      announcement("hrann-2", "Mantenha seus dados cadastrais atualizados", "Confira telefone, endereço e contato de emergência. Se algo mudou, avise o RH para atualizar seu cadastro.", "comunicado", 0, 12),
      announcement("hrann-3", "Política de férias", "As regras de marcação e fracionamento de férias estão na pasta Recursos Humanos do módulo Documentos.", "politica", 0, 20),
      announcement("hrann-4", "Benefícios da empresa", "As informações sobre benefícios ficam com o RH. Procure o setor para tirar dúvidas ou fazer alterações.", "beneficio", 0, 30),
    ],
    hr_tasks: [
      todo("hrtask-1", "demo-comercial", "Atualizar dados cadastrais", 7, "pendente"),
      todo("hrtask-2", "demo-comercial", "Assinar a política de segurança da informação", 14, "pendente"),
      todo("hrtask-3", "demo-tecnico", "Atualizar dados cadastrais", 7, "concluida"),
      todo("hrtask-4", "demo-atendimento", "Atualizar dados cadastrais", -2, "pendente"),
      todo("hrtask-5", "demo-financeiro", "Assinar a política de segurança da informação", 10, "pendente"),
    ],
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

/** Espaços colapsados e caixa baixa fora das aspas: 'VIP' continua 'VIP'. */
function normalize(query: string): string {
  return query
    .replace(/'(?:[^']|'')*'|[^']+/g, (part) => (part.startsWith("'") ? part : part.replace(/\s+/g, " ").toLowerCase()))
    .trim()
    .replace(/\s*;$/, "");
}

/** "?" consome o próximo bind; 'texto', número, NULL, datetime('now'), date('now') e date('now','localtime') viram valor. O resto é erro. */
function literalOrBind(token: string, nextBind: () => unknown): unknown {
  if (token === "?") return nextBind() ?? null;
  const literal = token.match(/^'((?:[^']|'')*)'$/s);
  if (literal) return literal[1].replace(/''/g, "'");
  if (token === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(token)) return Number(token);
  if (token === "datetime('now')" || token === "current_timestamp") return nowIso();
  if (token === "date('now')") return todayUtc();
  if (LOCAL_DATE_EXPRESSION.test(token)) return todayLocal();
  throw new Error(`Expressão demo não suportada: ${token}`);
}

/** Converte "a=? and b='x' and c is null" em predicado, consumindo binds na ordem. */
function parseWhere(clause: string, nextBind: () => unknown): (row: Row) => boolean {
  const checks = splitTopLevel(clause, " and ").map<(row: Row) => boolean>((part) => {
    const isNull = part.match(/^(\w+) is null$/);
    if (isNull) return (row) => row[isNull[1]] == null;
    const notNull = part.match(/^(\w+) is not null$/);
    if (notNull) return (row) => row[notNull[1]] != null;
    const equals = part.match(/^(\w+) ?= ?(\?|'(?:[^']|'')*'|-?\d+(?:\.\d+)?)$/s);
    if (equals) {
      const value = literalOrBind(equals[2], nextBind);
      return (row) => row[equals[1]] === value;
    }
    throw new Error(`Condição demo não suportada: ${part}`);
  });
  return (row) => checks.every((check) => check(row));
}

function compareValues(left: unknown, right: unknown): number {
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left).localeCompare(String(right), "pt-BR");
}

/** "col [asc|desc], col2 ..." → ordenação; nulos sempre por último. */
function parseOrderBy(spec: string): (a: Row, b: Row) => number {
  const keys = splitTopLevel(spec).map((part) => {
    const match = part.match(/^(\w+)(?: (asc|desc))?$/);
    if (!match) throw new Error(`Ordenação demo não suportada: ${part}`);
    return { column: match[1], factor: match[2] === "desc" ? -1 : 1 };
  });
  return (a, b) => {
    for (const { column, factor } of keys) {
      const left = a[column];
      const right = b[column];
      if (left == null || right == null) {
        if (left == null && right == null) continue;
        return left == null ? 1 : -1;
      }
      const order = compareValues(left, right) * factor;
      if (order !== 0) return order;
    }
    return 0;
  };
}

function matchesCompany(row: Row, companyId: unknown): boolean {
  return row.company_id === companyId && !row.deleted_at;
}

function createdAtDesc(a: Row, b: Row): number {
  return String(b.created_at).localeCompare(String(a.created_at));
}

/** Valores de colunas novas em linhas antigas, iguais aos UPDATE de backfill das migrations (0008). */
const BACKFILL: Record<string, (row: Row) => unknown> = {
  "receivables.description": (row) => row.ref_id ?? null,
  "payables.paid_amount": (row) => (row.status === "paga" ? Number(row.amount ?? 0) : 0),
  "receivables.received_amount": (row) => (row.status === "recebida" ? Number(row.amount ?? 0) : 0),
};

/** INSERT das telas legadas (colunas exatas, todos os valores "?"): mantêm os padrões que o demo antigo gravava. */
const LEGACY_INSERTS: Record<string, { columns: string[]; defaults?: () => Row }[]> = {
  customers: [{ columns: ["id", "company_id", "type", "name", "email", "phone", "document"], defaults: () => ({ address_json: "{}", status: "active" }) }],
  tickets: [
    {
      columns: ["id", "company_id", "subject", "description", "priority", "opened_by", "requester_area"],
      defaults: () => ({ channel: "portal", status: "aberto", agent_id: null, work_order_id: null }),
    },
  ],
  work_orders: [
    { columns: ["id", "company_id", "number", "technician_id", "status", "priority", "labor_cost", "materials_cost"], defaults: () => ({ opened_at: nowIso(), checklist_json: "[]" }) },
    {
      columns: ["id", "company_id", "number", "customer_id", "ticket_id", "technician_id", "priority"],
      defaults: () => ({ status: "aberta", opened_at: nowIso(), checklist_json: "[]", labor_cost: 0, materials_cost: 0 }),
    },
  ],
  custodies: [{ columns: ["id", "company_id", "item_id", "holder_id", "quantity", "status", "due_back_at"], defaults: () => ({ checked_out_at: nowIso() }) }],
  companies: [{ columns: ["id", "name", "document"], defaults: () => ({ settings_json: "{}" }) }],
  users: [{ columns: ["id", "name", "email", "password_hash"], defaults: () => ({ status: "active", locale: "pt-BR" }) }],
  memberships: [{ columns: ["id", "company_id", "user_id"], defaults: () => ({ role: "admin", scope: "empresa" }) }],
};

function sameColumns(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((column, index) => column === right[index]);
}

/** Linha completa: toda coluna do schema, com o valor dado ou o DEFAULT da migration. */
function withDefaults(table: string, given: Row): Row {
  const columns = SCHEMA.get(table);
  if (!columns) return { created_at: nowIso(), updated_at: nowIso(), deleted_at: null, ...given };
  const row: Row = {};
  for (const [column, value] of columns) row[column] = column in given ? given[column] : value();
  return row;
}

function assertColumns(table: string, columns: readonly string[]): void {
  const known = SCHEMA.get(table);
  if (!known) return;
  const unknown = columns.filter((column) => !known.has(column));
  if (unknown.length > 0) throw new Error(`Coluna demo desconhecida em ${table}: ${unknown.join(", ")}`);
}

/** Tabelas que faltam (banco salvo antes de uma migration) e colunas que faltam em linhas antigas. */
function ensureTables(tables: DemoTables): void {
  for (const table of SCHEMA.keys()) tables[table] ??= [];
}

function ensureColumns(tables: DemoTables): void {
  for (const [table, columns] of SCHEMA) {
    for (const row of tables[table]) {
      for (const [column, value] of columns) {
        if (column in row) continue;
        const backfill = BACKFILL[`${table}.${column}`];
        row[column] = backfill ? backfill(row) : value();
      }
    }
  }
}

const SELECT_PATTERN = /^select (.+?) from (\w+)(?: where (.+?))?(?: order by (.+?))?(?: limit (\d+))?$/s;

class DemoDatabase implements DatabaseLike {
  private tables: DemoTables;

  constructor() {
    this.tables = this.load();
  }

  async select<T>(query: string, bindValues: unknown[] = []): Promise<T> {
    const sql = normalize(query);
    // Cópias: quem consulta não pode enxergar (nem mutar) as linhas vivas do banco.
    const legacy = this.legacySelect(sql, bindValues);
    if (legacy) return legacy.map((row) => ({ ...row })) as T;

    const table = sql.match(/\bfrom (\w+)/)?.[1];
    if (!table || !(table in this.tables)) throw new Error(`Consulta demo nao suportada: ${query}`);
    const rows = LENIENT_TABLES.has(table) ? this.lenientSelect(table, sql, bindValues) : this.strictSelect(table, sql, query, bindValues);
    return rows.map((row) => ({ ...row })) as T;
  }

  async execute(query: string, bindValues: unknown[] = []): Promise<{ rowsAffected: number }> {
    const sql = normalize(query);
    if (/ on conflict\b| returning\b/.test(sql)) throw new Error(`Comando demo não suportado (ON CONFLICT/RETURNING): ${query}`);
    if (sql.startsWith("insert")) return this.insertRow(sql, query, bindValues);
    if (sql.startsWith("update")) return this.updateRows(sql, query, bindValues);
    if (sql.startsWith("delete")) return this.deleteRows(sql, query, bindValues);
    throw new Error(`Comando demo nao suportado: ${query}`);
  }

  /** Consultas fixas das telas legadas (JOIN e COUNT com IN/NOT IN), respondidas à mão. */
  private legacySelect(sql: string, bindValues: unknown[]): Row[] | null {
    const companyId = bindValues[0];
    if (sql.includes("select id from companies")) return this.tables.companies.filter((row) => !row.deleted_at).slice(0, 1);
    if (sql.includes("from users where lower(email)") || sql.includes("from users where email")) {
      const wanted = String(bindValues[0]).toLowerCase();
      return this.tables.users.filter((row) => String(row.email).toLowerCase() === wanted && !row.deleted_at).slice(0, 1);
    }
    if (sql.includes("from memberships where user_id")) return this.tables.memberships.filter((row) => row.user_id === bindValues[0] && !row.deleted_at).slice(0, 1);
    if (sql.includes("from companies where id")) return this.tables.companies.filter((row) => row.id === bindValues[0] && !row.deleted_at).slice(0, 1);

    const count = (rows: Row[]) => [{ n: rows.length }];
    if (sql === "select count(*) as n from customers where company_id=? and deleted_at is null") return count(this.active("customers", companyId));
    if (sql.startsWith("select count(*) as n from opportunities") && sql.includes("status='open'")) {
      return count(this.active("opportunities", companyId).filter((row) => row.status === "open"));
    }
    if (sql.startsWith("select count(*) as n from tickets") && sql.includes("status not in ('resolvido','fechado')")) {
      return count(
        this.active("tickets", companyId)
          .filter((row) => !sql.includes("opened_by=?") || row.opened_by === bindValues[1])
          .filter((row) => !["resolvido", "fechado"].includes(String(row.status)))
      );
    }
    if (sql.startsWith("select count(*) as n from work_orders") && sql.includes("status not in ('concluida','cancelada')")) {
      return count(this.active("work_orders", companyId).filter((row) => !["concluida", "cancelada"].includes(String(row.status))));
    }
    if (sql === "select count(*) as n from work_orders where company_id=?") return count(this.tables.work_orders.filter((row) => row.company_id === companyId));
    if (sql.startsWith("select count(*) as n from inventory_items i join")) {
      return count(this.inventoryWithBalance(companyId).filter((row) => Number(row.quantity) < Number(row.min_stock)));
    }
    if (sql.startsWith("select count(*) as n from payables") && sql.includes("status in ('aberta','aprovada')")) {
      return count(this.active("payables", companyId).filter((row) => ["aberta", "aprovada"].includes(String(row.status))));
    }
    if (sql.startsWith("select count(*) as n from receivables") && sql.includes("status='aberta'")) {
      return count(this.active("receivables", companyId).filter((row) => row.status === "aberta"));
    }
    if (sql.startsWith("select count(*) as n from projects") && sql.includes("status in ('planejado','andamento')")) {
      return count(this.active("projects", companyId).filter((row) => ["planejado", "andamento"].includes(String(row.status))));
    }
    if (sql.startsWith("select count(*) as n from custodies") && sql.includes("status='em_custodia'")) {
      return count(this.active("custodies", companyId).filter((row) => row.status === "em_custodia"));
    }

    if (sql.includes("from tickets t left join users")) {
      return this.ticketsWithDetails(companyId).filter((row) => !sql.includes("t.opened_by=?") || row.opened_by === bindValues[1]);
    }
    if (sql.includes("from inventory_items i left join stock_balances")) return this.inventoryWithBalance(companyId);
    if (sql.includes("from custodies c left join inventory_items")) return this.custodiesWithDetails(companyId);
    if (sql.includes("from custodies c left join users")) return this.custodiesWithDetails(companyId);
    if (sql.includes("from activities a left join users")) {
      return this.active("activities", companyId)
        .filter((row) => row.entity_type === "ticket" && row.entity_id === bindValues[1])
        .map<Row>((row) => ({ ...row, actor_name: this.tables.users.find((user) => user.id === row.actor_id)?.name }))
        .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    }
    return null;
  }

  /** Tabelas do demo original: WHERE que o demo não entende cai no filtro antigo por empresa (telas legadas). */
  private lenientSelect(table: string, sql: string, bindValues: unknown[]): Row[] {
    const companyId = bindValues[0];
    let rows: Row[] | null = null;
    const whereClause = sql.match(/ where (.+?)(?: order by| limit|$)/s)?.[1];
    if (whereClause && table !== "audit_logs") {
      try {
        let bindIndex = 0;
        rows = this.tables[table].filter(parseWhere(whereClause, () => bindValues[bindIndex++]));
      } catch {
        rows = null;
      }
    }
    rows ??= table === "audit_logs" ? this.tables[table].filter((row) => row.company_id === companyId) : this.active(table, companyId);

    const orderBy = sql.match(/ order by (.+?)(?: limit \d+)?$/)?.[1];
    if (orderBy) {
      try {
        rows = [...rows].sort(parseOrderBy(orderBy));
      } catch {
        // ordenação com alias/expressão: mantém a ordem gravada, como o demo antigo
      }
    }
    const limit = sql.match(/ limit (\d+)$/)?.[1];
    if (limit) rows = rows.slice(0, Number(limit));
    const countAlias = sql.match(/^select count\(\*\) as (\w+) from /)?.[1];
    return countAlias ? [{ [countAlias]: rows.length }] : rows;
  }

  /** Tabelas novas: só os padrões do topo do arquivo; qualquer outra coisa é erro. */
  private strictSelect(table: string, sql: string, query: string, bindValues: unknown[]): Row[] {
    const match = sql.match(SELECT_PATTERN);
    if (!match || match[2] !== table) throw new Error(`Consulta demo nao suportada (sem JOIN, alias ou expressão): ${query}`);
    const [, projection, , whereClause, orderBy, limit] = match;
    let bindIndex = 0;
    let rows = whereClause ? this.tables[table].filter(parseWhere(whereClause, () => bindValues[bindIndex++])) : [...this.tables[table]];
    if (orderBy) rows = [...rows].sort(parseOrderBy(orderBy));
    if (limit) rows = rows.slice(0, Number(limit));

    const countAlias = projection.match(/^count\(\*\) as (\w+)$/)?.[1];
    if (countAlias) return [{ [countAlias]: rows.length }];
    if (projection === "*") return rows;
    const columns = splitTopLevel(projection);
    if (!columns.every((column) => /^\w+$/.test(column))) throw new Error(`Consulta demo nao suportada (só *, colunas ou count(*)): ${query}`);
    assertColumns(table, columns);
    return rows.map((row) => Object.fromEntries(columns.map((column) => [column, row[column] ?? null])));
  }

  private insertRow(sql: string, query: string, bindValues: unknown[]): { rowsAffected: number } {
    const match = sql.match(/^insert(?: or (ignore|replace))? into (\w+) ?\(([^)]*)\) ?values ?\((.*)\)$/s);
    if (!match) throw new Error(`Comando demo nao suportado: ${query}`);
    const [, conflict, table, columnList, valueList] = match;
    if (!(table in this.tables)) throw new Error(`Tabela demo desconhecida: ${table}`);
    const columns = columnList.split(",").map((column) => column.trim());
    const values = splitTopLevel(valueList);
    if (values.length !== columns.length) throw new Error(`Comando demo nao suportado (uma linha por INSERT): ${query}`);
    assertColumns(table, columns);

    let bindIndex = 0;
    const given: Row = {};
    columns.forEach((column, index) => {
      given[column] = literalOrBind(values[index], () => bindValues[bindIndex++]);
    });
    const legacy = !conflict && values.every((value) => value === "?") ? LEGACY_INSERTS[table]?.find((spec) => sameColumns(spec.columns, columns)) : undefined;
    const row = withDefaults(table, { ...legacy?.defaults?.(), ...given });

    const rows = this.tables[table];
    const existing = row.id == null ? -1 : rows.findIndex((candidate) => candidate.id === row.id);
    if (existing >= 0) {
      if (conflict === "ignore") return { rowsAffected: 0 };
      if (conflict !== "replace") throw new Error(`Comando demo recusado: já existe ${table} com id ${String(row.id)} (UNIQUE)`);
      rows[existing] = row;
    } else {
      rows.push(row);
    }
    this.save();
    return { rowsAffected: 1 };
  }

  private updateRows(sql: string, query: string, bindValues: unknown[]): { rowsAffected: number } {
    const match = sql.match(/^update (\w+) set (.+?)(?: where (.+))?$/s);
    if (!match) throw new Error(`Comando demo nao suportado: ${query}`);
    const [, table, assignments, whereClause] = match;
    if (!(table in this.tables)) throw new Error(`Tabela demo desconhecida: ${table}`);
    let bindIndex = 0;
    const nextBind = () => bindValues[bindIndex++];
    const patch: Row = {};
    for (const assignment of splitTopLevel(assignments)) {
      const parts = assignment.match(/^(\w+) ?= ?(.+)$/s);
      if (!parts) throw new Error(`Expressão demo não suportada: ${assignment}`);
      patch[parts[1]] = literalOrBind(parts[2].trim(), nextBind);
    }
    assertColumns(table, Object.keys(patch));
    const matched = whereClause ? this.tables[table].filter(parseWhere(whereClause, nextBind)) : this.tables[table];
    matched.forEach((row) => Object.assign(row, patch));
    this.save();
    return { rowsAffected: matched.length };
  }

  /** DELETE físico: só para dados de catálogo substituídos pelo seed (o fluxo normal usa soft delete). */
  private deleteRows(sql: string, query: string, bindValues: unknown[]): { rowsAffected: number } {
    const match = sql.match(/^delete from (\w+)(?: where (.+))?$/s);
    if (!match) throw new Error(`Comando demo nao suportado: ${query}`);
    const [, table, whereClause] = match;
    if (!(table in this.tables)) throw new Error(`Tabela demo desconhecida: ${table}`);
    let bindIndex = 0;
    const rows = this.tables[table];
    const doomed = new Set(whereClause ? rows.filter(parseWhere(whereClause, () => bindValues[bindIndex++])) : rows);
    this.tables[table] = rows.filter((row) => !doomed.has(row));
    this.save();
    return { rowsAffected: doomed.size };
  }

  private load(): DemoTables {
    let tables: DemoTables;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      tables = saved ? (JSON.parse(saved) as DemoTables) : createSeed();
      ensureTables(tables);
      if (saved) upgradeSaved(tables);
    } catch {
      tables = createSeed();
      ensureTables(tables);
    }
    ensureColumns(tables);
    return tables;
  }

  private save(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.tables));
  }

  private active(table: string, companyId: unknown): Row[] {
    return this.tables[table].filter((row) => matchesCompany(row, companyId));
  }

  private inventoryWithBalance(companyId: unknown): Row[] {
    return this.active("inventory_items", companyId)
      .map<Row>((item) => {
        const supplierRow = this.tables.suppliers.find((candidate) => candidate.id === item.supplier_id);
        return {
          ...item,
          supplier_name: supplierRow?.name,
          supplier_document: supplierRow?.document,
          supplier_email: supplierRow?.email,
          supplier_phone: supplierRow?.phone,
          supplier_terms: supplierRow?.terms,
          supplier_rating: supplierRow?.rating,
          quantity: this.tables.stock_balances
            .filter((balanceRow) => balanceRow.company_id === companyId && balanceRow.item_id === item.id)
            .reduce((sum, balanceRow) => sum + Number(balanceRow.quantity), 0),
        };
      })
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
}

/** Dados de demonstração que bancos salvos antes deles ganham ao abrir. */
function upgradeSaved(tables: DemoTables): void {
  // Contas demo novas (CEO, RH) em bancos salvos antes delas.
  for (const account of DEMO_ACCOUNTS) {
    if (!tables.users.some((user) => user.id === account.id)) {
      tables.users.push(demoUserRow(account));
      tables.memberships.push(demoMembershipRow(account));
    }
  }
  if (tables.employees.length === 0) Object.assign(tables, hrSeed());
  if (tables.employee_compensation.length === 0) tables.employee_compensation = payrollSeed();
  if (!tables.documents.some((doc) => doc.id === "doc-15")) {
    tables.documents.push(
      documentRow("doc-15", "Politica de ferias.pdf", "PDF", 1, -20, "/Recursos Humanos/Politicas/Politica de ferias.pdf"),
      documentRow("doc-16", "Ficha de cadastro de colaborador.docx", "DOCX", 2, -45, "/Recursos Humanos/Modelos/Ficha de cadastro de colaborador.docx"),
    );
  }
  if (!tables.stock_locations.some((row) => row.id === DEMO_STOCK_LOCATION.id)) tables.stock_locations.push({ ...DEMO_STOCK_LOCATION });
}

let database: DemoDatabase | null = null;

/** Banco demo compartilhado pelo app no navegador. */
export function getDemoDb(): DatabaseLike {
  if (!database) database = new DemoDatabase();
  return database;
}

/** Instância nova que relê o localStorage (testes e ferramentas; o app usa getDemoDb). */
export function createDemoDb(): DatabaseLike & { execute(query: string, bindValues?: unknown[]): Promise<{ rowsAffected: number }> } {
  return new DemoDatabase();
}
