// Tabela de pacotes e preços do projeto "Desenvolvimento de Site".
//
// ESTIMATIVA: ~/LeadingSitesSorocaba/Proposta_Comercial.md não existia quando esta tabela
// foi criada. Todos os valores abaixo são faixas estimadas (is_estimate = 1) e devem ser
// substituídos pelos valores da proposta comercial quando ela existir.
// Faixa de implantação: R$ 1.200 (Básico, segmentos simples) a R$ 15.000 (Premium com SEO, clínicas).

export const PACKAGES = [
  {
    code: "basico",
    name: "Básico",
    sortOrder: 1,
    description: "Site institucional de uma página, otimizado para celular, com botão de WhatsApp, mapa e perfil do Google conectado.",
    features: ["Site de 1 página responsivo", "Botão de WhatsApp e ligação", "Mapa e horário de funcionamento", "Domínio e hospedagem configurados"],
  },
  {
    code: "agendamento",
    name: "Com agendamento",
    sortOrder: 2,
    description: "Site multipáginas com agendamento/orçamento online, integração com WhatsApp e e-mail e painel simples de solicitações.",
    features: ["Até 5 páginas", "Agendamento ou pedido de orçamento online", "Notificação por WhatsApp e e-mail", "Galeria e depoimentos", "Tudo do Básico"],
  },
  {
    code: "premium_seo",
    name: "Premium com SEO",
    sortOrder: 3,
    description: "Site completo com SEO local, blog, conteúdo por serviço, analytics e acompanhamento mensal de posicionamento.",
    features: ["Páginas por serviço com SEO local", "Blog e conteúdo inicial", "Google Analytics e Search Console", "Relatório mensal de posicionamento", "Tudo do Com agendamento"],
  },
];

// Preço por segmento: [implantação, mensalidade] em R$ para cada pacote.
// Chaves = valores da coluna "segmento" do CSV.
export const PRICES = {
  "Academias/Pilates/CrossFit": { basico: [1800, 150], agendamento: [3500, 250], premium_seo: [6500, 450] },
  "Advocacia": { basico: [2500, 200], agendamento: [4500, 300], premium_seo: [9000, 600] },
  "Arquitetura/Construção/Planejados": { basico: [3000, 200], agendamento: [5500, 300], premium_seo: [11000, 650] },
  "Automotivo": { basico: [1500, 120], agendamento: [3200, 220], premium_seo: [6000, 400] },
  "Clínicas": { basico: [3500, 250], agendamento: [6500, 400], premium_seo: [15000, 800] },
  "Contabilidade": { basico: [2200, 180], agendamento: [3800, 280], premium_seo: [7500, 500] },
  "Escolas/Idiomas": { basico: [2500, 200], agendamento: [4800, 320], premium_seo: [9500, 600] },
  "Eventos/Buffets": { basico: [2800, 200], agendamento: [5000, 300], premium_seo: [10000, 600] },
  "Imobiliárias": { basico: [4000, 300], agendamento: [7000, 450], premium_seo: [14000, 800] },
  "Pet/Veterinária": { basico: [1800, 150], agendamento: [3600, 250], premium_seo: [7000, 450] },
  "Restaurantes": { basico: [1200, 100], agendamento: [2800, 200], premium_seo: [5500, 350] },
  "Salões/Barbearias": { basico: [1200, 100], agendamento: [2800, 200], premium_seo: [5000, 350] },
};

// Cenários de conversão (percentual de leads que fecham).
export const SCENARIOS = [
  { code: "conservador", label: "Conservador (5%)", rate: 0.05 },
  { code: "realista", label: "Realista (10%)", rate: 0.1 },
  { code: "otimista", label: "Otimista (20%)", rate: 0.2 },
];

// Pacote sugerido por lead, a partir das avaliações no Google (demanda já comprovada).
//   >= 200 avaliações  -> Premium com SEO
//   50 a 199           -> Com agendamento
//   < 50 ou sem dado   -> Básico
export function suggestPackage(reviews) {
  if (reviews !== null && reviews >= 200) return "premium_seo";
  if (reviews !== null && reviews >= 50) return "agendamento";
  return "basico";
}

// Parâmetros do cronograma de abordagem.
export const OUTREACH = {
  perDay: 5,
  startDate: "2026-10-23", // próximo dia útil após a geração (2026-10-22)
  // Feriados nacionais dentro da janela (não há dados municipais de Sorocaba aqui).
  holidays: ["2026-11-02", "2026-11-20", "2026-12-25", "2027-01-01"],
};
