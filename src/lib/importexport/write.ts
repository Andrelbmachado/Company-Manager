// Gravação em lote da importação, nos dois bancos do app:
// - SQLite (desktop): várias linhas por comando (INSERT ... VALUES (...),(...) e UPDATE ... FROM (VALUES ...)), até
//   500 linhas por comando. Cada comando é atômico e 50 mil linhas viram ~100 chamadas em vez de 100 mil.
// - Banco demo (navegador): uma linha por comando, nos padrões que o demo entende.
// O tauri-plugin-sql usa um pool de conexões: BEGIN/COMMIT em chamadas separadas podem cair em conexões diferentes
// (e uma transação aberta esquecida trava o banco). Por isso o "tudo ou nada" usa um diário (WriteJournal): cada
// linha inserida ou alterada é anotada com o valor anterior e, se algo falhar no meio, undoJournal desfaz tudo.
import type { DatabaseLike } from "@/lib/db/demo";

export type Row = Record<string, unknown>;
export type Backend = "sqlite" | "demo";

/** Linhas por comando no SQLite. */
export const ROWS_PER_STATEMENT = 500;
/** Binds por comando (o SQLite aceita 32.766; folga para colunas largas). */
const MAX_BINDS = 10_000;

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function assertIdentifier(name: string): string {
  if (!IDENTIFIER.test(name)) throw new Error(`Nome de tabela/coluna inválido: ${name}`);
  return name;
}

const backends = new WeakMap<object, Promise<Backend>>();

/** SQLite de verdade ou banco demo? (`sqlite_version()` só existe no SQLite; o demo recusa SQL fora dos seus padrões.) */
export function detectBackend(db: DatabaseLike): Promise<Backend> {
  let backend = backends.get(db);
  if (!backend) {
    backend = db.select<{ version?: string }[]>("SELECT sqlite_version() AS version").then(
      (rows) => (Array.isArray(rows) && rows[0]?.version ? "sqlite" : "demo"),
      () => "demo" as const,
    );
    backends.set(db, backend);
  }
  return backend;
}

let lastYield = 0;

/**
 * Deixa a interface respirar entre lotes (o banco demo é síncrono e trava a tela sem isso). Só cede de fato a cada
 * ~30 ms: setTimeout custa ~4 ms por chamada no navegador e ceder a cada linha deixaria a importação lenta.
 */
export async function yieldToUi(): Promise<void> {
  const now = Date.now();
  if (now - lastYield < 30) return;
  await new Promise((resolve) => setTimeout(resolve, 0));
  lastYield = Date.now();
}

/** Instante no formato do datetime('now') do SQLite ('YYYY-MM-DD HH:MM:SS', UTC). */
export function sqliteNow(now = new Date()): string {
  return now.toISOString().replace("T", " ").slice(0, 19);
}

type JournalEntry =
  | { kind: "insert"; table: string; ids: string[] }
  | { kind: "update"; table: string; id: string; previous: Row }
  | { kind: "undo"; run: () => Promise<unknown> };

/** Diário da gravação: o que foi inserido e o valor anterior do que foi alterado, para desfazer. */
export class WriteJournal {
  readonly entries: JournalEntry[] = [];

  recordInsert(table: string, ids: string[]): void {
    if (ids.length) this.entries.push({ kind: "insert", table, ids });
  }

  recordUpdate(table: string, id: string, previous: Row): void {
    this.entries.push({ kind: "update", table, id, previous });
  }

  /** Gravação feita por outra regra (ex.: o motor de estoque), com o próprio jeito de desfazer. */
  recordUndo(run: () => Promise<unknown>): void {
    this.entries.push({ kind: "undo", run });
  }

  get isEmpty(): boolean {
    return this.entries.length === 0;
  }
}

/** Agrupa linhas pelo conjunto de colunas (um comando de várias linhas precisa das mesmas colunas). */
function groupByColumns<T>(items: T[], columnsOf: (item: T) => string[]): { columns: string[]; items: T[] }[] {
  const groups = new Map<string, { columns: string[]; items: T[] }>();
  for (const item of items) {
    const columns = columnsOf(item);
    const signature = columns.join(",");
    let group = groups.get(signature);
    if (!group) {
      group = { columns, items: [] };
      groups.set(signature, group);
    }
    group.items.push(item);
  }
  return [...groups.values()];
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

const rowsPerStatement = (columns: number) => Math.max(1, Math.min(ROWS_PER_STATEMENT, Math.floor(MAX_BINDS / Math.max(1, columns))));
const placeholders = (count: number) => `(${Array.from({ length: count }, () => "?").join(", ")})`;

/** Colunas com valor (null/undefined ficam de fora: o DEFAULT da coluna vale). `id` primeiro. */
function insertColumns(row: Row): string[] {
  return Object.keys(row)
    .filter((column) => row[column] !== undefined && row[column] !== null)
    .sort((a, b) => (a === "id" ? -1 : b === "id" ? 1 : a.localeCompare(b)))
    .map(assertIdentifier);
}

/**
 * Insere linhas novas (cada uma com `id`). Colunas nulas ficam com o DEFAULT. Anota no diário depois de cada comando.
 * `onRows` recebe quantas linhas acabaram de ser gravadas.
 */
export async function insertRows(db: DatabaseLike, table: string, rows: Row[], journal?: WriteJournal, onRows?: (count: number) => void): Promise<void> {
  assertIdentifier(table);
  if (rows.length === 0) return;
  const backend = await detectBackend(db);
  for (const group of groupByColumns(rows, insertColumns)) {
    const size = backend === "sqlite" ? rowsPerStatement(group.columns.length) : 1;
    for (const part of chunk(group.items, size)) {
      const sql = `INSERT INTO ${table} (${group.columns.join(", ")}) VALUES ${part.map(() => placeholders(group.columns.length)).join(", ")}`;
      await db.execute(sql, part.flatMap((row) => group.columns.map((column) => row[column])));
      journal?.recordInsert(table, part.map((row) => String(row.id)));
      onRows?.(part.length);
      await yieldToUi();
    }
  }
}

export interface RowUpdate {
  id: string;
  /** Colunas a gravar (as que ficam de fora não mudam). */
  values: Row;
  /** Valor anterior das mesmas colunas (vai para o diário). */
  previous?: Row;
}

/** Atualiza linhas existentes da empresa. Com `journal`, anota o valor anterior de cada coluna alterada. */
export async function updateRows(
  db: DatabaseLike,
  table: string,
  companyId: string,
  updates: RowUpdate[],
  journal?: WriteJournal,
  onRows?: (count: number) => void,
): Promise<void> {
  assertIdentifier(table);
  const pending = updates.filter((update) => Object.keys(update.values).length > 0);
  if (pending.length === 0) return;
  const backend = await detectBackend(db);
  const columnsOf = (update: RowUpdate) => Object.keys(update.values).sort().map(assertIdentifier);
  for (const group of groupByColumns(pending, columnsOf)) {
    const size = backend === "sqlite" ? rowsPerStatement(group.columns.length + 1) : 1;
    for (const part of chunk(group.items, size)) {
      if (backend === "sqlite") {
        const assignments = group.columns.map((column, index) => `${column} = v.column${index + 2}`).join(", ");
        const sql = `UPDATE ${table} SET ${assignments} FROM (VALUES ${part.map(() => placeholders(group.columns.length + 1)).join(", ")}) AS v WHERE ${table}.id = v.column1 AND ${table}.company_id = ?`;
        await db.execute(sql, [...part.flatMap((update) => [update.id, ...group.columns.map((column) => update.values[column] ?? null)]), companyId]);
      } else {
        const update = part[0];
        const sql = `UPDATE ${table} SET ${group.columns.map((column) => `${column}=?`).join(", ")} WHERE company_id=? AND id=?`;
        await db.execute(sql, [...group.columns.map((column) => update.values[column] ?? null), companyId, update.id]);
      }
      if (journal) for (const update of part) journal.recordUpdate(table, update.id, update.previous ?? {});
      onRows?.(part.length);
      await yieldToUi();
    }
  }
}

/** Desfaz o diário de trás para frente: apaga o que foi inserido e devolve o valor anterior do que foi alterado. */
export async function undoJournal(db: DatabaseLike, companyId: string, journal: WriteJournal): Promise<void> {
  const backend = await detectBackend(db);
  for (let index = journal.entries.length - 1; index >= 0; ) {
    const entry = journal.entries[index];
    if (entry.kind === "undo") {
      await entry.run();
      index--;
      continue;
    }
    if (entry.kind === "insert") {
      // Linhas recém-criadas por esta importação (nunca existiram para ninguém): apagar é desfazer, não excluir dado.
      const ids = [...entry.ids].reverse();
      if (backend === "sqlite") {
        for (const part of chunk(ids, ROWS_PER_STATEMENT)) {
          await db.execute(`DELETE FROM ${entry.table} WHERE company_id = ? AND id IN (${part.map(() => "?").join(", ")})`, [companyId, ...part]);
        }
      } else {
        for (const id of ids) await db.execute(`DELETE FROM ${entry.table} WHERE company_id=? AND id=?`, [companyId, id]);
      }
      index--;
      continue;
    }
    // Atualizações seguidas da mesma tabela voltam juntas (valor exato, inclusive NULL). Se a mesma linha foi
    // alterada mais de uma vez, vale o valor mais antigo de cada coluna (o de antes da importação).
    const table = entry.table;
    const restores = new Map<string, Row>();
    while (index >= 0) {
      const current = journal.entries[index];
      if (current.kind !== "update" || current.table !== table) break;
      restores.set(current.id, { ...restores.get(current.id), ...current.previous });
      index--;
    }
    await updateRows(db, table, companyId, [...restores].map(([id, values]) => ({ id, values })));
  }
  journal.entries.length = 0;
}
