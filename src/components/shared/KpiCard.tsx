import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface KpiTimelinePoint {
  week: string;
  value: number;
}

interface KpiCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: LucideIcon;
  trend?: { value: number; label: string };
  className?: string;
  iconClassName?: string;
  /** Série real do indicador. Sem série, o card não mostra gráfico (nada de curva inventada). */
  timeline?: KpiTimelinePoint[];
}

/** Indicador do dashboard: título pequeno, valor grande, sem brilho nem translucidez. */
export function KpiCard({ title, value, subtitle, icon: Icon, trend, className, iconClassName, timeline }: KpiCardProps) {
  return (
    <div className={cn("kpi-card flex flex-col gap-3 p-5", className)}>
      <div className="flex items-start justify-between gap-3">
        <span className="text-[13px] font-medium text-muted-foreground">{title}</span>
        {Icon && (
          <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground", iconClassName)}>
            <Icon size={16} />
          </span>
        )}
      </div>
      <div>
        <p className="font-display text-[clamp(1.75rem,2.6vw,2.5rem)] font-bold leading-none tracking-tight tabular-nums">{value}</p>
        {subtitle && <p className="mt-2 text-xs text-muted-foreground">{subtitle}</p>}
        {trend && (
          <p className={cn("mt-2 text-xs font-semibold", trend.value >= 0 ? "text-status-success dark:text-green-400" : "text-status-danger dark:text-red-400")}>
            {trend.value >= 0 ? "+" : ""}
            {trend.value}% {trend.label}
          </p>
        )}
      </div>
      {timeline && timeline.length > 0 && (
        <div className="mt-auto h-24 w-full pt-1">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={timeline} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="week" axisLine={{ stroke: "hsl(var(--border))" }} tickLine={false} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={30} allowDecimals={false} />
              <Tooltip
                cursor={{ stroke: "hsl(var(--border))" }}
                contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }}
                labelStyle={{ color: "hsl(var(--popover-foreground))" }}
              />
              <Line type="monotone" dataKey="value" name={title} stroke="hsl(var(--primary))" strokeWidth={2.2} dot={{ r: 2, fill: "hsl(var(--primary))" }} activeDot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
