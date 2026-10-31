import { useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartLegend, LineAreaChart, type LineAreaSeries } from "@/components/shared/charts/LineAreaChart";
import { useDismiss } from "@/app/layout/useDismiss";
import { cn, formatCurrency } from "@/lib/utils";
import type { AnnualBalancePoint, BalancePeriod, PeriodBalancePoint } from "@/lib/dashboard/finance";
import { SERIES_COLORS } from "./HomeWidgets";

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MONTH_NAMES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export interface BalanceChartLabels {
  title: string;
  /** Títulos do balanço por mês e por semana (o título é o botão que troca o período). */
  titleMonth?: string;
  titleWeek?: string;
  realized: string;
  accumulated: string;
  forecast: string;
}

interface BalanceChartProps {
  points?: AnnualBalancePoint[];
  /** Mês ou semana: um ponto por dia (src/lib/dashboard/finance.ts, periodBalance). */
  dayPoints?: PeriodBalancePoint[];
  period?: BalancePeriod;
  onPeriodChange?: (period: BalancePeriod) => void;
  /** Hoje ('YYYY-MM-DD'): a linha tracejada começa no último mês fechado, para continuar a linha do realizado. */
  today: string;
  labels: BalanceChartLabels;
  loading?: boolean;
  error?: string | null;
}

const money = (value: number) => formatCurrency(value);
const axisMoney = (value: number) => {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${value < 0 ? "-" : ""}R$ ${(abs / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (abs >= 1_000) return `${value < 0 ? "-" : ""}R$ ${(abs / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return formatCurrency(value).replace(/,00$/, "");
};

const dayLabel = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const weekdayLabel = (day: string) => `${WEEKDAYS[new Date(`${day}T12:00:00Z`).getUTCDay()]} ${day.slice(8, 10)}`;

/** Título do balanço: botão que abre a escolha do período (anual, mensal, semanal). */
function PeriodTitle({ period, labels, suffix, onChange }: { period: BalancePeriod; labels: BalanceChartLabels; suffix: string; onChange?: (period: BalancePeriod) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useDismiss(rootRef, open, () => setOpen(false));
  const titles: Record<BalancePeriod, string> = { ano: labels.title, mes: labels.titleMonth ?? "Balanço mensal", semana: labels.titleWeek ?? "Balanço semanal" };
  return (
    <div ref={rootRef} className="relative min-w-0 flex-1">
      <h2 id="dashboard-balanco" className="min-w-0 truncate font-bold">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-haspopup="menu"
          aria-expanded={open}
          title="Trocar o período do balanço"
          className="inline-flex max-w-full items-center gap-1.5 rounded-md px-1 py-0.5 -ml-1 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="truncate">{titles[period]}</span> <span className="font-normal text-muted-foreground">{suffix}</span>
          <ChevronDown size={15} className={cn("shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden="true" />
        </button>
      </h2>
      {open && (
        <div role="menu" aria-label="Período do balanço" className="absolute left-0 top-full z-30 mt-1 w-52 rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg">
          {(["ano", "mes", "semana"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="menuitemradio"
              aria-checked={period === value}
              onClick={() => {
                setOpen(false);
                onChange?.(value);
              }}
              className={cn("flex w-full rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-muted", period === value && "font-semibold")}
            >
              {titles[value]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Balanço do topo do Dashboard. Ano: resultado de cada mês, acumulado e a previsão (tracejada) até dezembro. Mês: o
 * mesmo por dia. Semana: entradas e saídas em aberto de hoje e dos 6 dias seguintes (o fluxo dos próximos 7 dias). O
 * título troca o período.
 */
export function BalanceChart(props: BalanceChartProps) {
  const period = props.period ?? "ano";
  if (period === "ano") return <AnnualBalance {...props} />;
  return <DailyBalance {...props} period={period} />;
}

function DailyBalance({ dayPoints, period, today, labels, loading, error, onPeriodChange }: BalanceChartProps & { period: "mes" | "semana" }) {
  const week = period === "semana";
  const lineSeries: LineAreaSeries[] = [
    { key: "realizado", label: "Resultado do dia", dots: true },
    { key: "acumulado", label: "Acumulado no mês" },
    { key: "previsto", label: labels.forecast, dashed: true },
  ];
  const data = (dayPoints ?? []).map((point) => ({ ...point, label: week ? weekdayLabel(point.day) : point.day.slice(8, 10) }));
  const inflow = (dayPoints ?? []).reduce((sum, point) => sum + point.entradas, 0);
  const outflow = (dayPoints ?? []).reduce((sum, point) => sum + point.saidas, 0);
  const suffix = week && dayPoints?.length ? `${dayLabel(dayPoints[0].day)} a ${dayLabel(dayPoints[dayPoints.length - 1].day)}` : `${MONTH_NAMES[Number(today.slice(5, 7)) - 1]} de ${today.slice(0, 4)}`;
  return (
    <section className="flex flex-col rounded-xl border bg-card" data-chart="balance" data-period={period} aria-labelledby="dashboard-balanco">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-5 py-3">
        <PeriodTitle period={period} labels={labels} suffix={suffix} onChange={onPeriodChange} />
        {week ? (
          <p className="text-xs text-muted-foreground">{`Entradas ${money(inflow)} · saídas ${money(outflow)}`}</p>
        ) : (
          <ChartLegend series={lineSeries} />
        )}
      </header>
      {loading && !dayPoints ? (
        <div className="m-5 h-64 animate-pulse rounded-md bg-muted" aria-hidden="true" />
      ) : error || !dayPoints ? (
        <p role="alert" className="px-5 py-6 text-sm text-destructive">{`Não foi possível carregar: ${error ?? "sem dados"}`}</p>
      ) : week ? (
        <div className="px-3 pb-3 pt-4">
          <div className="h-72 w-full" role="img" aria-label={`Fluxo dos próximos 7 dias: entradas ${money(inflow)}, saídas ${money(outflow)}.`}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} barGap={4} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={{ stroke: "hsl(var(--border))" }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={84} tickFormatter={axisMoney} />
                <Tooltip
                  cursor={{ fill: "hsl(var(--muted))" }}
                  formatter={(value: number) => money(value)}
                  contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: "hsl(var(--popover-foreground))" }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="entradas" name="Entradas" fill={SERIES_COLORS.entradas} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="saidas" name="Saídas" fill={SERIES_COLORS.saidas} radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : (
        <div className="px-3 pb-3 pt-4">
          <LineAreaChart
            className="h-72"
            ariaLabel={`Balanço de ${suffix}, por dia.`}
            data={data}
            xKey="label"
            series={lineSeries}
            yAxisWidth={84}
            zeroLine
            formatValue={money}
            formatAxis={axisMoney}
            formatLabel={(label) => `${label}/${today.slice(5, 7)}`}
          />
        </div>
      )}
    </section>
  );
}

function AnnualBalance({ points, today, labels, loading, error, onPeriodChange }: BalanceChartProps) {
  const series: LineAreaSeries[] = [
    { key: "realizado", label: labels.realized, dots: true },
    { key: "acumulado", label: labels.accumulated },
    { key: "previstoLinha", label: labels.forecast, dashed: true },
  ];
  const year = points?.[0]?.month.slice(0, 4) ?? today.slice(0, 4);
  const currentMonth = today.slice(0, 7);
  const currentIndex = points ? points.findIndex((point) => point.month === currentMonth) : -1;
  // Meses passados: a previsão é o próprio realizado; desenhá-la por cima só repetiria a linha. Começa um mês antes
  // do atual para emendar no realizado (ano que já passou não tem previsão; ano futuro é só previsão).
  const forecastFrom = currentIndex >= 0 ? Math.max(0, currentIndex - 1) : points && points[0].month > currentMonth ? 0 : 12;
  const data = (points ?? []).map((point, index) => ({
    ...point,
    label: MONTHS[index],
    previstoLinha: index >= forecastFrom ? point.previsto : null,
  }));
  const lastClosed = [...(points ?? [])].reverse().find((point) => point.acumulado !== null);
  const summary = lastClosed
    ? `${labels.title} de ${year}: ${labels.accumulated.toLowerCase()} até ${MONTH_NAMES[Number(lastClosed.month.slice(5, 7)) - 1]}, ${money(lastClosed.acumulado ?? 0)}.`
    : `${labels.title} de ${year}: só previsão.`;

  return (
    <section className="flex flex-col rounded-xl border bg-card" data-chart="balance" aria-labelledby="dashboard-balanco">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-5 py-3">
        <PeriodTitle period="ano" labels={labels} suffix={year} onChange={onPeriodChange} />
        <ChartLegend series={series} />
      </header>
      {loading && !points ? (
        <div className="m-5 h-64 animate-pulse rounded-md bg-muted" aria-hidden="true" />
      ) : error || !points ? (
        <p role="alert" className="px-5 py-6 text-sm text-destructive">{`Não foi possível carregar: ${error ?? "sem dados"}`}</p>
      ) : (
        <div className="px-3 pb-3 pt-4">
          <LineAreaChart
            className="h-72"
            ariaLabel={summary}
            data={data}
            xKey="label"
            series={series}
            yAxisWidth={84}
            zeroLine
            formatValue={money}
            formatAxis={axisMoney}
            formatLabel={(label) => `${MONTH_NAMES[MONTHS.indexOf(label)] ?? label} de ${year}`}
          />
          {/* A <table> não encolhe para o 1 px do sr-only (fica na largura do conteúdo e dava rolagem lateral na janela
              estreita); o div em volta é que corta e some da tela. */}
          <div className="sr-only">
            <table className="sr-only">
              <caption>{`${labels.title} de ${year}, por mês`}</caption>
              <thead>
                <tr>
                  <th scope="col">Mês</th>
                  <th scope="col">{labels.realized}</th>
                  <th scope="col">{labels.accumulated}</th>
                  <th scope="col">{labels.forecast}</th>
                </tr>
              </thead>
              <tbody>
                {points.map((point, index) => (
                  <tr key={point.month}>
                    <th scope="row">{MONTH_NAMES[index]}</th>
                    <td>{point.realizado == null ? "—" : money(point.realizado)}</td>
                    <td>{point.acumulado == null ? "—" : money(point.acumulado)}</td>
                    <td>{money(point.previsto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
