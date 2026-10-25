// Base dos relatórios (Tarefa 10): tabela exportável e contas de data feitas sobre "YYYY-MM-DD" (sem Date local, então
// fuso e horário de verão não deslocam o dia). Os relatórios leem tabelas inteiras da empresa e agregam no TypeScript,
// porque o banco demo do navegador não entende JOIN, SUM nem GROUP BY.
import { todayIso } from "@/lib/utils";

/** text: texto; date: dia "YYYY-MM-DD"; integer/number: quantidade; money: R$ (2 casas); percent: % (1 casa). */
export type ColumnKind = "text" | "date" | "integer" | "number" | "money" | "percent";

export interface ReportColumn {
  key: string;
  label: string;
  kind: ColumnKind;
}

export type CellValue = string | number | null | undefined;
export type ReportRow = Record<string, CellValue>;
/** strong: linha de total/grupo (negrito); indent: detalhe recuado (categoria da DRE). */
export type RowStyle = "strong" | "indent" | undefined;

/** Tabela que vai para a tela e para a exportação (CSV, XLSX e impressão/PDF). */
export interface ReportTable {
  title: string;
  subtitle?: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  /** Linha de total no rodapé. */
  totals?: ReportRow;
  /** Estilo por linha (mesma ordem de `rows`). */
  styles?: RowStyle[];
  /** Nome do arquivo sem extensão. */
  fileName: string;
}

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Dia "YYYY-MM-DD" → número de dias desde 1970-01-01 (UTC puro, sem fuso). */
function dayNumber(day: string): number {
  const [year, month, date] = day.slice(0, 10).split("-").map(Number);
  return Math.round(Date.UTC(year, month - 1, date) / 86_400_000);
}

function fromDayNumber(value: number): string {
  const date = new Date(value * 86_400_000);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/**
 * Dia local de um valor do banco: data de documento ("YYYY-MM-DD") fica como está; instante ISO (com Z ou fuso) vira o
 * dia no fuso local; datetime('now') do SQLite ("YYYY-MM-DD HH:MM:SS", sem fuso) é UTC. Vazio ou inválido → null.
 */
export function localDayOf(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(value)) return null;
  const instant = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value.replace(" ", "T")}Z`);
  return Number.isNaN(instant.getTime()) ? null : todayIso(instant);
}

export function addDays(day: string, days: number): string {
  return fromDayNumber(dayNumber(day) + days);
}

/** Dias de `from` até `to` (negativo se `to` vem antes). */
export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

/** "YYYY-MM-DD" → "YYYY-MM". */
export function monthOf(day: string): string {
  return day.slice(0, 7);
}

export function addMonths(month: string, count: number): string {
  const [year, index] = month.split("-").map(Number);
  const total = year * 12 + (index - 1) + count;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
}

/** Meses de `from` até `to`, inclusive ("YYYY-MM"). Vazio se `from` vem depois. */
export function monthsBetween(from: string, to: string): string[] {
  const months: string[] = [];
  for (let month = from; month <= to && months.length < 1200; month = addMonths(month, 1)) months.push(month);
  return months;
}

/** "2026-10" → "out/2026". */
export function monthLabel(month: string): string {
  const [year, index] = month.split("-").map(Number);
  return `${MONTHS[index - 1] ?? "?"}/${year}`;
}

/** Último dia do mês "YYYY-MM". */
export function lastDayOfMonth(month: string): string {
  return addDays(`${addMonths(month, 1)}-01`, -1);
}

/** Participação em %, com uma casa; total zero → 0. */
export function sharePercent(part: number, total: number): number {
  if (!total) return 0;
  return Math.round((part / total) * 1000) / 10 || 0;
}

export type PeriodPresetKey = "este_mes" | "mes_passado" | "ultimos_30" | "ultimos_90" | "este_ano" | "ultimos_12_meses";

export interface PeriodPreset {
  key: PeriodPresetKey;
  label: string;
  from: string;
  to: string;
}

/** Atalhos de período a partir de hoje ("YYYY-MM-DD"). */
export function periodPresets(today: string): PeriodPreset[] {
  const month = monthOf(today);
  const previous = addMonths(month, -1);
  return [
    { key: "este_mes", label: "Este mês", from: `${month}-01`, to: today },
    { key: "mes_passado", label: "Mês passado", from: `${previous}-01`, to: lastDayOfMonth(previous) },
    { key: "ultimos_30", label: "Últimos 30 dias", from: addDays(today, -29), to: today },
    { key: "ultimos_90", label: "Últimos 90 dias", from: addDays(today, -89), to: today },
    { key: "este_ano", label: "Este ano", from: `${today.slice(0, 4)}-01-01`, to: today },
    { key: "ultimos_12_meses", label: "Últimos 12 meses", from: `${addMonths(month, -11)}-01`, to: today },
  ];
}

/** "2026-10-01" → "01/10/2026". */
export function dayLabel(day: string): string {
  const [year, month, date] = day.split("-");
  return `${date}/${month}/${year}`;
}

/** "01/10/2026 a 31/10/2026". */
export function periodLabel(from: string, to: string): string {
  return `${dayLabel(from)} a ${dayLabel(to)}`;
}

/** Linha de banco genérica (as consultas são SELECT * por empresa). */
export type DbRow = Record<string, unknown>;

export function text(value: unknown): string | null {
  return value == null || value === "" ? null : String(value);
}

export function num(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
