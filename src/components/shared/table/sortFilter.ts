// Ordenação e filtros de tabela, puros (sem React): servem à EditableTable e a qualquer <table> do app via
// useSortFilter. A comparação segue o tipo da coluna: texto em pt-BR sem diferenciar acento nem caixa (e com
// números na ordem natural), número/dinheiro pelo valor, data pela cronologia (ISO, com hora ou dd/mm/aaaa), booleano
// Não → Sim e seleção pelo rótulo mostrado. Vazio vai sempre para o fim, nas duas direções.
import { parseDecimal } from "@/lib/importexport/normalize";
import type { ColumnKind } from "../editable/cellEditors";

/** Tipos da EditableTable mais os das tabelas de relatório/histórico. */
export type SortKind = ColumnKind | "datetime" | "integer" | "percent";

export interface ChoiceOption {
  value: string;
  label: string;
}

export interface SortFilterColumn<T> {
  key: string;
  header: string;
  kind: SortKind;
  /** Rótulos de `select` (ordena e filtra pelo rótulo). */
  options?: ChoiceOption[];
  /** `false` tira a ordenação por clique no cabeçalho. */
  sortable?: boolean;
  /** `false` tira a coluna da barra de filtros. */
  filterable?: boolean;
  /** Valor comparado e filtrado quando não é `row[key]` (ex.: nome vindo de outro cadastro). */
  sortValue?: (row: T) => unknown;
}

export type SortDirection = "asc" | "desc";

export interface SortState {
  key: string;
  direction: SortDirection;
}

export type ColumnFilter =
  | { type: "text"; contains: string }
  | { type: "range"; min: string; max: string }
  | { type: "dates"; from: string; to: string }
  | { type: "choice"; values: string[] };

export type FilterState = Record<string, ColumnFilter>;

const collator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });

const isTruthy = (value: unknown) => value === true || value === 1 || value === "1" || value === "true";

export type FilterType = ColumnFilter["type"];

/** Que filtro cada tipo de coluna usa. */
export function filterTypeOf(kind: SortKind): FilterType {
  switch (kind) {
    case "number":
    case "money":
    case "integer":
    case "percent":
      return "range";
    case "date":
    case "datetime":
      return "dates";
    case "select":
    case "bool":
      return "choice";
    default:
      return "text";
  }
}

export function emptyFilter(kind: SortKind): ColumnFilter {
  switch (filterTypeOf(kind)) {
    case "range":
      return { type: "range", min: "", max: "" };
    case "dates":
      return { type: "dates", from: "", to: "" };
    case "choice":
      return { type: "choice", values: [] };
    default:
      return { type: "text", contains: "" };
  }
}

/** Minúsculas, sem acento e sem espaços nas pontas ("  Ação É " → "acao e"). */
export function foldText(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export function cellValue<T>(row: T, column: SortFilterColumn<T>): unknown {
  return column.sortValue ? column.sortValue(row) : (row as Record<string, unknown>)[column.key];
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value !== "string" || !value.trim()) return null;
  const direct = Number(value);
  return Number.isFinite(direct) ? direct : parseDecimal(value);
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const BR_DAY = /^(\d{2})\/(\d{2})\/(\d{4})$/;

/**
 * Data → { dia "aaaa-mm-dd", instante para ordenar }. Data com hora sem fuso é UTC, como em `formatDay`
 * (o SQLite grava `datetime('now')` em UTC), e o dia é o local, o mesmo que a tela mostra.
 */
function toDate(value: unknown): { day: string; time: number } | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : { day: localDay(value), time: value.getTime() };
  if (typeof value !== "string") return null;
  const text = value.trim();
  const iso = ISO_DAY.exec(text);
  if (iso) return dayOf(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const br = BR_DAY.exec(text);
  if (br) return dayOf(Number(br[3]), Number(br[2]), Number(br[1]));
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(text)) {
    const instant = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/.test(text) ? text.replace(" ", "T") : `${text.replace(" ", "T")}Z`);
    if (!Number.isNaN(instant.getTime())) return { day: localDay(instant), time: instant.getTime() };
  }
  return null;
}

function dayOf(year: number, month: number, day: number): { day: string; time: number } | null {
  const time = new Date(year, month - 1, day).getTime();
  const check = new Date(time);
  if (check.getFullYear() !== year || check.getMonth() !== month - 1 || check.getDate() !== day) return null;
  return { day: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`, time };
}

function localDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function optionLabel<T>(column: SortFilterColumn<T>, value: unknown): string {
  const text = String(value);
  return column.options?.find((option) => option.value === text)?.label ?? text;
}

type Comparable = { kind: "number"; value: number } | { kind: "text"; value: string } | null;

/** Valor de comparação da célula; `null` = vazio (vai para o fim). */
function comparable<T>(column: SortFilterColumn<T>, value: unknown): Comparable {
  switch (column.kind) {
    case "bool":
      return { kind: "number", value: isTruthy(value) ? 1 : 0 };
    case "number":
    case "money":
    case "integer":
    case "percent": {
      const number = toNumber(value);
      return number === null ? null : { kind: "number", value: number };
    }
    case "date":
    case "datetime": {
      const date = toDate(value);
      return date ? { kind: "number", value: date.time } : null;
    }
    default: {
      if (value === null || value === undefined) return null;
      const text = (column.kind === "select" ? optionLabel(column, value) : String(value)).trim();
      return text ? { kind: "text", value: text } : null;
    }
  }
}

function compare(a: NonNullable<Comparable>, b: NonNullable<Comparable>): number {
  if (a.kind === "number" && b.kind === "number") return a.value - b.value;
  return collator.compare(String(a.value), String(b.value));
}

/** Nova cópia ordenada (estável); sem ordenação ou coluna desconhecida devolve as linhas na ordem recebida. */
export function sortRows<T>(rows: T[], columns: SortFilterColumn<T>[], sort: SortState | null): T[] {
  const column = sort ? columns.find((candidate) => candidate.key === sort.key) : undefined;
  if (!sort || !column || column.sortable === false) return rows;
  const sign = sort.direction === "asc" ? 1 : -1;
  const filled: { row: T; key: NonNullable<Comparable>; index: number }[] = [];
  const empty: T[] = [];
  rows.forEach((row, index) => {
    const key = comparable(column, cellValue(row, column));
    if (key) filled.push({ row, key, index });
    else empty.push(row);
  });
  filled.sort((a, b) => sign * compare(a.key, b.key) || a.index - b.index);
  return [...filled.map((item) => item.row), ...empty];
}

/** Ciclo do clique no cabeçalho: crescente → decrescente → sem ordenação. Outra coluna começa crescente. */
export function nextSort(current: SortState | null, key: string): SortState | null {
  if (!current || current.key !== key) return { key, direction: "asc" };
  return current.direction === "asc" ? { key, direction: "desc" } : null;
}

function bound(text: string): number | null {
  return text.trim() ? parseDecimal(text.trim()) : null;
}

function dayBound(text: string): string | null {
  return text.trim() ? toDate(text)?.day ?? null : null;
}

/** Filtro que de fato tira linhas (campo vazio, limite inválido ou nenhuma opção marcada não contam). */
export function isFilterActive(filter: ColumnFilter | undefined): boolean {
  if (!filter) return false;
  switch (filter.type) {
    case "text":
      return foldText(filter.contains) !== "";
    case "range":
      return bound(filter.min) !== null || bound(filter.max) !== null;
    case "dates":
      return dayBound(filter.from) !== null || dayBound(filter.to) !== null;
    case "choice":
      return filter.values.length > 0;
  }
}

/**
 * Quantos filtros tiram linhas. Com `columns`, só os de coluna que está na tabela e é filtrável (os mesmos que
 * filterRows aplica): filtro de coluna que saiu da tela não aparece no contador.
 */
export function activeFilterCount<T>(filters: FilterState, columns?: SortFilterColumn<T>[]): number {
  const keys = columns ? new Set(columns.filter((column) => column.filterable !== false).map((column) => column.key)) : null;
  return Object.entries(filters).filter(([key, filter]) => (!keys || keys.has(key)) && isFilterActive(filter)).length;
}

function isEmptyValue(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "string" && !value.trim());
}

function matches<T>(column: SortFilterColumn<T>, value: unknown, filter: ColumnFilter): boolean {
  switch (filter.type) {
    case "text": {
      const query = foldText(filter.contains);
      if (!query) return true;
      if (isEmptyValue(value)) return false;
      const text = column.kind === "select" ? optionLabel(column, value) : String(value);
      return foldText(text).includes(query);
    }
    case "range": {
      const min = bound(filter.min);
      const max = bound(filter.max);
      if (min === null && max === null) return true;
      const number = toNumber(value);
      if (number === null) return false;
      return (min === null || number >= min) && (max === null || number <= max);
    }
    case "dates": {
      const from = dayBound(filter.from);
      const to = dayBound(filter.to);
      if (from === null && to === null) return true;
      const day = toDate(value)?.day;
      if (!day) return false;
      return (from === null || day >= from) && (to === null || day <= to);
    }
    case "choice": {
      if (!filter.values.length) return true;
      if (column.kind === "bool") return filter.values.includes(isTruthy(value) ? "true" : "false");
      return filter.values.includes(isEmptyValue(value) ? "" : String(value));
    }
  }
}

/** Linhas que passam em todos os filtros (E). Filtro de coluna inexistente ou que não filtra é ignorado. */
export function filterRows<T>(rows: T[], columns: SortFilterColumn<T>[], filters: FilterState): T[] {
  const active = columns
    .filter((column) => column.filterable !== false && isFilterActive(filters[column.key]))
    .map((column) => ({ column, filter: filters[column.key] }));
  if (!active.length) return rows;
  return rows.filter((row) => active.every(({ column, filter }) => matches(column, cellValue(row, column), filter)));
}

export function applySortFilter<T>(rows: T[], columns: SortFilterColumn<T>[], sort: SortState | null, filters: FilterState): T[] {
  return sortRows(filterRows(rows, columns, filters), columns, sort);
}

/**
 * Opções da múltipla escolha: booleano = Sim/Não; seleção = opções da coluna, mais os valores gravados que não estão
 * nelas (status antigo) e "(vazio)" se alguma linha não tem valor. Sem `options`, os valores distintos das linhas.
 */
export function choiceOptions<T>(rows: T[], column: SortFilterColumn<T>): ChoiceOption[] {
  if (column.kind === "bool") {
    return [
      { value: "true", label: "Sim" },
      { value: "false", label: "Não" },
    ];
  }
  const declared = column.options ?? [];
  const known = new Set(declared.map((option) => option.value));
  const extra = new Set<string>();
  let hasEmpty = false;
  for (const row of rows) {
    const value = cellValue(row, column);
    if (isEmptyValue(value)) hasEmpty = true;
    else if (!known.has(String(value))) extra.add(String(value));
  }
  const extras = [...extra].sort(collator.compare).map((value) => ({ value, label: value }));
  return [...declared, ...extras, ...(hasEmpty ? [{ value: "", label: "(vazio)" }] : [])];
}
