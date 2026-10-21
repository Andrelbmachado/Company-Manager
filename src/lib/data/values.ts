// Parsing and normalisation of user-provided values (forms and imports).
// Accepts the formats people actually paste from spreadsheets in Brazil:
// "R$ 1.234,56", "1234.56", "31/12/2026", "2026-12-31", "Qualificação"...

import type { FieldDef } from "./entities";

export type CellValue = string | number | null;

export interface CoerceResult {
  value: CellValue;
  error?: string;
}

/** Lowercase, strip accents and punctuation: "E-mail " -> "e mail". */
export function normalizeKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, " ")
    .trim();
}

export function parseNumber(raw: string): number | null {
  let s = raw.replace(/[^\d,.\-]/g, "");
  if (!s || s === "-") return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    // Whichever separator comes last is the decimal one.
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    s = /^-?\d{1,3}(,\d{3})+$/.test(s) && s.split(",").length > 2 ? s.replace(/,/g, "") : s.replace(/,/g, ".");
  } else if (lastDot >= 0 && /^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    // "1.234" or "1.234.567" are thousands in pt-BR.
    s = s.replace(/\./g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Returns an ISO date (YYYY-MM-DD) or null. */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return isoDate(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) {
    const year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return isoDate(year, +m[2], +m[1]);
  }
  return null;
}

/** Returns "YYYY-MM-DD HH:MM:SS" (SQLite datetime format) or null. */
export function parseDateTime(raw: string): string | null {
  const date = parseDate(raw);
  if (!date) return null;
  const t = raw.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  const time = t ? `${t[1].padStart(2, "0")}:${t[2]}:${t[3] ?? "00"}` : "00:00:00";
  return `${date} ${time}`;
}

function isoDate(y: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Convert a raw string into the stored representation of a field.
 * Ref fields are returned untouched (resolved later against existing rows).
 */
export function coerceField(field: FieldDef, raw: string | number | null | undefined): CoerceResult {
  const s = raw === null || raw === undefined ? "" : String(raw).trim();

  if (s === "") {
    if (field.required) return { value: null, error: `${field.label} é obrigatório` };
    return { value: field.defaultValue ?? null };
  }

  switch (field.type) {
    case "number":
    case "currency":
    case "integer": {
      const n = typeof raw === "number" ? raw : parseNumber(s);
      if (n === null) return { value: null, error: `${field.label}: número inválido "${s}"` };
      return { value: field.type === "integer" ? Math.round(n) : n };
    }
    case "date": {
      const d = parseDate(s);
      return d ? { value: d } : { value: null, error: `${field.label}: data inválida "${s}"` };
    }
    case "datetime": {
      const d = parseDateTime(s);
      return d ? { value: d } : { value: null, error: `${field.label}: data inválida "${s}"` };
    }
    case "enum": {
      const target = normalizeKey(s);
      const match = field.options?.find(
        (o) => normalizeKey(o.value) === target || normalizeKey(o.label) === target
      );
      if (match) return { value: match.value };
      if (field.defaultValue !== undefined) return { value: field.defaultValue };
      return { value: null, error: `${field.label}: valor "${s}" não reconhecido` };
    }
    case "email":
      return { value: s.toLowerCase() };
    default:
      return { value: s };
  }
}
