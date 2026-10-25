import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon?: LucideIcon;
  /** Curto (2 a 4 palavras): sem texto de ajuda embaixo (pedido de 2026-10-25, item 9). */
  title: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 py-12 text-center", className)}>
      {Icon && (
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
          <Icon aria-hidden="true" size={20} className="text-muted-foreground" />
        </div>
      )}
      <p className="font-medium">{title}</p>
      {action}
    </div>
  );
}
