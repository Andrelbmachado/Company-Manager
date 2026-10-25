// Estado de ordenação e filtros de uma tabela: devolve as linhas já filtradas e ordenadas e as ações que
// SortableHeader, FilterButton e FilterBar usam. Não guarda nada fora da tela (filtro é de quem está vendo agora).
import { useCallback, useId, useMemo, useState } from "react";
import { activeFilterCount, applySortFilter, nextSort, type ColumnFilter, type FilterState, type SortFilterColumn, type SortState } from "./sortFilter";

export interface SortFilterOptions {
  /** Ordenação inicial (padrão: nenhuma, mantém a ordem que a tela passou). */
  initialSort?: SortState | null;
}

export interface SortFilterView<T> {
  /** Linhas filtradas e ordenadas. */
  rows: T[];
  /** Linhas recebidas, antes do filtro (de onde saem as opções da múltipla escolha). */
  source: T[];
  columns: SortFilterColumn<T>[];
  sort: SortState | null;
  setSort: (sort: SortState | null) => void;
  /** Clique no cabeçalho: crescente → decrescente → sem ordenação. */
  toggleSort: (key: string) => void;
  filters: FilterState;
  /** `null` remove o filtro da coluna. */
  setFilter: (key: string, filter: ColumnFilter | null) => void;
  clearFilters: () => void;
  /** Quantos filtros estão tirando linhas (só de colunas presentes). */
  activeCount: number;
  filtersOpen: boolean;
  setFiltersOpen: (open: boolean) => void;
  toggleFilters: () => void;
  /** id para o `aria-controls` do FilterButton e o `id` da FilterBar. */
  filtersId: string;
}

export function useSortFilter<T>(rows: T[], columns: SortFilterColumn<T>[], options: SortFilterOptions = {}): SortFilterView<T> {
  const [sort, setSort] = useState<SortState | null>(options.initialSort ?? null);
  const [filters, setFilters] = useState<FilterState>({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersId = `${useId()}-filtros`;

  const visible = useMemo(() => applySortFilter(rows, columns, sort, filters), [rows, columns, sort, filters]);

  const toggleSort = useCallback((key: string) => setSort((current) => nextSort(current, key)), []);
  const setFilter = useCallback((key: string, filter: ColumnFilter | null) => {
    setFilters((current) => {
      const next = { ...current };
      if (filter) next[key] = filter;
      else delete next[key];
      return next;
    });
  }, []);
  const clearFilters = useCallback(() => setFilters({}), []);
  const toggleFilters = useCallback(() => setFiltersOpen((open) => !open), []);

  return {
    rows: visible,
    source: rows,
    columns,
    sort,
    setSort,
    toggleSort,
    filters,
    setFilter,
    clearFilters,
    activeCount: activeFilterCount(filters, columns),
    filtersOpen,
    setFiltersOpen,
    toggleFilters,
    filtersId,
  };
}
