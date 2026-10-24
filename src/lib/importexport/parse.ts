// Lê CSV ou XLSX em linhas de texto { cabeçalho: valor }. Não interpreta valores (isso é do normalize.ts), só os
// deixa num texto que o normalizador entende: número do Excel vira "1234,56", data vira "YYYY-MM-DD", booleano "Sim"/"Não".
// CSV: detecta ; , tab e | (e a linha "sep=;" do Excel), BOM, UTF-8, UTF-16 e Windows-1252/Latin-1.
// XLSX: todas as abas com dados (read-excel-file lê o valor calculado das fórmulas; célula mesclada vale só na 1ª).
import { ImportFileError, errorMessage } from "./errors";

export interface ParsedSheet {
  name: string;
  headers: string[];
  rows: Record<string, string>[];
  /** Número de cada linha na planilha (cabeçalho = linha 1), para o relatório de erros. */
  rowNumbers: number[];
}

export interface ParsedFile {
  format: "csv" | "xlsx";
  sheets: ParsedSheet[];
}

export interface ParseOptions {
  /** Máximo de linhas por aba (padrão 100.000). */
  maxRows?: number;
}

export const MAX_IMPORT_ROWS = 100_000;
/** Tamanho máximo do arquivo (o XLSX descompactado ocupa bem mais memória que isso). */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

type FileLike = Blob & { name?: string };

const formatNumber = (value: number) => value.toLocaleString("pt-BR", { useGrouping: false, maximumFractionDigits: 10 });

// ── texto ─────────────────────────────────────────────────────────

/** Decodifica bytes de texto: BOM manda; sem BOM, UTF-8 se for válido, senão Windows-1252 (Latin-1 do Excel antigo). */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder("utf-8").decode(bytes.subarray(3));
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

type PapaModule = typeof import("papaparse");

async function loadPapa(): Promise<PapaModule> {
  const module = (await import("papaparse")) as unknown as PapaModule & { default?: PapaModule };
  // papaparse é UMD/CommonJS: no Node só existe o default; no Vite, os dois.
  return module.default ?? module;
}

const DELIMITERS = [";", ",", "\t", "|"] as const;

/** Escolhe o separador que dá o mesmo número de colunas (> 1) no maior número das primeiras linhas. */
function detectDelimiter(papa: PapaModule, text: string): string {
  const sample = text.slice(0, 64 * 1024);
  let best: { delimiter: string; consistent: number; columns: number } = { delimiter: ";", consistent: -1, columns: 0 };
  for (const delimiter of DELIMITERS) {
    const rows = papa.parse<string[]>(sample, { delimiter, preview: 30, skipEmptyLines: "greedy" }).data;
    if (rows.length === 0) continue;
    const columns = rows[0].length;
    if (columns < 2) continue;
    const consistent = rows.filter((row) => row.length === columns).length;
    if (consistent > best.consistent || (consistent === best.consistent && columns > best.columns)) best = { delimiter, consistent, columns };
  }
  return best.delimiter;
}

/** Cabeçalhos únicos e não vazios: "" → "Coluna N"; repetido → "Nome (2)". */
function uniqueHeaders(raw: string[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((cell, index) => {
    const base = cell.replace(/^﻿/, "").trim().replace(/\s+/g, " ") || `Coluna ${index + 1}`;
    const count = (seen.get(base.toLowerCase()) ?? 0) + 1;
    seen.set(base.toLowerCase(), count);
    return count === 1 ? base : `${base} (${count})`;
  });
}

/** Monta a aba a partir das linhas cruas (já em texto): 1ª linha não vazia = cabeçalho; linhas vazias saem. */
function buildSheet(name: string, records: string[][], maxRows: number): ParsedSheet | null {
  const isEmpty = (record: string[]) => record.every((cell) => !cell.trim());
  const headerIndex = records.findIndex((record) => !isEmpty(record));
  if (headerIndex < 0) return null;
  const width = Math.max(...records.slice(headerIndex).map((record) => record.length));
  const headerCells = Array.from({ length: width }, (_, index) => records[headerIndex][index] ?? "");
  const headers = uniqueHeaders(headerCells);
  const rows: Record<string, string>[] = [];
  const rowNumbers: number[] = [];
  for (let index = headerIndex + 1; index < records.length; index++) {
    const record = records[index];
    if (isEmpty(record)) continue;
    if (rows.length >= maxRows) {
      throw new ImportFileError(`A aba "${name}" tem mais de ${maxRows.toLocaleString("pt-BR")} linhas. Divida o arquivo em partes menores.`);
    }
    rows.push(Object.fromEntries(headers.map((header, column) => [header, (record[column] ?? "").trim()])));
    rowNumbers.push(index + 1);
  }
  return { name, headers, rows, rowNumbers };
}

async function parseCsv(bytes: Uint8Array, name: string, maxRows: number): Promise<ParsedSheet[]> {
  let text = decodeText(bytes);
  if (text.includes("\u0000")) throw new ImportFileError("O arquivo não parece ser um CSV de texto. Exporte a planilha como CSV ou envie o .xlsx.");
  const papa = await loadPapa();
  let delimiter: string | null = null;
  const hint = /^sep=(.)\r?\n/i.exec(text);
  if (hint) {
    delimiter = hint[1];
    text = text.slice(hint[0].length);
  }
  if (!text.trim()) throw new ImportFileError("O arquivo está vazio.");
  delimiter ??= detectDelimiter(papa, text);
  const result = papa.parse<string[]>(text, { delimiter, skipEmptyLines: false });
  const sheet = buildSheet(name.replace(/\.[^.]+$/, "") || "CSV", result.data, maxRows);
  if (!sheet) throw new ImportFileError("O arquivo está vazio.");
  return [sheet];
}

// ── XLSX ──────────────────────────────────────────────────────────

function cellText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? formatNumber(value) : "";
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    // O Excel não tem fuso: a biblioteca devolve a data em UTC.
    const iso = value.toISOString();
    return iso.slice(11, 19) === "00:00:00" ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
  }
  return String(value);
}

function xlsxErrorMessage(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  if (code === "XLS_FILE_NOT_SUPPORTED") return "Arquivo .xls (Excel 97-2003) não é aceito: abra no Excel e salve como .xlsx ou CSV.";
  if (code === "NO_DATA") return "A planilha está vazia.";
  return `Não foi possível ler o arquivo Excel (está corrompido ou não é .xlsx): ${errorMessage(error)}`;
}

async function parseXlsx(bytes: Uint8Array, maxRows: number): Promise<ParsedSheet[]> {
  const { default: readXlsxFile } = await import("read-excel-file/universal");
  let workbook: { sheet: string; data: unknown[][] }[];
  try {
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    workbook = (await readXlsxFile(buffer)) as unknown as { sheet: string; data: unknown[][] }[];
  } catch (error) {
    throw new ImportFileError(xlsxErrorMessage(error));
  }
  const sheets: ParsedSheet[] = [];
  for (const { sheet, data } of workbook) {
    const records = data.map((row) => (row ?? []).map(cellText));
    const parsed = buildSheet(sheet, records, maxRows);
    if (parsed) sheets.push(parsed);
  }
  if (sheets.length === 0) throw new ImportFileError("A planilha está vazia.");
  return sheets;
}

// ── entrada ───────────────────────────────────────────────────────

function detectFormat(name: string, bytes: Uint8Array): "csv" | "xlsx" {
  const extension = /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase() ?? "";
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const ole = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
  if (extension === "xlsx" || extension === "xlsm" || (extension === "xls" && zip)) return "xlsx";
  if (extension === "xls" || ole) throw new ImportFileError("Arquivo .xls (Excel 97-2003) não é aceito: abra no Excel e salve como .xlsx ou CSV.");
  if (["csv", "txt", "tsv", "tab", ""].includes(extension)) return zip ? "xlsx" : "csv";
  throw new ImportFileError(`Formato .${extension} não é aceito: envie um arquivo CSV ou Excel (.xlsx).`);
}

/** Lê o arquivo enviado. Erros (vazio, formato, tamanho, linhas demais) são ImportFileError com a mensagem pronta. */
export async function parseFile(file: FileLike, options: ParseOptions = {}): Promise<ParsedFile> {
  const maxRows = options.maxRows ?? MAX_IMPORT_ROWS;
  if (file.size === 0) throw new ImportFileError("O arquivo está vazio.");
  if (file.size > MAX_FILE_BYTES) throw new ImportFileError(`Arquivo grande demais (máximo ${MAX_FILE_BYTES / 1024 / 1024} MB). Divida em partes menores.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const name = file.name ?? "";
  const format = detectFormat(name, bytes);
  const sheets = format === "xlsx" ? await parseXlsx(bytes, maxRows) : await parseCsv(bytes, name, maxRows);
  return { format, sheets };
}
