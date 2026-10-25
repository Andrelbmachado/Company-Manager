// Fábrica de entidades importáveis de uma tabela só (clientes, fornecedores, contas...). Cada importer descreve
// campos, chaves de identificação e referências (cliente, fornecedor, categoria...) e ganha de graça:
// - conferência com o banco (referência não achada ou ambígua, duas linhas apontando para o mesmo cadastro);
// - upsert pela chave natural, da mais forte para a mais fraca (documento → e-mail → nome), sem casar com um
//   cadastro cuja chave mais forte é diferente (dois "Acme" com CNPJs diferentes não se misturam);
// - gravação em lote (write.ts): célula vazia não apaga o que já existe; só colunas que mudaram são gravadas;
// - exportação com os mesmos campos (referência sai pelo nome).
// SQL só nos padrões do banco demo (SELECT * ... WHERE company_id=? AND deleted_at IS NULL); junções em TypeScript.
import { v4 as uuidv4 } from "uuid";
import type { ZodType } from "zod";
import type { DatabaseLike } from "@/lib/db/demo";
import type { Resource } from "@/lib/permissions/rbac";
import { normalizeKey } from "./normalize";
import type { FieldDef, ImportEntity, RowIssue, UpsertContext } from "./registry";
import { insertRows, sqliteNow, updateRows, type Row, type RowUpdate } from "./write";

/** Valor resolvido de cada referência da linha: id achado, ou null quando a célula veio vazia. */
export type RefValues = Record<string, string | null>;

export interface RefSpec {
  /** Campo da planilha (FieldDef.key) com o texto da referência. */
  field: string;
  /** Coluna da tabela que guarda o id referenciado (para exportar). */
  column: string;
  table: string;
  /** Nome no singular para as mensagens ("cliente"). */
  label: string;
  /** Textos que identificam uma linha da tabela referenciada (documento, e-mail, código, nome...). */
  keys: (row: Row) => unknown[];
  /** Texto exportado no lugar do id. */
  display: (row: Row) => string;
  /** Só algumas linhas valem (ex.: categoria de despesa). */
  filter?: (row: Row) => boolean;
}

export interface KeySpec<T> {
  /** Nome da chave nas mensagens ("CPF/CNPJ", "e-mail", "nome"). */
  name: string;
  /** Valor da chave na linha da planilha (refs = ids resolvidos; no naturalKey, o texto cru da referência). */
  fromRow: (row: T, refs: RefValues) => unknown;
  /** Valor da mesma chave numa linha do banco. */
  fromDb: (row: Row) => unknown;
  /**
   * Texto comparável (padrão keyOf: sem acento, caixa, pontuação nem espaços, bom para nome e CPF/CNPJ).
   * E-mail usa emailKey e código (SKU, nº do documento) usa codeKey: neles a pontuação distingue cadastros.
   */
  compare?: (value: unknown) => string;
  /**
   * Chave que vários cadastros podem ter de verdade (parcelas repetem o nº do documento). Se mais de um cadastro casa,
   * as chaves mais fracas desempatam; se nem assim sobra um só, a linha vira erro com esta mensagem (em vez de
   * atualizar o mais antigo). Linhas da planilha com a mesma chave compartilhada não são "repetidas" por isso.
   */
  shared?: (count: number) => string;
}

export interface ColumnContext {
  refs: RefValues;
  /** Linha do banco que vai ser atualizada (null = linha nova). */
  existing: Row | null;
  userId: string | null;
  batchId?: string;
}

export interface TableEntitySpec<T> {
  key: string;
  label: string;
  description?: string;
  resource: Resource;
  table: string;
  fields: FieldDef[];
  schema: ZodType<T>;
  refs?: RefSpec[];
  /** Chaves de identificação, da mais forte para a mais fraca. */
  keys: KeySpec<T>[];
  /** Colunas gravadas (sem id/company_id). null/undefined = não mexe (na linha nova, vale o DEFAULT). */
  toColumns: (row: T, context: ColumnContext) => Row;
  /** Colunas só da linha nova (quem abriu, status inicial...). */
  insertDefaults?: (row: T, context: ColumnContext) => Row;
  /** Regra que depende de vários campos ou do cadastro existente; devolve a mensagem do problema. */
  validate?: (row: T, context: ColumnContext) => { field: string; message: string } | null;
  /** Campos exportados além das colunas de mesmo nome e das referências (endereço, valores derivados...). */
  exportExtra?: (row: Row) => Record<string, unknown>;
  /** Linhas da tabela que não entram na exportação. */
  exportFilter?: (row: Row) => boolean;
  /**
   * Regra que roda depois de gravar as linhas (fora da simulação), com o cadastro anterior de cada uma. O que ela
   * gravar tem de ir para `context.journal` (updateRows/insertRows com o diário ou journal.recordUndo), para a falha no
   * meio desfazer tudo. Ex.: readmissão de colaborador limpa o desligamento.
   */
  afterWrite?: (db: DatabaseLike, companyId: string, written: WrittenRow<T>[], context: UpsertContext) => Promise<void>;
}

/** Linha gravada pela importação: `existing` = cadastro como estava antes (null = linha nova). */
export interface WrittenRow<T> {
  id: string;
  row: T;
  existing: Row | null;
}

/** Texto comparável de uma chave: sem acento, caixa, pontuação nem espaços ("11.222.333/0001-81" = "11222333000181"). */
export function keyOf(value: unknown): string {
  if (value === null || value === undefined) return "";
  return normalizeKey(String(value)).replace(/ /g, "");
}

/** E-mail comparável: sem espaços nas pontas e em minúsculas. Ponto, traço e "_" contam ("ana.paula@" ≠ "anapaula@"). */
export function emailKey(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim().toLowerCase();
}

/**
 * Código comparável (SKU, nº do documento): pontuação conta ("CAD-001" ≠ "CAD001", "NF 10/01" ≠ "NF 100/1"); só ignora
 * espaços nas pontas e maiúsculas sem acento, como o COLLATE NOCASE do índice único de SKU.
 */
export function codeKey(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .trim()
    .replace(/[A-Z]/g, (char) => char.toLowerCase());
}

/** Texto de uma referência (cliente, fornecedor...): e-mail compara inteiro; documento, código e nome sem pontuação. */
export function refKey(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return text.includes("@") ? emailKey(text) : keyOf(text);
}

const compareOf = <T>(key: KeySpec<T>) => key.compare ?? keyOf;

/** Linhas ativas da empresa (o filtro por empresa e por excluídos é feito no SQL; o demo entende este formato). */
export async function loadActive(db: DatabaseLike, table: string, companyId: string): Promise<Row[]> {
  return db.select<Row[]>(`SELECT * FROM ${table} WHERE company_id=? AND deleted_at IS NULL`, [companyId]);
}

/** Linhas mais antigas primeiro (em chave repetida no banco, vale o cadastro mais antigo). */
export function byAge(a: Row, b: Row): number {
  return String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) || String(a.id).localeCompare(String(b.id));
}

export interface RefIndex {
  spec: RefSpec;
  byKey: Map<string, Set<string>>;
  byId: Map<string, Row>;
}

export async function loadRefs(db: DatabaseLike, companyId: string, refs: RefSpec[]): Promise<RefIndex[]> {
  const cache = new Map<string, Row[]>();
  const indexes: RefIndex[] = [];
  for (const spec of refs) {
    let rows = cache.get(spec.table);
    if (!rows) {
      rows = await loadActive(db, spec.table, companyId);
      cache.set(spec.table, rows);
    }
    const byKey = new Map<string, Set<string>>();
    const byId = new Map<string, Row>();
    for (const row of rows) {
      byId.set(String(row.id), row);
      if (spec.filter && !spec.filter(row)) continue;
      for (const key of new Set(spec.keys(row).map(refKey).filter(Boolean))) {
        if (!byKey.has(key)) byKey.set(key, new Set());
        byKey.get(key)!.add(String(row.id));
      }
    }
    indexes.push({ spec, byKey, byId });
  }
  return indexes;
}

/**
 * Texto exportado de uma referência, que a importação resolve de volta para o mesmo cadastro: o nome; se outro
 * cadastro tem o mesmo nome (matriz e filial), o documento, e-mail ou código que só ele tem.
 */
function refText(index: RefIndex, target: Row): string {
  const shown = index.spec.display(target);
  for (const candidate of [shown, ...index.spec.keys(target)]) {
    const key = refKey(candidate);
    if (key && index.byKey.get(key)?.size === 1) return String(candidate);
  }
  return shown;
}

type RefResult = { ok: true; refs: RefValues } | { ok: false; field: string; message: string };

function resolveRefs<T>(row: T, indexes: RefIndex[]): RefResult {
  const refs: RefValues = {};
  for (const { spec, byKey } of indexes) {
    const raw = (row as Record<string, unknown>)[spec.field];
    const key = refKey(raw);
    if (!key) {
      refs[spec.field] = null;
      continue;
    }
    const ids = byKey.get(key);
    if (!ids || ids.size === 0) return { ok: false, field: spec.field, message: `Nenhum cadastro de ${spec.label} com "${String(raw)}"` };
    if (ids.size > 1) return { ok: false, field: spec.field, message: `Mais de um cadastro de ${spec.label} com "${String(raw)}": use o documento ou o código` };
    refs[spec.field] = [...ids][0];
  }
  return { ok: true, refs };
}

/** Texto cru das referências (para a chave natural, que não consulta o banco). */
function rawRefs<T>(row: T, refs: RefSpec[] | undefined): RefValues {
  return Object.fromEntries((refs ?? []).map((spec) => [spec.field, refKey((row as Record<string, unknown>)[spec.field]) || null]));
}

export interface PlannedRow<T> {
  index: number;
  row: T;
  refs: RefValues;
  existing: Row | null;
  /** Linha nova que repete o cadastro novo de uma linha anterior (só com allowRepeat): índice dessa linha. */
  pendingOf?: number;
}

export interface Plan<T> {
  planned: PlannedRow<T>[];
  issues: RowIssue[];
}

export interface PlanOptions {
  userId?: string | null;
  /** Várias linhas podem apontar para o mesmo cadastro (ex.: um item de estoque em vários locais). */
  allowRepeat?: boolean;
}

/** Casa cada linha com um cadastro existente (ou nenhum) e aponta conflitos. */
export async function buildPlan<T>(spec: TableEntitySpec<T>, db: DatabaseLike, companyId: string, rows: T[], options: PlanOptions = {}): Promise<Plan<T>> {
  const userId = options.userId ?? null;
  const refIndexes = await loadRefs(db, companyId, spec.refs ?? []);
  const existingRows = (await loadActive(db, spec.table, companyId)).sort(byAge);
  // tier → valor → linhas do banco
  const index = spec.keys.map(() => new Map<string, Row[]>());
  for (const row of existingRows) {
    spec.keys.forEach((key, tier) => {
      const value = compareOf(key)(key.fromDb(row));
      if (!value) return;
      const list = index[tier].get(value);
      if (list) list.push(row);
      else index[tier].set(value, [row]);
    });
  }
  const issues: RowIssue[] = [];
  const planned: PlannedRow<T>[] = [];
  const claimed = new Map<string, number>();
  // Chaves das linhas novas desta planilha (duas linhas novas com o mesmo e-mail viram conflito, não dois cadastros).
  const pendingKeys = spec.keys.map(() => new Map<string, number>());
  const pendingValues = new Map<number, string[]>();

  rows.forEach((row, rowIndex) => {
    const resolved = resolveRefs(row, refIndexes);
    if (!resolved.ok) {
      issues.push({ index: rowIndex, field: resolved.field, message: resolved.message });
      return;
    }
    const values = spec.keys.map((key) => compareOf(key)(key.fromRow(row, resolved.refs)));
    /** As chaves das posições from..to-1 batem com as do cadastro (chave vazia de um dos lados não conta). */
    const agrees = (candidate: Row, from: number, to: number) =>
      spec.keys.slice(from, to).every((key, offset) => {
        const mine = values[from + offset];
        const theirs = compareOf(key)(key.fromDb(candidate));
        return !mine || !theirs || mine === theirs;
      });
    let existing: Row | null = null;
    for (let tier = 0; tier < spec.keys.length && !existing; tier++) {
      if (!values[tier]) continue;
      const candidates = (index[tier].get(values[tier]) ?? []).filter((candidate) => agrees(candidate, 0, tier));
      const shared = spec.keys[tier].shared;
      if (!shared || candidates.length <= 1) {
        existing = candidates[0] ?? null;
        continue;
      }
      const narrowed = candidates.filter((candidate) => agrees(candidate, tier + 1, spec.keys.length));
      if (narrowed.length !== 1) {
        issues.push({ index: rowIndex, field: "", message: shared(candidates.length) });
        return;
      }
      existing = narrowed[0];
    }
    let pendingOf: number | undefined;
    if (existing) {
      const first = claimed.get(String(existing.id));
      if (first !== undefined && !options.allowRepeat) {
        issues.push({ index: rowIndex, field: "", message: `Mesmo cadastro de outra linha da planilha (${describe(spec, existing)})`, relatedIndex: first });
        return;
      }
      if (first === undefined) claimed.set(String(existing.id), rowIndex);
    } else {
      // Mesma regra do banco: chave fraca igual não junta duas linhas cuja chave mais forte é diferente.
      const tier = values.findIndex((value, position) => {
        const other = value && !spec.keys[position].shared ? pendingKeys[position].get(value) : undefined;
        if (other === undefined) return false;
        const theirs = pendingValues.get(other) ?? [];
        return values.slice(0, position).every((mine, stronger) => !mine || !theirs[stronger] || mine === theirs[stronger]);
      });
      if (tier >= 0 && !options.allowRepeat) {
        issues.push({ index: rowIndex, field: "", message: `Repetido na planilha (mesmo ${spec.keys[tier].name})`, relatedIndex: pendingKeys[tier].get(values[tier]) });
        return;
      }
      if (tier >= 0) pendingOf = pendingKeys[tier].get(values[tier]);
      else {
        pendingValues.set(rowIndex, values);
        values.forEach((value, position) => value && !pendingKeys[position].has(value) && pendingKeys[position].set(value, rowIndex));
      }
    }
    const context: ColumnContext = { refs: resolved.refs, existing, userId };
    const problem = spec.validate?.(row, context);
    if (problem) {
      issues.push({ index: rowIndex, field: problem.field, message: problem.message });
      return;
    }
    planned.push({ index: rowIndex, row, refs: resolved.refs, existing, pendingOf });
  });
  return { planned, issues };
}

function describe<T>(spec: TableEntitySpec<T>, row: Row): string {
  const name = row.name ?? row.title ?? row.subject ?? row.description ?? row.id;
  return `${spec.label}: ${String(name)}`;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Mesmo valor; a data da planilha ('YYYY-MM-DD') não troca uma data com hora do mesmo dia (não perde a hora). */
const sameValue = (a: unknown, b: unknown) =>
  (a ?? null) === (b ?? null) ||
  (typeof a === "number" && typeof b === "number" && Math.abs(a - b) < 1e-9) ||
  (typeof a === "string" && typeof b === "string" && DATE_ONLY.test(b) && a.length > 10 && a.startsWith(b) && (a[10] === "T" || a[10] === " "));

/**
 * Colunas que mudam num cadastro existente: ignora vazias (célula vazia não apaga) e iguais; com alguma mudança,
 * também grava updated_at. Devolve null se nada muda.
 */
export function diffColumns(columns: Row, existing: Row, now = sqliteNow()): { values: Row; previous: Row } | null {
  const values: Row = {};
  const previous: Row = {};
  for (const [column, value] of Object.entries(columns)) {
    if (value === null || value === undefined || sameValue(existing[column], value)) continue;
    values[column] = value;
    previous[column] = existing[column] ?? null;
  }
  if (Object.keys(values).length === 0) return null;
  values.updated_at = now;
  previous.updated_at = existing.updated_at ?? null;
  return { values, previous };
}

/** Monta a entidade importável/exportável a partir da descrição da tabela. */
export function defineTableEntity<T>(spec: TableEntitySpec<T>): ImportEntity<T> {
  const refFields = new Map((spec.refs ?? []).map((ref) => [ref.field, ref]));
  return {
    key: spec.key,
    label: spec.label,
    description: spec.description,
    resource: spec.resource,
    fields: spec.fields,
    schema: spec.schema,

    naturalKey(row: T): string {
      const refs = rawRefs(row, spec.refs);
      for (const key of spec.keys) {
        if (key.shared) continue;
        const value = compareOf(key)(key.fromRow(row, refs));
        if (value) return `${key.name}:${value}`;
      }
      return "";
    },

    async check(db, companyId, rows) {
      return (await buildPlan(spec, db, companyId, rows)).issues;
    },

    async upsert(db, companyId, rows, context: UpsertContext = {}) {
      const userId = context.userId ?? null;
      const plan = await buildPlan(spec, db, companyId, rows, { userId });
      if (plan.issues.length) throw new Error(`${plan.issues.length} linha(s) não conferem mais com o banco: ${plan.issues[0].message}`);
      const now = sqliteNow();
      const inserts: Row[] = [];
      const updates: RowUpdate[] = [];
      const written: WrittenRow<T>[] = [];
      for (const item of plan.planned) {
        const columnContext: ColumnContext = { refs: item.refs, existing: item.existing, userId, batchId: context.batchId };
        const columns = spec.toColumns(item.row, columnContext);
        if (!item.existing) {
          const id = uuidv4();
          inserts.push({ ...spec.insertDefaults?.(item.row, columnContext), ...stripEmpty(columns), id, company_id: companyId });
          written.push({ id, row: item.row, existing: null });
          continue;
        }
        written.push({ id: String(item.existing.id), row: item.row, existing: item.existing });
        const change = diffColumns(columns, item.existing, now);
        if (change) updates.push({ id: String(item.existing.id), ...change });
      }
      const inserted = inserts.length;
      const updated = plan.planned.length - inserted;
      if (context.dryRun) return { inserted, updated };
      const total = inserts.length + updates.length;
      let done = 0;
      const progress = (count: number) => {
        done += count;
        context.onProgress?.(done, total);
      };
      await insertRows(db, spec.table, inserts, context.journal, progress);
      await updateRows(db, spec.table, companyId, updates, context.journal, progress);
      if (spec.afterWrite) await spec.afterWrite(db, companyId, written, context);
      return { inserted, updated };
    },

    async exportData(db, companyId) {
      const rows = (await loadActive(db, spec.table, companyId)).filter((row) => !spec.exportFilter || spec.exportFilter(row)).sort(byAge);
      const refIndexes = await loadRefs(db, companyId, spec.refs ?? []);
      return rows.map((row) => {
        const out: Record<string, unknown> = {};
        for (const field of spec.fields) {
          const ref = refFields.get(field.key);
          if (ref) {
            const id = row[ref.column];
            const index = refIndexes.find((candidate) => candidate.spec === ref);
            const target = id ? index?.byId.get(String(id)) : undefined;
            out[field.key] = target && index ? refText(index, target) : null;
          } else if (field.key in row) {
            out[field.key] = field.kind === "bool" ? toBool(row[field.key]) : row[field.key];
          }
        }
        return { ...out, ...spec.exportExtra?.(row) };
      });
    },
  };
}

export function stripEmpty(row: Row): Row {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null && value !== undefined));
}

/** 0/1, 'true'/'false' (bind do Tauri) ou booleano → booleano. */
export function toBool(value: unknown): boolean | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return !["0", "false", "nao", "não"].includes(String(value).toLowerCase());
}

// ── endereço (address_json) ───────────────────────────────────────

export const ADDRESS_KEYS = ["cep", "logradouro", "numero", "complemento", "bairro", "cidade", "uf"] as const;

/** Campos de endereço da planilha (chave `endereco_<parte>`), guardados juntos em address_json. */
export const ADDRESS_FIELDS: FieldDef[] = [
  { key: "endereco_cep", label: "CEP", kind: "text", aliases: ["cep"], example: "01310-100" },
  { key: "endereco_logradouro", label: "Logradouro", kind: "text", aliases: ["endereço", "endereco", "rua", "logradouro"], example: "Av. Paulista" },
  { key: "endereco_numero", label: "Número", kind: "text", aliases: ["número", "numero", "nº", "n"], example: "1000" },
  { key: "endereco_complemento", label: "Complemento", kind: "text", aliases: ["complemento"], example: "Sala 12" },
  { key: "endereco_bairro", label: "Bairro", kind: "text", aliases: ["bairro"], example: "Bela Vista" },
  { key: "endereco_cidade", label: "Cidade", kind: "text", aliases: ["cidade", "município", "municipio"], example: "São Paulo" },
  { key: "endereco_uf", label: "UF", kind: "text", aliases: ["uf", "estado"], example: "SP", hint: "Sigla do estado" },
];

function parseJson(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** address_json novo: o que já existe + as partes preenchidas na planilha (undefined se nada veio). */
export function addressColumn(row: Record<string, unknown>, existing: Row | null): string | undefined {
  const parts: Record<string, string> = {};
  for (const part of ADDRESS_KEYS) {
    const value = row[`endereco_${part}`];
    if (typeof value === "string" && value.trim()) parts[part] = part === "uf" ? value.trim().toUpperCase() : value.trim();
  }
  if (Object.keys(parts).length === 0) return undefined;
  return JSON.stringify({ ...parseJson(existing?.address_json), ...parts });
}

/** Partes do address_json para exportar. */
export function addressExport(row: Row): Record<string, unknown> {
  const address = parseJson(row.address_json);
  return Object.fromEntries(ADDRESS_KEYS.map((part) => [`endereco_${part}`, address[part] ?? null]));
}
