import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

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
  timeline?: KpiTimelinePoint[];
}

export function KpiCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  className,
  iconClassName,
  timeline,
}: KpiCardProps) {
  const monthlyTimeline = timeline ?? fallbackTimeline(value);

  return (
    <div
      className={cn(
        "kpi-card flex min-h-52 flex-col gap-3 p-5",
        className
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">{title}</span>
        {Icon && (
          <span
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary",
              iconClassName
            )}
          >
            <Icon size={16} />
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-2xl font-bold tracking-tight">{value}</span>
        {subtitle && <span className="text-xs text-muted-foreground">{subtitle}</span>}
        {trend && (
          <span
            className={cn(
              "text-xs font-medium",
              trend.value >= 0 ? "text-emerald-600" : "text-red-500"
            )}
          >
            {trend.value >= 0 ? "+" : ""}
            {trend.value}% {trend.label}
          </span>
        )}
      </div>
      <div className="mt-auto h-20 w-full pt-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={monthlyTimeline} margin={{ top: 3, right: 3, bottom: 0, left: -16 }}>
            <XAxis dataKey="week" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
            <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} width={30} allowDecimals={false} />
            <Tooltip
              cursor={{ stroke: "hsl(var(--border))" }}
              contentStyle={{
                background: "hsl(var(--popover))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 8,
                fontSize: 11,
              }}
              labelStyle={{ color: "hsl(var(--popover-foreground))" }}
            />
            <Line type="monotone" dataKey="value" name={title} stroke="hsl(var(--primary))" strokeWidth={2.2} dot={{ r: 2, fill: "hsl(var(--primary))" }} activeDot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function fallbackTimeline(value: string | number): KpiTimelinePoint[] {
  const current = typeof value === "number" ? value : parseFormattedNumber(value);
  const safeValue = Number.isFinite(current) ? current : 0;
  return [
    { week: "S1", value: rounded(Math.max(0, safeValue * 0.58)) },
    { week: "S2", value: rounded(Math.max(0, safeValue * 0.74)) },
    { week: "S3", value: rounded(Math.max(0, safeValue * 0.88)) },
    { week: "S4", value: rounded(Math.max(0, safeValue)) },
  ];
}

function parseFormattedNumber(value: string): number {
  const normalized = value.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  return Number(normalized);
}

function rounded(value: number): number {
  return value > 100 ? Math.round(value) : Math.round(value * 10) / 10;
}
