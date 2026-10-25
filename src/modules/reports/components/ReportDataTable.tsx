import { useMemo } from "react";
import { NoFilterMatchRow, SortableHeader, TableFilterBar, TableFilterToolbar, useSortFilter, type SortFilterColumn } from "@/components/shared/table";
import { formatCell } from "@/lib/reports/export";
import type { ReportRow, ReportTable } from "@/lib/reports/common";
import { cn } from "@/lib/utils";

const NUMERIC = new Set(["integer", "number", "money", "percent"]);

interface IndexedRow {
  row: ReportRow;
  /** Posição no relatório (o estilo da linha vem por índice). */
  index: number;
}

/**
 * A mesma tabela que vai para a exportação, na tela: números à direita, linha de total no rodapé. Clique no cabeçalho
 * ordena pelo tipo da coluna e Filtrar abre os filtros por coluna; com filtro escondendo linhas, o total (do período
 * inteiro) sai do rodapé para não somar o que não está na tela. Demonstrativo com estilo por linha (DRE: grupo,
 * subtotal, detalhe) não ordena nem filtra: a ordem das linhas é o próprio relatório.
 */
export function ReportDataTable({ table, empty = "Nada no período escolhido." }: { table: ReportTable; empty?: string }) {
  const numeric = (kind: string) => NUMERIC.has(kind);
  const statement = Boolean(table.styles?.length);
  const rows = useMemo<IndexedRow[]>(() => table.rows.map((row, index) => ({ row, index })), [table.rows]);
  const columns = useMemo<SortFilterColumn<IndexedRow>[]>(
    () =>
      table.columns.map((column) => ({
        key: column.key,
        header: column.label,
        kind: column.kind,
        sortable: !statement,
        filterable: !statement,
        sortValue: (item: IndexedRow) => item.row[column.key],
      })),
    [table.columns, statement],
  );
  const view = useSortFilter(rows, columns);
  const filtered = view.rows.length < rows.length;
  return (
    <div className="rounded-xl border">
      {!statement && rows.length > 0 && <TableFilterToolbar view={view} />}
      <TableFilterBar view={view} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">
            {table.title}
            {table.subtitle ? ` — ${table.subtitle}` : ""}
          </caption>
          <thead className="bg-muted/30 text-left text-muted-foreground">
            <tr>
              {columns.map((column) => (
                <SortableHeader
                  key={column.key}
                  label={column.header}
                  sortKey={column.key}
                  sort={view.sort}
                  onSort={view.toggleSort}
                  sortable={!statement}
                  align={numeric(column.kind) ? "right" : "left"}
                  className="px-4 py-3 text-sm"
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={table.columns.length} className="px-4 py-8 text-center text-muted-foreground">
                  {empty}
                </td>
              </tr>
            ) : view.rows.length === 0 ? (
              <NoFilterMatchRow colSpan={table.columns.length} />
            ) : (
              view.rows.map(({ row, index }) => {
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
          {table.totals && rows.length > 0 && !filtered && (
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
    </div>
  );
}
