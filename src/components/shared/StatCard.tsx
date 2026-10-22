import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface StatCardProps {
  title: string;
  value: ReactNode;
  hint?: string;
  className?: string;
}

/** Indicador: título pequeno, valor grande (fonte de exibição, algarismos tabulares). Superfície opaca, sem brilho. */
export function StatCard({ title, value, hint, className }: StatCardProps) {
  return (
    <div className={cn("rounded-xl border bg-card p-5", className)}>
      <p className="text-[13px] font-medium text-muted-foreground">{title}</p>
      <p className="mt-2.5 font-display text-[clamp(1.75rem,2.6vw,2.5rem)] font-bold leading-none tracking-tight tabular-nums">{value}</p>
      {hint && <p className="mt-2.5 text-xs leading-snug text-muted-foreground">{hint}</p>}
    </div>
  );
}
