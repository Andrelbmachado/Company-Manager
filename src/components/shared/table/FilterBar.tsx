// Linha de filtros por coluna, conforme o tipo: texto "contém" (sem acento/caixa), número e dinheiro de–até (aceita
// "1.234,56"), data de–até e seleção/booleano em múltipla escolha (até 3 opções na própria linha; mais que isso, lista
// suspensa compacta). Os valores ficam como digitados; o que conta como filtro ativo é decidido em sortFilter (limite
// inválido ou campo vazio não filtra). Grade que se ajusta à largura: numa janela estreita, um filtro por linha.
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { ChevronDown, FilterX } from "lucide-react";
import { cn } from "@/lib/utils";
import { activeFilterCount, choiceOptions, emptyFilter, isFilterActive, type ChoiceOption, type ColumnFilter, type FilterState, type SortFilterColumn } from "./sortFilter";

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
const FIELD = "flex min-w-0 flex-col gap-1 text-xs font-medium text-muted-foreground";
const INLINE_CHOICES = 3;

export function FilterBar<T>({ id, rows, columns, filters, onChange, onClear, className }: FilterBarProps<T>) {
  const filterable = columns.filter((column) => column.filterable !== false);
  const count = activeFilterCount(filters);
  return (
    <div
      id={id}
      role="group"
      aria-label="Filtros"
      data-filter-bar=""
      className={cn("grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] items-start gap-x-4 gap-y-3 border-b px-4 py-3", className)}
    >
      {filterable.map((column) => (
        <FilterField key={column.key} column={column} rows={rows} filter={filters[column.key] ?? emptyFilter(column.kind)} onChange={(filter) => onChange(column.key, filter)} />
      ))}
      <div className="col-span-full flex items-center justify-end gap-3 text-sm">
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
      // Campo de data nativo precisa de ~8rem: lado a lado quando cabe, um embaixo do outro numa coluna estreita.
      return (
        <div role="group" aria-label={column.header} className={FIELD}>
          {heading}
          <div className="flex flex-wrap items-center gap-1.5">
            <input type="date" aria-label={`${column.header}: de`} title="De" value={filter.from} onChange={(event) => onChange({ ...filter, from: event.target.value })} className={cn(INPUT, "min-w-[8rem] flex-1")} />
            <input type="date" aria-label={`${column.header}: até`} title="Até" value={filter.to} onChange={(event) => onChange({ ...filter, to: event.target.value })} className={cn(INPUT, "min-w-[8rem] flex-1")} />
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

interface ChoiceFieldProps<T> {
  column: SortFilterColumn<T>;
  rows: T[];
  values: string[];
  onChange: (values: string[]) => void;
  active: boolean;
}

function ChoiceField<T>({ column, rows, values, onChange, active }: ChoiceFieldProps<T>) {
  const options = useMemo(() => choiceOptions(rows, column), [rows, column]);
  const toggle = (value: string, checked: boolean) => onChange(checked ? [...values, value] : values.filter((item) => item !== value));
  const boxes = options.map((option) => (
    <label key={option.value} className="inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap">
      <input type="checkbox" checked={values.includes(option.value)} onChange={(event) => toggle(option.value, event.target.checked)} className="h-3.5 w-3.5 accent-primary" />
      {option.label}
    </label>
  ));
  return (
    <fieldset className={FIELD}>
      <legend className={cn("mb-1 text-xs font-medium", active && "text-foreground")}>{column.header}</legend>
      {options.length <= INLINE_CHOICES ? (
        <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 text-sm font-normal text-foreground">{boxes}</div>
      ) : (
        <ChoiceDropdown header={column.header} options={options} values={values}>
          {boxes}
        </ChoiceDropdown>
      )}
    </fieldset>
  );
}

function summaryText(options: ChoiceOption[], values: string[]): string {
  if (!values.length) return "Todos";
  const labels = options.filter((option) => values.includes(option.value)).map((option) => option.label);
  return labels.length <= 2 ? labels.join(", ") : `${labels.length} selecionados`;
}

/**
 * Lista suspensa com <details>: abre e fecha pelo teclado sem código; fecha também com clique fora ou Esc. O resumo
 * mostra o que está marcado ("Todos", "Lead, Ativo", "3 selecionados").
 */
function ChoiceDropdown({ header, options, values, children }: { header: string; options: ChoiceOption[]; values: string[]; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: Event) => {
      const details = ref.current;
      if (!details?.open) return;
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !details.contains(event.target as Node)) details.open = false;
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, []);
  const text = summaryText(options, values);
  return (
    <details ref={ref} className="group relative">
      <summary
        aria-label={`${header}: ${text}`}
        className={cn(INPUT, "flex cursor-pointer list-none items-center justify-between gap-2 font-normal [&::-webkit-details-marker]:hidden", values.length > 0 && "border-primary/40")}
      >
        <span className="truncate">{text}</span>
        <ChevronDown aria-hidden="true" size={14} className="shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="absolute left-0 right-0 z-20 mt-1 flex max-h-60 flex-col gap-1.5 overflow-y-auto rounded-md border bg-popover p-2 text-sm font-normal text-popover-foreground shadow-md">
        {children}
      </div>
    </details>
  );
}
