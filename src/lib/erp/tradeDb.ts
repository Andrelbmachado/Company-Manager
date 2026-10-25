// Utilitários de banco do catálogo, vendas e compras (pricing, orders, receiving, catalog, suppliers).
// SQL só nos padrões do banco demo (SELECT * com WHERE col=? AND ..., UPDATE/INSERT de uma linha): JOIN, soma e
// filtro por faixa ficam no TypeScript. O primeiro bind é sempre company_id quando a tabela tem empresa.
// Sem transação: o tauri-plugin-sql usa um pool de conexões e BEGIN/COMMIT não ficam na mesma conexão. Por isso as
// funções validam tudo antes da primeira gravação e, se uma gravação falhar no meio, desfazem o que gravaram.
import type { DatabaseLike } from "@/lib/db/demo";
import { splitInstallments } from "@/lib/money";

/** Regra de negócio violada: a mensagem (pt-BR) vai direto para a tela. */
export class TradeRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TradeRuleError";
  }
}

export function fail(message: string): never {
  throw new TradeRuleError(message);
}

/** Mensagem para a tela: regra de negócio como está; erro inesperado com um prefixo. */
export function errorMessage(error: unknown): string {
  if (error instanceof TradeRuleError) return error.message;
  if (error instanceof Error) return `Não foi possível concluir: ${error.message}`;
  return `Não foi possível concluir: ${String(error)}`;
}

export const nowIso = () => new Date().toISOString();

/** 1, true, "1" e "true" (o desktop grava booleano como texto; o demo, como booleano). */
export function isTrue(value: unknown): boolean {
  return value === 1 || value === true || value === "1" || value === "true";
}

/** Linhas ativas (sem deleted_at) da empresa. */
export function activeRows<T>(db: DatabaseLike, table: string, companyId: string): Promise<T[]> {
  return db.select<T[]>(`SELECT * FROM ${table} WHERE company_id=? AND deleted_at IS NULL`, [companyId]);
}

/** Linhas ativas da empresa com `column = value`. */
export function activeRowsBy<T>(db: DatabaseLike, table: string, companyId: string, column: string, value: unknown): Promise<T[]> {
  return db.select<T[]>(`SELECT * FROM ${table} WHERE company_id=? AND ${column}=? AND deleted_at IS NULL`, [companyId, value]);
}

/** Registro ativo da empresa pelo id, ou null. */
export async function activeRow<T>(db: DatabaseLike, table: string, companyId: string, id: string | null | undefined): Promise<T | null> {
  if (!id) return null;
  const rows = await db.select<T[]>(`SELECT * FROM ${table} WHERE company_id=? AND id=? AND deleted_at IS NULL`, [companyId, id]);
  return rows[0] ?? null;
}

/**
 * Documento (pedido, fatura, recebimento) pelo id, ativo. Sem empresa informada, vale a do próprio registro
 * (ids são uuid); com empresa, só se for dela.
 */
export async function documentById<T extends { company_id: string }>(db: DatabaseLike, table: string, id: string, companyId: string | undefined, label: string): Promise<T> {
  const rows = companyId
    ? await db.select<T[]>(`SELECT * FROM ${table} WHERE company_id=? AND id=? AND deleted_at IS NULL`, [companyId, id])
    : await db.select<T[]>(`SELECT * FROM ${table} WHERE id=? AND deleted_at IS NULL`, [id]);
  return rows[0] ?? fail(`${label} não encontrado.`);
}

/** Linhas afetadas de um execute (SQLite do desktop, banco de teste e demo devolvem rowsAffected). */
export function rowsAffected(result: unknown): number | null {
  const value = (result as { rowsAffected?: unknown } | null)?.rowsAffected;
  return typeof value === "number" ? value : null;
}

/**
 * Troca o status só se ele ainda for o esperado (e as colunas de `mustBeNull` ainda vazias): de duas abas ou dois
 * cliques ao mesmo tempo, só um passa. Os demais campos vão junto no mesmo UPDATE.
 */
export async function claimStatus(
  db: DatabaseLike,
  table: string,
  companyId: string,
  id: string,
  expected: string,
  patch: Record<string, unknown>,
  conflictMessage: string,
  mustBeNull: readonly string[] = [],
): Promise<void> {
  const columns = Object.keys(patch);
  const nullChecks = mustBeNull.map((column) => ` AND ${column} IS NULL`).join("");
  const result = await db.execute(
    `UPDATE ${table} SET ${columns.map((column) => `${column}=?`).join(", ")} WHERE company_id=? AND id=? AND status=?${nullChecks}`,
    [...columns.map((column) => patch[column]), companyId, id, expected],
  );
  if (rowsAffected(result) === 0) fail(conflictMessage);
}

interface CategoryRow {
  id: string;
  parent_id?: string | null;
  code?: string | null;
  kind: string;
  dre_group?: string | null;
  position?: number | null;
  active?: unknown;
}

/**
 * Categoria padrão do plano de contas para o que vendas e compras geram: receita de venda (dre_group "receita") ou
 * custo da mercadoria (dre_group "custo"). Prefere a subcategoria (folha) mais acima na ordem; sem plano, null.
 */
export async function defaultFinanceCategory(db: DatabaseLike, companyId: string, kind: "receita" | "despesa"): Promise<string | null> {
  const rows = (await activeRows<CategoryRow>(db, "finance_categories", companyId)).filter((row) => row.kind === kind && (row.active == null || isTrue(row.active)));
  if (rows.length === 0) return null;
  const parents = new Set(rows.map((row) => row.parent_id).filter(Boolean));
  const group = kind === "receita" ? "receita" : "custo";
  const score = (row: CategoryRow) => (row.dre_group === group ? 0 : 2) + (parents.has(row.id) ? 1 : 0);
  const order = (row: CategoryRow) => [score(row), Number(row.position ?? 0), String(row.code ?? "")] as const;
  return [...rows].sort((a, b) => {
    const [sa, pa, ca] = order(a);
    const [sb, pb, cb] = order(b);
    return sa - sb || pa - pb || ca.localeCompare(cb, "pt-BR", { numeric: true });
  })[0].id;
}

export async function insertRow(db: DatabaseLike, table: string, row: Record<string, unknown>): Promise<void> {
  const columns = Object.keys(row);
  await db.execute(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`, columns.map((column) => row[column]));
}

export async function updateRow(db: DatabaseLike, table: string, companyId: string, id: string, patch: Record<string, unknown>): Promise<void> {
  const columns = Object.keys(patch);
  await db.execute(`UPDATE ${table} SET ${columns.map((column) => `${column}=?`).join(", ")} WHERE company_id=? AND id=?`, [...columns.map((column) => patch[column]), companyId, id]);
}

/** Desfaz o que já foi gravado (em ordem inversa) e repassa o erro original. */
export async function undoing<T>(work: (undo: (step: () => Promise<unknown>) => void) => Promise<T>): Promise<T> {
  const steps: (() => Promise<unknown>)[] = [];
  try {
    return await work((step) => steps.push(step));
  } catch (error) {
    for (const step of steps.reverse()) {
      try {
        await step();
      } catch (undoError) {
        console.error("[erp] falha ao desfazer gravação parcial", undoError);
      }
    }
    throw error;
  }
}

/** Texto aparado; vazio vira null. */
export function cleanText(value: string | null | undefined): string | null {
  const text = (value ?? "").trim();
  return text ? text : null;
}

/** 'YYYY-MM-DD' válido (dia de calendário que existe). */
export function isIsoDay(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Soma dias a 'YYYY-MM-DD' pelo calendário (UTC puro: sem fuso nem horário de verão). */
export function addDaysIso(day: string, days: number): string {
  const [year, month, date] = day.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
}

/**
 * Valor de cada parcela (splitInstallments: soma exata, a última absorve os centavos). Recusa quando o valor não dá
 * ao menos R$ 0,01 por parcela, para não gerar conta a receber/pagar de R$ 0,00.
 */
export function installmentAmounts(total: number, count: number): number[] {
  const amounts = splitInstallments(total, count);
  if (amounts.some((amount) => !(amount > 0))) fail(`O valor não dá ${count} parcelas de ao menos R$ 0,01; diminua o número de parcelas.`);
  return amounts;
}

/** Número finito (aceita texto de formulário com vírgula decimal, ex.: "1.234,56"). */
export function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return Number.NaN;
  const text = value.trim();
  if (!text) return Number.NaN;
  const normalized = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text;
  return Number(normalized);
}
