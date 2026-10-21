// Minimal RFC 4180 CSV parser/serializer with delimiter auto-detection.
// Handles UTF-8 BOM, quoted fields, escaped quotes ("") and CRLF line endings.

export type CsvDelimiter = "," | ";" | "\t";

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
  delimiter: CsvDelimiter;
}

export function detectDelimiter(text: string): CsvDelimiter {
  const firstLine = stripBom(text).split(/\r?\n/, 1)[0] ?? "";
  const counts: Record<CsvDelimiter, number> = { ",": 0, ";": 0, "\t": 0 };
  let inQuotes = false;
  for (const ch of firstLine) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch in counts) counts[ch as CsvDelimiter]++;
  }
  // Prefer ";" on ties: it is the default for Excel in pt-BR.
  if (counts[";"] >= counts[","] && counts[";"] >= counts["\t"] && counts[";"] > 0) return ";";
  if (counts["\t"] > counts[","]) return "\t";
  return ",";
}

export function parseCsv(input: string, delimiter?: CsvDelimiter): ParsedCsv {
  const text = stripBom(input);
  const delim = delimiter ?? detectDelimiter(text);
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === "") {
      inQuotes = true;
    } else if (ch === delim) {
      record.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  const nonEmpty = records.filter((r) => r.some((c) => c.trim() !== ""));
  const [headerRow = [], ...rows] = nonEmpty;
  const headers = headerRow.map((h) => h.trim());
  return {
    headers,
    rows: rows.map((r) => headers.map((_, idx) => (r[idx] ?? "").trim())),
    delimiter: delim,
  };
}

export function toCsv(
  headers: string[],
  rows: unknown[][],
  delimiter: CsvDelimiter = ";"
): string {
  const escape = (value: unknown): string => {
    if (value === null || value === undefined) return "";
    const s = String(value);
    return /["\r\n]/.test(s) || s.includes(delimiter) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers, ...rows].map((r) => r.map(escape).join(delimiter));
  // BOM so Excel opens accented characters correctly.
  return "﻿" + lines.join("\r\n") + "\r\n";
}

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}
