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
    <div className={cn("flex min-h-9 items-center justify-between gap-4 pb-6", className)}>
      <div className="group/title relative inline-flex">
        <h1 className="cursor-help text-2xl font-semibold tracking-tight">{title}</h1>
        {description && (
          <span
            role="tooltip"
            className="pointer-events-none absolute left-0 top-full z-30 mt-2 w-max max-w-xs translate-y-1 rounded-md border bg-popover px-2.5 py-1.5 text-xs font-normal text-popover-foreground opacity-0 shadow-md transition-all group-hover/title:translate-y-0 group-hover/title:opacity-100"
          >
            {description}
          </span>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
