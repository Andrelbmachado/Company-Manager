// Banco SQLite real (em memória) para testes, com as migrations de src-tauri/migrations aplicadas.
// Mesmo formato do DatabaseLike de lib/db (select/execute com binds "?") e mesma conversão de binds
// do tauri-plugin-sql 2.x (ver toTauriBind), para que um teste que passa aqui passe no app desktop.
import Database from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, URL as NodeURL } from "node:url";
import type { DatabaseLike } from "@/lib/db/demo";
import { ROLE_LABELS } from "@/lib/permissions/rbac";
import type { Role } from "@/types";

// URL do Node, não a global: nos testes de componente (jsdom) a global é a do jsdom, que o fileURLToPath recusa.
export const MIGRATIONS_DIR = fileURLToPath(new NodeURL("../../src-tauri/migrations", import.meta.url));

export interface MigrationFile {
  version: number;
  file: string;
  sql: string;
}

export interface QueryResult {
  rowsAffected: number;
  lastInsertId?: number;
}

export interface TestDb extends DatabaseLike {
  select<T>(sql: string, binds?: unknown[]): Promise<T>;
  execute(sql: string, binds?: unknown[]): Promise<QueryResult>;
  /** Aplica as migrations que faltam (todas, ou até `upTo`). */
  migrate(options?: { upTo?: number }): Promise<void>;
  /** Versões já aplicadas, em ordem. */
  readonly appliedVersions: readonly number[];
  /** Conexão better-sqlite3, para inspeção (PRAGMA, EXPLAIN). Código do app deve usar select/execute. */
  readonly raw: Database.Database;
  close(): void;
}

export interface CreateTestDbOptions {
  /** Para testar upgrade de schema: aplica só até esta versão; complete depois com `migrate()`. */
  upTo?: number;
}

let cache: MigrationFile[] | null = null;

/** Migrations de src-tauri/migrations (`NNNN_nome.sql`) em ordem numérica. */
export function listMigrations(): MigrationFile[] {
  if (!cache) {
    cache = readdirSync(MIGRATIONS_DIR)
      .map((file) => ({ file, match: /^(\d+)_.+\.sql$/.exec(file) }))
      .filter((entry): entry is { file: string; match: RegExpExecArray } => entry.match !== null)
      .map(({ file, match }) => ({ version: Number(match[1]), file, sql: readFileSync(path.join(MIGRATIONS_DIR, file), "utf8") }))
      .sort((a, b) => a.version - b.version);
  }
  return cache;
}

/**
 * Converte um bind como o app desktop faz: o JS serializa os argumentos em JSON (undefined/NaN → null,
 * Date → texto ISO) e o tauri-plugin-sql (wrapper.rs) liga null → NULL, string → TEXT, número → REAL e
 * qualquer outra coisa como JSON em TEXT. Atenção: booleano vira o TEXTO 'true'/'false', não 1/0;
 * para colunas 0/1 passe números.
 */
export function toTauriBind(value: unknown): string | number | null {
  if (typeof value === "bigint") throw new TypeError("O plugin SQL do Tauri não aceita BigInt como bind; use number ou string.");
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    throw new TypeError("O plugin SQL do Tauri não grava binários (o bind vira JSON). Guarde arquivos em disco e o caminho no banco.");
  }
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const json = JSON.stringify(value === undefined ? null : value);
  const parsed: unknown = json === undefined ? null : JSON.parse(json);
  if (parsed === null) return null;
  if (typeof parsed === "string" || typeof parsed === "number") return parsed;
  return JSON.stringify(parsed);
}

function decodeRow(row: Record<string, unknown>): Record<string, unknown> {
  // O plugin devolve BLOB como array de bytes (JSON); o resto já sai igual (INTEGER/REAL → number, TEXT → string).
  for (const key of Object.keys(row)) {
    const value = row[key];
    if (Buffer.isBuffer(value)) row[key] = Array.from(value);
  }
  return row;
}

function isMultiStatementError(error: unknown): boolean {
  return error instanceof Error && /more than one statement/i.test(error.message);
}

export async function createTestDb(options: CreateTestDbOptions = {}): Promise<TestDb> {
  const raw = new Database(":memory:");
  // O sqlx (usado pelo tauri-plugin-sql) abre toda conexão com foreign_keys = ON.
  raw.pragma("foreign_keys = ON");
  const applied: number[] = [];

  const migrate = async ({ upTo }: { upTo?: number } = {}): Promise<void> => {
    const last = applied.length ? applied[applied.length - 1] : 0;
    for (const migration of listMigrations()) {
      if (migration.version <= last) continue;
      if (upTo !== undefined && migration.version > upTo) break;
      // Como o sqlx: cada migration numa transação.
      raw.exec("BEGIN");
      try {
        raw.exec(migration.sql);
        raw.exec("COMMIT");
      } catch (error) {
        if (raw.inTransaction) raw.exec("ROLLBACK");
        throw new Error(`Migration ${migration.file} falhou: ${error instanceof Error ? error.message : String(error)}`);
      }
      applied.push(migration.version);
    }
  };

  const db: TestDb = {
    raw,
    get appliedVersions() {
      return [...applied];
    },
    migrate,
    async select<T>(sql: string, binds: unknown[] = []): Promise<T> {
      const statement = raw.prepare(sql);
      const values = binds.map(toTauriBind);
      if (!statement.reader) {
        statement.run(...values);
        return [] as T;
      }
      return (statement.all(...values) as Record<string, unknown>[]).map(decodeRow) as T;
    },
    async execute(sql: string, binds: unknown[] = []): Promise<QueryResult> {
      let statement: Database.Statement;
      try {
        statement = raw.prepare(sql);
      } catch (error) {
        if (!isMultiStatementError(error) || binds.length) throw error;
        // Vários comandos sem binds (o sqlx executa todos em sequência).
        const before = raw.prepare("SELECT total_changes() AS n").get() as { n: number };
        raw.exec(sql);
        const after = raw.prepare("SELECT total_changes() AS n, last_insert_rowid() AS id").get() as { n: number; id: number };
        return { rowsAffected: after.n - before.n, lastInsertId: Number(after.id) };
      }
      const result = statement.run(...binds.map(toTauriBind));
      return { rowsAffected: result.changes, lastInsertId: Number(result.lastInsertRowid) };
    },
    close() {
      if (raw.open) raw.close();
    },
  };

  await migrate({ upTo: options.upTo });
  return db;
}

export const TEST_ROLES = Object.keys(ROLE_LABELS) as Role[];

/**
 * Cria uma empresa e uma conta (users + memberships) por papel pedido. Ids previsíveis:
 * empresa `companyId` (padrão "test-company") e usuário `test-user-<papel>`.
 */
export async function insertTestCompany(
  db: TestDb,
  options: { companyId?: string; name?: string; roles?: Role[] } = {},
): Promise<{ companyId: string; userIds: Partial<Record<Role, string>> }> {
  const companyId = options.companyId ?? "test-company";
  await db.execute("INSERT INTO companies (id, name) VALUES (?, ?)", [companyId, options.name ?? "Empresa de Teste"]);
  const userIds: Partial<Record<Role, string>> = {};
  for (const role of options.roles ?? TEST_ROLES) {
    const userId = `test-user-${role}`;
    await db.execute("INSERT OR IGNORE INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)", [
      userId,
      `Teste ${role}`,
      `${role}@teste.local`,
      "plain:teste",
    ]);
    await db.execute("INSERT INTO memberships (id, company_id, user_id, role, scope) VALUES (?, ?, ?, ?, ?)", [
      `test-member-${companyId}-${role}`,
      companyId,
      userId,
      role,
      ["ceo", "admin", "gerente"].includes(role) ? "empresa" : "setor",
    ]);
    userIds[role] = userId;
  }
  return { companyId, userIds };
}
