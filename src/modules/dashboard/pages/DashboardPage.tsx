import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getDb } from "@/lib/db/client";
import { useRequiredSession } from "@/hooks/useSession";
import { useToday } from "@/hooks/useToday";
import { can } from "@/lib/permissions/rbac";
import { PageHeader } from "@/components/shared/PageHeader";
import { KpiCard } from "@/components/shared/KpiCard";
import { ensureMyEmployee } from "@/lib/hr/queries";
import { applyDueTerminations } from "@/lib/hr/employment";
import { cn, formatCurrency, todayIso } from "@/lib/utils";
import { isHrWidget, roleHome, type HomeWidget } from "@/lib/dashboard/roleHomes";
import { loadHomeMetrics, seesTeamFollowUps, type HomeContext } from "@/lib/dashboard/metrics";
import { loadDashboardOverview, periodBalance, type BalancePeriod, type Loaded } from "@/lib/dashboard/finance";
import { useAreaLabels } from "@/lib/labels/useLabel";
import { OverdueFollowUps } from "@/modules/crm/components/Activities";
import { HomeChartCard, HomeKpiCard, HomeListCard } from "../components/HomeWidgets";
import { BalanceChart } from "../components/BalanceChart";
import type { Role } from "@/types";

/** Widgets da home desenhados pelo próprio módulo (com as ações dele), em vez do cartão de lista genérico. */
const MODULE_PANELS: ReadonlySet<string> = new Set(["crm.followups"]);

/** Indicadores do setor que repetem um card do resumo do topo (some quando o card aparece). */
const COVERED_BY_OVERVIEW: Readonly<Record<string, "active_work">> = { "projects.active": "active_work" };

/** Período do balanço do topo escolhido pela pessoa (fica neste navegador/app). */
const PERIOD_KEY = "cm.dashboard.balancePeriod";
function savedPeriod(): BalancePeriod {
  try {
    const value = localStorage.getItem(PERIOD_KEY);
    return value === "mes" || value === "semana" ? value : "ano";
  } catch {
    return "ano";
  }
}

const FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** Card do resumo do topo: só título e número, clicável até a tela de onde o número vem. */
function OverviewCard({ id, title, path, loaded, loading, render }: { id: string; title: string; path: string; loaded?: Loaded<unknown>; loading: boolean; render: () => ReactNode }) {
  if (loading && !loaded) return <div data-card={id} className="h-[7.5rem] animate-pulse rounded-xl border bg-card" aria-hidden="true" />;
  const error = loaded && !loaded.ok ? `Não foi possível carregar: ${loaded.error}` : null;
  return (
    <Link to={path} data-card={id} title={error ?? undefined} className={cn("group block rounded-xl", FOCUS)}>
      <KpiCard title={title} value={loaded?.ok ? render() : <span className={error ? "text-destructive" : undefined}>—</span>} className="h-full transition-colors group-hover:border-primary/60" />
    </Link>
  );
}

/**
 * Dashboard: no topo, o resumo (resultado do mês, a pagar e a receber na semana, trabalhos ativos; títulos da área da
 * empresa) e o balanço, cada um só para quem vê o recurso (src/lib/dashboard/finance.ts). O título do balanço troca
 * entre anual, mensal e semanal (o semanal é o fluxo dos próximos 7 dias). Abaixo, a home por setor: indicadores,
 * pendências e gráfico do papel (src/lib/dashboard/roleHomes.ts); sem atalhos e sem Meu RH (tem tela própria).
 * Os números de RH e folha ficam numa consulta ["hr", "dashboard", ...] (as telas de RH e da Folha a invalidam);
 * os demais em ["dashboard-kpis", ...] (Financeiro, Estoque e Custódia invalidam). Cada widget que falha mostra o erro só nele.
 */
export default function DashboardPage() {
  const session = useRequiredSession();
  const qc = useQueryClient();
  const role = session.membership.role as Role;
  const companyId = session.company.id;
  const userId = session.user.id;
  // Vira à meia-noite: com o app aberto de um dia para o outro, a semana, o mês e o gráfico não ficam no dia anterior.
  const today = useToday();
  const { label, profile, loading: labelsLoading } = useAreaLabels();
  const widgets = useMemo(() => roleHome(role), [role]);
  const sectorData = useMemo(() => widgets.filter((widget) => !isHrWidget(widget) && !MODULE_PANELS.has(widget.id)), [widgets]);
  const hrData = useMemo(() => widgets.filter((widget) => isHrWidget(widget)), [widgets]);
  const [period, setPeriod] = useState<BalancePeriod>(savedPeriod);
  function changePeriod(next: BalancePeriod) {
    setPeriod(next);
    try {
      localStorage.setItem(PERIOD_KEY, next);
    } catch {
      // sem armazenamento: vale só nesta visita
    }
  }
  const context = (): HomeContext => ({ companyId, userId, role, today: todayIso(), now: new Date() });

  // Resumo do topo: resultado do mês, semana a pagar/receber e o balanço (financeiro), e os trabalhos ativos (projetos).
  const showFinance = can(role, "view", "finance") && can(role, "view", "payables") && can(role, "view", "receivables");
  const showWork = can(role, "view", "projects");
  const overview = useQuery({
    // "dashboard-kpis": as gravações do financeiro invalidam (invalidateFinance). A área entra na chave porque muda
    // o que conta como trabalho ativo (projetos ou clientes).
    queryKey: ["dashboard-kpis", "overview", companyId, role, today, profile],
    queryFn: async () => loadDashboardOverview(await getDb(), companyId, { today, finance: showFinance, work: showWork, profile }),
    enabled: (showFinance || showWork) && !labelsLoading,
    refetchInterval: 60_000,
    staleTime: 15_000,
  });
  const overviewLoading = labelsLoading || overview.isLoading;
  const daily = useQuery({
    // Mesmo prefixo "dashboard-kpis": as gravações do financeiro também invalidam o balanço por dia.
    queryKey: ["dashboard-kpis", "balance", companyId, period, today],
    queryFn: async () => periodBalance(await getDb(), companyId, period as "mes" | "semana", today),
    enabled: showFinance && period !== "ano",
    refetchInterval: 60_000,
    staleTime: 15_000,
  });
  const data = overview.data;
  const monthValue = data?.month?.ok ? data.month.value.result : 0;
  const overviewCards = [
    showFinance && {
      id: "result",
      title: label(monthValue < 0 ? "dashboard.debt" : "dashboard.profit"),
      path: "/finance/fluxo-de-caixa",
      loaded: data?.month,
      // Dívida é estado (vermelho); o título já diz que é dívida, então o número vai sem sinal.
      render: () => (monthValue < 0 ? <span className="text-destructive">{formatCurrency(-monthValue)}</span> : formatCurrency(monthValue)),
    },
    showFinance && { id: "payables_week", title: label("dashboard.payables_week"), path: "/finance", loaded: data?.payables, render: () => formatCurrency(data?.payables?.ok ? data.payables.value.total : 0) },
    showFinance && { id: "receivables_week", title: label("dashboard.receivables_week"), path: "/finance", loaded: data?.receivables, render: () => formatCurrency(data?.receivables?.ok ? data.receivables.value.total : 0) },
    showWork && { id: "active_work", title: label("dashboard.active_work"), path: "/projects", loaded: data?.activeWork, render: () => new Intl.NumberFormat("pt-BR").format(data?.activeWork?.ok ? data.activeWork.value : 0) },
  ].filter((card): card is Exclude<typeof card, false> => !!card);
  const overviewFailure = overview.error ? (overview.error instanceof Error ? overview.error.message : String(overview.error)) : null;
  const overviewErrors = overviewFailure
    ? [`o resumo: ${overviewFailure}`]
    : overviewCards.flatMap((card) => (card.loaded && !card.loaded.ok ? [`${card.title}: ${card.loaded.error}`] : []));
  const covered = new Set(overviewCards.map((card) => card.id));

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
  const own = widgets.filter((widget) => !(COVERED_BY_OVERVIEW[widget.id] && covered.has(COVERED_BY_OVERVIEW[widget.id])));
  const kpis = own.filter((widget) => widget.kind === "kpi");
  const panels = own.filter((widget) => widget.kind === "list" || widget.kind === "chart");

  const panel = (widget: HomeWidget) =>
    widget.id === "crm.followups" ? (
      // Follow-ups vencidos do CRM com Concluir na própria home: os da pessoa, ou da equipe para quem gerencia.
      <div key={widget.id} data-widget={widget.id}>
        <OverdueFollowUps userId={seesTeamFollowUps(role) ? null : userId} limit={5} className="h-full" />
      </div>
    ) : widget.kind === "chart"
      ? <HomeChartCard key={widget.id} widget={widget} result={results[widget.id]} loading={loading} />
      : <HomeListCard key={widget.id} widget={widget} result={results[widget.id]} loading={loading} />;

  return (
    <div className="space-y-8">
      <PageHeader title={label("module.dashboard")} />

      {overviewCards.length > 0 && (
        <section aria-labelledby="home-resumo" data-overview="" className="space-y-3">
          <h2 id="home-resumo" className="sr-only">Resumo</h2>
          <div className={cn("grid grid-cols-1 gap-4 sm:grid-cols-2", overviewCards.length >= 4 ? "xl:grid-cols-4" : overviewCards.length === 3 && "xl:grid-cols-3")}>
            {overviewCards.map((card) => (
              <OverviewCard key={card.id} id={card.id} title={card.title} path={card.path} loaded={card.loaded} loading={overviewLoading} render={card.render} />
            ))}
          </div>
          {overviewErrors.length > 0 && (
            <p role="alert" className="text-sm text-destructive">{`Não foi possível carregar ${overviewErrors.join("; ")}.`}</p>
          )}
        </section>
      )}

      {showFinance && (
        <BalanceChart
          period={period}
          onPeriodChange={changePeriod}
          points={data?.balance?.ok ? data.balance.value : undefined}
          dayPoints={period === "ano" ? undefined : daily.data}
          error={
            period === "ano"
              ? data?.balance && !data.balance.ok ? data.balance.error : overviewFailure
              : daily.error ? (daily.error instanceof Error ? daily.error.message : String(daily.error)) : null
          }
          loading={period === "ano" ? overviewLoading : daily.isLoading}
          today={today}
          labels={{
            title: label("dashboard.balance_chart"),
            titleMonth: label("dashboard.balance_chart_month"),
            titleWeek: label("dashboard.balance_chart_week"),
            realized: label("dashboard.balance_realized"),
            accumulated: label("dashboard.balance_accumulated"),
            forecast: label("dashboard.balance_forecast"),
          }}
        />
      )}

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

    </div>
  );
}
