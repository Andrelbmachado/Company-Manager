// Leitura de extrato bancário: OFX 1.x (SGML, sem tags de fechamento nos campos), OFX 2 (XML) e CSV dos bancos
// brasileiros (";" ou ",", preâmbulo antes do cabeçalho, "1.234,56", "250,50 D", datas dd/mm/aaaa).
// Valor positivo = entrada (crédito), negativo = saída (débito), como em bank_transactions.amount.
import Papa from "papaparse";
import { roundMoney, toCents } from "@/lib/money";
import { isIsoDay, parseMoneyInput } from "./financeCommon";

export interface BankTx {
  /** Id do lançamento no banco (FITID do OFX; no CSV, gerado de forma estável a partir da linha). */
  fitid: string | null;
  postedAt: string;
  amount: number;
  description: string;
  memo: string | null;
  checkNumber: string | null;
  /** TRNTYPE do OFX (DEBIT, CREDIT, XFER...). */
  type: string | null;
  /** Saldo depois do lançamento, quando o extrato informa. */
  balanceAfter?: number | null;
}

export interface OfxStatement {
  transactions: BankTx[];
  bankId: string | null;
  accountId: string | null;
  balance: number | null;
  balanceDate: string | null;
}

/** TRNTYPE de saída: alguns bancos mandam o valor positivo nesses tipos. */
const DEBIT_TYPES = new Set(["DEBIT", "PAYMENT", "CASH", "ATM", "POS", "FEE", "SRVCHG", "CHECK", "DIRECTDEBIT", "REPEATPMT"]);

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/** Valor de um campo do OFX: `<TAG>valor` (SGML) ou `<TAG>valor</TAG>` (XML). */
function ofxField(block: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([^<\\r\\n]*)`, "i").exec(block);
  if (!match) return null;
  const value = decodeEntities(match[1]).replace(/\s+/g, " ").trim();
  return value === "" ? null : value;
}

/** Data do OFX ("20261003120000", seguida do fuso entre colchetes) → "2026-10-03": o dia que o banco informa, sem converter fuso. */
function ofxDate(value: string | null): string | null {
  const match = value ? /^(\d{4})(\d{2})(\d{2})/.exec(value) : null;
  if (!match) return null;
  const day = `${match[1]}-${match[2]}-${match[3]}`;
  return isIsoDay(day) ? day : null;
}

/** TRNAMT/BALAMT: decimal com ponto (ou vírgula, em alguns bancos) e sem milhar; "1.500" é 1,5. */
function ofxAmount(value: string | null): number | null {
  if (!value) return null;
  const text = value.trim().replace(/^\+/, "");
  const parsed = /^-?\d*[.,]?\d+$/.test(text) ? Number(text.replace(",", ".")) : parseMoneyInput(text);
  return Number.isFinite(parsed) ? roundMoney(parsed) : null;
}

function assertOfx(text: string): void {
  if (!/<OFX>|OFXHEADER/i.test(text)) throw new Error("O arquivo não parece um extrato OFX.");
}

/** Lançamentos de um extrato OFX. Lançamento sem data ou valor válido é ignorado. */
export function parseOfx(text: string): BankTx[] {
  assertOfx(text);
  const blocks = text
    .split(/<STMTTRN>/i)
    .slice(1)
    .map((part) => part.split(/<\/STMTTRN>|<\/BANKTRANLIST>|<STMTTRN>/i)[0]);
  const transactions: BankTx[] = [];
  for (const block of blocks) {
    const postedAt = ofxDate(ofxField(block, "DTPOSTED"));
    let amount = ofxAmount(ofxField(block, "TRNAMT"));
    if (!postedAt || amount == null) continue;
    const type = ofxField(block, "TRNTYPE")?.toUpperCase() ?? null;
    if (type && DEBIT_TYPES.has(type) && amount > 0) amount = -amount;
    const name = ofxField(block, "NAME");
    const memo = ofxField(block, "MEMO");
    transactions.push({
      fitid: ofxField(block, "FITID"),
      postedAt,
      amount: amount || 0,
      description: name ?? memo ?? type ?? "Lançamento",
      memo: name && memo && memo !== name ? memo : null,
      checkNumber: ofxField(block, "CHECKNUM"),
      type,
    });
  }
  return transactions;
}

/** Extrato OFX completo: lançamentos, banco/conta e saldo final (LEDGERBAL). */
export function parseOfxStatement(text: string): OfxStatement {
  const transactions = parseOfx(text);
  const ledger = text.split(/<LEDGERBAL>/i)[1]?.split(/<\/LEDGERBAL>/i)[0] ?? "";
  return {
    transactions,
    bankId: ofxField(text, "BANKID"),
    accountId: ofxField(text, "ACCTID"),
    balance: ledger ? ofxAmount(ofxField(ledger, "BALAMT")) : null,
    balanceDate: ledger ? ofxDate(ofxField(ledger, "DTASOF")) : null,
  };
}

const CP1252_HIGH: Record<number, string> = {
  0x80: "€", 0x82: "‚", 0x83: "ƒ", 0x84: "„", 0x85: "…", 0x86: "†", 0x87: "‡", 0x88: "ˆ", 0x89: "‰", 0x8a: "Š", 0x8b: "‹", 0x8c: "Œ", 0x8e: "Ž",
  0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—", 0x98: "˜", 0x99: "™", 0x9a: "š", 0x9b: "›", 0x9c: "œ", 0x9e: "ž", 0x9f: "Ÿ",
};

function decodeWindows1252(bytes: Uint8Array): string {
  try {
    return new TextDecoder("windows-1252").decode(bytes);
  } catch {
    let text = "";
    for (const byte of bytes) text += CP1252_HIGH[byte] ?? String.fromCharCode(byte);
    return text;
  }
}

/**
 * Texto de um arquivo de extrato: UTF-8 quando os bytes são UTF-8 válido (com ou sem BOM), senão Windows-1252
 * (Latin-1 dos bancos brasileiros, inclusive OFX com CHARSET:1252). UTF-8 válido com acento quase nunca é 1252 por acaso.
 */
export function decodeStatementBytes(input: Uint8Array | ArrayBuffer): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = decodeWindows1252(bytes);
  }
  return text.replace(/^﻿/, "");
}

/** Sem acento, minúsculas, espaços simples. */
function normalizeHeader(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/["']/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

interface CsvColumns {
  date: number;
  description: number;
  value: number;
  credit: number;
  debit: number;
  document: number;
  balance: number;
}

function detectColumns(cells: string[]): CsvColumns | null {
  const headers = cells.map(normalizeHeader);
  const find = (pattern: RegExp, skip: number[] = []) => headers.findIndex((header, index) => !skip.includes(index) && pattern.test(header));
  const date = find(/^(data|dt\b|date)/);
  if (date < 0) return null;
  const value = find(/^(valor|vlr|montante|quantia|amount)/, [date]);
  const credit = find(/(credito|entrada)/, [date, value]);
  const debit = find(/(debito|saida)/, [date, value, credit]);
  if (value < 0 && credit < 0 && debit < 0) return null;
  const used = [date, value, credit, debit];
  const balance = find(/^saldo/, used);
  const document = find(/^(documento|doc\b|n\.? ?doc|numero|nº)/, [...used, balance]);
  const description = find(/(historico|descricao|lancamento|detalhe|memo|description|discriminacao)/, [...used, balance, document]);
  return { date, description, value, credit, debit, document, balance };
}

const DELIMITERS = [";", "\t", ","] as const;

function splitLine(line: string, delimiter: string): string[] {
  return (Papa.parse<string[]>(line, { delimiter }).data[0] ?? []).map((cell) => cell.trim());
}

/** "03/10/2026", "03/10/26", "2026-10-03", "03-10-2026", "03.10.2026" → "2026-10-03". */
function csvDate(value: string | undefined): string | null {
  const text = (value ?? "").trim();
  let match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (match) return isIsoDay(`${match[1]}-${match[2]}-${match[3]}`) ? `${match[1]}-${match[2]}-${match[3]}` : null;
  match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})\b/.exec(text);
  if (!match) return null;
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  const day = `${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  return isIsoDay(day) ? day : null;
}

/** "1.234,56", "-89,90", "250,50 D", "1.500,00 C", "(89,90)", "R$ 10,00" → número; NaN se vazio. */
function csvMoney(value: string | undefined): number {
  let text = (value ?? "").trim();
  if (!text || text === "-") return Number.NaN;
  let sign = 1;
  const suffix = /\s*([DC])$/i.exec(text);
  if (suffix) {
    sign = suffix[1].toUpperCase() === "D" ? -1 : 1;
    text = text.slice(0, suffix.index);
  }
  const parsed = parseMoneyInput(text);
  if (!Number.isFinite(parsed)) return Number.NaN;
  return roundMoney(sign === -1 ? -Math.abs(parsed) : parsed);
}

/** FNV-1a 32 bits em hexadecimal (id estável de linha de CSV). */
function hash(text: string): string {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value.toString(16).padStart(8, "0");
}

/**
 * Id estável de um lançamento sem FITID: data + valor + descrição + ordem entre lançamentos iguais no arquivo
 * (dois PIX iguais no mesmo dia são dois lançamentos; o mesmo arquivo de novo gera os mesmos ids).
 */
export function lineFitid(prefix: string, postedAt: string, amount: number, description: string, occurrence: number): string {
  return `${prefix}-${postedAt.replace(/-/g, "")}-${toCents(amount)}-${hash(normalizeHeader(description))}-${occurrence}`;
}

/** Contador de ocorrências por (data, valor, descrição), para lineFitid. */
export function occurrenceCounter(): (postedAt: string, amount: number, description: string) => number {
  const seen = new Map<string, number>();
  return (postedAt, amount, description) => {
    const key = `${postedAt}|${toCents(amount)}|${normalizeHeader(description)}`;
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    return occurrence;
  };
}

/**
 * Lançamentos de um extrato em CSV. Acha o cabeçalho (coluna de data + valor, ou crédito/débito) mesmo depois de
 * linhas de preâmbulo, pula linhas de saldo e gera um fitid estável por linha: data + valor + descrição + ordem entre
 * linhas iguais, para reimportar o mesmo arquivo sem duplicar.
 */
export function parseStatementCsv(text: string): BankTx[] {
  const clean = text.replace(/^﻿/, "");
  if (!clean.trim()) throw new Error("O arquivo está vazio.");
  const lines = clean.split(/\r?\n/);

  let headerIndex = -1;
  let delimiter: string = ";";
  let columns: CsvColumns | null = null;
  for (let index = 0; index < Math.min(lines.length, 40) && !columns; index++) {
    for (const candidate of DELIMITERS) {
      if (!lines[index].includes(candidate)) continue;
      const found = detectColumns(splitLine(lines[index], candidate));
      if (found) {
        headerIndex = index;
        delimiter = candidate;
        columns = found;
        break;
      }
    }
  }
  if (!columns) throw new Error("Não encontrei as colunas de data e valor no CSV (ex.: Data;Histórico;Valor).");

  const rows = Papa.parse<string[]>(lines.slice(headerIndex + 1).join("\n"), { delimiter, skipEmptyLines: "greedy" }).data;
  const nextOccurrence = occurrenceCounter();
  const transactions: BankTx[] = [];
  for (const row of rows) {
    const cells = row.map((cell) => (cell ?? "").trim());
    const postedAt = csvDate(cells[columns.date]);
    if (!postedAt) continue;
    const description = (columns.description >= 0 ? cells[columns.description] : "") || "";
    if (normalizeHeader(description).replace(/\s/g, "").startsWith("saldo")) continue;

    let amount = columns.value >= 0 ? csvMoney(cells[columns.value]) : Number.NaN;
    if (!Number.isFinite(amount)) {
      const credit = columns.credit >= 0 ? csvMoney(cells[columns.credit]) : Number.NaN;
      const debit = columns.debit >= 0 ? csvMoney(cells[columns.debit]) : Number.NaN;
      if (!Number.isFinite(credit) && !Number.isFinite(debit)) continue;
      amount = roundMoney((Number.isFinite(credit) ? Math.abs(credit) : 0) - (Number.isFinite(debit) ? Math.abs(debit) : 0));
    }
    if (!amount) continue;

    const balance = columns.balance >= 0 ? csvMoney(cells[columns.balance]) : Number.NaN;
    transactions.push({
      fitid: lineFitid("CSV", postedAt, amount, description, nextOccurrence(postedAt, amount, description)),
      postedAt,
      amount,
      description: description || "Lançamento",
      memo: null,
      checkNumber: columns.document >= 0 ? cells[columns.document] || null : null,
      type: null,
      balanceAfter: Number.isFinite(balance) ? balance : null,
    });
  }
  return transactions;
}

export interface ParsedStatement {
  source: "ofx" | "csv";
  transactions: BankTx[];
  balance: number | null;
  balanceDate: string | null;
}

/** OFX ou CSV, pelo conteúdo. */
export function parseStatementFile(text: string): ParsedStatement {
  if (/<OFX>|OFXHEADER/i.test(text)) {
    const statement = parseOfxStatement(text);
    return { source: "ofx", transactions: statement.transactions, balance: statement.balance, balanceDate: statement.balanceDate };
  }
  return { source: "csv", transactions: parseStatementCsv(text), balance: null, balanceDate: null };
}
