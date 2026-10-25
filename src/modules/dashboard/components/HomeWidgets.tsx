import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { KpiCard } from "@/components/shared/KpiCard";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { cn, formatCurrency } from "@/lib/utils";
import { formatMetricValue, type HomeMetricResult, type MetricTone } from "@/lib/dashboard/metrics";
import type { HomeWidget } from "@/lib/dashboard/roleHomes";
import { HOME_ICONS } from "./homeIcons";

const TONE_TEXT: Record<MetricTone, string> = {
  neutral: "text-muted-foreground",
  success: "text-emerald-700 dark:text-emerald-400",
  warning: "text-amber-700 dark:text-amber-400",
  danger: "text-status-danger dark:text-red-400",
};

const FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function errorText(result: HomeMetricResult | undefined): string | null {
  return result && !result.ok ? `Não foi possível carregar: ${result.error}` : null;
}

/** Cor do número quando ele é um estado (vencido, atrasado); o resto fica na cor do texto (tema monocromático). */
const VALUE_TONE: Partial<Record<MetricTone, string>> = {
  warning: "text-amber-700 dark:text-amber-400",
  danger: "text-destructive",
};

/**
 * Indicador clicável que leva à tela do número: só título e número (KpiCard). O detalhe (contagem, "nada vencido",
 * erro) fica na dica e no nome acessível, não embaixo do número.
 */
export function HomeKpiCard({ widget, result, loading }: { widget: HomeWidget; result?: HomeMetricResult; loading?: boolean }) {
  const metric = result?.ok ? result.metric : null;
  const error = errorText(result);
  const value = metric ? formatMetricValue(metric) : "—";
  const hint = error ?? metric?.hint ?? widget.description;
  if (loading && !result) return <div className="h-[7.5rem] animate-pulse rounded-xl border bg-card" aria-hidden="true" />;
  const tone = error ? "text-destructive" : metric?.tone ? VALUE_TONE[metric.tone] : undefined;
  return (
    <Link to={widget.path} title={hint} aria-label={`${widget.title}: ${value}. ${hint}`} className={cn("group block rounded-xl", FOCUS)} data-widget={widget.id}>
      <KpiCard title={widget.title} value={tone ? <span className={tone}>{value}</span> : value} className="h-full transition-colors group-hover:border-primary/60" />
    </Link>
  );
}

function CardHeader({ widget, badge }: { widget: HomeWidget; badge?: string }) {
  const Icon = HOME_ICONS[widget.icon];
  return (
    <header className="flex items-center gap-2 border-b px-5 py-3">
      <Icon size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />
      <h2 className="min-w-0 flex-1 truncate font-bold">{widget.title}</h2>
      {badge && <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums">{badge}</span>}
      <Link to={widget.path} className={cn("flex shrink-0 items-center gap-1 rounded text-xs font-semibold text-primary-text hover:underline", FOCUS)} aria-label={`Abrir ${widget.title}`}>
        Abrir <ArrowRight size={12} aria-hidden="true" />
      </Link>
    </header>
  );
}

/** Pendências com itens (follow-ups vencidos, solicitações, itens abaixo do mínimo...). */
export function HomeListCard({ widget, result, loading }: { widget: HomeWidget; result?: HomeMetricResult; loading?: boolean }) {
  const metric = result?.ok ? result.metric : null;
  const items = metric?.items ?? [];
  return (
    <section className="flex flex-col rounded-xl border bg-card" aria-label={widget.title} data-widget={widget.id}>
      <CardHeader widget={widget} badge={metric ? formatMetricValue(metric) : undefined} />
      {loading && !result ? (
        <div className="space-y-2 p-5" aria-hidden="true">{Array.from({ length: 3 }).map((_, index) => <div key={index} className="h-9 animate-pulse rounded-md bg-muted" />)}</div>
      ) : errorText(result) ? (
        <p role="alert" className={cn("px-5 py-6 text-sm", TONE_TEXT.danger)}>{errorText(result)}</p>
      ) : items.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">{metric?.hint ?? widget.description}</p>
      ) : (
        <>
          <ul className="divide-y">
            {items.map((item) => (
              <li key={item.id} className="flex items-center gap-3 px-5 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.title}</p>
                  {item.detail && <p className="truncate text-xs text-muted-foreground">{item.detail}</p>}
                </div>
                {item.badge && <StatusBadge status={item.badge.status} tone={item.badge.tone} className="shrink-0" />}
              </li>
            ))}
          </ul>
          {metric?.hint && <p className={cn("mt-auto border-t px-5 py-2.5 text-xs", TONE_TEXT[metric.tone ?? "neutral"])}>{metric.hint}</p>}
        </>
      )}
    </section>
  );
}

/**
 * Cor por série (tokens do tema, monocromático como o BalanceChart): entrada no primário e saída em cinza médio.
 * Saída de dinheiro não é estado de erro, então não usa o vermelho do destructive. Chamados em primário claro.
 */
export const SERIES_COLORS: Record<string, string> = {
  entradas: "hsl(var(--primary))",
  saidas: "hsl(var(--muted-foreground))",
  os: "hsl(var(--primary))",
  chamados: "hsl(var(--primary) / 0.4)",
};

/** Série por dia (últimos ou próximos 7 dias), só com dados reais. */
export function HomeChartCard({ widget, result, loading }: { widget: HomeWidget; result?: HomeMetricResult; loading?: boolean }) {
  const metric = result?.ok ? result.metric : null;
  const chart = metric?.chart;
  const isMoney = metric?.format === "money";
  return (
    <section className="flex flex-col rounded-xl border bg-card" aria-label={widget.title} data-widget={widget.id}>
      <CardHeader widget={widget} badge={metric ? formatMetricValue(metric) : undefined} />
      {loading && !result ? (
        <div className="m-5 h-48 animate-pulse rounded-md bg-muted" aria-hidden="true" />
      ) : errorText(result) || !chart ? (
        <p role="alert" className={cn("px-5 py-6 text-sm", TONE_TEXT.danger)}>{errorText(result) ?? "Sem dados."}</p>
      ) : (
        <div className="px-3 pb-2 pt-4">
          <div className="h-52 w-full" role="img" aria-label={`${widget.title}. ${metric?.hint ?? ""}`}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart.points} barGap={4} margin={{ top: 4, right: 8, bottom: 0, left: isMoney ? 8 : -12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={{ stroke: "hsl(var(--border))" }} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={!isMoney ? false : true}
                  width={isMoney ? 72 : 30}
                  tickFormatter={(value: number) => (isMoney ? formatCurrency(value).replace(/,00$/, "") : String(value))}
                />
                <Tooltip
                  cursor={{ fill: "hsl(var(--muted))" }}
                  formatter={(value: number) => (isMoney ? formatCurrency(value) : value)}
                  contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: "hsl(var(--popover-foreground))" }}
                />
                {chart.series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
                {chart.series.map((series) => (
                  <Bar key={series.key} dataKey={series.key} name={series.label} fill={SERIES_COLORS[series.key] ?? "hsl(var(--primary))"} radius={[4, 4, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          {metric?.hint && <p className={cn("px-2 pt-1 text-xs", TONE_TEXT[metric.tone ?? "neutral"])}>{metric.hint}</p>}
        </div>
      )}
    </section>
  );
}

/** Atalhos do setor. */
export function HomeShortcuts({ widgets }: { widgets: HomeWidget[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {widgets.map((widget) => {
        const Icon = HOME_ICONS[widget.icon];
        return (
          <li key={widget.id}>
            <Link to={widget.path} data-widget={widget.id} className={cn("flex h-full items-center gap-3 rounded-xl border bg-card px-4 py-3 transition-colors hover:border-primary/60 hover:bg-muted/40", FOCUS)}>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Icon size={17} aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{widget.title}</span>
                <span className="block truncate text-xs text-muted-foreground">{widget.description}</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
