// Linha de filtros por coluna, conforme o tipo: texto "contém" (sem acento/caixa), número e dinheiro de–até (aceita
// "1.234,56"), data de–até e seleção/booleano em múltipla escolha. Os valores ficam como digitados; o que conta como
// filtro ativo é decidido em sortFilter (limite inválido ou campo vazio não filtra).
import { useMemo } from "react";
import { FilterX } from "lucide-react";
import { cn } from "@/lib/utils";
import { choiceOptions, emptyFilter, isFilterActive, activeFilterCount, type ColumnFilter, type FilterState, type SortFilterColumn } from "./sortFilter";

export interface FilterBarProps<T> {
  id?: string;
  /** Todas as linhas (antes do filtro): de onde saem as opções da múltipla escolha. */
  rows: T[];
  columns: SortFilterColumn<T>[];
  filters: FilterState;
  onChange: (key: string, filter: ColumnFilter | null) => void;
  onClear: () => void;
  className?: string;
}

const INPUT = "h-8 w-full min-w-0 rounded-md border bg-background px-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring aria-[invalid=true]:border-destructive";
const FIELD = "flex min-w-[9rem] flex-1 basis-44 flex-col gap-1 text-xs font-medium text-muted-foreground";

export function FilterBar<T>({ id, rows, columns, filters, onChange, onClear, className }: FilterBarProps<T>) {
  const filterable = columns.filter((column) => column.filterable !== false);
  const count = activeFilterCount(filters);
  return (
    <div id={id} role="group" aria-label="Filtros" data-filter-bar="" className={cn("flex flex-wrap items-end gap-x-4 gap-y-3 border-b px-4 py-3", className)}>
      {filterable.map((column) => (
        <FilterField key={column.key} column={column} rows={rows} filter={filters[column.key] ?? emptyFilter(column.kind)} onChange={(filter) => onChange(column.key, filter)} />
      ))}
      <div className="ml-auto flex items-center gap-3 text-sm">
        {count > 0 && (
          <span aria-live="polite" className="text-muted-foreground">
            {count === 1 ? "1 filtro ativo" : `${count} filtros ativos`}
          </span>
        )}
        <button
          type="button"
          onClick={onClear}
          disabled={count === 0}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          <FilterX aria-hidden="true" size={14} /> Limpar filtros
        </button>
      </div>
    </div>
  );
}

interface FilterFieldProps<T> {
  column: SortFilterColumn<T>;
  rows: T[];
  filter: ColumnFilter;
  onChange: (filter: ColumnFilter) => void;
}

function FilterField<T>({ column, rows, filter, onChange }: FilterFieldProps<T>) {
  const active = isFilterActive(filter);
  const heading = <span className={cn(active && "text-foreground")}>{column.header}</span>;
  switch (filter.type) {
    case "text":
      return (
        <label className={FIELD}>
          {heading}
          <input type="search" aria-label={`${column.header}: contém`} placeholder="Contém…" value={filter.contains} onChange={(event) => onChange({ type: "text", contains: event.target.value })} className={INPUT} />
        </label>
      );
    case "range":
      return (
        <div role="group" aria-label={column.header} className={FIELD}>
          {heading}
          <div className="flex items-center gap-1.5">
            <RangeInput label={`${column.header}: mínimo`} placeholder="mín" value={filter.min} onChange={(min) => onChange({ ...filter, min })} />
            <span aria-hidden="true">–</span>
            <RangeInput label={`${column.header}: máximo`} placeholder="máx" value={filter.max} onChange={(max) => onChange({ ...filter, max })} />
          </div>
        </div>
      );
    case "dates":
      return (
        <div role="group" aria-label={column.header} className={cn(FIELD, "basis-64")}>
          {heading}
          <div className="flex items-center gap-1.5">
            <input type="date" aria-label={`${column.header}: de`} value={filter.from} onChange={(event) => onChange({ ...filter, from: event.target.value })} className={INPUT} />
            <span aria-hidden="true">–</span>
            <input type="date" aria-label={`${column.header}: até`} value={filter.to} onChange={(event) => onChange({ ...filter, to: event.target.value })} className={INPUT} />
          </div>
        </div>
      );
    case "choice":
      return <ChoiceField column={column} rows={rows} values={filter.values} onChange={(values) => onChange({ type: "choice", values })} active={active} />;
  }
}

function RangeInput({ label, placeholder, value, onChange }: { label: string; placeholder: string; value: string; onChange: (value: string) => void }) {
  // Número que não dá para ler ("abc") não filtra; o campo fica marcado para a pessoa ver.
  const invalid = value.trim() !== "" && !isFilterActive({ type: "range", min: value, max: "" });
  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={label}
      aria-invalid={invalid || undefined}
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={cn(INPUT, "text-right tabular-nums")}
    />
  );
}

function ChoiceField<T>({ column, rows, values, onChange, active }: { column: SortFilterColumn<T>; rows: T[]; values: string[]; onChange: (values: string[]) => void; active: boolean }) {
  const options = useMemo(() => choiceOptions(rows, column), [rows, column]);
  const toggle = (value: string, checked: boolean) => onChange(checked ? [...values, value] : values.filter((item) => item !== value));
  return (
    <fieldset className={cn(FIELD, "basis-56")}>
      <legend className={cn("mb-1 text-xs font-medium", active && "text-foreground")}>{column.header}</legend>
      <div className={cn("flex flex-wrap gap-x-3 gap-y-1 text-sm font-normal text-foreground", options.length > 8 && "max-h-32 overflow-y-auto")}>
        {options.map((option) => (
          <label key={option.value} className="inline-flex cursor-pointer items-center gap-1.5">
            <input type="checkbox" checked={values.includes(option.value)} onChange={(event) => toggle(option.value, event.target.checked)} className="h-3.5 w-3.5 accent-primary" />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
