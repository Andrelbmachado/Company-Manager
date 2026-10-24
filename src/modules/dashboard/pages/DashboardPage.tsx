import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getDb } from "@/lib/db/client";
import { useRequiredSession } from "@/hooks/useSession";
import { ROLE_LABELS, can } from "@/lib/permissions/rbac";
import { PageHeader } from "@/components/shared/PageHeader";
import { ensureMyEmployee } from "@/lib/hr/queries";
import { applyDueTerminations } from "@/lib/hr/employment";
import { todayIso } from "@/lib/utils";
import { ROLE_HOME_INTRO, isHrWidget, isPersonalWidget, roleHome, type HomeWidget } from "@/lib/dashboard/roleHomes";
import { loadHomeMetrics, type HomeContext } from "@/lib/dashboard/metrics";
import { HomeChartCard, HomeKpiCard, HomeListCard, HomeShortcuts } from "../components/HomeWidgets";
import type { Role } from "@/types";

/**
 * Home por setor: indicadores, pendências, gráfico e atalhos do papel (src/lib/dashboard/roleHomes.ts), mais o Meu RH.
 * Os números de RH e folha ficam numa consulta ["hr", "dashboard", ...] (as telas de RH e da Folha a invalidam);
 * os demais em ["dashboard-kpis", ...] (Estoque e Custódia invalidam). Cada widget que falha mostra o erro só nele.
 */
export default function DashboardPage() {
  const session = useRequiredSession();
  const qc = useQueryClient();
  const role = session.membership.role as Role;
  const companyId = session.company.id;
  const userId = session.user.id;
  const widgets = useMemo(() => roleHome(role), [role]);
  const sectorData = useMemo(() => widgets.filter((widget) => widget.kind !== "shortcut" && !isHrWidget(widget)), [widgets]);
  const hrData = useMemo(() => widgets.filter((widget) => widget.kind !== "shortcut" && isHrWidget(widget)), [widgets]);
  const context = (): HomeContext => ({ companyId, userId, role, today: todayIso(), now: new Date() });

  const sector = useQuery({
    queryKey: ["dashboard-kpis", "home", companyId, userId, role],
    queryFn: async () => loadHomeMetrics(await getDb(), context(), sectorData),
    refetchInterval: 60_000,
    staleTime: 15_000,
  });
  const hr = useQuery({
    queryKey: ["hr", "dashboard", companyId, userId, role],
    queryFn: async () => {
      // Primeiro acesso de qualquer papel: cria (ou liga pelo e-mail) o cadastro de colaborador do Meu RH.
      await ensureMyEmployee(session).catch(() => undefined);
      const db = await getDb();
      const ctx = context();
      // Desligamento agendado cuja data chegou vira "desligado" (como nas telas de RH, só quem edita o RH efetiva):
      // sem isso ativos e folha da home contariam a pessoa até alguém abrir a Gestão de RH.
      const changed = can(role, "edit", "hr_admin") ? await applyDueTerminations(db, companyId, ctx.today).catch(() => 0) : 0;
      // Telas de RH e da Folha já em cache passam a ver a pessoa desligada (esta consulta fica de fora: já lê o novo).
      if (changed > 0) void qc.invalidateQueries({ queryKey: ["hr"], predicate: (query) => query.queryKey[1] !== "dashboard" });
      return loadHomeMetrics(db, ctx, hrData);
    },
    refetchInterval: 60_000,
    staleTime: 15_000,
  });

  const results = { ...sector.data, ...hr.data };
  const loading = sector.isLoading || hr.isLoading;
  const personal = widgets.filter(isPersonalWidget);
  const own = widgets.filter((widget) => !isPersonalWidget(widget));
  const kpis = own.filter((widget) => widget.kind === "kpi");
  const panels = own.filter((widget) => widget.kind === "list" || widget.kind === "chart");
  const shortcuts = own.filter((widget) => widget.kind === "shortcut");

  const panel = (widget: HomeWidget) =>
    widget.kind === "chart"
      ? <HomeChartCard key={widget.id} widget={widget} result={results[widget.id]} loading={loading} />
      : <HomeListCard key={widget.id} widget={widget} result={results[widget.id]} loading={loading} />;

  return (
    <div className="space-y-8">
      <PageHeader title="Dashboard" description={`${ROLE_LABELS[role]} · ${session.company.name}. ${ROLE_HOME_INTRO[role]}`} />

      {kpis.length > 0 && (
        <section aria-labelledby="home-indicadores">
          <h2 id="home-indicadores" className="sr-only">Indicadores do setor</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {kpis.map((widget) => <HomeKpiCard key={widget.id} widget={widget} result={results[widget.id]} loading={loading} />)}
          </div>
        </section>
      )}

      {panels.length > 0 && (
        <section aria-label="Pendências e acompanhamento" className="grid gap-4 lg:grid-cols-2">
          {panels.map(panel)}
        </section>
      )}

      {shortcuts.length > 0 && (
        <section aria-labelledby="home-atalhos" className="space-y-3">
          <h2 id="home-atalhos" className="text-sm font-semibold text-muted-foreground">Atalhos</h2>
          <HomeShortcuts widgets={shortcuts} />
        </section>
      )}

      {personal.length > 0 && (
        <section aria-labelledby="home-meu-rh" className="space-y-3">
          <h2 id="home-meu-rh" className="text-sm font-semibold text-muted-foreground">Meu RH</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {personal.map((widget) => <HomeKpiCard key={widget.id} widget={widget} result={results[widget.id]} loading={loading} />)}
          </div>
        </section>
      )}
    </div>
  );
}
