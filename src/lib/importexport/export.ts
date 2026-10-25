// Exportação e modelos de planilha. As colunas são os campos da entidade, com os mesmos rótulos da importação:
// o arquivo exportado volta pela importação sem remapear e sem duplicar (atualiza pela chave natural).
// CSV: separador ";", BOM UTF-8 e CRLF (o Excel em pt-BR abre direto), "1234,56", dd/mm/aaaa, Sim/Não, rótulo do
// enum; texto que começa com = + - @ ganha um apóstrofo na frente (não vira fórmula; a importação tira o apóstrofo).
// XLSX: células tipadas (número com formato de moeda, data de verdade), cabeçalho em negrito e fixo.
import type { DatabaseLike } from "@/lib/db/demo";
import { getEntity, type FieldDef, type ImportEntity } from "./registry";

export type ExportFormat = "csv" | "xlsx";

export interface ExportContext {
  db: DatabaseLike;
  companyId: string;
}

const MIME: Record<ExportFormat, string> = {
  csv: "text/csv;charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function requireEntity(entityKey: string): ImportEntity<unknown> {
  const entity = getEntity(entityKey);
  if (!entity) throw new Error(`Cadastro desconhecido para exportar: ${entityKey}`);
  return entity;
}

// ── valores ───────────────────────────────────────────────────────

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;
const ISO_MONTH = /^(\d{4})-(\d{2})$/;

const decimalText = (value: number, digits?: number) =>
  (digits === undefined ? value.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 10 }) : value.toFixed(digits)).replace(".", ",");

function asNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function asBool(value: unknown): boolean | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return !["0", "false", "nao", "não"].includes(String(value).toLowerCase());
}

const optionLabel = (field: FieldDef, value: unknown) => field.options?.find((option) => option.value === value)?.label ?? String(value);

/** Valor da célula como texto pt-BR (CSV e conferência). Vazio = "". */
export function formatCell(field: FieldDef, value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  switch (field.kind) {
    case "money": {
      const number = asNumber(value);
      return number === null ? String(value) : decimalText(number, 2);
    }
    case "number":
    case "int": {
      const number = asNumber(value);
      return number === null ? String(value) : decimalText(number);
    }
    case "date": {
      const match = ISO_DATE.exec(String(value));
      return match ? `${match[3]}/${match[2]}/${match[1]}` : String(value);
    }
    case "month": {
      const match = ISO_MONTH.exec(String(value));
      return match ? `${match[2]}/${match[1]}` : String(value);
    }
    case "bool": {
      const flag = asBool(value);
      return flag === null ? "" : flag ? "Sim" : "Não";
    }
    case "enum":
      return optionLabel(field, value);
    default:
      return String(value);
  }
}

/** Texto que o Excel/LibreOffice trataria como fórmula ganha um apóstrofo (injeção de CSV). */
export function escapeFormula(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

const NUMERIC_KINDS = new Set(["money", "number", "int", "date", "month", "bool"]);

function csvCell(field: FieldDef | null, text: string): string {
  const safe = field && NUMERIC_KINDS.has(field.kind) ? text : escapeFormula(text);
  return /[";\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function toCsv(fields: FieldDef[], rows: string[][]): string {
  const lines = [fields.map((field) => csvCell(null, field.label)).join(";")];
  for (const row of rows) lines.push(row.map((text, index) => csvCell(fields[index], text)).join(";"));
  return `﻿${lines.join("\r\n")}\r\n`;
}

// ── XLSX ──────────────────────────────────────────────────────────

type XlsxCell = { value?: string | number | Date | boolean; type?: StringConstructor | NumberConstructor | DateConstructor; format?: string; fontWeight?: "bold"; wrap?: boolean } | null;

function xlsxCell(field: FieldDef, value: unknown): XlsxCell {
  if (value === null || value === undefined || value === "") return null;
  if (field.kind === "money" || field.kind === "number" || field.kind === "int") {
    const number = asNumber(value);
    if (number !== null) return { value: number, type: Number, format: field.kind === "money" ? "#,##0.00" : field.kind === "int" ? "0" : "0.##########" };
  }
  if (field.kind === "date") {
    const match = ISO_DATE.exec(String(value));
    if (match) return { value: new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))), type: Date, format: "dd/mm/yyyy" };
  }
  const text = formatCell(field, value);
  return text ? { value: text, type: String } : null;
}

const header = (label: string): XlsxCell => ({ value: label, type: String, fontWeight: "bold" });

/** Nome de aba válido no Excel: até 31 caracteres, sem : \ / ? * [ ]. */
export function sheetName(label: string): string {
  return label.replace(/[:\\/?*[\]]/g, " ").trim().slice(0, 31) || "Dados";
}

const columnWidth = (field: FieldDef) => Math.min(40, Math.max(12, field.label.length + 2));

async function toXlsx(sheets: { name: string; fields?: FieldDef[]; data: XlsxCell[][]; widths?: number[] }[]): Promise<Blob> {
  const { default: writeXlsxFile } = await import("write-excel-file/universal");
  const blob = await writeXlsxFile(
    sheets.map((sheet) => ({
      sheet: sheetName(sheet.name),
      data: sheet.data,
      columns: (sheet.widths ?? sheet.fields?.map(columnWidth) ?? []).map((width) => ({ width })),
      stickyRowsCount: 1,
    })) as Parameters<typeof writeXlsxFile>[0],
  ).toBlob();
  return new Blob([blob], { type: MIME.xlsx });
}

// ── exportação ────────────────────────────────────────────────────

/** Linhas exportáveis (valores crus) da entidade, na ordem dos campos. */
export async function exportData(entityKey: string, context: ExportContext): Promise<Record<string, unknown>[]> {
  const entity = requireEntity(entityKey);
  if (!entity.exportData) throw new Error(`${entity.label}: exportação não disponível`);
  return entity.exportData(context.db, context.companyId);
}

/** Arquivo com todos os registros ativos da empresa (CSV ou XLSX). */
export async function exportRows(entityKey: string, format: ExportFormat, context: ExportContext): Promise<Blob> {
  const entity = requireEntity(entityKey);
  const rows = await exportData(entityKey, context);
  if (format === "csv") {
    const text = toCsv(entity.fields, rows.map((row) => entity.fields.map((field) => formatCell(field, row[field.key]))));
    return new Blob([text], { type: MIME.csv });
  }
  const data: XlsxCell[][] = [entity.fields.map((field) => header(field.label)), ...rows.map((row) => entity.fields.map((field) => xlsxCell(field, row[field.key])))];
  return toXlsx([{ name: entity.label, fields: entity.fields, data }]);
}

// ── modelos ───────────────────────────────────────────────────────

const KIND_HINT: Record<FieldDef["kind"], string> = {
  text: "Texto",
  money: "Valor em reais, ex.: 1.234,56",
  number: "Número, ex.: 10,5",
  int: "Número inteiro",
  date: "Data dd/mm/aaaa",
  month: "Mês e ano, ex.: 11/2026",
  bool: "Sim ou Não",
  enum: "Um dos valores aceitos",
  phone: "Telefone com DDD, ex.: (11) 98765-4321",
  email: "E-mail",
  cpf: "CPF, com ou sem pontuação",
  cnpj: "CNPJ, com ou sem pontuação",
  document: "CPF ou CNPJ, com ou sem pontuação",
};

/** Explicação de cada coluna (aba "Instruções" do modelo e ajuda da tela). */
export function fieldInstructions(field: FieldDef): string {
  const parts = [field.kind === "enum" && field.options?.length ? `Um destes: ${field.options.map((option) => option.label).join(", ")}` : KIND_HINT[field.kind]];
  if (field.hint) parts.push(field.hint);
  return parts.join(". ");
}

/** Modelo para preencher: cabeçalho com os rótulos e uma linha de exemplo; o XLSX traz também a aba "Instruções". */
export async function templateFor(entityKey: string, format: ExportFormat): Promise<Blob> {
  const entity = requireEntity(entityKey);
  const example = entity.fields.map((field) => field.example ?? "");
  if (format === "csv") return new Blob([toCsv(entity.fields, [example])], { type: MIME.csv });
  const text = (value: string, bold = false): XlsxCell => (value ? { value, type: String, ...(bold ? { fontWeight: "bold" as const } : {}) } : null);
  const instructions: XlsxCell[][] = [
    [header("Coluna"), header("Obrigatória"), header("Como preencher")],
    ...entity.fields.map((field) => [text(field.label, true), text(field.required ? "Sim" : "Não"), { value: fieldInstructions(field), type: String, wrap: true } as XlsxCell]),
    [null, null, null],
    [text("Dica"), null, text("Apague a linha de exemplo antes de importar. Linhas que já existem (mesmo documento, e-mail ou código) são atualizadas; célula vazia não apaga o que já está cadastrado.")],
  ];
  return toXlsx([
    { name: entity.label, fields: entity.fields, data: [entity.fields.map((field) => header(field.label)), example.map((value) => text(value))] },
    { name: "Instruções", data: instructions, widths: [28, 12, 80] },
  ]);
}

// ── nomes de arquivo ──────────────────────────────────────────────

function slug(text: string): string {
  return (
    text
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "dados"
  );
}

/** "clientes-2026-10-24.xlsx" (exportação) ou "modelo-clientes.csv" (modelo). */
export function exportFilename(entityKey: string, format: ExportFormat, kind: "export" | "template" = "export", day = new Date()): string {
  const label = slug(getEntity(entityKey)?.label ?? entityKey);
  if (kind === "template") return `modelo-${label}.${format}`;
  const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  return `${label}-${date}.${format}`;
}
