// Células da EditableTable: como cada tipo de coluna aparece na leitura, que texto vai para o campo ao editar e como
// o texto digitado volta a ser valor. A conversão usa o normalizador da importação (formatos brasileiros:
// "1.234,56", "R$ 10,00", "31/12/2025" — nunca mês/dia), então tabela e planilha aceitam as mesmas entradas.
import type { ReactNode } from "react";
import { cleanText, normalizeField, normalizeValue } from "@/lib/importexport/normalize";
import { cn, formatCurrency, formatDay } from "@/lib/utils";

export type ColumnKind = "text" | "number" | "money" | "date" | "select" | "bool" | "email" | "phone";

export interface EditableColumn<T> {
  key: keyof T & string;
  header: string;
  kind: ColumnKind;
  /** Opções de `select` (valor gravado + rótulo mostrado). */
  options?: { value: string; label: string }[];
  /** Mostra, mas não vira campo no modo edição. */
  readOnly?: boolean;
  /** Largura da coluna em px. */
  width?: number;
  /** Vazio não salva: aparece "Obrigatório" na célula. */
  required?: boolean;
  /** Conteúdo da célula fora do modo edição (link, StatusBadge...). Sem ele, o valor formatado pelo tipo. */
  render?: (row: T) => ReactNode;
  placeholder?: string;
  /** `false` tira a ordenação por clique no cabeçalho. */
  sortable?: boolean;
  /** `false` tira a coluna da barra de filtros. */
  filterable?: boolean;
  /** Valor usado para ordenar e filtrar quando não é `row[key]` (ex.: coluna com `render` de outro cadastro). */
  sortValue?: (row: T) => unknown;
}

export type CellParse = { ok: true; value: unknown } | { ok: false; reason: string };

export const CELL_INPUT = "h-8 w-full min-w-[6rem] rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring aria-[invalid=true]:border-destructive";

const isEmpty = (value: unknown) => value === null || value === undefined || value === "";
const isTruthy = (value: unknown) => value === true || value === 1 || value === "1" || value === "true";

/** Valor como aparece na leitura. */
export function displayCell<T>(column: EditableColumn<T>, value: unknown): ReactNode {
  if (column.kind === "bool") return isTruthy(value) ? "Sim" : "Não";
  if (isEmpty(value)) return <span className="text-muted-foreground">—</span>;
  switch (column.kind) {
    case "money":
      return Number.isFinite(Number(value)) ? formatCurrency(Number(value)) : String(value);
    case "number":
      return Number.isFinite(Number(value)) ? Number(value).toLocaleString("pt-BR") : String(value);
    case "date":
      return formatDay(String(value));
    case "select":
      return column.options?.find((option) => option.value === String(value))?.label ?? String(value);
    default:
      return String(value);
  }
}

/** Texto que o campo mostra ao entrar no modo edição (o mesmo formato que a pessoa digitaria). */
export function cellText<T>(column: EditableColumn<T>, value: unknown): string {
  if (column.kind === "bool") return isTruthy(value) ? "true" : "false";
  if (isEmpty(value)) return "";
  const number = Number(value);
  switch (column.kind) {
    case "money":
      return Number.isFinite(number) ? number.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(value);
    case "number":
      // Sem separador de milhar: "1.234" seria lido de volta como milhar, mas "1234,5" não deixa dúvida.
      return Number.isFinite(number) ? number.toLocaleString("pt-BR", { useGrouping: false, maximumFractionDigits: 10 }) : String(value);
    case "date": {
      const text = formatDay(String(value));
      return text === "—" ? "" : text;
    }
    default:
      return String(value);
  }
}

/**
 * Texto digitado → valor gravado. Vazio é `null` (ou "Obrigatório"). `bool` devolve 1/0 quando o valor original da
 * coluna é número (colunas 0/1 do SQLite) e true/false nos demais casos.
 */
export function parseCell<T>(column: EditableColumn<T>, text: string, original?: unknown): CellParse {
  if (column.kind === "bool") {
    const on = text === "true";
    return { ok: true, value: typeof original === "number" ? (on ? 1 : 0) : on };
  }
  if (!text.trim()) return column.required ? { ok: false, reason: "Obrigatório" } : { ok: true, value: null };
  switch (column.kind) {
    case "text":
      return { ok: true, value: cleanText(text) };
    case "number":
      return asCell(normalizeField({ key: column.key, label: column.header, kind: "number" }, text));
    case "money":
    case "date":
    case "email":
    case "phone":
      return asCell(normalizeValue(column.kind, text));
    case "select": {
      const option = column.options?.find((candidate) => candidate.value === text);
      return option ? { ok: true, value: option.value } : { ok: false, reason: "Escolha uma das opções" };
    }
  }
}

function asCell(result: ReturnType<typeof normalizeValue>): CellParse {
  return result.ok ? { ok: true, value: result.value } : { ok: false, reason: result.reason };
}

/** Mesmo valor para fins de "mudou?" (null = "", 1234.5 = "1234.50", true = 1). */
export function sameCellValue<T>(column: EditableColumn<T>, a: unknown, b: unknown): boolean {
  if (column.kind === "bool") return isTruthy(a) === isTruthy(b);
  if (isEmpty(a) || isEmpty(b)) return isEmpty(a) && isEmpty(b);
  if (column.kind === "money" || column.kind === "number") return Number(a) === Number(b);
  return String(a) === String(b);
}

const INPUT_MODE: Partial<Record<ColumnKind, "decimal" | "email" | "tel">> = { money: "decimal", number: "decimal", email: "email", phone: "tel" };
const PLACEHOLDER: Partial<Record<ColumnKind, string>> = { money: "0,00", date: "dd/mm/aaaa", phone: "(00) 00000-0000" };

interface CellEditorProps<T> {
  column: EditableColumn<T>;
  text: string;
  /**
   * Valor gravado como texto (`cellText`). Na seleção, um valor gravado que não está nas opções (status antigo)
   * aparece como opção extra: sem isso o campo mostraria outra opção e não daria para voltar ao valor gravado.
   */
  stored?: string;
  label: string;
  error?: string;
  errorId?: string;
  onChange: (text: string) => void;
}

/** Campo da célula no modo edição; o erro de validação aparece logo abaixo, na própria célula. */
export function CellEditor<T>({ column, text, stored, label, error, errorId, onChange }: CellEditorProps<T>) {
  const invalid = error ? true : undefined;
  const describedBy = error ? errorId : undefined;
  let control: ReactNode;
  if (column.kind === "bool") {
    control = (
      <input
        type="checkbox"
        aria-label={label}
        checked={text === "true"}
        onChange={(event) => onChange(event.target.checked ? "true" : "false")}
        className="h-4 w-4 accent-primary"
      />
    );
  } else if (column.kind === "select") {
    const options = column.options ?? [];
    const legacy = stored && !options.some((option) => option.value === stored) ? stored : null;
    control = (
      <select aria-label={label} aria-invalid={invalid} aria-describedby={describedBy} value={text} onChange={(event) => onChange(event.target.value)} className={cn(CELL_INPUT, "px-1.5")}>
        {(!column.required || !text) && <option value="">—</option>}
        {legacy && <option value={legacy}>{legacy}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    );
  } else {
    control = (
      <input
        type="text"
        aria-label={label}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        inputMode={INPUT_MODE[column.kind]}
        placeholder={column.placeholder ?? PLACEHOLDER[column.kind]}
        value={text}
        onChange={(event) => onChange(event.target.value)}
        className={cn(CELL_INPUT, (column.kind === "money" || column.kind === "number") && "text-right tabular-nums")}
      />
    );
  }
  return (
    <>
      {control}
      {error && <p id={errorId} className="mt-1 text-xs font-medium text-destructive">{error}</p>}
    </>
  );
}
