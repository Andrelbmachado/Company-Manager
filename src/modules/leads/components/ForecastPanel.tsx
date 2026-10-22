import { useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, TrendingUp } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { emit } from "@/lib/events/bus";
import { useRequiredSession } from "@/hooks/useSession";
import { usePermission } from "@/hooks/usePermission";
import { EmptyState } from "@/components/shared/EmptyState";
import { formatMoney } from "@/lib/prospecting/contact";
import { saveForecasts } from "@/lib/prospecting/seed";
import type { Lead, RevenueForecast, RevenueScenario } from "@/types";

interface ForecastPanelProps {
  projectId: string | null;
  scenarios: RevenueScenario[];
  forecasts: RevenueForecast[];
  leads: Lead[];
}

export function ForecastPanel({ projectId, scenarios, forecasts, leads }: ForecastPanelProps) {
  const session = useRequiredSession();
  const qc = useQueryClient();
  const canEdit = usePermission("edit", "leads");

  const byScenario = useMemo(() => {
    const map = new Map<string, Map<string | null, RevenueForecast>>();
    for (const row of forecasts) {
      const rows = map.get(row.scenario_id) ?? new Map<string | null, RevenueForecast>();
      rows.set(row.segment ?? null, row);
      map.set(row.scenario_id, rows);
    }
    return map;
  }, [forecasts]);

  const segments = useMemo(() => {
    const first = scenarios.map((scenario) => byScenario.get(scenario.id)).find(Boolean);
    return first ? [...first.values()].filter((row) => row.segment).sort((a, b) => b.potential_revenue - a.potential_revenue) : [];
  }, [scenarios, byScenario]);

  const recalc = useMutation({
    mutationFn: async () => {
      if (!projectId) return;
      const db = await getDb();
      await saveForecasts(db, session.company.id, projectId, scenarios, leads.map((lead) => ({ ...lead, segment: lead.pricing_segment ?? lead.category })), segments.map((row) => row.segment as string));
      await emit({
        type: "revenue_forecast.recalculated",
        companyId: session.company.id,
        actorId: session.user.id,
        entityType: "project",
        entityId: projectId,
        title: `Previsão de receita recalculada com ${leads.length} leads`,
        module: "leads",
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["revenue-forecasts", session.company.id] }),
  });

  if (scenarios.length === 0 || forecasts.length === 0) {
    return <EmptyState icon={TrendingUp} title="Sem previsão cadastrada" description="A previsão é gerada junto com a importação dos leads." />;
  }

  const total = (scenarioId: string) => byScenario.get(scenarioId)?.get(null);
  const potential = total(scenarios[0].id)?.potential_revenue ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-sm text-muted-foreground">
          <strong className="text-foreground">Estimativa de receita.</strong> Potencial por lead = implantação + 12 mensalidades do pacote assumido (Premium com 200+ avaliações no Google, Básico nos demais), 1º ano, com os preços da Proposta Comercial. Descontos e meses grátis do Programa de Indicação não entram.
          Cada cenário aplica a taxa de conversão sobre toda a base de {leads.length} leads (potencial total: <strong className="text-foreground">{formatMoney(potential)}</strong>).
        </p>
        {canEdit && projectId && (
          <button
            type="button"
            onClick={() => recalc.mutate()}
            disabled={recalc.isPending}
            className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw size={14} className={recalc.isPending ? "animate-spin" : undefined} /> Recalcular a partir dos leads
          </button>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {scenarios.map((scenario) => {
          const row = total(scenario.id);
          if (!row) return null;
          return (
            <article key={scenario.id} className="rounded-xl border bg-card p-5">
              <p className="text-[13px] font-medium text-muted-foreground">{scenario.label}</p>
              <p className="mt-2.5 font-display text-[clamp(1.75rem,2.6vw,2.5rem)] font-bold leading-none tracking-tight tabular-nums">{formatMoney(row.forecast_revenue)}</p>
              <p className="mt-2 text-xs text-muted-foreground">receita prevista no 1º ano, ≈ {row.expected_closed.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} fechamentos</p>
              <dl className="mt-4 grid grid-cols-2 gap-3 border-t pt-3 text-sm">
                <div><dt className="text-xs text-muted-foreground">Implantação</dt><dd className="font-semibold tabular-nums">{formatMoney(row.forecast_setup)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Recorrência mensal</dt><dd className="font-semibold tabular-nums">{formatMoney(row.forecast_monthly)}</dd></div>
              </dl>
            </article>
          );
        })}
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/30">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Segmento</th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Leads</th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Potencial (100%)</th>
              {scenarios.map((scenario) => <th key={scenario.id} className="whitespace-nowrap px-4 py-3 text-right font-medium text-muted-foreground">{scenario.label}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y">
            <tr className="bg-muted/20 font-semibold">
              <td className="px-4 py-2.5">Total</td>
              <td className="px-4 py-2.5 text-right">{total(scenarios[0].id)?.leads_count ?? 0}</td>
              <td className="px-4 py-2.5 text-right">{formatMoney(potential)}</td>
              {scenarios.map((scenario) => <td key={scenario.id} className="px-4 py-2.5 text-right">{formatMoney(total(scenario.id)?.forecast_revenue ?? 0)}</td>)}
            </tr>
            {segments.map((segment) => (
              <tr key={segment.segment}>
                <td className="px-4 py-2.5 font-medium">{segment.segment}</td>
                <td className="px-4 py-2.5 text-right text-muted-foreground">{segment.leads_count}</td>
                <td className="px-4 py-2.5 text-right text-muted-foreground">{formatMoney(segment.potential_revenue)}</td>
                {scenarios.map((scenario) => (
                  <td key={scenario.id} className="px-4 py-2.5 text-right">{formatMoney(byScenario.get(scenario.id)?.get(segment.segment ?? null)?.forecast_revenue ?? 0)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
