import type { ReactNode } from "react";

/** Row between the page header and the content: search, filters, counters. */
export function Toolbar({ children, count }: { children: ReactNode; count?: number }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3" data-testid="list-toolbar">
      <div className="flex flex-1 flex-wrap items-center gap-2">{children}</div>
      {count !== undefined && (
        <span className="text-xs text-muted-foreground tabular-nums" data-testid="list-count">
          {count} {count === 1 ? "registro" : "registros"}
        </span>
      )}
    </div>
  );
}
