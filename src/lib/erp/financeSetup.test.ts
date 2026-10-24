// Cadastros do financeiro: contas a pagar/receber (com parcelas), contas bancárias, plano de contas, centros de custo
// e recorrências — validações, conta padrão única, ciclo no plano de contas e exclusão só do que não está em uso.
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, insertTestCompany, type TestDb } from "@/test/sqlite";
import { addBankAccount, addCategory, addPayable, addRecurring, insertRow } from "@/test/financeFixtures";
import { runRecurring } from "./recurring";
import {
  createEntries,
  deleteBankAccount,
  deleteCategory,
  deleteCostCenter,
  deleteRecurring,
  saveBankAccount,
  saveCategory,
  saveCostCenter,
  saveRecurring,
  setRecurringActive,
  updateEntry,
} from "./financeSetup";
import { settleEntry } from "./settlements";

let db: TestDb;
let companyId: string;
const USER = "test-user-financeiro";

interface Row {
  [key: string]: unknown;
}
const rows = async (table: string) => db.select<Row[]>(`SELECT * FROM ${table} WHERE company_id = ? ORDER BY created_at, id`, [companyId]);
const row = async (table: string, id: string) => (await db.select<Row[]>(`SELECT * FROM ${table} WHERE id = ?`, [id]))[0];

beforeEach(async () => {
  db = await createTestDb();
  ({ companyId } = await insertTestCompany(db, { roles: ["financeiro"] }));
});

describe("createEntries / updateEntry", () => {
  it("conta a pagar em 3 parcelas: centavos na última, vencimentos mensais (fim de mês ajustado) e numeração", async () => {
    await insertRow(db, "suppliers", { id: "sup", company_id: companyId, name: "Fornecedor" });
    const ids = await createEntries(db, companyId, "payable", { description: "Notebook", amount: 1000, dueDate: "2026-01-31", installments: 3, partyId: "sup", documentNumber: "NF 10" });
    expect(ids).toHaveLength(3);
    const created = await db.select<Row[]>("SELECT * FROM payables WHERE company_id = ? ORDER BY installment_number", [companyId]);
    expect(created.map((item) => [item.description, item.amount, item.due_date, item.installment_number, item.installment_count])).toEqual([
      ["Notebook (1/3)", 333.33, "2026-01-31", 1, 3],
      ["Notebook (2/3)", 333.33, "2026-02-28", 2, 3],
      ["Notebook (3/3)", 333.34, "2026-03-31", 3, 3],
    ]);
    expect(created[0]).toMatchObject({ status: "aberta", supplier_id: "sup", document_number: "NF 10", ref_type: "Manual", paid_amount: 0 });
  });

  it("conta a receber à vista grava descrição, cliente e origem manual", async () => {
    await insertRow(db, "customers", { id: "cus", company_id: companyId, name: "Cliente" });
    const [id] = await createEntries(db, companyId, "receivable", { description: "Consultoria", amount: 1250.5, dueDate: "2026-11-10", partyId: "cus", competence: "2026-10" });
    expect(await row("receivables", id)).toMatchObject({ description: "Consultoria", amount: 1250.5, customer_id: "cus", ref_type: "Manual", ref_id: null, competence: "2026-10", installment_count: null, status: "aberta" });
  });

  it("recusa descrição vazia, valor zero, parcelas sem vencimento e competência inválida", async () => {
    await expect(createEntries(db, companyId, "payable", { description: " ", amount: 10 })).rejects.toThrow(/descrição/);
    await expect(createEntries(db, companyId, "payable", { description: "X", amount: 0 })).rejects.toThrow(/valor/);
    await expect(createEntries(db, companyId, "payable", { description: "X", amount: 10, installments: 2 })).rejects.toThrow(/vencimento/);
    await expect(createEntries(db, companyId, "payable", { description: "X", amount: 10, competence: "10/2026" })).rejects.toThrow(/Competência/);
    await expect(createEntries(db, companyId, "payable", { description: "X", amount: 10, installments: 0 })).rejects.toThrow(/parcelas/);
  });

  it("editar não deixa o valor abaixo do já pago e recalcula o status", async () => {
    const [id] = await createEntries(db, companyId, "payable", { description: "Serviço", amount: 1000, dueDate: "2026-10-10" });
    await settleEntry(db, companyId, { kind: "payable", id, amount: 400, paidAt: "2026-10-05" });
    await expect(updateEntry(db, companyId, "payable", id, { description: "Serviço", amount: 300 })).rejects.toThrow(/já pago/);
    await updateEntry(db, companyId, "payable", id, { description: "Serviço revisado", amount: 400, dueDate: "2026-10-12" });
    expect(await row("payables", id)).toMatchObject({ description: "Serviço revisado", amount: 400, status: "paga", paid_amount: 400, due_date: "2026-10-12" });
    await updateEntry(db, companyId, "payable", id, { description: "Serviço revisado", amount: 500 });
    expect(await row("payables", id)).toMatchObject({ status: "paga_parcial", paid_at: null });
  });

  it("editar conta gerada por recorrência semanal: a competência com o dia, devolvida pelo formulário, continua valendo", async () => {
    await addRecurring(db, companyId, { id: "rec-sem", amount: 50, frequency: "semanal", start_date: "2026-10-02" });
    await runRecurring(db, companyId, "2026-10-24");
    const [generated] = await db.select<Row[]>("SELECT * FROM payables WHERE company_id = ? ORDER BY competence", [companyId]);
    const id = String(generated.id);
    await updateEntry(db, companyId, "payable", id, { description: "Diarista", amount: 60, competence: String(generated.competence) });
    expect(await row("payables", id)).toMatchObject({ description: "Diarista", amount: 60, competence: "2026-10-02", recurring_entry_id: "rec-sem" });
    await expect(updateEntry(db, companyId, "payable", id, { description: "Diarista", amount: 60, competence: "2026-10-09" })).rejects.toThrow(/Competência inválida/);
  });

  it("competência de lançamento recorrente não pode repetir a de outro lançamento da mesma recorrência", async () => {
    await addRecurring(db, companyId, { id: "rec-men", amount: 100, day_of_month: 5, start_date: "2026-01-01", last_competence: "2026-08" });
    await runRecurring(db, companyId, "2026-10-24");
    const [september] = await db.select<Row[]>("SELECT * FROM payables WHERE company_id = ? AND competence = ?", [companyId, "2026-09"]);
    await expect(updateEntry(db, companyId, "payable", String(september.id), { description: "Aluguel", amount: 100, competence: "2026-10" })).rejects.toThrow(/já tem um lançamento na competência 10\/2026/);
    await updateEntry(db, companyId, "payable", String(september.id), { description: "Aluguel", amount: 100, competence: "2026-11" });
    expect(await row("payables", String(september.id))).toMatchObject({ competence: "2026-11" });
  });

  it("editar conta a receber antiga preserva ref_type/ref_id e normaliza o legado quitado", async () => {
    await insertRow(db, "receivables", { id: "old", company_id: companyId, ref_type: "invoice", ref_id: "inv-1", amount: 300, status: "recebida" });
    await updateEntry(db, companyId, "receivable", "old", { description: "Parcela 1/3", amount: 300 });
    expect(await row("receivables", "old")).toMatchObject({ description: "Parcela 1/3", ref_type: "invoice", ref_id: "inv-1", status: "recebida", received_amount: 300 });
  });
});

describe("contas bancárias", () => {
  it("a primeira conta vira a padrão; marcar outra como padrão desmarca a anterior", async () => {
    const first = await saveBankAccount(db, companyId, { name: "Banco A", kind: "corrente", openingBalance: 100, openingDate: "2026-01-01" });
    expect(await row("bank_accounts", first)).toMatchObject({ is_default: 1, active: 1, opening_balance: 100 });
    const second = await saveBankAccount(db, companyId, { name: "Banco B", kind: "poupanca", isDefault: true });
    expect(await row("bank_accounts", first)).toMatchObject({ is_default: 0 });
    expect(await row("bank_accounts", second)).toMatchObject({ is_default: 1 });
    await saveBankAccount(db, companyId, { name: "Banco B2", kind: "poupanca", isDefault: true, active: false }, second);
    expect(await row("bank_accounts", second)).toMatchObject({ name: "Banco B2", active: 0, is_default: 1 });
    await expect(saveBankAccount(db, companyId, { name: "", kind: "corrente" })).rejects.toThrow(/nome/);
    await expect(saveBankAccount(db, companyId, { name: "X", kind: "corrente", openingDate: "31/12/2025" })).rejects.toThrow(/Data/);
  });

  it("só exclui conta sem movimento", async () => {
    const used = await saveBankAccount(db, companyId, { name: "Usada", kind: "corrente" });
    const unused = await saveBankAccount(db, companyId, { name: "Sem uso", kind: "caixa" });
    await insertRow(db, "bank_transactions", { id: "tx", company_id: companyId, bank_account_id: used, posted_at: "2026-10-01", amount: 10 });
    await expect(deleteBankAccount(db, companyId, used)).rejects.toThrow(/desative/);
    await deleteBankAccount(db, companyId, unused);
    expect((await row("bank_accounts", unused)).deleted_at).toBeTruthy();
  });

  it("conta prevista numa fatura também está em uso", async () => {
    const id = await saveBankAccount(db, companyId, { name: "Recebimentos", kind: "corrente" });
    await insertRow(db, "invoices", { id: "fat-1", company_id: companyId, number: 1, total: 100, bank_account_id: id });
    await expect(deleteBankAccount(db, companyId, id)).rejects.toThrow(/desative/);
  });
});

describe("plano de contas e centros de custo", () => {
  it("cria hierarquia, recusa código repetido e ciclo, e só exclui categoria sem uso nem filhas", async () => {
    const parent = await saveCategory(db, companyId, { name: "Despesas", kind: "despesa", code: "4", dreGroup: "despesa" });
    const child = await saveCategory(db, companyId, { name: "Aluguel", kind: "despesa", code: "4.1", parentId: parent });
    expect(await row("finance_categories", child)).toMatchObject({ parent_id: parent, dre_group: null, active: 1 });
    await expect(saveCategory(db, companyId, { name: "Outra", kind: "despesa", code: "4.1" })).rejects.toThrow(/código/);
    await expect(saveCategory(db, companyId, { name: "Despesas", kind: "despesa", code: "4", parentId: child }, parent)).rejects.toThrow(/dentro dela/);
    await expect(saveCategory(db, companyId, { name: "X", kind: "despesa", dreGroup: "invalido" as never })).rejects.toThrow(/DRE/);

    await expect(deleteCategory(db, companyId, parent)).rejects.toThrow(/subcategorias/);
    await addPayable(db, companyId, { id: "p", amount: 10, category_id: child });
    await expect(deleteCategory(db, companyId, child)).rejects.toThrow(/em uso/);
    const free = await saveCategory(db, companyId, { name: "Livre", kind: "receita" });
    await deleteCategory(db, companyId, free);
    expect((await row("finance_categories", free)).deleted_at).toBeTruthy();
  });

  it("centro de custo: cria, edita e só exclui sem uso", async () => {
    const id = await saveCostCenter(db, companyId, { name: "TI" });
    await saveCostCenter(db, companyId, { name: "Tecnologia" }, id);
    expect(await row("cost_centers", id)).toMatchObject({ name: "Tecnologia" });
    await addPayable(db, companyId, { id: "p", amount: 10, cost_center_id: id });
    await expect(deleteCostCenter(db, companyId, id)).rejects.toThrow(/em uso/);
    await db.execute("UPDATE payables SET deleted_at = datetime('now') WHERE id = 'p'");
    await deleteCostCenter(db, companyId, id);
    expect((await row("cost_centers", id)).deleted_at).toBeTruthy();
  });

  it("categoria de receita de produto, de fatura ou de pedido de compra está em uso (as contas geradas depois herdam a categoria)", async () => {
    const product = await saveCategory(db, companyId, { name: "Vendas de produtos", kind: "receita" });
    const invoice = await saveCategory(db, companyId, { name: "Serviços", kind: "receita" });
    const purchase = await saveCategory(db, companyId, { name: "Insumos", kind: "despesa" });
    await insertRow(db, "products", { id: "prod-1", company_id: companyId, name: "Roteador", revenue_category_id: product });
    await insertRow(db, "invoices", { id: "fat-1", company_id: companyId, number: 1, total: 100, category_id: invoice });
    await insertRow(db, "purchase_orders", { id: "pc-1", company_id: companyId, number: 1, total: 50, category_id: purchase });
    for (const id of [product, invoice, purchase]) await expect(deleteCategory(db, companyId, id)).rejects.toThrow(/em uso/);
  });

  it("centro de custo de pedido de compra está em uso", async () => {
    const id = await saveCostCenter(db, companyId, { name: "Produção" });
    await insertRow(db, "purchase_orders", { id: "pc-1", company_id: companyId, number: 1, total: 50, cost_center_id: id });
    await expect(deleteCostCenter(db, companyId, id)).rejects.toThrow(/em uso/);
  });
});

describe("recorrências", () => {
  it("cria, valida, desativa e exclui (soft delete)", async () => {
    await addCategory(db, companyId, { id: "cat", name: "Aluguel", kind: "despesa" });
    await addBankAccount(db, companyId, { id: "bank" });
    const id = await saveRecurring(db, companyId, { kind: "pagar", description: "Aluguel", amount: 6800, frequency: "mensal", dayOfMonth: 5, startDate: "2026-01-01", categoryId: "cat", bankAccountId: "bank" }, USER);
    expect(await row("recurring_entries", id)).toMatchObject({ kind: "pagar", amount: 6800, day_of_month: 5, active: 1, created_by: USER, category_id: "cat", last_competence: null });
    await expect(saveRecurring(db, companyId, { kind: "pagar", description: "X", amount: 10, frequency: "mensal", startDate: "2026-02-01", endDate: "2026-01-01" }, USER)).rejects.toThrow(/fim/);
    await expect(saveRecurring(db, companyId, { kind: "pagar", description: "X", amount: 10, frequency: "mensal", startDate: "2026-02-01", dayOfMonth: 32 }, USER)).rejects.toThrow(/Dia/);
    await expect(saveRecurring(db, companyId, { kind: "pagar", description: "X", amount: 10, frequency: "quinzenal" as never, startDate: "2026-02-01" }, USER)).rejects.toThrow(/Frequência/);
    await setRecurringActive(db, companyId, id, false);
    expect(await row("recurring_entries", id)).toMatchObject({ active: 0 });
    await deleteRecurring(db, companyId, id);
    expect((await row("recurring_entries", id)).deleted_at).toBeTruthy();
    expect(await rows("payables")).toEqual([]);
  });
});
