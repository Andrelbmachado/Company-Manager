// Conciliação: importar extrato sem duplicar (fitid por conta, inclusive excluídos), casar automaticamente só quando há
// um candidato exato, sugerir, conciliar à mão (parcial/excesso), categorizar, ignorar e desfazer.
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, insertTestCompany, type TestDb } from "@/test/sqlite";
import { addBankAccount, addBankTransaction, addCategory, addPayable, addReceivable } from "@/test/financeFixtures";
import { categorizeTransaction, ignoreTransaction, matchTransaction, reconcile, suggestMatches, undoTransaction, type BankTx } from "./reconcile";
import { listSettlements } from "./settlements";

let db: TestDb;
let companyId: string;
const USER = "test-user-financeiro";

interface Row {
  [key: string]: unknown;
}
const row = async (table: string, id: string) => (await db.select<Row[]>(`SELECT * FROM ${table} WHERE id = ?`, [id]))[0];
const txByFitid = async (fitid: string) => (await db.select<Row[]>("SELECT * FROM bank_transactions WHERE fitid = ?", [fitid]))[0];

const tx = (fitid: string, postedAt: string, amount: number, description = fitid): BankTx => ({ fitid, postedAt, amount, description, memo: null, checkNumber: null, type: null });

const STATEMENT: BankTx[] = [tx("F-TARIFA", "2026-10-03", -89.9, "TARIFA"), tx("F-PIX", "2026-10-05", 1500, "PIX RECEBIDO"), tx("F-BOLETO", "2026-10-07", -250.5, "PAGTO BOLETO")];

beforeEach(async () => {
  db = await createTestDb();
  ({ companyId } = await insertTestCompany(db, { roles: ["financeiro"] }));
  await addBankAccount(db, companyId, { id: "A" });
  await addBankAccount(db, companyId, { id: "B" });
  await addCategory(db, companyId, { id: "cat-tarifa", name: "Tarifas", kind: "despesa", dre_group: "financeiro" });
  await addPayable(db, companyId, { id: "P", amount: 250.5, due_date: "2026-10-06" });
  await addReceivable(db, companyId, { id: "R", amount: 1500, due_date: "2026-10-04" });
  await addReceivable(db, companyId, { id: "R-longe", amount: 1500, due_date: "2026-12-30" });
  await addPayable(db, companyId, { id: "Q-outra-conta", amount: 89.9, due_date: "2026-10-03", bank_account_id: "B" });
});

describe("reconcile (importar extrato)", () => {
  it("importa, casa automaticamente as contas com valor exato perto da data e deixa o resto pendente", async () => {
    const result = await reconcile(db, "A", STATEMENT, { userId: USER, source: "ofx" });
    expect(result).toMatchObject({ imported: 3, duplicates: 0, matched: 2, pending: 1 });

    expect(await txByFitid("F-BOLETO")).toMatchObject({ status: "conciliada", payable_id: "P", receivable_id: null, reconciled_by: USER, source: "ofx", bank_account_id: "A", company_id: companyId, posted_at: "2026-10-07", amount: -250.5 });
    expect(await row("payables", "P")).toMatchObject({ status: "paga", paid_amount: 250.5, paid_at: "2026-10-07" });
    const [settlement] = await listSettlements(db, companyId, "payable", "P");
    expect(settlement).toMatchObject({ amount: 250.5, paid_at: "2026-10-07", bank_account_id: "A", bank_transaction_id: (await txByFitid("F-BOLETO")).id });

    expect(await txByFitid("F-PIX")).toMatchObject({ status: "conciliada", receivable_id: "R" });
    expect(await row("receivables", "R")).toMatchObject({ status: "recebida", received_amount: 1500 });
    expect(await row("receivables", "R-longe")).toMatchObject({ status: "aberta" });
    // Conta ligada a outra conta bancária não casa automaticamente.
    expect(await txByFitid("F-TARIFA")).toMatchObject({ status: "pendente", payable_id: null });
  });

  it("reimportar o mesmo extrato não duplica (nem lançamento excluído volta)", async () => {
    await reconcile(db, "A", STATEMENT, { userId: USER });
    await db.execute("UPDATE bank_transactions SET deleted_at = datetime('now') WHERE fitid = ?", ["F-TARIFA"]);
    const again = await reconcile(db, "A", STATEMENT, { userId: USER });
    expect(again).toMatchObject({ imported: 0, duplicates: 3, matched: 0 });
    expect(await db.select<Row[]>("SELECT * FROM bank_transactions WHERE company_id = ?", [companyId])).toHaveLength(3);
    // Mesmo fitid em outra conta é outro lançamento.
    expect(await reconcile(db, "B", [STATEMENT[0]], { userId: USER })).toMatchObject({ imported: 1 });
  });

  it("fitid repetido no próprio arquivo entra uma vez; lançamento sem fitid ganha um fitid estável", async () => {
    const noFitid = { ...tx("", "2026-10-09", -10, "SEM ID"), fitid: null };
    const first = await reconcile(db, "A", [STATEMENT[0], STATEMENT[0], noFitid, noFitid], { autoMatch: false });
    expect(first).toMatchObject({ imported: 3, duplicates: 1 });
    expect(await reconcile(db, "A", [noFitid, noFitid], { autoMatch: false })).toMatchObject({ imported: 0, duplicates: 2 });
  });

  it("dois candidatos com o mesmo valor: não casa sozinho, e a sugestão mais próxima vem primeiro", async () => {
    await addReceivable(db, companyId, { id: "R2", amount: 1500, due_date: "2026-10-08" });
    const result = await reconcile(db, "A", [STATEMENT[1]], { userId: USER });
    expect(result).toMatchObject({ imported: 1, matched: 0, pending: 1 });
    const pending = await txByFitid("F-PIX");
    const suggestions = await suggestMatches(db, companyId, String(pending.id));
    expect(suggestions.slice(0, 3).map((item) => item.entry.id)).toEqual(["R", "R2", "R-longe"]);
    expect(suggestions[0]).toMatchObject({ exact: true, daysApart: 1 });
  });

  it("autoMatch: false só importa", async () => {
    expect(await reconcile(db, "A", STATEMENT, { autoMatch: false })).toMatchObject({ imported: 3, matched: 0, pending: 3 });
  });

  it("conta bancária inexistente é erro", async () => {
    await expect(reconcile(db, "nao-existe", STATEMENT)).rejects.toThrow(/Conta bancária não encontrada/);
  });
});

describe("matchTransaction, categorizar, ignorar e desfazer", () => {
  it("valor menor que o saldo baixa em parte; valor maior quita e o excesso vira juros", async () => {
    await addReceivable(db, companyId, { id: "R300", amount: 300, due_date: "2026-10-10" });
    await addBankTransaction(db, companyId, { id: "t-100", bank_account_id: "A", posted_at: "2026-10-10", amount: 100 });
    await matchTransaction(db, companyId, "t-100", { kind: "receivable", id: "R300" }, USER);
    expect(await row("receivables", "R300")).toMatchObject({ status: "recebida_parcial", received_amount: 100 });

    await addBankTransaction(db, companyId, { id: "t-210", bank_account_id: "A", posted_at: "2026-10-12", amount: 210 });
    await matchTransaction(db, companyId, "t-210", { kind: "receivable", id: "R300" }, USER);
    expect(await row("receivables", "R300")).toMatchObject({ status: "recebida", received_amount: 300 });
    const settlements = await listSettlements(db, companyId, "receivable", "R300");
    expect(settlements.map((item) => [item.amount, item.interest])).toEqual([[100, 0], [200, 10]]);
    expect(await row("bank_transactions", "t-210")).toMatchObject({ status: "conciliada", receivable_id: "R300", reconciled_by: USER });
  });

  it("recusa sentido trocado, lançamento já conciliado e conta quitada", async () => {
    await addBankTransaction(db, companyId, { id: "t-credito", bank_account_id: "A", posted_at: "2026-10-05", amount: 1500 });
    await expect(matchTransaction(db, companyId, "t-credito", { kind: "payable", id: "P" }, USER)).rejects.toThrow(/entrada/);
    await matchTransaction(db, companyId, "t-credito", { kind: "receivable", id: "R" }, USER);
    await expect(matchTransaction(db, companyId, "t-credito", { kind: "receivable", id: "R-longe" }, USER)).rejects.toThrow(/pendente/);
    await addBankTransaction(db, companyId, { id: "t-credito-2", bank_account_id: "A", posted_at: "2026-10-05", amount: 1500 });
    await expect(matchTransaction(db, companyId, "t-credito-2", { kind: "receivable", id: "R" }, USER)).rejects.toThrow(/quitada/);
  });

  it("categorizar concilia sem conta ligada; ignorar e desfazer voltam para pendente", async () => {
    await addBankTransaction(db, companyId, { id: "t-tarifa", bank_account_id: "A", posted_at: "2026-10-03", amount: -89.9 });
    await categorizeTransaction(db, companyId, "t-tarifa", "cat-tarifa", USER);
    expect(await row("bank_transactions", "t-tarifa")).toMatchObject({ status: "conciliada", category_id: "cat-tarifa", payable_id: null, receivable_id: null, reconciled_by: USER });
    await undoTransaction(db, companyId, "t-tarifa");
    expect(await row("bank_transactions", "t-tarifa")).toMatchObject({ status: "pendente", reconciled_at: null, reconciled_by: null });

    await ignoreTransaction(db, companyId, "t-tarifa");
    expect(await row("bank_transactions", "t-tarifa")).toMatchObject({ status: "ignorada" });
    await undoTransaction(db, companyId, "t-tarifa");
    expect(await row("bank_transactions", "t-tarifa")).toMatchObject({ status: "pendente" });
    await expect(categorizeTransaction(db, companyId, "t-tarifa", "nao-existe", USER)).rejects.toThrow(/Categoria/);
  });

  it("desfazer conciliação com conta estorna a baixa e reabre a conta", async () => {
    await reconcile(db, "A", STATEMENT, { userId: USER });
    const boleto = await txByFitid("F-BOLETO");
    await undoTransaction(db, companyId, String(boleto.id));
    expect(await txByFitid("F-BOLETO")).toMatchObject({ status: "pendente", payable_id: null, reconciled_at: null });
    expect(await row("payables", "P")).toMatchObject({ status: "aberta", paid_amount: 0, paid_at: null });
    expect(await listSettlements(db, companyId, "payable", "P")).toEqual([]);
  });
});
