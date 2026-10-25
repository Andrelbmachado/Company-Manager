// Atalhos para tabela comum com useSortFilter: Filtrar e a linha de filtros já ligados ao estado da tabela, e a linha
// de aviso quando o filtro não deixa nada. Uso:
//   const view = useSortFilter(rows, columns);
//   <TableFilterButton view={view} />          (na barra, ao lado de Editar/Atualizar)
//   <TableFilterBar view={view} />             (logo abaixo da barra; só aparece com Filtrar aberto)
//   <tbody>{view.rows.map(...)}{rows.length > 0 && !view.rows.length && <NoFilterMatchRow colSpan={n} />}</tbody>
import { FilterBar } from "./FilterBar";
import { FilterButton } from "./TableButtons";
import type { SortFilterView } from "./useSortFilter";

/** Mensagem da tabela quando há registros, mas nenhum passa nos filtros. */
export const NO_FILTER_MATCH = "Nenhum registro com esses filtros.";

export function TableFilterButton<T>({ view, disabled, className }: { view: SortFilterView<T>; disabled?: boolean; className?: string }) {
  return <FilterButton open={view.filtersOpen} onToggle={view.toggleFilters} activeCount={view.activeCount} controls={view.filtersId} disabled={disabled} className={className} />;
}

export function TableFilterBar<T>({ view, className }: { view: SortFilterView<T>; className?: string }) {
  if (!view.filtersOpen) return null;
  return <FilterBar id={view.filtersId} rows={view.source} columns={view.columns} filters={view.filters} onChange={view.setFilter} onClear={view.clearFilters} className={className} />;
}

export function NoFilterMatchRow({ colSpan, className }: { colSpan: number; className?: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className={className ?? "px-4 py-8 text-center text-sm text-muted-foreground"}>
        {NO_FILTER_MATCH}
      </td>
    </tr>
  );
}
