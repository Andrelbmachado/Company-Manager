// CSV/JSON import and export for any entity in the registry.
// The planning functions are pure (no I/O) so they can be unit-tested and
// reused by the UI dialog and the automation API alike.

import { parseCsv, toCsv } from "@/lib/csv";
import { isTauri } from "@/lib/runtime";
import type { Session } from "@/types";
import {
  getEntity,
  optionLabel,
  writableFields,
  type EntityDef,
  type EntityKey,
  type FieldDef,
} from "./entities";
import { coerceField, normalizeKey } from "./values";
import { insertEntities, listEntity, listRefOptions, refLabel, type Row } from "./repository";

// ── Reading files ─────────────────────────────────────────────────

export interface Tabular {
  headers: string[];
  rows: string[][];
}

/** Parse CSV (any of , ; TAB) or a JSON array of objects. */
export function readTabular(text: string, fileName = ""): Tabular {
  const trimmed = text.trim();
  if (fileName.toLowerCase().endsWith(".json") || trimmed.startsWith("[")) {
    const data = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(data)) throw new Error("O JSON deve ser uma lista de objetos.");
    const headers = Array.from(
      new Set(data.flatMap((o) => (o && typeof o === "object" ? Object.keys(o) : [])))
    );
    return {
      headers,
      rows: data.map((o) =>
        headers.map((h) => {
          const v = (o as Record<string, unknown>)[h];
          if (v === null || v === undefined) return "";
          // JSON numbers use "." as decimal; write them with "," so parseNumber
          // never reads 1.234 as one thousand two hundred thirty-four.
          if (typeof v === "number") return String(v).replace(".", ",");
          return typeof v === "object" ? JSON.stringify(v) : String(v);
        })
      ),
    };
  }
  const { headers, rows } = parseCsv(text);
  return { headers, rows };
}

// ── Column mapping ────────────────────────────────────────────────

/** Field key for each source header (index-aligned), or null to ignore. */
export type ColumnMapping = (string | null)[];

function fieldNames(f: FieldDef): string[] {
  return [f.key, f.label, ...(f.aliases ?? [])].map(normalizeKey);
}

export function autoMapHeaders(def: EntityDef, headers: string[]): ColumnMapping {
  const fields = writableFields(def);
  const used = new Set<string>();
  const mapping: ColumnMapping = headers.map(() => null);

  // Pass 1: exact name/alias match. Pass 2: header contains a name as whole
  // words; the longest match wins ("Nome da empresa" -> Empresa, not Nome).
  const passes: ((h: string, names: string[]) => number)[] = [
    (h, names) => (names.includes(h) ? h.length : 0),
    (h, names) =>
      Math.max(0, ...names.filter((n) => n.length > 2 && ` ${h} `.includes(` ${n} `)).map((n) => n.length)),
  ];
  for (const score of passes) {
    headers.forEach((header, i) => {
      if (mapping[i]) return;
      const h = normalizeKey(header);
      let best: { key: string; score: number } | null = null;
      for (const f of fields) {
        if (used.has(f.key)) continue;
        const s = score(h, fieldNames(f));
        if (s > 0 && (!best || s > best.score)) best = { key: f.key, score: s };
      }
      if (best) {
        mapping[i] = best.key;
        used.add(best.key);
      }
    });
  }
  return mapping;
}

// ── Planning ──────────────────────────────────────────────────────

export interface ImportContext {
  /** Rows of every referenced entity, keyed by entity. */
  refRows: Partial<Record<EntityKey, Row[]>>;
  /** Rows that already exist, for duplicate detection. */
  existing: Row[];
}

export interface PlannedRow {
  /** 1-based line in the source file, header included (first data row = 2). */
  line: number;
  values: Row;
  errors: string[];
  warnings: string[];
  duplicate: boolean;
}

export interface ImportPlan {
  rows: PlannedRow[];
  toInsert: Row[];
  errorCount: number;
  duplicateCount: number;
}

function resolveRef(field: FieldDef, raw: string, ctx: ImportContext): string | null {
  const target = normalizeKey(raw);
  const rows = ctx.refRows[field.ref!.entity] ?? [];
  for (const col of field.ref!.matchBy) {
    const hit = rows.find((r) => r[col] !== null && r[col] !== undefined && normalizeKey(String(r[col])) === target);
    if (hit) return String(hit.id);
  }
  return null;
}

function dedupeKey(row: Row, field: string): string | null {
  const v = row[field];
  if (v === null || v === undefined || v === "") return null;
  const s = String(v);
  return `${field}:${field === "phone" || field === "document" ? s.replace(/\D/g, "") : normalizeKey(s)}`;
}

export function planImport(
  def: EntityDef,
  data: Tabular,
  mapping: ColumnMapping,
  ctx: ImportContext,
  options: { skipDuplicates?: boolean } = {}
): ImportPlan {
  const skipDuplicates = options.skipDuplicates ?? true;
  const fields = writableFields(def);
  const seen = new Set<string>();
  for (const r of ctx.existing) {
    for (const f of def.dedupeBy ?? []) {
      const k = dedupeKey(r, f);
      if (k) seen.add(k);
    }
  }

  const planned: PlannedRow[] = data.rows.map((cells, idx) => {
    const raw: Record<string, string> = {};
    mapping.forEach((fieldKey, col) => {
      if (fieldKey && cells[col] !== undefined && cells[col] !== "" && raw[fieldKey] === undefined) {
        raw[fieldKey] = cells[col];
      }
    });

    const values: Row = {};
    const errors: string[] = [];
    const warnings: string[] = [];
    for (const f of fields) {
      const input = raw[f.key];
      if (f.type === "ref") {
        if (!input) {
          if (f.required) errors.push(`${f.label} é obrigatório`);
          continue;
        }
        const id = resolveRef(f, input, ctx);
        if (id) values[f.key] = id;
        else if (f.required) errors.push(`${f.label} "${input}" não encontrado`);
        else warnings.push(`${f.label} "${input}" não encontrado; ficará em branco`);
        continue;
      }
      const res = coerceField(f, input);
      if (res.error) errors.push(res.error);
      else if (res.value !== null) values[f.key] = res.value;
    }

    let duplicate = false;
    const keys = (def.dedupeBy ?? []).map((f) => dedupeKey(values, f)).filter(Boolean) as string[];
    if (keys.some((k) => seen.has(k))) duplicate = true;
    if (!errors.length) keys.forEach((k) => seen.add(k));

    return { line: idx + 2, values, errors, warnings, duplicate };
  });

  const toInsert = planned
    .filter((p) => !p.errors.length && !(skipDuplicates && p.duplicate))
    .map((p) => p.values);

  return {
    rows: planned,
    toInsert,
    errorCount: planned.filter((p) => p.errors.length).length,
    duplicateCount: planned.filter((p) => p.duplicate).length,
  };
}

export async function loadImportContext(def: EntityDef, companyId: string): Promise<ImportContext> {
  const refEntities = Array.from(
    new Set(def.fields.filter((f) => f.type === "ref" && f.ref).map((f) => f.ref!.entity))
  );
  const refRows: ImportContext["refRows"] = {};
  await Promise.all(
    refEntities.map(async (k) => {
      refRows[k] = await listRefOptions(k, companyId);
    })
  );
  const existing = def.dedupeBy?.length ? await listEntity(def.key, companyId) : [];
  return { refRows, existing };
}

export interface ImportReport {
  entity: EntityKey;
  total: number;
  inserted: number;
  skippedDuplicates: number;
  errors: { line: number; errors: string[] }[];
}

/** One-shot import with automatic column mapping (used by the automation API). */
export async function importText(
  key: EntityKey,
  session: Session,
  text: string,
  options: { fileName?: string; skipDuplicates?: boolean; mapping?: Record<string, string> } = {}
): Promise<ImportReport> {
  const def = getEntity(key);
  if (def.importable === false) throw new Error(`${def.labelPlural} não aceitam importação.`);
  const data = readTabular(text, options.fileName);
  const mapping = autoMapHeaders(def, data.headers);
  if (options.mapping) {
    data.headers.forEach((h, i) => {
      if (h in options.mapping!) mapping[i] = options.mapping![h] || null;
    });
  }
  const ctx = await loadImportContext(def, session.company.id);
  const plan = planImport(def, data, mapping, ctx, options);
  await insertEntities(key, session, plan.toInsert);
  return {
    entity: key,
    total: plan.rows.length,
    inserted: plan.toInsert.length,
    skippedDuplicates: (options.skipDuplicates ?? true) ? plan.rows.filter((r) => r.duplicate && !r.errors.length).length : 0,
    errors: plan.rows.filter((r) => r.errors.length).map((r) => ({ line: r.line, errors: r.errors })),
  };
}

// ── Export ────────────────────────────────────────────────────────

export type ExportFormat = "csv" | "json";

function exportCell(f: FieldDef, row: Row): string | number {
  const v = row[f.key];
  if (f.type === "ref") return refLabel(row, f.key);
  if (v === null || v === undefined) return "";
  if (f.type === "enum") return optionLabel(f, v);
  if ((f.type === "currency" || f.type === "number") && typeof v === "number") {
    // Decimal comma: matches the ";" delimiter used by Excel pt-BR.
    return String(v).replace(".", ",");
  }
  return typeof v === "number" ? v : String(v);
}

export function exportRows(def: EntityDef, rows: Row[], format: ExportFormat): string {
  if (format === "json") {
    const out = rows.map((r) => {
      const o: Row = { id: r.id };
      for (const f of def.fields) {
        o[f.key] = r[f.key] ?? null;
        if (f.type === "ref") o[f.key + "_name"] = refLabel(r, f.key) || null;
      }
      return o;
    });
    return JSON.stringify(out, null, 2);
  }
  return toCsv(
    ["ID", ...def.fields.map((f) => f.label)],
    rows.map((r) => [r.id, ...def.fields.map((f) => exportCell(f, r))])
  );
}

/** Empty CSV with the expected headers plus one example row. */
export function templateCsv(def: EntityDef): string {
  const fields = writableFields(def);
  const example = fields.map((f) => {
    if (f.placeholder && f.type !== "ref") return f.placeholder;
    if (f.type === "enum") return f.options?.find((o) => o.value === f.defaultValue)?.label ?? f.options?.[0]?.label ?? "";
    if (f.type === "date") return "31/12/2026";
    if (f.type === "datetime") return "31/12/2026 14:00";
    if (f.type === "currency" || f.type === "number") return "1234,56";
    if (f.type === "integer") return String(f.defaultValue ?? 0);
    return "";
  });
  return toCsv(fields.map((f) => f.label + (f.required ? " *" : "")), [example]);
}

export function exportFileName(def: EntityDef, format: ExportFormat | "template"): string {
  const date = new Date().toISOString().slice(0, 10);
  const slug = normalizeKey(def.labelPlural).replace(/ /g, "-");
  return format === "template" ? `modelo-${slug}.csv` : `${slug}-${date}.${format}`;
}

/** Save text to disk: native dialog on desktop, download in the browser. */
export async function saveTextFile(fileName: string, content: string): Promise<boolean> {
  const ext = fileName.split(".").pop() ?? "txt";
  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    const path = await save({ defaultPath: fileName, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (!path) return false;
    await writeTextFile(path, content);
    return true;
  }
  const mime = ext === "json" ? "application/json" : "text/csv";
  const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

// ── Full backup ───────────────────────────────────────────────────

/** Insertion order: referenced entities first. */
const BACKUP_ORDER: EntityKey[] = [
  "customers",
  "inventory_items",
  "leads",
  "opportunities",
  "tickets",
  "work_orders",
  "projects",
  "custodies",
  "payables",
  "receivables",
  "documents",
];

export interface Backup {
  app: "company-manager";
  version: 1;
  exported_at: string;
  company: string;
  data: Partial<Record<EntityKey, Row[]>>;
}

export async function exportBackup(session: Session, keys: EntityKey[]): Promise<string> {
  const data: Backup["data"] = {};
  for (const key of keys) {
    data[key] = JSON.parse(exportRows(getEntity(key), await listEntity(key, session.company.id), "json"));
  }
  const backup: Backup = {
    app: "company-manager",
    version: 1,
    exported_at: new Date().toISOString(),
    company: session.company.name,
    data,
  };
  return JSON.stringify(backup, null, 2);
}

/**
 * Restore a backup produced by exportBackup. Rows get new ids; references are
 * re-resolved by name (the `<field>_name` columns), duplicates are skipped.
 */
export async function importBackup(session: Session, text: string, keys: EntityKey[]): Promise<ImportReport[]> {
  const backup = JSON.parse(text) as Backup;
  if (backup?.app !== "company-manager" || !backup.data) throw new Error("Arquivo não é um backup do Company Manager.");
  const reports: ImportReport[] = [];
  for (const key of BACKUP_ORDER) {
    const rows = backup.data[key];
    if (!rows?.length || !keys.includes(key)) continue;
    const def = getEntity(key);
    const prepared = rows.map((r) => {
      const out: Row = { ...r };
      for (const f of def.fields) {
        if (f.type === "ref" && r[f.key + "_name"]) out[f.key] = r[f.key + "_name"];
        delete out[f.key + "_name"];
      }
      delete out.id;
      return out;
    });
    reports.push(await importText(key, session, JSON.stringify(prepared), { fileName: "backup.json" }));
  }
  return reports;
}
