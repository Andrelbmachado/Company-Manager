import { ChartLegend, LineAreaChart, type LineAreaSeries } from "@/components/shared/charts/LineAreaChart";
import { formatCurrency } from "@/lib/utils";
import type { AnnualBalancePoint } from "@/lib/dashboard/finance";

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MONTH_NAMES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

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

/** Balanço do ano: resultado de cada mês, acumulado no ano e a previsão (tracejada) até dezembro, cada um com a sua cor. */
export function BalanceChart({ points, today, labels, loading, error }: BalanceChartProps) {
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
        <h2 id="dashboard-balanco" className="min-w-0 flex-1 truncate font-bold">
          {labels.title} <span className="font-normal text-muted-foreground">{year}</span>
        </h2>
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
