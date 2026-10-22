/**
 * Catálogo central dos 20 departamentos do Company Manager.
 * Cada departamento tem sua própria rota (/departamentos/:slug) e cards
 * específicos da área. Ícones são nomes do lucide-react, resolvidos na UI.
 */

export type DepartmentSlug =
  | "design"
  | "rh"
  | "financeiro"
  | "projetos"
  | "ti"
  | "vendas"
  | "suporte"
  | "operacoes"
  | "marketing"
  | "comercial"
  | "compras"
  | "logistica"
  | "qualidade"
  | "pmo"
  | "seguranca-informacao"
  | "contabilidade"
  | "administrativo"
  | "atendimento-cliente"
  | "dados-analytics"
  | "assistente-executivo";

export type DepartmentGroup = "Negócio" | "Pessoas & Gestão" | "Operação" | "Tecnologia" | "Diretoria";

export interface DepartmentCard {
  /** Recurso protegido que alimenta o card (ex.: "ferias_ausencias"). */
  resource: string;
  title: string;
  description: string;
  icon: string;
}

export interface DepartmentDefinition {
  slug: DepartmentSlug;
  name: string;
  description: string;
  icon: string;
  group: DepartmentGroup;
  cards: DepartmentCard[];
}

const c = (resource: string, title: string, description: string, icon: string): DepartmentCard => ({
  resource,
  title,
  description,
  icon,
});

export const DEPARTMENTS: readonly DepartmentDefinition[] = [
  {
    slug: "design", name: "Design", group: "Negócio", icon: "Palette",
    description: "Identidade visual, UI/UX e entregas criativas.",
    cards: [
      c("briefings", "Briefings", "Pedidos de design abertos e em andamento", "ClipboardList"),
      c("design_system", "Design System", "Componentes, tokens e guias de marca", "Layers"),
      c("revisoes", "Revisões", "Aprovações pendentes com solicitantes", "CheckCircle2"),
      c("assets", "Biblioteca de Assets", "Logos, ícones e templates", "Image"),
    ],
  },
  {
    slug: "rh", name: "RH", group: "Pessoas & Gestão", icon: "Users",
    description: "Pessoas, admissões, folha, férias e clima.",
    cards: [
      c("colaboradores", "Colaboradores", "Quadro ativo, cargos e lotação", "Users"),
      c("ferias_ausencias", "Férias e Ausências", "Calendário de férias, folgas e afastamentos", "CalendarDays"),
      c("recrutamento", "Recrutamento", "Vagas abertas e funil de candidatos", "UserPlus"),
      c("folha", "Folha de Pagamento", "Salários, benefícios e encargos (confidencial)", "Banknote"),
      c("avaliacoes", "Avaliações", "Ciclos de desempenho e PDI", "Star"),
    ],
  },
  {
    slug: "financeiro", name: "Financeiro", group: "Pessoas & Gestão", icon: "Wallet",
    description: "Fluxo de caixa, contas a pagar e a receber.",
    cards: [
      c("fluxo_caixa", "Fluxo de Caixa", "Entradas e saídas previstas x realizadas", "TrendingUp"),
      c("contas_pagar", "Contas a Pagar", "Vencimentos e aprovações", "ArrowUpRight"),
      c("contas_receber", "Contas a Receber", "Cobranças e inadimplência", "ArrowDownLeft"),
      c("orcamento", "Orçamento", "Orçado x realizado por departamento", "PieChart"),
    ],
  },
  {
    slug: "projetos", name: "Projetos", group: "Operação", icon: "FolderKanban",
    description: "Portfólio de projetos, tarefas e entregas.",
    cards: [
      c("projetos_ativos", "Projetos Ativos", "Status, prazos e responsáveis", "FolderKanban"),
      c("tarefas", "Tarefas", "Backlog e tarefas em andamento", "ListTodo"),
      c("marcos", "Marcos", "Próximas entregas e milestones", "Flag"),
      c("riscos", "Riscos", "Riscos abertos e planos de mitigação", "AlertTriangle"),
    ],
  },
  {
    slug: "ti", name: "TI", group: "Tecnologia", icon: "Monitor",
    description: "Infraestrutura, chamados internos e ativos de TI.",
    cards: [
      c("chamados_ti", "Chamados Internos", "Solicitações de colaboradores", "LifeBuoy"),
      c("ativos_ti", "Ativos de TI", "Notebooks, licenças e periféricos", "Laptop"),
      c("infraestrutura", "Infraestrutura", "Servidores, rede e backups", "Server"),
      c("acessos", "Gestão de Acessos", "Onboarding/offboarding de contas", "KeyRound"),
    ],
  },
  {
    slug: "vendas", name: "Vendas", group: "Negócio", icon: "TrendingUp",
    description: "Pipeline, metas e fechamento de negócios.",
    cards: [
      c("pipeline", "Pipeline", "Oportunidades por estágio", "Target"),
      c("metas", "Metas", "Meta x realizado do time", "Trophy"),
      c("propostas", "Propostas", "Propostas enviadas e aguardando", "FileSignature"),
      c("comissoes", "Comissões", "Comissões a pagar por vendedor", "Coins"),
    ],
  },
  {
    slug: "suporte", name: "Suporte", group: "Operação", icon: "Headphones",
    description: "Suporte técnico, SLA e base de conhecimento.",
    cards: [
      c("tickets", "Tickets", "Fila por prioridade e SLA", "Ticket"),
      c("sla", "SLA", "Tempo de resposta e resolução", "Timer"),
      c("base_conhecimento", "Base de Conhecimento", "Artigos e soluções", "BookOpen"),
      c("escalonamentos", "Escalonamentos", "Casos escalados para N2/N3", "ArrowUpCircle"),
    ],
  },
  {
    slug: "operacoes", name: "Operações", group: "Operação", icon: "Cog",
    description: "Ordens de serviço, processos e capacidade.",
    cards: [
      c("ordens_servico", "Ordens de Serviço", "OS abertas, em execução e concluídas", "Wrench"),
      c("processos", "Processos", "Mapa de processos e POPs", "Workflow"),
      c("capacidade", "Capacidade", "Alocação de equipes", "Gauge"),
      c("indicadores_ops", "Indicadores", "Produtividade e retrabalho", "BarChart3"),
    ],
  },
  {
    slug: "marketing", name: "Marketing", group: "Negócio", icon: "Megaphone",
    description: "Campanhas, conteúdo, leads e marca.",
    cards: [
      c("campanhas", "Campanhas", "Campanhas ativas e performance", "Megaphone"),
      c("calendario_editorial", "Calendário Editorial", "Posts e conteúdos planejados", "CalendarRange"),
      c("leads_mkt", "Leads", "Leads gerados por canal", "Magnet"),
      c("verba", "Verba de Mídia", "Investimento e CAC", "BadgeDollarSign"),
    ],
  },
  {
    slug: "comercial", name: "Comercial", group: "Negócio", icon: "Handshake",
    description: "Contas-chave, contratos e parcerias.",
    cards: [
      c("contas_chave", "Contas-chave", "Clientes estratégicos e saúde da conta", "Building"),
      c("contratos", "Contratos", "Vigência, renovações e reajustes", "FileText"),
      c("parcerias", "Parcerias", "Canais e parceiros", "Handshake"),
      c("tabela_precos", "Tabela de Preços", "Preços e políticas de desconto", "Tags"),
    ],
  },
  {
    slug: "compras", name: "Compras", group: "Operação", icon: "ShoppingCart",
    description: "Requisições, cotações e fornecedores.",
    cards: [
      c("requisicoes", "Requisições", "Pedidos internos de compra", "ClipboardList"),
      c("cotacoes", "Cotações", "Comparativo de fornecedores", "Scale"),
      c("pedidos_compra", "Pedidos de Compra", "POs emitidos e recebimentos", "ShoppingCart"),
      c("fornecedores", "Fornecedores", "Cadastro e avaliação", "Factory"),
    ],
  },
  {
    slug: "logistica", name: "Logística", group: "Operação", icon: "Truck",
    description: "Estoque, expedição e transporte.",
    cards: [
      c("estoque", "Estoque", "Saldos e itens abaixo do mínimo", "Package"),
      c("expedicao", "Expedição", "Envios do dia e pendências", "PackageCheck"),
      c("transportes", "Transportes", "Rotas, fretes e transportadoras", "Truck"),
      c("custodia", "Custódia", "Equipamentos sob responsabilidade", "Archive"),
    ],
  },
  {
    slug: "qualidade", name: "Qualidade", group: "Operação", icon: "BadgeCheck",
    description: "Não conformidades, auditorias e melhoria contínua.",
    cards: [
      c("nao_conformidades", "Não Conformidades", "RNCs abertas e ações corretivas", "AlertOctagon"),
      c("auditorias_qualidade", "Auditorias", "Agenda de auditorias internas", "ClipboardCheck"),
      c("indicadores_qualidade", "Indicadores", "NPS interno, defeitos, retrabalho", "LineChart"),
      c("documentos_sgq", "Documentos do SGQ", "Procedimentos e normas", "FileCheck"),
    ],
  },
  {
    slug: "pmo", name: "PMO", group: "Pessoas & Gestão", icon: "LayoutGrid",
    description: "Governança do portfólio e metodologia.",
    cards: [
      c("portfolio", "Portfólio", "Visão consolidada de todos os projetos", "LayoutGrid"),
      c("status_report", "Status Report", "Relatórios semanais", "FileBarChart"),
      c("capacidade_pmo", "Capacidade x Demanda", "Alocação de recursos entre projetos", "Gauge"),
      c("metodologia", "Metodologia", "Templates e boas práticas", "BookMarked"),
    ],
  },
  {
    slug: "seguranca-informacao", name: "Segurança da Informação", group: "Tecnologia", icon: "ShieldCheck",
    description: "Riscos, incidentes, LGPD e controles.",
    cards: [
      c("incidentes", "Incidentes", "Incidentes de segurança abertos", "Siren"),
      c("riscos_si", "Riscos", "Matriz de riscos e controles", "ShieldAlert"),
      c("lgpd", "LGPD", "Solicitações de titulares e ROPA", "Lock"),
      c("revisao_acessos", "Revisão de Acessos", "Recertificação periódica", "UserCheck"),
    ],
  },
  {
    slug: "contabilidade", name: "Contabilidade", group: "Pessoas & Gestão", icon: "Calculator",
    description: "Fechamento contábil, fiscal e obrigações.",
    cards: [
      c("fechamento", "Fechamento Mensal", "Checklist de fechamento", "CalendarCheck"),
      c("obrigacoes", "Obrigações Fiscais", "SPED, DCTF e prazos", "Landmark"),
      c("conciliacao", "Conciliação", "Conciliação bancária e contábil", "GitCompare"),
      c("dre", "DRE", "Demonstrativo de resultados", "FileSpreadsheet"),
    ],
  },
  {
    slug: "administrativo", name: "Administrativo", group: "Pessoas & Gestão", icon: "Briefcase",
    description: "Facilities, contratos administrativos e rotinas.",
    cards: [
      c("facilities", "Facilities", "Manutenção predial e espaços", "Building2"),
      c("contratos_adm", "Contratos Administrativos", "Aluguel, limpeza, utilidades", "FileText"),
      c("viagens", "Viagens", "Solicitações e reembolsos", "Plane"),
      c("malote", "Correspondências", "Malote e protocolos", "Mail"),
    ],
  },
  {
    slug: "atendimento-cliente", name: "Atendimento ao Cliente", group: "Negócio", icon: "MessageCircle",
    description: "Relacionamento, canais de atendimento e satisfação.",
    cards: [
      c("atendimentos", "Atendimentos", "Conversas por canal (WhatsApp, e-mail, telefone)", "MessageCircle"),
      c("satisfacao", "Satisfação", "CSAT e NPS", "Smile"),
      c("reclamacoes", "Reclamações", "Reclame Aqui e ouvidoria", "MessageSquareWarning"),
      c("roteiros", "Roteiros", "Scripts e respostas prontas", "ScrollText"),
    ],
  },
  {
    slug: "dados-analytics", name: "Dados e Analytics", group: "Tecnologia", icon: "BarChart3",
    description: "Dashboards, KPIs e qualidade de dados.",
    cards: [
      c("dashboards", "Dashboards", "Painéis publicados por área", "LayoutDashboard"),
      c("kpis", "KPIs", "Definições e metas de indicadores", "Activity"),
      c("pipelines_dados", "Pipelines", "Cargas e integrações de dados", "Database"),
      c("solicitacoes_dados", "Solicitações", "Pedidos de relatórios", "Inbox"),
    ],
  },
  {
    slug: "assistente-executivo", name: "Assistente Executivo", group: "Diretoria", icon: "Crown",
    description: "Agenda, pendências e briefings da diretoria.",
    cards: [
      c("agenda_executiva", "Agenda", "Compromissos da diretoria", "CalendarClock"),
      c("pendencias", "Pendências", "Decisões e aprovações aguardando", "Inbox"),
      c("briefing_diario", "Briefing Diário", "Resumo consolidado das áreas", "Newspaper"),
      c("viagens_exec", "Viagens", "Reservas e itinerários", "Plane"),
    ],
  },
] as const;

export const DEPARTMENT_SLUGS: readonly DepartmentSlug[] = DEPARTMENTS.map((d) => d.slug);

export function getDepartment(slug: string): DepartmentDefinition | undefined {
  return DEPARTMENTS.find((d) => d.slug === slug);
}

export function isDepartmentSlug(slug: string): slug is DepartmentSlug {
  return DEPARTMENT_SLUGS.includes(slug as DepartmentSlug);
}
