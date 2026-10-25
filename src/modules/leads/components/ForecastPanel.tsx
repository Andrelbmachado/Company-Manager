import { useMemo } from "react";
import { TrendingUp } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { KpiCard } from "@/components/shared/KpiCard";
import { NoFilterMatchRow, SortableHeader, TableFilterBar, TableFilterToolbar, useSortFilter, type SortFilterColumn } from "@/components/shared/table";
import { formatMoney } from "@/lib/prospecting/contact";
import { computeForecasts, type ForecastRow } from "@/lib/prospecting/forecast";
import type { Lead, RevenueScenario } from "@/types";

interface ForecastPanelProps {
  scenarios: RevenueScenario[];
  /** Leads da prospecção escolhida: a previsão é calculada na hora só com eles. */
  leads: Lead[];
}

const TH = "px-4 py-3 text-sm";

interface ScenarioLine {
  scenario: RevenueScenario;
  total: ForecastRow | undefined;
}

const SCENARIO_COLUMNS: SortFilterColumn<ScenarioLine>[] = [
  { key: "label", header: "Cenário", kind: "text", sortValue: (line) => line.scenario.label },
  { key: "expected_closed", header: "Fechamentos esperados", kind: "number", sortValue: (line) => line.total?.expected_closed ?? 0 },
  { key: "forecast_setup", header: "Implantação", kind: "money", sortValue: (line) => line.total?.forecast_setup ?? 0 },
  { key: "forecast_monthly", header: "Recorrência mensal", kind: "money", sortValue: (line) => line.total?.forecast_monthly ?? 0 },
  { key: "forecast_revenue", header: "Receita no 1º ano", kind: "money", sortValue: (line) => line.total?.forecast_revenue ?? 0 },
];

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
  const segments = useMemo<ForecastRow[]>(() => (scenarios.length ? rows.filter((row) => row.scenarioCode === scenarios[0].id && row.segment !== null) : []), [rows, scenarios]);
  const scenarioLines = useMemo<ScenarioLine[]>(() => scenarios.map((scenario) => ({ scenario, total: rows.find((row) => row.scenarioCode === scenario.id && row.segment === null) })), [rows, scenarios]);
  const segmentColumns = useMemo<SortFilterColumn<ForecastRow>[]>(
    () => [
      { key: "segment", header: "Segmento", kind: "text" },
      { key: "leads_count", header: "Leads", kind: "integer" },
      { key: "potential_revenue", header: "Potencial (100%)", kind: "money" },
      ...scenarios.map<SortFilterColumn<ForecastRow>>((scenario) => ({
        key: `cenario:${scenario.id}`,
        header: scenario.label,
        kind: "money",
        sortValue: (segment) => rows.find((row) => row.scenarioCode === scenario.id && row.segment === segment.segment)?.forecast_revenue ?? 0,
      })),
    ],
    [rows, scenarios],
  );
  const scenarioView = useSortFilter(scenarioLines, SCENARIO_COLUMNS);
  const segmentView = useSortFilter(segments, segmentColumns);

  if (scenarios.length === 0) {
    return <EmptyState icon={TrendingUp} title="Nenhum cenário" />;
  }
  if (leads.length === 0) {
    return <EmptyState icon={TrendingUp} title="Nenhum lead nesta prospecção" />;
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 md:grid-cols-3">
        {scenarios.map((scenario) => (
          <KpiCard key={scenario.id} title={scenario.label} value={formatMoney(total(scenario.id)?.forecast_revenue ?? 0)} />
        ))}
      </div>

      <div className="rounded-xl border">
        <TableFilterToolbar view={scenarioView} />
        <TableFilterBar view={scenarioView} />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                {SCENARIO_COLUMNS.map((column) => (
                  <SortableHeader key={column.key} label={column.header} sortKey={column.key} sort={scenarioView.sort} onSort={scenarioView.toggleSort} align={column.kind === "text" ? "left" : "right"} className={TH} />
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {scenarioView.rows.map(({ scenario, total: row }) => (
                <tr key={scenario.id}>
                  <td className="px-4 py-2.5 font-medium">{scenario.label}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{(row?.expected_closed ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(row?.forecast_setup ?? 0)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(row?.forecast_monthly ?? 0)}</td>
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{formatMoney(row?.forecast_revenue ?? 0)}</td>
                </tr>
              ))}
              {!scenarioView.rows.length && <NoFilterMatchRow colSpan={SCENARIO_COLUMNS.length} />}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border">
        <TableFilterToolbar view={segmentView} />
        <TableFilterBar view={segmentView} />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                {segmentColumns.map((column) => (
                  <SortableHeader key={column.key} label={column.header} sortKey={column.key} sort={segmentView.sort} onSort={segmentView.toggleSort} align={column.kind === "text" ? "left" : "right"} className={TH} />
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {/* Total de todos os segmentos: fica no topo e sai quando o filtro esconde segmentos. */}
              {segmentView.rows.length === segments.length && (
                <tr className="bg-muted/20 font-semibold">
                  <td className="px-4 py-2.5">Total</td>
                  <td className="px-4 py-2.5 text-right">{total(scenarios[0].id)?.leads_count ?? 0}</td>
                  <td className="px-4 py-2.5 text-right">{formatMoney(total(scenarios[0].id)?.potential_revenue ?? 0)}</td>
                  {scenarios.map((scenario) => <td key={scenario.id} className="px-4 py-2.5 text-right">{formatMoney(total(scenario.id)?.forecast_revenue ?? 0)}</td>)}
                </tr>
              )}
              {segmentView.rows.map((segment) => (
                <tr key={segment.segment}>
                  <td className="px-4 py-2.5 font-medium">{segment.segment}</td>
                  <td className="px-4 py-2.5 text-right text-muted-foreground">{segment.leads_count}</td>
                  <td className="px-4 py-2.5 text-right text-muted-foreground">{formatMoney(segment.potential_revenue)}</td>
                  {scenarios.map((scenario) => (
                    <td key={scenario.id} className="px-4 py-2.5 text-right">{formatMoney(segmentRow(scenario.id, segment.segment as string)?.forecast_revenue ?? 0)}</td>
                  ))}
                </tr>
              ))}
              {segments.length > 0 && !segmentView.rows.length && <NoFilterMatchRow colSpan={segmentColumns.length} />}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
