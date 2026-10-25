import { formatCell } from "@/lib/reports/export";
import type { ReportTable } from "@/lib/reports/common";
import { cn } from "@/lib/utils";

const NUMERIC = new Set(["integer", "number", "money", "percent"]);

/** A mesma tabela que vai para a exportação, na tela: números à direita, linha de total no rodapé. */
export function ReportDataTable({ table, empty = "Nada no período escolhido." }: { table: ReportTable; empty?: string }) {
  const numeric = (kind: string) => NUMERIC.has(kind);
  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full text-sm">
        <caption className="sr-only">
          {table.title}
          {table.subtitle ? ` — ${table.subtitle}` : ""}
        </caption>
        <thead className="bg-muted/30 text-left text-muted-foreground">
          <tr>
            {table.columns.map((column) => (
              <th key={column.key} scope="col" className={cn("whitespace-nowrap px-4 py-3 font-medium", numeric(column.kind) && "text-right")}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.length === 0 ? (
            <tr>
              <td colSpan={table.columns.length} className="px-4 py-8 text-center text-muted-foreground">
                {empty}
              </td>
            </tr>
          ) : (
            table.rows.map((row, index) => {
              const style = table.styles?.[index];
              return (
                <tr key={index} className={cn("border-t", style === "strong" && "bg-muted/20 font-semibold")}>
                  {table.columns.map((column, columnIndex) => {
                    const value = row[column.key];
                    const negative = typeof value === "number" && value < 0 && column.kind === "money";
                    return (
                      <td
                        key={column.key}
                        className={cn(
                          "px-4 py-2.5",
                          numeric(column.kind) ? "whitespace-nowrap text-right tabular-nums" : columnIndex === 0 && column.kind === "text" ? "min-w-56" : "whitespace-nowrap",
                          negative && "text-status-danger dark:text-red-400",
                          style === "indent" && columnIndex === 0 && "pl-9 text-muted-foreground",
                        )}
                      >
                        {formatCell(value, column.kind)}
                      </td>
                    );
                  })}
                </tr>
              );
            })
          )}
        </tbody>
        {table.totals && table.rows.length > 0 && (
          <tfoot className="border-t-2 bg-muted/30 font-semibold">
            <tr>
              {table.columns.map((column) => {
                const value = table.totals![column.key];
                return (
                  <td key={column.key} className={cn("whitespace-nowrap px-4 py-3", numeric(column.kind) && "text-right tabular-nums")}>
                    {value === null || value === undefined ? "" : formatCell(value, column.kind)}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
