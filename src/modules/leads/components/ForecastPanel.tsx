import { useMemo } from "react";
import { TrendingUp } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { KpiCard } from "@/components/shared/KpiCard";
import { formatMoney } from "@/lib/prospecting/contact";
import { computeForecasts, type ForecastRow } from "@/lib/prospecting/forecast";
import type { Lead, RevenueScenario } from "@/types";

interface ForecastPanelProps {
  scenarios: RevenueScenario[];
  /** Leads da prospecção escolhida: a previsão é calculada na hora só com eles. */
  leads: Lead[];
}

const TH = "whitespace-nowrap px-4 py-3 font-medium text-muted-foreground";

/** Previsão de receita da campanha por cenário de conversão (estimativa sobre o potencial de cada lead). */
export function ForecastPanel({ scenarios, leads }: ForecastPanelProps) {
  const rows = useMemo(
    () =>
      computeForecasts(
        leads.map((lead) => ({ ...lead, segment: lead.pricing_segment ?? lead.category })),
        scenarios.map((scenario) => ({ code: scenario.id, conversion_rate: scenario.conversion_rate })),
      ),
    [leads, scenarios],
  );
  const total = (scenarioId: string) => rows.find((row) => row.scenarioCode === scenarioId && row.segment === null);
  const segmentRow = (scenarioId: string, segment: string) => rows.find((row) => row.scenarioCode === scenarioId && row.segment === segment);
  const segments: ForecastRow[] = scenarios.length ? rows.filter((row) => row.scenarioCode === scenarios[0].id && row.segment !== null) : [];

  if (scenarios.length === 0) {
    return <EmptyState icon={TrendingUp} title="Sem cenários de conversão cadastrados" />;
  }
  if (leads.length === 0) {
    return <EmptyState icon={TrendingUp} title="Nenhum lead nesta prospecção" description="A previsão aparece quando a prospecção tiver leads." />;
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 md:grid-cols-3">
        {scenarios.map((scenario) => (
          <KpiCard key={scenario.id} title={scenario.label} value={formatMoney(total(scenario.id)?.forecast_revenue ?? 0)} />
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/30">
            <tr>
              <th className={`${TH} text-left`}>Cenário</th>
              <th className={`${TH} text-right`}>Fechamentos esperados</th>
              <th className={`${TH} text-right`}>Implantação</th>
              <th className={`${TH} text-right`}>Recorrência mensal</th>
              <th className={`${TH} text-right`}>Receita no 1º ano</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {scenarios.map((scenario) => {
              const row = total(scenario.id);
              return (
                <tr key={scenario.id}>
                  <td className="px-4 py-2.5 font-medium">{scenario.label}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{(row?.expected_closed ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(row?.forecast_setup ?? 0)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(row?.forecast_monthly ?? 0)}</td>
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{formatMoney(row?.forecast_revenue ?? 0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/30">
            <tr>
              <th className={`${TH} text-left`}>Segmento</th>
              <th className={`${TH} text-right`}>Leads</th>
              <th className={`${TH} text-right`}>Potencial (100%)</th>
              {scenarios.map((scenario) => <th key={scenario.id} className={`${TH} text-right`}>{scenario.label}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y">
            <tr className="bg-muted/20 font-semibold">
              <td className="px-4 py-2.5">Total</td>
              <td className="px-4 py-2.5 text-right">{total(scenarios[0].id)?.leads_count ?? 0}</td>
              <td className="px-4 py-2.5 text-right">{formatMoney(total(scenarios[0].id)?.potential_revenue ?? 0)}</td>
              {scenarios.map((scenario) => <td key={scenario.id} className="px-4 py-2.5 text-right">{formatMoney(total(scenario.id)?.forecast_revenue ?? 0)}</td>)}
            </tr>
            {segments.map((segment) => (
              <tr key={segment.segment}>
                <td className="px-4 py-2.5 font-medium">{segment.segment}</td>
                <td className="px-4 py-2.5 text-right text-muted-foreground">{segment.leads_count}</td>
                <td className="px-4 py-2.5 text-right text-muted-foreground">{formatMoney(segment.potential_revenue)}</td>
                {scenarios.map((scenario) => (
                  <td key={scenario.id} className="px-4 py-2.5 text-right">{formatMoney(segmentRow(scenario.id, segment.segment as string)?.forecast_revenue ?? 0)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
