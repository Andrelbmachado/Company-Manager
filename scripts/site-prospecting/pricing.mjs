// Pacotes e preços do projeto "Desenvolvimento de Site".
//
// Fonte: ~/LeadingSitesSorocaba/Proposta_Comercial.md (preços FIXOS por segmento, implantação + mensalidade,
// com fidelidade mínima de 12 meses; faixa de implantação R$ 1.600 a R$ 12.000) e INSTRUCAO_PACOTES.md
// (pacotes BÁSICO, ESSENCIAL e PREMIUM).
//
// Correspondência com as colunas da Proposta: BÁSICO = "Básico"; ESSENCIAL = "Com funcionalidade-chave";
// PREMIUM = "Premium com SEO". O que muda é o produto (vitrine / gerenciador / os dois), o preço segue a tabela.

export const PACKAGES = [
  {
    code: "basico",
    name: "Básico",
    sortOrder: 1,
    description: "Só a vitrine: o site público para o cliente final, com fotos, cardápio ou serviços, preços, formulário de contato e atendente de WhatsApp. Sem painel de gestão. Mensalidade com fidelidade mínima de 12 meses.",
    features: [
      "Site público responsivo de 4 a 5 páginas",
      "Fotos, cardápio ou serviços e preços do cliente",
      "Formulário de contato e atendente de WhatsApp",
      "Mapa, horários e link para as avaliações do Google",
      "Domínio no nome do cliente, hospedagem e SSL",
    ],
  },
  {
    code: "essencial",
    name: "Essencial",
    sortOrder: 2,
    description: "Só o gerenciador: painel com login para donos e funcionários, específico do segmento. Sem vitrine pública. Mensalidade com fidelidade mínima de 12 meses.",
    features: [
      "Painel com login para donos e funcionários",
      "Módulos do dia a dia do segmento",
      "Perfis de acesso por função",
      "Hospedagem, backup e suporte",
    ],
  },
  {
    code: "premium",
    name: "Premium",
    sortOrder: 3,
    description: "Vitrine e gerenciador juntos, com chave para ativar ou desativar o módulo de gestão. Mensalidade com fidelidade mínima de 12 meses.",
    features: [
      "Tudo do Básico (vitrine pública)",
      "Tudo do Essencial (painel de gestão do segmento)",
      "Chave para ativar ou desativar o módulo de gestão",
      "SEO local e relatório mensal",
    ],
  },
];

export const PET_SHOP_SEGMENT = "Pet shop / banho e tosa / hotel";

// Preço por segmento de preço: [implantação, mensalidade] em R$ para cada pacote (Proposta Comercial, seção 1).
// Chaves = valores da coluna "segmento" do CSV, mais o segmento de pet shop, que a Proposta separa.
export const PRICES = {
  "Pet/Veterinária": { basico: [2200, 149], essencial: [4200, 249], premium: [7800, 449] },
  [PET_SHOP_SEGMENT]: { basico: [1800, 129], essencial: [3200, 229], premium: [5900, 399] },
  "Clínicas": { basico: [2600, 169], essencial: [4800, 279], premium: [9500, 549] },
  "Advocacia": { basico: [2600, 169], essencial: [4800, 279], premium: [9500, 549] },
  "Contabilidade": { basico: [2200, 149], essencial: [4500, 249], premium: [8500, 499] },
  "Eventos/Buffets": { basico: [2200, 149], essencial: [4500, 279], premium: [8500, 499] },
  "Academias/Pilates/CrossFit": { basico: [2000, 149], essencial: [4000, 249], premium: [7000, 449] },
  "Automotivo": { basico: [2000, 149], essencial: [4500, 249], premium: [9500, 499] },
  "Arquitetura/Construção/Planejados": { basico: [2600, 169], essencial: [4800, 279], premium: [9500, 549] },
  "Escolas/Idiomas": { basico: [2000, 149], essencial: [4500, 249], premium: [8000, 449] },
  "Restaurantes": { basico: [1600, 129], essencial: [3500, 229], premium: [6500, 399] },
  "Salões/Barbearias": { basico: [1600, 129], essencial: [3200, 229], premium: [5900, 399] },
  "Imobiliárias": { basico: [3000, 199], essencial: [6500, 349], premium: [12000, 649] },
};

// Escopo base do gerenciador por segmento (Essencial e Premium). Buffet, veterinária e restaurante vêm da
// INSTRUCAO_PACOTES.md; os demais partem da "funcionalidade-chave" da Proposta e devem ser detalhados com o cliente.
export const MANAGEMENT_SCOPE = {
  "Pet/Veterinária": "Prontuários, agenda de consultas, vacinas e lembretes de retorno, tutores e pets",
  [PET_SHOP_SEGMENT]: "Agenda de banho e tosa e de diárias, pets e tutores, lembretes",
  "Clínicas": "Agenda, pacientes e lembretes de consulta",
  "Advocacia": "Agenda de consultas e cadastro de clientes",
  "Contabilidade": "Agenda de reuniões e cadastro de clientes",
  "Eventos/Buffets": "Festas, reservas, cardápio e aniversariantes",
  "Academias/Pilates/CrossFit": "Alunos, grade de horários e aulas experimentais",
  "Automotivo": "Orçamentos, agenda de revisões e ordens de serviço",
  "Arquitetura/Construção/Planejados": "Briefings, orçamentos e projetos em andamento",
  "Escolas/Idiomas": "Matrículas, visitas e aulas experimentais, turmas",
  "Restaurantes": "Comandas, maquininha, estoque e cozinha",
  "Salões/Barbearias": "Agenda, clientes e lembretes",
  "Imobiliárias": "Imóveis, visitas e contatos",
};

// Cenários de conversão (percentual de leads que fecham).
export const SCENARIOS = [
  { code: "conservador", label: "Conservador (5%)", rate: 0.05 },
  { code: "realista", label: "Realista (10%)", rate: 0.1 },
  { code: "otimista", label: "Otimista (20%)", rate: 0.2 },
];

// Segmento de preço de um lead: a Proposta separa pet shop / banho e tosa / hotel da veterinária.
export function pricingSegment(name, category) {
  if (category === "Pet/Veterinária" && /banho|tosa|hotel|creche|pet ?shop/i.test(name)) return PET_SHOP_SEGMENT;
  return category;
}

// Pacote assumido na estimativa de receita de cada lead. Todos os 155 leads estão SEM SITE, então a porta de
// entrada é a vitrine (Básico). Negócios com 200+ avaliações no Google (operação movimentada, mais clientes
// para gerir) entram como Premium. O Essencial (só gerenciador) não é assumido: serve a quem já tem vitrine.
export function suggestPackage(reviews) {
  return reviews !== null && reviews >= 200 ? "premium" : "basico";
}

// Plano do projeto "Desenvolvimento de Site": etapas em ordem (fluxo do Project Manager) e as tarefas de cada uma.
// Status da etapa é derivado das tarefas. Sem horas estimadas de propósito: não há base para prometer esses números.
export const PROJECT_STAGES = [
  { key: "preparacao", name: "Preparação comercial", description: "Leads, pacotes, preços e mensagem de abordagem prontos.", start: "2026-10-22", end: "2026-10-26" },
  { key: "prospeccao", name: "Prospecção", description: "Abordar os leads, 5 por dia útil, do mais prioritário ao menos.", start: "2026-10-23", end: "2026-12-08" },
  { key: "templates", name: "Produção dos templates", description: "Templates de site para cada pacote.", start: null, end: null },
  { key: "entrega", name: "Entrega ao cliente", description: "Do briefing à publicação do site do cliente.", start: null, end: null },
  { key: "recorrencia", name: "Mensalidade e pós-venda", description: "Cobrança recorrente e acompanhamento.", start: null, end: null },
];

export const PROJECT_TASKS = [
  { key: "importar-leads", stage: "preparacao", title: "Importar leads de Sorocaba para o CRM", status: "concluida", priority: "alta", due: "2026-10-22", description: "155 leads do SEM_SITE_sorocaba_filtrado.csv com WhatsApp apenas para celular." },
  { key: "cadastrar-pacotes", stage: "preparacao", title: "Cadastrar pacotes, preços e previsão de receita", status: "concluida", priority: "alta", due: "2026-10-22", description: "Pacotes Básico, Essencial e Premium com a tabela de preços da Proposta Comercial." },
  { key: "validar-precos", stage: "preparacao", title: "Validar preços com a Proposta Comercial", status: "concluida", priority: "alta", due: "2026-10-26", description: "Preços fixos da Proposta Comercial aplicados à tabela do CRM." },
  { key: "mensagem-whatsapp", stage: "preparacao", title: "Redigir mensagem de abordagem por WhatsApp", status: "aberta", priority: "media", due: "2026-10-23", description: null },
  { key: "abordar-leads", stage: "prospeccao", title: "Abordar leads: 5 por dia útil", status: "aberta", priority: "media", due: "2026-12-08", description: "Seguir o cronograma de abordagem (Prospecção > Cronograma): sites quebrados primeiro, depois mais avaliações." },
  { key: "template-basico", stage: "templates", title: "Montar template do Básico (vitrine)", status: "aberta", priority: "media", due: null, description: null },
  { key: "template-agendamento", stage: "templates", title: "Montar template do Essencial (gerenciador)", status: "aberta", priority: "media", due: null, description: null },
  { key: "template-premium", stage: "templates", title: "Montar template do Premium (vitrine + gerenciador)", status: "aberta", priority: "baixa", due: null, description: null },
  { key: "processo-entrega", stage: "entrega", title: "Definir processo de entrega (briefing até publicação)", status: "aberta", priority: "media", due: null, description: null },
  { key: "cobranca-mensalidade", stage: "recorrencia", title: "Configurar cobrança de mensalidade", status: "aberta", priority: "baixa", due: null, description: null },
];

// Títulos do seed v1 que mudaram no v2 (renomeados para os novos pacotes). O upgrade só altera a tarefa se o
// título ainda for o antigo, ou seja, se ninguém a editou.
export const LEGACY_TASK_TITLES = {
  "validar-precos": "Validar preços com a Proposta Comercial",
  "template-agendamento": "Montar template com agendamento",
  "template-premium": "Montar template Premium com SEO",
  "template-basico": "Montar template de site Básico",
};

// Parâmetros do cronograma de abordagem.
export const OUTREACH = {
  perDay: 5,
  startDate: "2026-10-23", // próximo dia útil após a geração (2026-10-22)
  // Feriados nacionais dentro da janela (não há dados municipais de Sorocaba aqui).
  holidays: ["2026-11-02", "2026-11-20", "2026-12-25", "2027-01-01"],
};
