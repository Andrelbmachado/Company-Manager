// Perfil de área da empresa: o mesmo app serve TI, advocacia, serviços e comércio trocando os rótulos de cards,
// gráficos e módulos. Ordem de precedência: sobrescrita da empresa (`company.labels`) → texto do perfil
// (`company.area_profile`) → texto padrão da chave → a própria chave (nunca texto vazio).
// Puro (sem banco nem React): a leitura/gravação fica em store.ts e o hook em useLabel.ts.
import type { AreaProfile } from "@/types";

export type { AreaProfile };

export const AREA_PROFILES: readonly AreaProfile[] = ["ti", "advocacia", "servicos", "comercio", "personalizado"];

export const AREA_PROFILE_LABELS: Record<AreaProfile, string> = {
  ti: "TI e tecnologia",
  advocacia: "Advocacia",
  servicos: "Prestação de serviços",
  comercio: "Comércio",
  personalizado: "Personalizado",
};

/** Perfil de quem nunca escolheu (os textos de hoje do app, que nasceu numa empresa de TI). */
export const DEFAULT_AREA_PROFILE: AreaProfile = "ti";

/** Tamanho máximo de um rótulo personalizado (cabe num card e na sidebar). */
export const MAX_LABEL_LENGTH = 60;

export type LabelGroup = "Dashboard" | "Módulos";

/** Perfis com texto próprio ("personalizado" usa o texto padrão + as sobrescritas). */
type ProfileTexts = Partial<Record<Exclude<AreaProfile, "personalizado">, string>>;

export interface LabelDef {
  key: string;
  group: LabelGroup;
  /** Onde o rótulo aparece (coluna da tabela em Configurações > Área da empresa). */
  description: string;
  /** Texto padrão (perfil sem texto próprio e "personalizado"). */
  text: string;
  profiles?: ProfileTexts;
}

const DEFS = [
  // Dashboard (Tarefa 4): 4 cards e o gráfico do balanço anual.
  { key: "dashboard.profit", group: "Dashboard", description: "Card de resultado do mês, quando positivo", text: "Lucro do mês" },
  { key: "dashboard.debt", group: "Dashboard", description: "Card de resultado do mês, quando negativo", text: "Dívida do mês" },
  { key: "dashboard.payables_week", group: "Dashboard", description: "Card de contas a pagar até domingo", text: "A pagar na semana" },
  { key: "dashboard.receivables_week", group: "Dashboard", description: "Card de contas a receber até domingo", text: "A receber na semana" },
  {
    key: "dashboard.active_work",
    group: "Dashboard",
    description: "Card de trabalhos em andamento",
    text: "Projetos ativos",
    profiles: { advocacia: "Clientes ativos", servicos: "Serviços em andamento" },
  },
  { key: "dashboard.balance_chart", group: "Dashboard", description: "Título do gráfico do ano", text: "Balanço anual" },
  { key: "dashboard.balance_chart_month", group: "Dashboard", description: "Título do gráfico do mês (dia a dia)", text: "Balanço mensal" },
  { key: "dashboard.balance_chart_week", group: "Dashboard", description: "Título do gráfico dos próximos 7 dias", text: "Balanço semanal" },
  { key: "dashboard.balance_realized", group: "Dashboard", description: "Linha do resultado de cada mês", text: "Resultado do mês" },
  { key: "dashboard.balance_accumulated", group: "Dashboard", description: "Linha do total acumulado no ano", text: "Acumulado no ano" },
  { key: "dashboard.balance_forecast", group: "Dashboard", description: "Linha tracejada da previsão", text: "Previsão de receita" },

  // Módulos: item da sidebar, título na busca e título da página.
  { key: "module.dashboard", group: "Módulos", description: "Página inicial", text: "Dashboard" },
  { key: "module.calendar", group: "Módulos", description: "Agenda da empresa (Visão Geral)", text: "Calendário" },
  { key: "module.hr", group: "Módulos", description: "RH do próprio colaborador", text: "Meu RH" },
  { key: "module.hr_manage", group: "Módulos", description: "Gestão de pessoas", text: "Gestão de RH" },
  { key: "module.crm", group: "Módulos", description: "Cadastro de clientes", text: "CRM", profiles: { advocacia: "Clientes" } },
  { key: "module.leads", group: "Módulos", description: "Prospecção de novos clientes", text: "Prospecção" },
  { key: "module.opportunities", group: "Módulos", description: "Funil de oportunidades", text: "Oportunidades", profiles: { advocacia: "Novos casos" } },
  { key: "module.sales", group: "Módulos", description: "Pedidos de venda e faturas", text: "Vendas", profiles: { advocacia: "Faturamento", servicos: "Faturamento" } },
  { key: "module.catalog", group: "Módulos", description: "Produtos, serviços e tabelas de preço", text: "Catálogo", profiles: { advocacia: "Serviços", servicos: "Serviços" } },
  { key: "module.operations", group: "Módulos", description: "Ordens de serviço", text: "Ordens de Serviço" },
  {
    key: "module.projects",
    group: "Módulos",
    description: "Projetos, etapas e tarefas",
    text: "Project Manager",
    profiles: { advocacia: "Processos", servicos: "Projetos", comercio: "Projetos" },
  },
  { key: "module.products", group: "Módulos", description: "Desenvolvimento de produtos", text: "Desenv. de Produtos" },
  { key: "module.inventory", group: "Módulos", description: "Itens e saldos de estoque", text: "Estoque" },
  { key: "module.custody", group: "Módulos", description: "Peças emprestadas", text: "Custódia de peça" },
  { key: "module.purchasing", group: "Módulos", description: "Pedidos de compra e recebimento", text: "Compras" },
  { key: "module.suppliers", group: "Módulos", description: "Cadastro de fornecedores (Logística)", text: "Fornecedores" },
  { key: "module.finance", group: "Módulos", description: "Contas a pagar e a receber", text: "Financeiro" },
  { key: "module.payroll", group: "Módulos", description: "Salários (só CEO e Administração)", text: "Folha de pagamento" },
  { key: "module.documents", group: "Módulos", description: "Pastas e arquivos", text: "Documentos" },
  { key: "module.reports", group: "Módulos", description: "Relatórios", text: "Relatórios" },
  { key: "module.imports", group: "Módulos", description: "Importação de planilhas", text: "Importar dados" },
  { key: "module.audit", group: "Módulos", description: "Histórico de ações", text: "Auditoria" },
] as const satisfies readonly LabelDef[];

export type LabelKey = (typeof DEFS)[number]["key"];

/** Todos os rótulos editáveis, na ordem da tabela de Configurações. */
export const LABEL_DEFS: readonly LabelDef[] = DEFS;

export const LABEL_KEYS: readonly LabelKey[] = DEFS.map((def) => def.key);

/** Sobrescritas gravadas pela empresa: chave → texto. */
export type LabelOverrides = Readonly<Record<string, string>>;

const BY_KEY = new Map<string, LabelDef>(LABEL_DEFS.map((def) => [def.key, def]));

export function isLabelKey(key: string): key is LabelKey {
  return BY_KEY.has(key);
}

export function parseAreaProfile(value: unknown): AreaProfile {
  return typeof value === "string" && (AREA_PROFILES as readonly string[]).includes(value) ? (value as AreaProfile) : DEFAULT_AREA_PROFILE;
}

/** Só chaves conhecidas com texto (sem espaços nas pontas, até MAX_LABEL_LENGTH). Qualquer outra coisa é ignorada. */
export function parseLabelOverrides(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, text] of Object.entries(value as Record<string, unknown>)) {
    if (!isLabelKey(key) || typeof text !== "string") continue;
    const clean = text.trim().slice(0, MAX_LABEL_LENGTH);
    if (clean) result[key] = clean;
  }
  return result;
}

/** Texto padrão da chave (sem perfil nem sobrescrita); chave desconhecida devolve a própria chave. */
export function defaultLabelFor(key: string): string {
  return BY_KEY.get(key)?.text ?? key;
}

/** Rótulo de uma chave para o perfil, com as sobrescritas da empresa. Nunca devolve texto vazio. */
export function labelFor(key: string, profile: AreaProfile | string, overrides: LabelOverrides = {}): string {
  const override = overrides[key];
  if (typeof override === "string" && override.trim()) return override.trim();
  const def = BY_KEY.get(key);
  if (!def) return key;
  const area = parseAreaProfile(profile);
  const profileText = area === "personalizado" ? undefined : (def.profiles as ProfileTexts | undefined)?.[area];
  return profileText ?? def.text;
}
