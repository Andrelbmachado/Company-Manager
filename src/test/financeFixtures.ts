// Massa de dados do financeiro para os testes (SQLite real ou banco demo): uma linha por INSERT, só colunas dadas.
import type { DatabaseLike } from "@/lib/db/demo";

export type FixtureRow = Record<string, string | number | null>;

export async function insertRow(db: DatabaseLike, table: string, row: FixtureRow): Promise<void> {
  const columns = Object.keys(row);
  await db.execute(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`, columns.map((column) => row[column]));
}

export async function addPayable(db: DatabaseLike, companyId: string, row: FixtureRow & { id: string; amount: number }): Promise<void> {
  await insertRow(db, "payables", { company_id: companyId, description: `Conta ${row.id}`, status: "aberta", ...row });
}

export async function addReceivable(db: DatabaseLike, companyId: string, row: FixtureRow & { id: string; amount: number }): Promise<void> {
  await insertRow(db, "receivables", { company_id: companyId, description: `Recebível ${row.id}`, status: "aberta", ...row });
}

export async function addBankAccount(db: DatabaseLike, companyId: string, row: FixtureRow & { id: string }): Promise<void> {
  await insertRow(db, "bank_accounts", { company_id: companyId, name: `Conta ${row.id}`, kind: "corrente", opening_balance: 0, ...row });
}

export async function addCategory(db: DatabaseLike, companyId: string, row: FixtureRow & { id: string; name: string; kind: string }): Promise<void> {
  await insertRow(db, "finance_categories", { company_id: companyId, ...row });
}

export async function addSettlement(db: DatabaseLike, companyId: string, row: FixtureRow & { id: string; amount: number; paid_at: string }): Promise<void> {
  await insertRow(db, "finance_settlements", { company_id: companyId, ...row });
}

export async function addBankTransaction(db: DatabaseLike, companyId: string, row: FixtureRow & { id: string; bank_account_id: string; posted_at: string; amount: number }): Promise<void> {
  await insertRow(db, "bank_transactions", { company_id: companyId, source: "manual", status: "pendente", ...row });
}

export async function addRecurring(db: DatabaseLike, companyId: string, row: FixtureRow & { id: string; amount: number; start_date: string }): Promise<void> {
  await insertRow(db, "recurring_entries", { company_id: companyId, kind: "pagar", description: `Recorrência ${row.id}`, frequency: "mensal", active: 1, ...row });
}
