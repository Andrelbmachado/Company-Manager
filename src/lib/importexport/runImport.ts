// Executa uma importação: mapeia colunas → normaliza → valida (zod) → aponta linhas repetidas → confere com o banco →
// grava (ou só simula) → registra o lote em import_batches.
// Modos: "skip-errors" grava as linhas boas e devolve o relatório das ruins; "all-or-nothing" não grava nada se
// houver qualquer erro. Se o banco falhar no meio da gravação, o diário (write.ts) desfaz o que já foi gravado.
import { v4 as uuidv4 } from "uuid";
import type { DatabaseLike } from "@/lib/db/demo";
import type { ImportBatchStatus, ImportMode } from "@/types";
import { errorMessage, type ImportRowError } from "./errors";
import { normalizeField, normalizeKey } from "./normalize";
import { getEntity, type FieldDef, type ImportEntity } from "./registry";
import { ptBrErrorMap } from "./schema";
import { sqliteNow, undoJournal, WriteJournal, yieldToUi } from "./write";

/** Campo → cabeçalho da planilha (campo sem coluna fica de fora). */
export type ColumnMapping = Record<string, string | null | undefined>;

export interface ImportOptions {
  db: DatabaseLike;
  companyId: string;
  userId?: string | null;
  mode: ImportMode;
  dryRun: boolean;
  filename?: string | null;
  sheetName?: string | null;
  format?: "csv" | "xlsx" | null;
  /** Número de cada linha na planilha (padrão: posição + 2, com o cabeçalho na linha 1). */
  rowNumbers?: number[];
  onProgress?: (progress: ImportProgress) => void;
}

export interface ImportProgress {
  phase: "validando" | "conferindo" | "gravando";
  done: number;
  total: number;
}

export interface ImportResult {
  /** Linhas gravadas (ou que seriam gravadas, na simulação). */
  ok: number;
  inserted: number;
  updated: number;
  /** Erros por linha, em ordem de linha (row 0 = o lote todo). */
  errors: ImportRowError[];
  /** Linhas com pelo menos um erro. */
  rowsWithErrors: number;
  total: number;
  status: ImportBatchStatus;
  dryRun: boolean;
  mode: ImportMode;
  batchId: string;
}

export interface ValidatedRow<T = Record<string, unknown>> {
  /** Posição em `rows`. */
  index: number;
  row: number;
  value: T;
}

/** Quantos erros vão para o histórico (o relatório baixado na hora tem todos). */
export const MAX_STORED_ERRORS = 1000;

const rowNumberOf = (rowNumbers: number[] | undefined, index: number) => rowNumbers?.[index] ?? index + 2;

/** Campos obrigatórios sem coluna escolhida. */
export function missingRequired(entity: ImportEntity<unknown>, mapping: ColumnMapping): FieldDef[] {
  return entity.fields.filter((field) => field.required && !mapping[field.key]);
}

/**
 * Normaliza e valida as linhas (sem banco): valores convertidos, obrigatórios, regras do zod e chave natural repetida.
 * Serve para a prévia da tela e é o 1º passo de runImport.
 */
export async function validateRows<T>(
  entity: ImportEntity<T>,
  mapping: ColumnMapping,
  rows: Record<string, string>[],
  rowNumbers?: number[],
  onProgress?: (done: number) => void,
): Promise<{ valid: ValidatedRow<T>[]; errors: ImportRowError[] }> {
  const valid: ValidatedRow<T>[] = [];
  const errors: ImportRowError[] = [];
  const mapped = entity.fields.filter((field) => mapping[field.key]);
  const firstByKey = new Map<string, number>();

  for (let index = 0; index < rows.length; index++) {
    if (index % 500 === 0) {
      onProgress?.(index);
      await yieldToUi();
    }
    const source = rows[index];
    const row = rowNumberOf(rowNumbers, index);
    const value: Record<string, unknown> = {};
    const rowErrors: ImportRowError[] = [];
    for (const field of mapped) {
      const raw = source[mapping[field.key]!] ?? "";
      const result = normalizeField(field, raw);
      if (!result.ok) rowErrors.push({ row, field: field.key, message: result.reason, value: raw });
      else if (result.value !== null) value[field.key] = result.value;
      else if (field.required) rowErrors.push({ row, field: field.key, message: `${field.label}: campo obrigatório vazio`, value: raw });
    }
    if (rowErrors.length === 0) {
      const parsed = entity.schema.safeParse(value, { errorMap: ptBrErrorMap });
      if (parsed.success) {
        const key = entity.naturalKey(parsed.data);
        const first = key ? firstByKey.get(key) : undefined;
        if (first !== undefined) {
          rowErrors.push({ row, field: "", message: `Repetido na planilha: mesmo cadastro da linha ${first}` });
        } else {
          if (key) firstByKey.set(key, row);
          valid.push({ index, row, value: parsed.data });
        }
      } else {
        for (const issue of parsed.error.issues) {
          const fieldKey = String(issue.path[0] ?? "");
          const field = entity.fields.find((candidate) => candidate.key === fieldKey);
          rowErrors.push({
            row,
            field: fieldKey,
            message: field ? `${field.label}: ${issue.message}` : issue.message,
            value: field && mapping[field.key] ? source[mapping[field.key]!] : undefined,
          });
        }
      }
    }
    errors.push(...rowErrors);
  }
  onProgress?.(rows.length);
  return { valid, errors };
}

/** Sugere a coluna de cada campo comparando cabeçalho com chave, rótulo e apelidos (sem acento, caixa ou pontuação). */
export function suggestMapping(entity: ImportEntity<unknown>, headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<string>();
  const names = (field: FieldDef) => [field.label, field.key, ...(field.aliases ?? [])].map(normalizeKey).filter(Boolean);
  const normalized = headers.map((header) => ({ header, key: normalizeKey(header) }));
  // 1º o rótulo e a chave exatos (o modelo baixado casa 100%), depois os apelidos.
  const passes: ((field: FieldDef) => string[])[] = [(field) => [normalizeKey(field.label), normalizeKey(field.key)], names];
  for (const pass of passes) {
    for (const field of entity.fields) {
      if (mapping[field.key]) continue;
      const wanted = pass(field);
      const match = normalized.find((candidate) => !used.has(candidate.header) && wanted.includes(candidate.key));
      if (match) {
        mapping[field.key] = match.header;
        used.add(match.header);
      }
    }
  }
  return mapping;
}

/** { cabeçalho: campo } do histórico (formato de import_batches.mapping_json). */
function mappingJson(mapping: ColumnMapping): string {
  return JSON.stringify(Object.fromEntries(Object.entries(mapping).filter(([, header]) => header).map(([field, header]) => [header, field])));
}

/** Importa as linhas na entidade (chave do registro ou a própria entidade). */
export async function runImport<T>(
  entityOrKey: ImportEntity<T> | string,
  mapping: ColumnMapping,
  rows: Record<string, string>[],
  options: ImportOptions,
): Promise<ImportResult> {
  const entity = (typeof entityOrKey === "string" ? getEntity(entityOrKey) : entityOrKey) as ImportEntity<T> | undefined;
  if (!entity) throw new Error(`Entidade de importação desconhecida: ${String(entityOrKey)}`);
  const { db, companyId, mode, dryRun } = options;
  const batchId = uuidv4();
  const total = rows.length;
  const errors: ImportRowError[] = [];
  let inserted = 0;
  let updated = 0;
  let ok = 0;

  const missing = missingRequired(entity as ImportEntity<unknown>, mapping);
  if (missing.length) {
    errors.push({ row: 0, field: "", message: `Escolha a coluna de: ${missing.map((field) => field.label).join(", ")}` });
  } else if (total === 0) {
    errors.push({ row: 0, field: "", message: "A planilha não tem linhas para importar." });
  } else {
    const validation = await validateRows(entity, mapping, rows, options.rowNumbers, (done) => options.onProgress?.({ phase: "validando", done, total }));
    errors.push(...validation.errors);
    let valid = validation.valid;

    if (entity.check && valid.length) {
      options.onProgress?.({ phase: "conferindo", done: 0, total: valid.length });
      const issues = await entity.check(db, companyId, valid.map((item) => item.value));
      const failed = new Set<number>();
      for (const issue of issues) {
        const item = valid[issue.index];
        if (!item) continue;
        failed.add(issue.index);
        const field = entity.fields.find((candidate) => candidate.key === issue.field);
        const related = issue.relatedIndex !== undefined ? valid[issue.relatedIndex]?.row : undefined;
        errors.push({
          row: item.row,
          field: issue.field,
          message: `${issue.message}${related !== undefined ? ` (linha ${related})` : ""}`,
          value: field && mapping[field.key] ? rows[item.index][mapping[field.key]!] : undefined,
        });
      }
      valid = valid.filter((_, index) => !failed.has(index));
    }

    const blocked = mode === "all-or-nothing" && errors.length > 0;
    if (!blocked && valid.length) {
      const journal = new WriteJournal();
      try {
        const result = await entity.upsert(db, companyId, valid.map((item) => item.value), {
          dryRun,
          journal: dryRun ? undefined : journal,
          batchId,
          userId: options.userId ?? null,
          onProgress: (done, count) => options.onProgress?.({ phase: "gravando", done, total: count }),
        });
        inserted = result.inserted;
        updated = result.updated;
        ok = valid.length;
      } catch (error) {
        let message = `Falha ao gravar no banco: ${errorMessage(error)}.`;
        try {
          await undoJournal(db, companyId, journal);
          message += " Nada desta importação foi gravado.";
        } catch (undoError) {
          message += ` Não foi possível desfazer a parte já gravada (${errorMessage(undoError)}): confira os registros.`;
        }
        errors.unshift({ row: 0, field: "", message });
      }
    }
  }

  errors.sort((a, b) => a.row - b.row);
  const rowsWithErrors = new Set(errors.filter((error) => error.row > 0).map((error) => error.row)).size;
  const status: ImportBatchStatus = dryRun ? "simulacao" : ok === 0 && errors.length > 0 ? "falhou" : errors.length > 0 ? "com_erros" : "concluida";

  try {
    await db.execute(
      `INSERT INTO import_batches (id, company_id, entity, filename, sheet_name, format, mode, dry_run, status, rows_total, rows_ok, rows_err, inserted, updated, errors_json, mapping_json, created_by, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        batchId,
        companyId,
        entity.key,
        options.filename ?? null,
        options.sheetName ?? null,
        options.format ?? null,
        mode,
        dryRun ? 1 : 0,
        status,
        total,
        ok,
        rowsWithErrors,
        inserted,
        updated,
        JSON.stringify(errors.slice(0, MAX_STORED_ERRORS).map(({ row, field, message }) => ({ row, field, message }))),
        mappingJson(mapping),
        options.userId ?? null,
        sqliteNow(),
      ],
    );
  } catch (error) {
    errors.push({ row: 0, field: "", message: `A importação terminou, mas o histórico não foi registrado: ${errorMessage(error)}` });
  }

  return { ok, inserted, updated, errors, rowsWithErrors, total, status, dryRun, mode, batchId };
}
