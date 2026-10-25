import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  actions?: ReactNode;
  className?: string;
}

/** Título da tela e as ações à direita. Sem subtítulo (pedido de 2026-10-25, item 8). */
export function PageHeader({ title, actions, className }: PageHeaderProps) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-4 pb-6", className)}>
      <h1 className="min-w-0 text-large-title font-bold tracking-tight">{title}</h1>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
