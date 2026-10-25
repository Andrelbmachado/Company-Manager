// Exportação dos relatórios: CSV (Excel em português), XLSX e PDF. O PDF sai pelo diálogo de impressão do sistema
// ("Salvar como PDF" no macOS), com uma folha montada só com o relatório; assim não entra biblioteca de PDF no app.
// No app desktop o arquivo vai para o caminho escolhido no diálogo Salvar; no navegador, é baixado (pelo "Salvar como"
// único do app, src/lib/files/saveAs.ts). O CSV/XLSX daqui é de uma tabela calculada (com total, % e linhas de grupo);
// o da importação (src/lib/importexport/export.ts) é o cadastro cru, no formato que volta pela importação.
import writeXlsxFile, { type Cell, type SheetData } from "write-excel-file/universal";
import { saveBlobAs } from "@/lib/files/saveAs";
import { formatCurrency } from "@/lib/utils";
import { dayLabel, type CellValue, type ColumnKind, type ReportColumn, type ReportRow, type ReportTable } from "./common";

export type ExportFormat = "csv" | "xlsx" | "pdf";

export const EXPORT_FORMATS: readonly { format: ExportFormat; label: string; hint: string }[] = [
  { format: "csv", label: "CSV", hint: "Planilha simples (Excel, Numbers, Google Planilhas)" },
  { format: "xlsx", label: "Excel", hint: "Planilha do Excel (.xlsx)" },
  { format: "pdf", label: "PDF", hint: "Abre a impressão: escolha “Salvar como PDF”" },
];

const MIME: Record<Exclude<ExportFormat, "pdf">, string> = {
  csv: "text/csv;charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
const FILTER_NAMES: Record<Exclude<ExportFormat, "pdf">, string> = { csv: "Planilha CSV", xlsx: "Planilha do Excel" };

function isNumeric(kind: ColumnKind): boolean {
  return kind === "integer" || kind === "number" || kind === "money" || kind === "percent";
}

function decimals(kind: ColumnKind): number {
  return kind === "money" ? 2 : kind === "percent" ? 1 : 0;
}

/** Número com vírgula decimal e sem separador de milhar (o Excel em português lê como número). */
function csvNumber(value: number, kind: ColumnKind): string {
  if (kind === "number") return String(Math.round(value * 1000) / 1000).replace(".", ",");
  return value.toFixed(decimals(kind)).replace(".", ",");
}

/**
 * Texto que começa com =, +, -, @ (mesmo depois de espaços, que a planilha pode descartar), tab ou CR vira fórmula no
 * Excel/LibreOffice: prefixa com apóstrofo (proteção contra injeção de fórmula).
 */
function neutralizeFormula(value: string): string {
  return /^(?:[\t\r]|\s*[=+\-@])/.test(value) ? `'${value}` : value;
}

/** `indent`: recuo da linha de detalhe, aplicado depois de neutralizar (o recuo não pode esconder a fórmula). */
function csvCell(value: CellValue, column: ReportColumn, indent = false): string {
  if (value === null || value === undefined || value === "") return "";
  let output: string;
  if (typeof value === "number" && isNumeric(column.kind)) output = csvNumber(value, column.kind);
  else if (column.kind === "date" && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) output = dayLabel(value);
  else output = neutralizeFormula(String(value));
  if (indent) output = `    ${output}`;
  return /[";\r\n]/.test(output) ? `"${output.replace(/"/g, '""')}"` : output;
}

function rowsWithTotals(table: ReportTable): { row: ReportRow; strong: boolean; indent: boolean }[] {
  const rows = table.rows.map((row, index) => ({ row, strong: table.styles?.[index] === "strong", indent: table.styles?.[index] === "indent" }));
  return table.totals ? [...rows, { row: table.totals, strong: true, indent: false }] : rows;
}

/** CSV para o Excel em português: BOM UTF-8, ponto e vírgula, vírgula decimal, linhas com CRLF e linha de total. */
export function toCsv(table: ReportTable): string {
  const lines = [table.columns.map((column) => csvCell(column.label, { ...column, kind: "text" })).join(";")];
  for (const { row, indent } of rowsWithTotals(table)) {
    lines.push(table.columns.map((column, index) => csvCell(row[column.key], column, indent && index === 0)).join(";"));
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}

const XLSX_FORMAT: Partial<Record<ColumnKind, string>> = { integer: "0", number: "#,##0.###", money: "#,##0.00", percent: "0.0" };

function xlsxCell(value: CellValue, column: ReportColumn, strong: boolean, indent: boolean): Cell {
  if (value === null || value === undefined || value === "") return null;
  const weight = strong ? { fontWeight: "bold" as const } : {};
  if (typeof value === "number" && isNumeric(column.kind)) return { type: Number, value, format: XLSX_FORMAT[column.kind], ...weight };
  if (column.kind === "date" && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return { type: Date, value: new Date(Date.UTC(year, month - 1, day)), format: "dd/mm/yyyy", ...weight };
  }
  return { type: String, value: String(value), ...(indent ? { indent: 1 } : {}), ...weight };
}

/** Linhas da planilha: título, subtítulo, linha em branco, cabeçalho, dados e total. */
export function xlsxSheet(table: ReportTable): SheetData {
  const header = table.columns.map<Cell>((column) => ({ type: String, value: column.label, fontWeight: "bold", ...(isNumeric(column.kind) ? { align: "right" as const } : {}) }));
  return [
    [{ type: String, value: table.title, fontWeight: "bold", fontSize: 14 }],
    [table.subtitle ? { type: String, value: table.subtitle } : null],
    [null],
    header,
    ...rowsWithTotals(table).map(({ row, strong, indent }) => table.columns.map((column, index) => xlsxCell(row[column.key], column, strong, indent && index === 0))),
  ];
}

export async function toXlsxBlob(table: ReportTable): Promise<Blob> {
  const widths = table.columns.map((column) => ({ width: Math.min(48, Math.max(10, column.label.length + 2, ...table.rows.map((row) => String(row[column.key] ?? "").length + 2))) }));
  return writeXlsxFile(xlsxSheet(table), { sheet: table.title.slice(0, 31), columns: widths }).toBlob();
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const numberFormat = (fractionDigits: number, max = fractionDigits) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: fractionDigits, maximumFractionDigits: max });

/** Valor como aparece na tela e na impressão (R$ 1.000,00 · 64,9% · 24/10/2026). */
export function formatCell(value: CellValue, kind: ColumnKind): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") {
    if (kind === "money") return formatCurrency(value);
    if (kind === "percent") return `${numberFormat(1).format(value)}%`;
    if (kind === "integer") return numberFormat(0).format(value);
    if (kind === "number") return numberFormat(0, 3).format(value);
  }
  if (kind === "date" && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return dayLabel(value);
  return String(value);
}

export interface PrintOptions {
  company?: string;
  generatedAt?: Date;
}

/** Folha do relatório para imprimir/salvar em PDF (todo texto escapado). */
export function reportHtml(table: ReportTable, options: PrintOptions = {}): string {
  const generatedAt = options.generatedAt ?? new Date();
  const stamp = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(generatedAt);
  const align = (column: ReportColumn) => (isNumeric(column.kind) ? ' class="num"' : "");
  const cells = (row: ReportRow, tag: "td" | "th") => table.columns.map((column) => `<${tag}${align(column)}>${escapeHtml(formatCell(row[column.key], column.kind))}</${tag}>`).join("");
  const body = table.rows
    .map((row, index) => {
      const style = table.styles?.[index];
      return `<tr${style ? ` class="${style}"` : ""}>${cells(row, "td")}</tr>`;
    })
    .join("");
  const meta = [options.company, table.subtitle, `Gerado em ${stamp}`].filter(Boolean).map((item) => escapeHtml(String(item))).join(" · ");
  return [
    `<header><h1>${escapeHtml(table.title)}</h1><p>${meta}</p></header>`,
    "<table>",
    `<thead><tr>${table.columns.map((column) => `<th${align(column)}>${escapeHtml(column.label)}</th>`).join("")}</tr></thead>`,
    `<tbody>${body || `<tr><td colspan="${table.columns.length}">Nada no período.</td></tr>`}</tbody>`,
    table.totals ? `<tfoot><tr>${cells(table.totals, "th")}</tr></tfoot>` : "",
    "</table>",
  ].join("");
}

const PRINT_CSS = `
#cm-print-root { display: none; }
@media print {
  @page { size: A4 landscape; margin: 12mm; }
  body.cm-printing > *:not(#cm-print-root) { display: none !important; }
  body.cm-printing #cm-print-root { display: block !important; color: #000; background: #fff; font: 10pt/1.35 -apple-system, "Helvetica Neue", Arial, sans-serif; }
  #cm-print-root h1 { font-size: 15pt; margin: 0 0 2pt; }
  #cm-print-root header p { margin: 0 0 8pt; color: #444; font-size: 9pt; }
  #cm-print-root table { width: 100%; border-collapse: collapse; }
  #cm-print-root th, #cm-print-root td { border-bottom: 0.5pt solid #bbb; padding: 3pt 5pt; text-align: left; vertical-align: top; }
  #cm-print-root thead th { border-bottom: 1pt solid #000; }
  #cm-print-root thead { display: table-header-group; }
  #cm-print-root tfoot th { border-top: 1pt solid #000; border-bottom: none; }
  #cm-print-root .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  #cm-print-root tr { break-inside: avoid; }
  #cm-print-root tr.strong td { font-weight: 700; }
  #cm-print-root tr.indent td:first-child { padding-left: 16pt; }
}`;

/**
 * Imprime só o relatório (no macOS o diálogo tem "Salvar como PDF"). A folha fica num #cm-print-root escondido na tela;
 * a próxima impressão a substitui. No app Tauri, window.print() devolve uma Promise (precisa de core:webview:allow-print).
 */
export async function printReport(table: ReportTable, options: PrintOptions = {}): Promise<void> {
  let style = document.getElementById("cm-print-style");
  if (!style) {
    style = document.createElement("style");
    style.id = "cm-print-style";
    style.textContent = PRINT_CSS;
    document.head.appendChild(style);
  }
  let root = document.getElementById("cm-print-root");
  if (!root) {
    root = document.createElement("div");
    root.id = "cm-print-root";
    root.setAttribute("aria-hidden", "true");
    document.body.appendChild(root);
  }
  root.innerHTML = reportHtml(table, options);
  document.body.classList.add("cm-printing");
  try {
    await (window.print() as unknown as Promise<void> | undefined);
  } catch (error) {
    throw new Error(`Não foi possível abrir a impressão: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Grava o arquivo: no app, no caminho escolhido no diálogo Salvar (null = cancelou); no navegador, baixa (devolve o nome). */
export async function saveReportFile(fileName: string, content: string | Blob, format: Exclude<ExportFormat, "pdf">): Promise<string | null> {
  const blob = typeof content === "string" ? new Blob([content], { type: MIME[format] }) : content;
  return saveBlobAs(blob, fileName, { filters: [{ name: FILTER_NAMES[format], extensions: [format] }] });
}

/** Exporta a tabela no formato escolhido. CSV/XLSX: caminho gravado (null = cancelado). PDF: abre a impressão e devolve null. */
export async function exportReport(table: ReportTable, format: ExportFormat, options: PrintOptions = {}): Promise<string | null> {
  if (format === "pdf") {
    await printReport(table, options);
    return null;
  }
  const content = format === "csv" ? toCsv(table) : await toXlsxBlob(table);
  return saveReportFile(`${table.fileName}.${format}`, content, format);
}
