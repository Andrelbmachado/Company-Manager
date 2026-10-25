import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCurrency } from "@/lib/utils";
import type { AnnualBalancePoint } from "@/lib/dashboard/finance";

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MONTH_NAMES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** Monocromático: o resultado do mês na cor do texto, o acumulado em cinza e a previsão tracejada. */
const STROKES = {
  realizado: "hsl(var(--foreground))",
  acumulado: "hsl(var(--muted-foreground))",
  previsto: "hsl(var(--foreground) / 0.65)",
} as const;
const FORECAST_DASH = "6 5";

export interface BalanceChartLabels {
  title: string;
  realized: string;
  accumulated: string;
  forecast: string;
}

interface BalanceChartProps {
  points?: AnnualBalancePoint[];
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

function LegendItem({ label, color, dashed }: { label: string; color: string; dashed?: boolean }) {
  return (
    <li className="flex items-center gap-2">
      <svg width="22" height="8" aria-hidden="true" className="shrink-0">
        <line x1="1" y1="4" x2="21" y2="4" stroke={color} strokeWidth="2" strokeDasharray={dashed ? "4 3" : undefined} strokeLinecap="round" />
      </svg>
      <span data-legend="">{label}</span>
    </li>
  );
}

/** Balanço do ano: resultado de cada mês, acumulado no ano e a previsão (tracejada) até dezembro. */
export function BalanceChart({ points, today, labels, loading, error }: BalanceChartProps) {
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
        <h2 id="dashboard-balanco" className="min-w-0 flex-1 truncate font-bold">
          {labels.title} <span className="font-normal text-muted-foreground">{year}</span>
        </h2>
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <LegendItem label={labels.realized} color={STROKES.realizado} />
          <LegendItem label={labels.accumulated} color={STROKES.acumulado} />
          <LegendItem label={labels.forecast} color={STROKES.previsto} dashed />
        </ul>
      </header>
      {loading && !points ? (
        <div className="m-5 h-64 animate-pulse rounded-md bg-muted" aria-hidden="true" />
      ) : error || !points ? (
        <p role="alert" className="px-5 py-6 text-sm text-destructive">{`Não foi possível carregar: ${error ?? "sem dados"}`}</p>
      ) : (
        <div className="px-3 pb-3 pt-4">
          <div className="h-72 w-full" role="img" aria-label={summary}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={{ stroke: "hsl(var(--border))" }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={84} tickFormatter={axisMoney} />
                <ReferenceLine y={0} stroke="hsl(var(--border))" />
                <Tooltip
                  formatter={(value, name) => [typeof value === "number" ? money(value) : "—", name]}
                  labelFormatter={(label: string) => `${MONTH_NAMES[MONTHS.indexOf(label)] ?? label} de ${year}`}
                  contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: "hsl(var(--popover-foreground))" }}
                  itemStyle={{ color: "hsl(var(--popover-foreground))" }}
                />
                <Line type="linear" dataKey="realizado" name={labels.realized} stroke={STROKES.realizado} strokeWidth={2} dot={{ r: 2.5 }} activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />
                <Line type="linear" dataKey="acumulado" name={labels.accumulated} stroke={STROKES.acumulado} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
                <Line type="linear" dataKey="previstoLinha" name={labels.forecast} stroke={STROKES.previsto} strokeWidth={2} strokeDasharray={FORECAST_DASH} dot={false} connectNulls={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
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
      )}
    </section>
  );
}
