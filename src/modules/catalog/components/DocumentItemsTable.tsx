import { useMemo, type ReactNode } from "react";
import { NoFilterMatchRow, SortableHeader, TableFilterBar, TableFilterToolbar, useSortFilter, type SortFilterColumn } from "@/components/shared/table";
import { formatQty } from "@/lib/erp/stockPosting";
import { formatCurrency } from "@/lib/utils";
import type { LineItemBase } from "@/types";
import { TD } from "./tradeKit";

interface ExtraColumn<T> {
  header: string;
  cell: (item: T) => ReactNode;
  /** Número comparado e filtrado; sem ele a coluna só aparece (não ordena nem filtra). */
  value?: (item: T) => number;
}

/** Cabeçalho ordenável no padrão do TH das telas de compra/venda (o alinhamento vem do `align`). */
const SORT_TH = "px-4 py-3 text-sm";

/**
 * Itens gravados de pedido, fatura ou compra (somente leitura), com colunas extras opcionais (ex.: recebido). Clique no
 * cabeçalho ordena pelo tipo da coluna e Filtrar filtra por coluna.
 */
export function DocumentItemsTable<T extends LineItemBase>({ items, extra = [], priceLabel = "Preço unit." }: { items: readonly T[]; extra?: readonly ExtraColumn<T>[]; priceLabel?: string }) {
  const rows = useMemo(() => [...items], [items]);
  const columns = useMemo<SortFilterColumn<T>[]>(
    () => [
      { key: "position", header: "#", kind: "integer" },
      { key: "description", header: "Descrição", kind: "text" },
      { key: "qty", header: "Qtd.", kind: "number", sortValue: (item) => Number(item.qty) },
      ...extra.map<SortFilterColumn<T>>((column) => ({
        key: `extra:${column.header}`,
        header: column.header,
        kind: "number",
        sortable: Boolean(column.value),
        filterable: Boolean(column.value),
        sortValue: column.value,
      })),
      { key: "unit_price", header: priceLabel, kind: "money", sortValue: (item) => Number(item.unit_price) },
      { key: "discount", header: "Desconto", kind: "money", sortValue: (item) => Number(item.discount) },
      { key: "total", header: "Total", kind: "money", sortValue: (item) => Number(item.total) },
    ],
    [extra, priceLabel],
  );
  const view = useSortFilter(rows, columns);
  return (
    <div className="rounded-xl border">
      {rows.length > 0 && <TableFilterToolbar view={view} />}
      <TableFilterBar view={view} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-muted/30">
            <tr>
              {columns.map((column) => (
                <SortableHeader
                  key={column.key}
                  label={column.header}
                  sortKey={column.key}
                  sort={view.sort}
                  onSort={view.toggleSort}
                  sortable={column.sortable !== false}
                  align={column.kind === "text" || column.key === "position" ? "left" : "right"}
                  className={SORT_TH}
                />
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {view.rows.map((item) => (
              <tr key={item.id}>
                <td className={`${TD} text-muted-foreground`}>{item.position}</td>
                <td className={`${TD} font-medium`}>{item.description}</td>
                <td className={`${TD} text-right tabular-nums`}>{formatQty(Number(item.qty))} {item.unit}</td>
                {extra.map((column) => <td key={column.header} className={`${TD} text-right tabular-nums`}>{column.cell(item)}</td>)}
                <td className={`${TD} text-right tabular-nums`}>{formatCurrency(Number(item.unit_price))}</td>
                <td className={`${TD} text-right tabular-nums text-muted-foreground`}>{Number(item.discount) ? formatCurrency(Number(item.discount)) : "—"}</td>
                <td className={`${TD} text-right font-medium tabular-nums`}>{formatCurrency(Number(item.total))}</td>
              </tr>
            ))}
            {rows.length > 0 && !view.rows.length && <NoFilterMatchRow colSpan={columns.length} />}
          </tbody>
        </table>
      </div>
    </div>
  );
}
