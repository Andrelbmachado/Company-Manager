// Limpeza dos dados de exemplo do modo demonstração (só app desktop: lê o schema do SQLite por sqlite_master e
// pragma_*; o banco demo do navegador não entende isso e é todo de exemplo de qualquer jeito).
//
// Regras (Tarefa 10 do redesign):
// - Some toda linha da empresa com id "dev-..." ou "demo-..." (hard delete: é dado fictício), em todas as tabelas com
//   `id` e `company_id`, menos DEMO_EXCLUDED_TABLES (leads são pesquisa real; contas, vínculos e a empresa ficam).
// - Também somem os lançamentos que uma recorrência de exemplo gerou sozinha (id = generatedEntryId da recorrência):
//   não foram cadastrados pela pessoa, só derivam do exemplo.
// - O que a pessoa cadastrou (qualquer outro id) fica intacto. Se um registro dela aponta (chave estrangeira) para um
//   de exemplo, o de exemplo fica também (e o que ele usa), para nada quebrar: `kept` diz quantos.
// - Sem transação no plugin SQL e sem ON DELETE CASCADE no schema: apaga em camadas, primeiro o que ninguém mais
//   referencia (filhos antes dos pais). Uma exclusão recusada (alguém gravou uma referência no meio) só deixa aquela
//   linha, e as que ela usa, para trás.
import type { DatabaseLike } from "@/lib/db/demo";
import { generatedEntryId } from "@/lib/erp/recurring";

/** Tabelas que a limpeza nunca apaga (o plano: leads, contas de login, vínculos, empresa e o controle de migrations). */
export const DEMO_EXCLUDED_TABLES = ["leads", "users", "memberships", "companies", "_sqlx_migrations"] as const;
export const DEMO_ID_PREFIXES = ["dev-", "demo-"] as const;

/** Id de dado de exemplo: começa exatamente com "dev-" ou "demo-". */
export function isDemoId(id: unknown): boolean {
  return typeof id === "string" && DEMO_ID_PREFIXES.some((prefix) => id.startsWith(prefix));
}

export interface DemoRowCount {
  total: number;
  byTable: Record<string, number>;
}

export interface PurgeResult {
  removed: number;
  /** Linhas de exemplo que ficaram porque um registro que não é de exemplo aponta para elas (direta ou indiretamente). */
  kept: number;
  removedByTable: Record<string, number>;
  keptByTable: Record<string, number>;
}

interface TableInfo {
  name: string;
  columns: Set<string>;
  foreignKeys: { column: string; table: string }[];
}

// substr, não LIKE: LIKE ignora maiúsculas ("DEV-..." não é dado de exemplo) e trata "_" como curinga.
const DEMO_ID_SQL = "(substr(id, 1, 4) = 'dev-' OR substr(id, 1, 5) = 'demo-')";
const CHUNK = 200;
const SEP = "\u0000";

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;
const rowKey = (table: string, id: string) => `${table}${SEP}${id}`;
const tableOf = (key: string) => key.slice(0, key.indexOf(SEP));
const idOf = (key: string) => key.slice(key.indexOf(SEP) + 1);
const excluded = (table: string) => (DEMO_EXCLUDED_TABLES as readonly string[]).includes(table);

async function loadTables(db: DatabaseLike): Promise<TableInfo[]> {
  const names = await db.select<{ name: string }[]>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  const tables: TableInfo[] = [];
  for (const { name } of names) {
    if (name === "_sqlx_migrations") continue;
    const columns = await db.select<{ name: string }[]>("SELECT name FROM pragma_table_info(?)", [name]);
    const foreignKeys = await db.select<{ table: string; from: string }[]>('SELECT "table", "from" FROM pragma_foreign_key_list(?)', [name]);
    tables.push({ name, columns: new Set(columns.map((column) => column.name)), foreignKeys: foreignKeys.map((fk) => ({ column: fk.from, table: fk.table })) });
  }
  return tables;
}

/** Tabela em que a limpeza procura linhas de exemplo: tem `id` e `company_id` e não está protegida. */
function purgeable(table: TableInfo): boolean {
  return !excluded(table.name) && table.columns.has("id") && table.columns.has("company_id");
}

function bump(counter: Record<string, number>, table: string, by = 1): void {
  counter[table] = (counter[table] ?? 0) + by;
}

/** Quantas linhas de exemplo (id dev-/demo-) a empresa tem, por tabela (só as tabelas que a limpeza alcança). */
export async function countDemoRows(db: DatabaseLike, companyId: string): Promise<DemoRowCount> {
  const byTable: Record<string, number> = {};
  let total = 0;
  for (const table of await loadTables(db)) {
    if (!purgeable(table)) continue;
    const [row] = await db.select<{ n: number }[]>(`SELECT count(*) AS n FROM ${quote(table.name)} WHERE company_id = ? AND ${DEMO_ID_SQL}`, [companyId]);
    const n = Number(row?.n ?? 0);
    if (n > 0) {
      byTable[table.name] = n;
      total += n;
    }
  }
  return { total, byTable };
}

/** Lançamentos gerados por runRecurring a partir de uma recorrência de exemplo (o id é derivado dela). */
async function addGeneratedEntries(db: DatabaseLike, tables: TableInfo[], companyId: string, candidates: Set<string>): Promise<void> {
  for (const name of ["payables", "receivables"]) {
    const table = tables.find((item) => item.name === name);
    if (!table || !table.columns.has("recurring_entry_id") || !table.columns.has("competence")) continue;
    const rows = await db.select<{ id: string; recurring_entry_id: string; competence: string | null }[]>(
      `SELECT id, recurring_entry_id, competence FROM ${quote(name)} WHERE company_id = ? AND recurring_entry_id IS NOT NULL`,
      [companyId],
    );
    for (const row of rows) {
      if (!row.competence || !candidates.has(rowKey("recurring_entries", row.recurring_entry_id))) continue;
      if (row.id === generatedEntryId(row.recurring_entry_id, row.competence)) candidates.add(rowKey(name, row.id));
    }
  }
}

/** Apaga as linhas (nenhuma é referenciada por outra que fica); devolve as que saíram de fato. */
async function deleteRows(db: DatabaseLike, keys: string[]): Promise<string[]> {
  const byTable = new Map<string, string[]>();
  for (const key of keys) byTable.set(tableOf(key), [...(byTable.get(tableOf(key)) ?? []), idOf(key)]);
  const deleted: string[] = [];
  for (const [table, ids] of byTable) {
    for (let start = 0; start < ids.length; start += CHUNK) {
      const chunk = ids.slice(start, start + CHUNK);
      try {
        await db.execute(`DELETE FROM ${quote(table)} WHERE id IN (${chunk.map(() => "?").join(", ")})`, chunk);
        deleted.push(...chunk.map((id) => rowKey(table, id)));
      } catch {
        // Uma referência nova (gravada depois que o grafo foi lido) barrou o lote: tenta uma a uma e deixa só a barrada.
        for (const id of chunk) {
          try {
            await db.execute(`DELETE FROM ${quote(table)} WHERE id = ?`, [id]);
            deleted.push(rowKey(table, id));
          } catch {
            /* fica: alguém aponta para ela */
          }
        }
      }
    }
  }
  return deleted;
}

/** Apaga os dados de exemplo da empresa (ver as regras no topo do arquivo). Não mexe no `demo_mode` (demoMode.ts faz isso). */
export async function purgeDemoData(db: DatabaseLike, companyId: string): Promise<PurgeResult> {
  const tables = await loadTables(db);
  const candidates = new Set<string>();
  for (const table of tables) {
    if (!purgeable(table)) continue;
    const rows = await db.select<{ id: string }[]>(`SELECT id FROM ${quote(table.name)} WHERE company_id = ? AND ${DEMO_ID_SQL}`, [companyId]);
    for (const { id } of rows) if (isDemoId(id)) candidates.add(rowKey(table.name, id));
  }
  await addGeneratedEntries(db, tables, companyId, candidates);

  const result: PurgeResult = { removed: 0, kept: 0, removedByTable: {}, keptByTable: {} };
  if (candidates.size === 0) return result;

  // Quem aponta para cada candidata. Referência vinda de linha que fica (real, lead, conta...) nunca sai da contagem.
  const candidateTables = new Set([...candidates].map(tableOf));
  const references = new Map<string, number>();
  const pointsTo = new Map<string, string[]>();
  for (const table of tables) {
    const foreignKeys = table.foreignKeys.filter((fk) => candidateTables.has(fk.table) && table.columns.has(fk.column));
    if (foreignKeys.length === 0 || !table.columns.has("id")) continue;
    const columns = [...new Set(foreignKeys.map((fk) => fk.column))];
    const rows = await db.select<Record<string, unknown>[]>(`SELECT id, ${columns.map(quote).join(", ")} FROM ${quote(table.name)}`);
    for (const row of rows) {
      const source = rowKey(table.name, String(row.id));
      const sourceGoes = candidates.has(source);
      for (const fk of foreignKeys) {
        const value = row[fk.column];
        if (value == null) continue;
        const target = rowKey(fk.table, String(value));
        if (target === source || !candidates.has(target)) continue;
        references.set(target, (references.get(target) ?? 0) + 1);
        if (sourceGoes) pointsTo.set(source, [...(pointsTo.get(source) ?? []), target]);
      }
    }
  }

  // Camadas: apaga o que ninguém referencia; isso libera o que essas linhas usavam, e assim por diante.
  const removed = new Set<string>();
  let layer = [...candidates].filter((key) => !references.get(key));
  while (layer.length > 0) {
    const next: string[] = [];
    for (const key of await deleteRows(db, layer)) {
      removed.add(key);
      bump(result.removedByTable, tableOf(key));
      for (const target of pointsTo.get(key) ?? []) {
        const left = (references.get(target) ?? 0) - 1;
        references.set(target, left);
        if (left === 0) next.push(target);
      }
    }
    layer = next;
  }

  for (const key of candidates) if (!removed.has(key)) bump(result.keptByTable, tableOf(key));
  result.removed = removed.size;
  result.kept = candidates.size - removed.size;
  return result;
}
