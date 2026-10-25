// Gravações das tabelas de cadastro do financeiro (recorrências, extrato da conciliação, plano de contas e centros de
// custo): papel sem permissão é barrado na camada de dados, mesmo chamando a função direto, e nada muda; recorrência
// aceita qualquer descrição.
import { describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { addBankAccount, addBankTransaction, addCategory, addRecurring } from "@/test/financeFixtures";
import type { Role } from "@/types";
import { saveCategoryChanges, saveCostCenterChanges } from "./categoryEditing";
import { saveRecurringChanges } from "./recurringEditing";
import { saveTransactionChanges } from "./transactionEditing";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));

const testDb = useTestDb();
type Row = Record<string, unknown>;

async function setup(role: Role) {
  const db = testDb();
  const { companyId } = await insertTestCompany(db, { companyId: "empresa-cadastros", roles: [role] });
  await addBankAccount(db, companyId, { id: "banco", name: "Banco Principal", is_default: 1 });
  await addCategory(db, companyId, { id: "cat-d", name: "Aluguel", code: "4.1", kind: "despesa" });
  await addRecurring(db, companyId, { id: "rec", description: "Internet", amount: 150, day_of_month: 5, start_date: "2020-01-01" });
  await addBankTransaction(db, companyId, { id: "t1", bank_account_id: "banco", posted_at: "2026-10-02", amount: -35, description: "Café" });
  return { db, ctx: { companyId, role, userId: `test-user-${role}` } };
}

const row = async (table: string, id: string) => (await testDb().select<Row[]>(`SELECT * FROM ${table} WHERE id = ?`, [id]))[0];

describe("cadastros do financeiro na camada de dados", () => {
  it("papel sem permissão é barrado e nada muda", async () => {
    const { db, ctx } = await setup("gerente");
    await expect(saveRecurringChanges(db, ctx, { updated: [{ id: "rec", amount: 1 }], created: [] })).rejects.toThrow(/permissão para editar/);
    await expect(saveRecurringChanges(db, ctx, { updated: [], created: [{ description: "Luz", amount: 90, start_date: "2026-01-01" }] })).rejects.toThrow(/permissão para adicionar/);
    await expect(saveTransactionChanges(db, ctx, "banco", { updated: [{ id: "t1", amount: -40 }], created: [] })).rejects.toThrow(/permissão para editar/);
    await expect(saveTransactionChanges(db, ctx, "banco", { updated: [], created: [{ description: "Tarifa", posted_at: "2026-10-03", amount: -5 }] })).rejects.toThrow(/permissão para adicionar/);
    await expect(saveCategoryChanges(db, ctx, { updated: [{ id: "cat-d", name: "Outro" }], created: [] })).rejects.toThrow(/permissão para editar/);
    await expect(saveCostCenterChanges(db, ctx, { updated: [], created: [{ name: "Comercial" }] })).rejects.toThrow(/permissão para adicionar/);

    expect(await row("recurring_entries", "rec")).toMatchObject({ amount: 150 });
    expect(await row("bank_transactions", "t1")).toMatchObject({ amount: -35 });
    expect(await db.select("SELECT id FROM bank_transactions WHERE company_id = ?", [ctx.companyId])).toHaveLength(1);
    expect(await row("finance_categories", "cat-d")).toMatchObject({ name: "Aluguel" });
    expect(await db.select("SELECT id FROM cost_centers WHERE company_id = ?", [ctx.companyId])).toHaveLength(0);
  });

  it("recorrência grava com qualquer descrição (até \"Linha nova\") e recusa descrição vazia", async () => {
    const { db, ctx } = await setup("financeiro");
    const [id] = await saveRecurringChanges(db, ctx, { updated: [], created: [{ description: "Linha nova", kind: "pagar", amount: 90, start_date: "2026-01-01" }] }, "2026-01-01");
    expect(await row("recurring_entries", id)).toMatchObject({ description: "Linha nova", amount: 90 });
    await expect(saveRecurringChanges(db, ctx, { updated: [], created: [{ description: "  ", amount: 90, start_date: "2026-01-01" }] }, "2026-01-01")).rejects.toThrow("Linha nova: informe a descrição.");
  });
});
