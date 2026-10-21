import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <header
      data-testid="page-header"
      className={cn("flex flex-wrap items-center justify-between gap-x-4 gap-y-3", className)}
    >
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-2" data-testid="page-actions">
          {actions}
        </div>
      )}
    </header>
  );
}
