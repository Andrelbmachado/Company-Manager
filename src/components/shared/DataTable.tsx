import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  isLoading?: boolean;
  empty?: ReactNode;
  testId?: string;
}

const alignClass = { left: "text-left", right: "text-right", center: "text-center" } as const;

export function DataTable<T>({ columns, rows, getRowId, isLoading, empty, testId }: DataTableProps<T>) {
  if (isLoading) {
    return (
      <div className="space-y-2" aria-busy="true">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-11 animate-pulse rounded-lg bg-muted/40" />
        ))}
      </div>
    );
  }
  if (!rows.length) return <>{empty}</>;

  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full text-sm" data-testid={testId}>
        <thead className="border-b bg-muted/40">
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cn(
                  "h-10 whitespace-nowrap px-4 text-xs font-medium uppercase tracking-wide text-muted-foreground",
                  alignClass[c.align ?? "left"],
                  c.className
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row) => (
            <tr key={getRowId(row)} data-row-id={getRowId(row)} className="transition-colors hover:bg-muted/30">
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={cn("h-12 px-4 align-middle", alignClass[c.align ?? "left"], c.className)}
                >
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
