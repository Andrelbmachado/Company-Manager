import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface StatCardProps {
  title: string;
  value: ReactNode;
  hint?: string;
  /** "text": valor em texto (nome, tempo), menor que o número. */
  kind?: "number" | "text";
  className?: string;
}

/** Indicador: título pequeno, valor grande (fonte de exibição, algarismos tabulares). Superfície opaca, sem brilho. */
export function StatCard({ title, value, hint, kind = "number", className }: StatCardProps) {
  return (
    <div className={cn("rounded-xl border bg-card p-5", className)}>
      <p className="text-[13px] font-medium text-muted-foreground">{title}</p>
      <p className={cn("mt-2.5 font-display font-bold tracking-tight tabular-nums", kind === "number" ? "text-[clamp(1.75rem,2.6vw,2.5rem)] leading-none" : "text-xl leading-snug")}>{value}</p>
      {hint && <p className="mt-2.5 text-xs leading-snug text-muted-foreground">{hint}</p>}
    </div>
  );
}
