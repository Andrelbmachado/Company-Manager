import { useId, type ReactNode } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cn } from "@/lib/utils";

/**
 * Paleta de séries (--chart-1..6 em globals.css): a única cor fora de estado no tema monocromático, para distinguir
 * uma linha da outra. Cada token tem um tom para o claro e outro para o escuro, com contraste >= 3:1 sobre o card.
 */
export const CHART_PALETTE_SIZE = 6;

/** Margem do gráfico; o respiro horizontal dos pontos vem do X_PADDING. */
export const CHART_MARGIN = { top: 12, right: 16, bottom: 4, left: 8 } as const;

/** Respiro (px) entre a borda da área do gráfico e o primeiro/último ponto: o último mês não encosta na borda. */
export const X_PADDING = 24;

const FORECAST_DASH = "6 5";
const AXIS_TICK = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };

/** Cor da série pela posição na paleta (recomeça depois da sexta). */
export function seriesColor(index: number): string {
  const slot = ((Math.trunc(index) % CHART_PALETTE_SIZE) + CHART_PALETTE_SIZE) % CHART_PALETTE_SIZE;
  return `hsl(var(--chart-${slot + 1}))`;
}

export interface LineAreaSeries {
  /** Campo do valor em cada ponto de `data`. */
  key: string;
  /** Nome na legenda e na dica. */
  label: string;
  /** Posição na paleta (0 a 5); sem ela, a ordem da série. */
  colorIndex?: number;
  /** Linha tracejada (previsão). */
  dashed?: boolean;
  /** Marca cada valor com um ponto. */
  dots?: boolean;
}

const colorOf = (series: LineAreaSeries, index: number) => seriesColor(series.colorIndex ?? index);

export interface LineAreaChartProps {
  data: object[];
  /** Campo do rótulo do eixo horizontal. */
  xKey: string;
  series: LineAreaSeries[];
  /** Valor na dica (padrão: o número como está). */
  formatValue?: (value: number) => string;
  /** Rótulo do eixo vertical. */
  formatAxis?: (value: number) => string;
  /** Título da dica a partir do rótulo do eixo horizontal. */
  formatLabel?: (label: string) => string;
  yAxisWidth?: number;
  /** Linha de referência no zero. */
  zeroLine?: boolean;
  minTickGap?: number;
  /** Classe do contêiner (dá a altura, ex.: "h-72"). */
  className?: string;
  /** Nome acessível: com ele o contêiner vira role="img". */
  ariaLabel?: string;
  /** Tamanho fixo em px (sem ResponsiveContainer); sem ele o gráfico ocupa o contêiner. */
  width?: number;
  height?: number;
  /** Elementos extras do recharts (ex.: <Bar>), desenhados por cima das áreas e por baixo das linhas. */
  children?: ReactNode;
}

/**
 * Gráfico de linha do app: cada série com a cor dela, um gradiente da mesma cor (forte embaixo da linha, transparente
 * no pé do gráfico) e respiro nas bordas para o primeiro e o último ponto. A área é só preenchimento (sem dica nem
 * traço); o traço, os pontos e a dica são da linha, desenhada por cima de tudo.
 */
export function LineAreaChart({
  data,
  xKey,
  series,
  formatValue = (value) => String(value),
  formatAxis,
  formatLabel,
  yAxisWidth = 60,
  zeroLine,
  minTickGap,
  className,
  ariaLabel,
  width,
  height,
  children,
}: LineAreaChartProps) {
  // useId tem ":" (":r1:"), que atrapalha no url(#...): fica só o que vale num id.
  const uid = useId().replace(/[^A-Za-z0-9_-]/g, "");
  const gradientId = (index: number) => `line-area-${uid}-${index}`;

  const chart = (
    <ComposedChart data={data} margin={{ ...CHART_MARGIN }} width={width} height={height}>
      <defs>
        {series.map((item, index) => {
          const color = colorOf(item, index);
          return (
            <linearGradient key={item.key} id={gradientId(index)} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={item.dashed ? 0.14 : 0.28} />
              <stop offset="55%" stopColor={color} stopOpacity={item.dashed ? 0.04 : 0.08} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          );
        })}
      </defs>
      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
      <XAxis
        dataKey={xKey}
        tick={AXIS_TICK}
        axisLine={{ stroke: "hsl(var(--border))" }}
        tickLine={false}
        padding={{ left: X_PADDING, right: X_PADDING }}
        minTickGap={minTickGap}
      />
      <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={yAxisWidth} tickFormatter={formatAxis} />
      {zeroLine && <ReferenceLine y={0} stroke="hsl(var(--border))" />}
      <Tooltip
        cursor={{ stroke: "hsl(var(--border))" }}
        formatter={(value, name) => [typeof value === "number" ? formatValue(value) : "—", name]}
        labelFormatter={formatLabel ? (label) => formatLabel(String(label)) : undefined}
        contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
        labelStyle={{ color: "hsl(var(--popover-foreground))" }}
        itemStyle={{ color: "hsl(var(--popover-foreground))" }}
      />
      {series.map((item, index) => (
        <Area
          key={`area-${item.key}`}
          type="linear"
          dataKey={item.key}
          name={item.label}
          stroke="none"
          fill={`url(#${gradientId(index)})`}
          fillOpacity={1}
          baseValue="dataMin"
          dot={false}
          activeDot={false}
          tooltipType="none"
          legendType="none"
          connectNulls={false}
          isAnimationActive={false}
        />
      ))}
      {children}
      {series.map((item, index) => {
        const color = colorOf(item, index);
        return (
          <Line
            key={`line-${item.key}`}
            type="linear"
            dataKey={item.key}
            name={item.label}
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={item.dashed ? FORECAST_DASH : undefined}
            dot={item.dots ? { r: 2.5, fill: color, stroke: color } : false}
            activeDot={{ r: 4, fill: color, stroke: "hsl(var(--card))", strokeWidth: 2 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        );
      })}
    </ComposedChart>
  );

  return (
    <div className={cn("w-full", className)} role={ariaLabel ? "img" : undefined} aria-label={ariaLabel}>
      {width && height ? (
        chart
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          {chart}
        </ResponsiveContainer>
      )}
    </div>
  );
}

/** Legenda das séries com a mesma cor (e o mesmo tracejado) das linhas. `children` entra antes, para itens extras. */
export function ChartLegend({ series, className, children, label }: { series: LineAreaSeries[]; className?: string; children?: ReactNode; label?: string }) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground", className)} aria-label={label}>
      {children}
      {series.map((item, index) => (
        <li key={item.key} className="flex items-center gap-2">
          <svg width="22" height="8" aria-hidden="true" className="shrink-0">
            <line x1="1" y1="4" x2="21" y2="4" stroke={colorOf(item, index)} strokeWidth="2" strokeDasharray={item.dashed ? "4 3" : undefined} strokeLinecap="round" />
          </svg>
          <span data-legend="">{item.label}</span>
        </li>
      ))}
    </ul>
  );
}
