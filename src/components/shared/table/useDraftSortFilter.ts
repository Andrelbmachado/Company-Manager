// Ordenação e filtros para tabela de formulário: linhas que são campos sendo digitados (itens do pedido e da proposta,
// mapeamento de colunas da importação, recebimento do pedido de compra). A ordem e o filtro valem para um retrato das
// linhas tirado no clique do cabeçalho ou na mudança do filtro: digitar num campo não faz a linha pular de lugar nem
// sumir. Linha nova (fora do retrato) fica sempre visível, no fim; linha removida sai. É só a vista: quem grava continua
// usando a lista original, na ordem dela.
import { useCallback, useMemo, useRef, useState } from "react";
import type { ColumnFilter, SortFilterColumn, SortState } from "./sortFilter";
import { useSortFilter, type SortFilterView } from "./useSortFilter";

export function useDraftSortFilter<T>(rows: T[], columns: SortFilterColumn<T>[], getKey: (row: T) => string): SortFilterView<T> {
  const [snapshot, setSnapshot] = useState<T[]>(rows);
  const latest = useRef(rows);
  latest.current = rows;
  const keyOf = useRef(getKey);
  keyOf.current = getKey;

  const inner = useSortFilter(snapshot, columns);
  const { toggleSort: innerToggle, setSort: innerSetSort, setFilter: innerSetFilter, clearFilters: innerClear } = inner;
  const retake = useCallback(() => setSnapshot(latest.current), []);
  const toggleSort = useCallback((key: string) => {
    retake();
    innerToggle(key);
  }, [retake, innerToggle]);
  const setSort = useCallback((sort: SortState | null) => {
    retake();
    innerSetSort(sort);
  }, [retake, innerSetSort]);
  const setFilter = useCallback((key: string, filter: ColumnFilter | null) => {
    retake();
    innerSetFilter(key, filter);
  }, [retake, innerSetFilter]);
  const clearFilters = useCallback(() => {
    retake();
    innerClear();
  }, [retake, innerClear]);

  const idle = !inner.sort && inner.activeCount === 0;
  const visible = useMemo(() => {
    if (idle) return rows;
    const key = keyOf.current;
    const current = new Map(rows.map((row) => [key(row), row] as const));
    const known = new Set(snapshot.map(key));
    const ordered = inner.rows.flatMap((row) => {
      const live = current.get(key(row));
      return live === undefined ? [] : [live];
    });
    return [...ordered, ...rows.filter((row) => !known.has(key(row)))];
  }, [idle, rows, snapshot, inner.rows]);

  return { ...inner, rows: visible, source: rows, toggleSort, setSort, setFilter, clearFilters };
}
