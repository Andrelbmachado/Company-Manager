// Previsão de receita por cenário de conversão. Função pura — usada pelo seed e pela aba Previsão de receita, que
// calcula na hora com os leads da prospecção escolhida.
// Todos os valores são ESTIMATIVAS derivadas da tabela de pacotes (service_packages / package_prices).

export interface ForecastLead {
  /** Segmento de preço do lead (agrupa a previsão por segmento). */
  segment?: string | null;
  estimated_setup: number;
  estimated_monthly: number;
  estimated_revenue: number;
}

export interface ForecastScenario {
  code: string;
  conversion_rate: number;
}

export interface ForecastRow {
  scenarioCode: string;
  /** null = total geral do cenário */
  segment: string | null;
  leads_count: number;
  expected_closed: number;
  potential_setup: number;
  potential_monthly: number;
  potential_revenue: number;
  forecast_setup: number;
  forecast_monthly: number;
  forecast_revenue: number;
}

const cents = (value: number) => Math.round(value * 100) / 100;

interface Bucket {
  leads: number;
  setup: number;
  monthly: number;
  revenue: number;
}

function emptyBucket(): Bucket {
  return { leads: 0, setup: 0, monthly: 0, revenue: 0 };
}

function toRow(scenario: ForecastScenario, segment: string | null, bucket: Bucket): ForecastRow {
  const rate = scenario.conversion_rate;
  return {
    scenarioCode: scenario.code,
    segment,
    leads_count: bucket.leads,
    expected_closed: cents(bucket.leads * rate),
    potential_setup: cents(bucket.setup),
    potential_monthly: cents(bucket.monthly),
    potential_revenue: cents(bucket.revenue),
    forecast_setup: cents(bucket.setup * rate),
    forecast_monthly: cents(bucket.monthly * rate),
    forecast_revenue: cents(bucket.revenue * rate),
  };
}

/**
 * Para cada cenário: uma linha de total + uma por segmento (ordenadas por potencial).
 * `knownSegments` mantém linhas zeradas de segmentos que já tinham previsão mas perderam todos os leads.
 */
export function computeForecasts(
  leads: ForecastLead[],
  scenarios: ForecastScenario[],
  knownSegments: string[] = [],
): ForecastRow[] {
  const bySegment = new Map<string, Bucket>(knownSegments.map((segment) => [segment, emptyBucket()]));
  const total = emptyBucket();

  for (const lead of leads) {
    const segment = lead.segment?.trim() || "Sem segmento";
    const bucket = bySegment.get(segment) ?? emptyBucket();
    bucket.leads += 1;
    bucket.setup += lead.estimated_setup;
    bucket.monthly += lead.estimated_monthly;
    bucket.revenue += lead.estimated_revenue;
    bySegment.set(segment, bucket);
    total.leads += 1;
    total.setup += lead.estimated_setup;
    total.monthly += lead.estimated_monthly;
    total.revenue += lead.estimated_revenue;
  }

  const segments = [...bySegment.entries()].sort(([nameA, a], [nameB, b]) => b.revenue - a.revenue || nameA.localeCompare(nameB, "pt-BR"));

  return scenarios.flatMap((scenario) => [
    toRow(scenario, null, total),
    ...segments.map(([segment, bucket]) => toRow(scenario, segment, bucket)),
  ]);
}
