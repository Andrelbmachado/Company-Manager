// Converte o texto de uma célula no valor gravado, entendendo formatos brasileiros: "1.234,56", "R$ 10,00",
// "31/12/2025" (nunca mês/dia), CPF/CNPJ com ou sem máscara (inclusive CNPJ alfanumérico), telefone com DDD.
// Célula vazia é sempre { ok: true, value: null }: obrigatoriedade é conferida por quem chama (runImport).
import { roundMoney } from "@/lib/money";
import type { FieldDef, NormalizeKind } from "./registry";

export type NormalizeResult = { ok: true; value: unknown } | { ok: false; reason: string };

const okValue = (value: unknown): NormalizeResult => ({ ok: true, value });
const failure = (reason: string): NormalizeResult => ({ ok: false, reason });

/** Minúsculas, sem acento, pontuação vira espaço, espaços únicos ("Razão  Social*" → "razao social"). */
export function normalizeKey(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function onlyDigits(text: string): string {
  return text.replace(/\D+/g, "");
}

/** Mostra o valor recebido na mensagem, cortado (planilhas podem ter células enormes). */
function quote(raw: string): string {
  const text = raw.trim();
  return `"${text.length > 40 ? `${text.slice(0, 40)}…` : text}"`;
}

// ── números ───────────────────────────────────────────────────────

const GROUPED = (separator: string) => new RegExp(`^\\d{1,3}(\\${separator}\\d{3})+$`);

/**
 * Decimal no formato brasileiro ou internacional, sem arredondar. Regras: com "." e "," o último é o decimal;
 * só "," é decimal (mais de uma = milhar); só "." com exatamente 3 dígitos depois (e parte inteira ≠ 0) é milhar
 * ("1.234" = 1234), com 1–2 ou 4+ dígitos é decimal ("10.5", "1234.56"); vários "." = milhar.
 */
export function parseDecimal(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  let text = raw.replace(/[\s  ]+/g, "").replace(/^(R\$|BRL)/i, "").replace(/(R\$|BRL)$/i, "");
  if (!text) return null;
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  text = text.replace(/^(R\$|BRL)/i, "");
  if (text.startsWith("-")) {
    negative = !negative;
    text = text.slice(1);
  } else if (text.startsWith("+")) {
    text = text.slice(1);
  } else if (text.endsWith("-")) {
    negative = !negative;
    text = text.slice(0, -1);
  }
  text = text.replace(/^(R\$|BRL)/i, "");
  if (!/^[\d.,]+$/.test(text) || !/\d/.test(text)) return null;

  const lastDot = text.lastIndexOf(".");
  const lastComma = text.lastIndexOf(",");
  let integerPart: string;
  let fraction = "";
  if (lastDot >= 0 && lastComma >= 0) {
    const decimal = lastDot > lastComma ? "." : ",";
    const thousands = decimal === "." ? "," : ".";
    const position = text.lastIndexOf(decimal);
    integerPart = text.slice(0, position);
    fraction = text.slice(position + 1);
    if (fraction.includes(thousands) || fraction.includes(decimal) || !/^\d*$/.test(fraction)) return null;
    if (integerPart.includes(thousands) ? !GROUPED(thousands).test(integerPart) : !/^\d+$/.test(integerPart)) return null;
    integerPart = integerPart.split(thousands).join("");
  } else if (lastComma >= 0 || lastDot >= 0) {
    const separator = lastComma >= 0 ? "," : ".";
    const count = text.split(separator).length - 1;
    if (count > 1) {
      if (!GROUPED(separator).test(text)) return null;
      integerPart = text.split(separator).join("");
    } else {
      const [before, after] = text.split(separator);
      const thousandsDot = separator === "." && after.length === 3 && before.length > 0 && before.length <= 3 && Number(before) !== 0;
      if (thousandsDot) {
        integerPart = before + after;
      } else {
        integerPart = before || "0";
        fraction = after;
      }
    }
  } else {
    integerPart = text;
  }
  if (!/^\d+$/.test(integerPart) || !/^\d*$/.test(fraction)) return null;
  const value = Number(fraction ? `${integerPart}.${fraction}` : integerPart);
  if (!Number.isFinite(value)) return null;
  return negative ? -value || 0 : value;
}

function parseMoney(raw: string): NormalizeResult {
  const value = parseDecimal(raw);
  return value === null ? failure(`Valor inválido: ${quote(raw)} (use 1.234,56)`) : okValue(roundMoney(value));
}

function parseNumber(raw: string): NormalizeResult {
  const value = parseDecimal(raw);
  // toPrecision tira ruído binário de valores vindos do Excel (0,1 + 0,2).
  return value === null ? failure(`Número inválido: ${quote(raw)}`) : okValue(Number(value.toPrecision(15)));
}

function parseInt(raw: string): NormalizeResult {
  const value = parseDecimal(raw);
  if (value === null || !Number.isInteger(value)) return failure(`Número inteiro inválido: ${quote(raw)}`);
  if (!Number.isSafeInteger(value)) return failure(`Número grande demais: ${quote(raw)}`);
  return okValue(value);
}

// ── datas ─────────────────────────────────────────────────────────

const pad = (value: number) => String(value).padStart(2, "0");

function isoDate(year: number, month: number, day: number): string | null {
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Série do Excel (dias desde 30/12/1899) → 'YYYY-MM-DD'. */
function fromExcelSerial(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return null;
  const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000);
  return isoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/** Ano de 2 dígitos: 00–69 = 2000–2069, 70–99 = 1970–1999. */
const fullYear = (text: string) => (text.length === 2 ? (Number(text) < 70 ? 2000 : 1900) + Number(text) : Number(text));

function toIsoDate(raw: string): string | null {
  const text = raw.trim();
  let match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s].*)?$/.exec(text);
  if (match) return isoDate(Number(match[1]), Number(match[2]), Number(match[3]));
  match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?:,?\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*h)?)?$/i.exec(text);
  if (match) return isoDate(fullYear(match[3]), Number(match[2]), Number(match[1]));
  match = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  if (match && /^(19|20)/.test(text)) return isoDate(Number(match[1]), Number(match[2]), Number(match[3]));
  if (/^\d{5}(?:[.,]\d+)?$/.test(text)) return fromExcelSerial(Number(text.replace(",", ".")));
  return null;
}

function parseDate(raw: string): NormalizeResult {
  const value = toIsoDate(raw);
  return value ? okValue(value) : failure(`Data inválida: ${quote(raw)} (use dd/mm/aaaa)`);
}

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** Competência 'YYYY-MM': "10/2026", "2026-10", "out/2026", "outubro de 2026" ou uma data completa. */
function parseMonth(raw: string): NormalizeResult {
  const text = normalizeKey(raw);
  let match = /^(\d{4}) (\d{1,2})$/.exec(text);
  let year: number | null = null;
  let month: number | null = null;
  if (match) {
    year = Number(match[1]);
    month = Number(match[2]);
  } else if ((match = /^(\d{1,2}) (\d{4}|\d{2})$/.exec(text))) {
    year = fullYear(match[2]);
    month = Number(match[1]);
  } else if ((match = /^([a-z]{3})[a-z]* (?:de )?(\d{4}|\d{2})$/.exec(text))) {
    const index = MONTHS.indexOf(match[1]);
    if (index >= 0) {
      year = fullYear(match[2]);
      month = index + 1;
    }
  } else {
    const date = toIsoDate(raw);
    if (date) return okValue(date.slice(0, 7));
  }
  if (year === null || month === null || month < 1 || month > 12 || year < 1000) return failure(`Competência inválida: ${quote(raw)} (use mm/aaaa)`);
  return okValue(`${year}-${pad(month)}`);
}

// ── sim/não ───────────────────────────────────────────────────────

const TRUE_WORDS = new Set(["sim", "s", "yes", "y", "true", "verdadeiro", "v", "1", "x", "ativo", "ativa", "ok"]);
const FALSE_WORDS = new Set(["nao", "n", "no", "false", "falso", "f", "0", "inativo", "inativa"]);

function parseBool(raw: string): NormalizeResult {
  const key = normalizeKey(raw);
  if (TRUE_WORDS.has(key)) return okValue(true);
  if (FALSE_WORDS.has(key)) return okValue(false);
  return failure(`Use Sim ou Não: ${quote(raw)}`);
}

// ── telefone ──────────────────────────────────────────────────────

function parsePhone(raw: string): NormalizeResult {
  const trimmed = raw.trim();
  let digits = onlyDigits(trimmed);
  if (trimmed.startsWith("+") && !digits.startsWith("55")) {
    return digits.length >= 8 && digits.length <= 15 ? okValue(`+${digits}`) : failure(`Telefone inválido: ${quote(raw)}`);
  }
  if (/^0[3589]00\d{6,7}$/.test(digits)) return okValue(`${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`);
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) digits = digits.slice(2);
  if (digits.startsWith("0") && (digits.length === 11 || digits.length === 12)) digits = digits.slice(1);
  switch (digits.length) {
    case 10:
      return okValue(`(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`);
    case 11:
      return okValue(`(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`);
    case 8:
      return okValue(`${digits.slice(0, 4)}-${digits.slice(4)}`);
    case 9:
      return okValue(`${digits.slice(0, 5)}-${digits.slice(5)}`);
    default:
      return failure(`Telefone inválido: ${quote(raw)} (use DDD + número)`);
  }
}

// ── CPF / CNPJ ────────────────────────────────────────────────────

function cleanDocument(raw: string): string {
  return raw.toUpperCase().replace(/[^0-9A-Z]/g, "");
}

/** Dígitos verificadores do CNPJ (numérico ou alfanumérico: cada caractere vale código ASCII − 48). */
function cnpjCheckDigits(base: string): string {
  const calc = (text: string, weights: number[]) => {
    const total = [...text].reduce((sum, char, index) => sum + (char.charCodeAt(0) - 48) * weights[index], 0);
    const rest = total % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const first = calc(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = calc(`${base}${first}`, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${first}${second}`;
}

export function isValidCnpj(value: string): boolean {
  const cnpj = cleanDocument(value);
  if (!/^[0-9A-Z]{12}\d{2}$/.test(cnpj) || /^(.)\1+$/.test(cnpj)) return false;
  return cnpjCheckDigits(cnpj.slice(0, 12)) === cnpj.slice(12);
}

export function isValidCpf(value: string): boolean {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;
  const calc = (text: string) => {
    const total = [...text].reduce((sum, char, index) => sum + Number(char) * (text.length + 1 - index), 0);
    const rest = (total * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  const first = calc(cpf.slice(0, 9));
  const second = calc(cpf.slice(0, 10));
  return `${first}${second}` === cpf.slice(9);
}

const formatCnpj = (cnpj: string) => `${cnpj.slice(0, 2)}.${cnpj.slice(2, 5)}.${cnpj.slice(5, 8)}/${cnpj.slice(8, 12)}-${cnpj.slice(12)}`;
const formatCpf = (cpf: string) => `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;

function parseCnpj(raw: string): NormalizeResult {
  let cnpj = cleanDocument(raw);
  // O Excel guarda CNPJ como número e perde o zero à esquerda: completa só se os dígitos verificadores baterem.
  if (/^\d{12,13}$/.test(cnpj)) cnpj = cnpj.padStart(14, "0");
  return isValidCnpj(cnpj) ? okValue(formatCnpj(cnpj)) : failure(`CNPJ inválido: ${quote(raw)}`);
}

function parseCpf(raw: string): NormalizeResult {
  let cpf = cleanDocument(raw);
  if (/^\d{9,10}$/.test(cpf)) cpf = cpf.padStart(11, "0");
  return isValidCpf(cpf) ? okValue(formatCpf(cpf)) : failure(`CPF inválido: ${quote(raw)}`);
}

function parseDocument(raw: string): NormalizeResult {
  const clean = cleanDocument(raw);
  if (/^\d{9,11}$/.test(clean)) {
    const cpf = parseCpf(raw);
    if (cpf.ok || clean.length === 11) return cpf.ok ? cpf : failure(`CPF/CNPJ inválido: ${quote(raw)}`);
  }
  const cnpj = parseCnpj(raw);
  return cnpj.ok ? cnpj : failure(`CPF/CNPJ inválido: ${quote(raw)}`);
}

/** Só os caracteres que identificam o documento ("11.222.333/0001-81" → "11222333000181"), para comparar. */
export function documentKey(value: string | null | undefined): string {
  return value ? cleanDocument(value) : "";
}

// ── e-mail ────────────────────────────────────────────────────────

const EMAIL = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[^\s@<>()[\],;:".]{2,}$/;

function parseEmail(raw: string): NormalizeResult {
  const email = raw.trim().replace(/^mailto:/i, "").toLowerCase();
  return EMAIL.test(email) ? okValue(email) : failure(`E-mail inválido: ${quote(raw)}`);
}

// ── entrada ───────────────────────────────────────────────────────

const PARSERS: Record<NormalizeKind, (raw: string) => NormalizeResult> = {
  money: parseMoney,
  date: parseDate,
  int: parseInt,
  bool: parseBool,
  phone: parsePhone,
  cnpj: parseCnpj,
  cpf: parseCpf,
  email: parseEmail,
};

export function normalizeValue(kind: NormalizeKind, raw: string): NormalizeResult {
  if (raw == null || !String(raw).trim()) return okValue(null);
  return PARSERS[kind](String(raw));
}

/** Texto: apara e desfaz o apóstrofo que a exportação põe antes de =, +, - e @ (proteção contra fórmula). */
export function cleanText(raw: string): string {
  const text = raw.trim();
  return /^'[=+\-@]/.test(text) ? text.slice(1) : text;
}

/** Normaliza a célula conforme o campo (inclui texto, número, enum, documento e competência). */
export function normalizeField(field: FieldDef, raw: string | null | undefined): NormalizeResult {
  if (raw == null || !String(raw).trim()) return okValue(null);
  const text = String(raw);
  switch (field.kind) {
    case "text":
      return okValue(cleanText(text));
    case "number":
      return parseNumber(text);
    case "document":
      return parseDocument(text);
    case "month":
      return parseMonth(text);
    case "enum": {
      const key = normalizeKey(text);
      const option = field.options?.find((candidate) => normalizeKey(candidate.value) === key || normalizeKey(candidate.label) === key);
      if (option) return okValue(option.value);
      const accepted = (field.options ?? []).map((candidate) => candidate.label).join(", ");
      return failure(`Valor não aceito: ${quote(text)}. Use: ${accepted}`);
    }
    default:
      return normalizeValue(field.kind, text);
  }
}
