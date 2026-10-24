// @vitest-environment jsdom
// O financeiro também roda no banco demo do navegador (localStorage, SQL por padrões de texto): todo SQL de baixas,
// recorrências, fluxo de caixa, DRE e conciliação tem de caber nos padrões dele (sem JOIN, SUM, IN, <, OR...).
import { beforeEach, describe, expect, it } from "vitest";
import { createDemoDb } from "@/lib/db/demo";
import { addBankAccount, addCategory, addPayable, addReceivable, addRecurring } from "@/test/financeFixtures";
import { accountBalances, cashflow } from "./cashflow";
import { dre } from "./dre";
import { categorizeTransaction, ignoreTransaction, matchTransaction, reconcile, suggestMatches, undoTransaction, addManualTransaction } from "./reconcile";
import { runRecurring } from "./recurring";
import { createEntries, deleteBankAccount, deleteCategory, deleteCostCenter, deleteRecurring, saveBankAccount, saveCategory, saveCostCenter, saveRecurring, setRecurringActive, updateEntry } from "./financeSetup";
import { approvePayable, cancelEntry, deleteEntry, listSettlements, reverseSettlement, settleEntry } from "./settlements";
import { parseOfx } from "./statement";

const C = "empresa-financeiro-demo";
type Row = Record<string, unknown>;

beforeEach(() => localStorage.clear());

const OFX = `OFXHEADER:100
<OFX><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261007<TRNAMT>-250.50<FITID>F1<MEMO>PAGTO BOLETO</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261008<TRNAMT>99.00<FITID>F2<MEMO>PIX</STMTTRN>
<STMTTRN><TRNTYPE>FEE<DTPOSTED>20261009<TRNAMT>12.00<FITID>F3<MEMO>TARIFA</STMTTRN>
</BANKTRANLIST></OFX>`;

describe("financeiro no banco demo", () => {
  it("baixa, estorno, aprovação, cancelamento e exclusão", async () => {
    const db = createDemoDb();
    await addBankAccount(db, C, { id: "bank", opening_balance: 100, opening_date: "2026-01-01" });
    await addPayable(db, C, { id: "p1", amount: 1000, due_date: "2026-10-15" });
    await addReceivable(db, C, { id: "r1", amount: 300, due_date: "2026-10-20" });

    await approvePayable(db, C, "p1", "demo-financeiro");
    const partial = await settleEntry(db, C, { kind: "payable", id: "p1", amount: 400, paidAt: "2026-10-10", bankAccountId: "bank" });
    expect(partial).toMatchObject({ status: "paga_parcial", remaining: 600 });
    await settleEntry(db, C, { kind: "payable", id: "p1", amount: 600, interest: 5, paidAt: "2026-10-11", bankAccountId: "bank" });
    const [paid] = await db.select<Row[]>("SELECT * FROM payables WHERE company_id=? AND id=?", [C, "p1"]);
    expect(paid).toMatchObject({ status: "paga", paid_amount: 1000, paid_at: "2026-10-11" });
    const settlements = await listSettlements(db, C, "payable", "p1");
    expect(settlements).toHaveLength(2);
    await reverseSettlement(db, C, settlements[1].id);
    expect((await db.select<Row[]>("SELECT * FROM payables WHERE company_id=? AND id=?", [C, "p1"]))[0]).toMatchObject({ status: "paga_parcial", paid_amount: 400 });

    await cancelEntry(db, C, "receivable", "r1");
    await deleteEntry(db, C, "receivable", "r1");
    expect(await db.select<Row[]>("SELECT * FROM receivables WHERE company_id=? AND deleted_at IS NULL", [C])).toEqual([]);

    const balances = await accountBalances(db, C, "2026-10-31");
    expect(balances[0]).toMatchObject({ accountId: "bank", balance: -300 });
  });

  it("recorrências geram uma vez só (sem UNIQUE no demo)", async () => {
    const db = createDemoDb();
    await addRecurring(db, C, { id: "rec", amount: 500, day_of_month: 5, start_date: "2026-01-01", last_competence: "2026-08" });
    await addRecurring(db, C, { id: "rec-r", kind: "receber", amount: 70, frequency: "semanal", start_date: "2026-10-02" });
    expect(await runRecurring(db, C, "2026-10-24")).toMatchObject({ created: 7 });
    expect(await runRecurring(db, C, "2026-10-24")).toMatchObject({ created: 0 });
    // Mesmo com a última competência apagada, o id determinístico não deixa duplicar.
    await db.execute("UPDATE recurring_entries SET last_competence=? WHERE company_id=? AND id=?", [null, C, "rec"]);
    await db.execute("UPDATE payables SET deleted_at=datetime('now') WHERE company_id=? AND recurring_entry_id=?", [C, "rec"]);
    expect(await runRecurring(db, C, "2026-10-24")).toMatchObject({ created: 0 });
    const payables = await db.select<Row[]>("SELECT * FROM payables WHERE company_id=?", [C]);
    expect(payables.map((row) => row.competence).sort()).toEqual(["2026-09", "2026-10"]);
  });

  it("competência repetida na mesma recorrência é recusada e retomar depois da pausa não gera os meses parados", async () => {
    const db = createDemoDb();
    await addRecurring(db, C, { id: "rec", amount: 500, day_of_month: 5, start_date: "2026-01-01", last_competence: "2026-08" });
    expect(await runRecurring(db, C, "2026-10-24")).toMatchObject({ created: 2 });
    const [september] = await db.select<Row[]>("SELECT * FROM payables WHERE company_id=? AND competence=?", [C, "2026-09"]);
    await expect(updateEntry(db, C, "payable", String(september.id), { description: "Aluguel", amount: 500, competence: "2026-10" })).rejects.toThrow(/já tem um lançamento/);
    await setRecurringActive(db, C, "rec", false, "2026-10-24");
    await setRecurringActive(db, C, "rec", true, "2027-01-10");
    expect(await runRecurring(db, C, "2027-01-10")).toMatchObject({ created: 1 });
    const payables = await db.select<Row[]>("SELECT * FROM payables WHERE company_id=?", [C]);
    expect(payables.map((row) => row.competence).sort()).toEqual(["2026-09", "2026-10", "2027-01"]);
  });

  it("fluxo de caixa e DRE", async () => {
    const db = createDemoDb();
    await addBankAccount(db, C, { id: "bank", opening_balance: 1000 });
    await addCategory(db, C, { id: "cat-r", name: "Vendas", kind: "receita", dre_group: "receita" });
    await addReceivable(db, C, { id: "r1", amount: 500, due_date: "2026-10-20", competence: "2026-10", category_id: "cat-r" });
    await addPayable(db, C, { id: "p1", amount: 200, due_date: "2026-10-12", competence: "2026-10" });
    await settleEntry(db, C, { kind: "payable", id: "p1", amount: 200, paidAt: "2026-10-12", bankAccountId: "bank" });
    const days = await cashflow(db, C, "2026-10-01", "2026-10-31", { today: "2026-10-10" });
    expect(days[30].balance).toBe(1300);
    expect(await dre(db, C, "2026-10")).toMatchObject({ receita: 500, despesas: 200, resultado: 300 });
  });

  it("cadastros: contas com parcelas, conta bancária padrão, plano de contas, centro de custo e recorrência", async () => {
    const db = createDemoDb();
    const ids = await createEntries(db, C, "payable", { description: "Compra", amount: 100, dueDate: "2026-10-31", installments: 3 });
    expect(ids).toHaveLength(3);
    await updateEntry(db, C, "payable", ids[0], { description: "Compra revisada", amount: 40 });
    const [first] = await db.select<Row[]>("SELECT * FROM payables WHERE company_id=? AND id=?", [C, ids[0]]);
    expect(first).toMatchObject({ description: "Compra revisada", amount: 40, due_date: "2026-10-31", installment_count: 3 });

    const a = await saveBankAccount(db, C, { name: "A", kind: "corrente" });
    const b = await saveBankAccount(db, C, { name: "B", kind: "caixa", isDefault: true });
    const accounts = await db.select<Row[]>("SELECT * FROM bank_accounts WHERE company_id=? AND deleted_at IS NULL", [C]);
    expect(accounts.find((item) => item.id === a)).toMatchObject({ is_default: 0 });
    expect(accounts.find((item) => item.id === b)).toMatchObject({ is_default: 1 });
    await deleteBankAccount(db, C, a);

    const parent = await saveCategory(db, C, { name: "Despesas", kind: "despesa", code: "4" });
    const child = await saveCategory(db, C, { name: "Aluguel", kind: "despesa", code: "4.1", parentId: parent });
    await expect(deleteCategory(db, C, parent)).rejects.toThrow(/subcategorias/);
    await deleteCategory(db, C, child);
    const costCenter = await saveCostCenter(db, C, { name: "TI" });
    await deleteCostCenter(db, C, costCenter);
    const recurring = await saveRecurring(db, C, { kind: "receber", description: "Contrato", amount: 99, frequency: "mensal", startDate: "2026-01-01" }, "demo-financeiro");
    await setRecurringActive(db, C, recurring, false);
    await deleteRecurring(db, C, recurring);
    expect(await db.select<Row[]>("SELECT * FROM recurring_entries WHERE company_id=? AND deleted_at IS NULL", [C])).toEqual([]);
  });

  it("conciliação: importar, casar, sugerir, categorizar, ignorar, desfazer e não duplicar", async () => {
    const db = createDemoDb();
    await addBankAccount(db, C, { id: "bank" });
    await addCategory(db, C, { id: "cat-tarifa", name: "Tarifas", kind: "despesa", dre_group: "financeiro" });
    await addPayable(db, C, { id: "p1", amount: 250.5, due_date: "2026-10-06" });
    await addReceivable(db, C, { id: "r1", amount: 300, due_date: "2026-10-08" });

    const result = await reconcile(db, "bank", parseOfx(OFX), { userId: "demo-financeiro" });
    expect(result).toMatchObject({ companyId: C, imported: 3, matched: 1, pending: 2 });
    expect(await reconcile(db, "bank", parseOfx(OFX))).toMatchObject({ imported: 0, duplicates: 3 });

    const transactions = await db.select<Row[]>("SELECT * FROM bank_transactions WHERE company_id=? AND bank_account_id=? ORDER BY posted_at ASC", [C, "bank"]);
    const [boleto, pix, tarifa] = transactions;
    expect(boleto).toMatchObject({ status: "conciliada", payable_id: "p1" });
    expect(tarifa).toMatchObject({ amount: -12 });

    const suggestions = await suggestMatches(db, C, String(pix.id));
    expect(suggestions.map((item) => item.entry.id)).toEqual(["r1"]);
    await matchTransaction(db, C, String(pix.id), { kind: "receivable", id: "r1" }, "demo-financeiro");
    expect((await db.select<Row[]>("SELECT * FROM receivables WHERE company_id=? AND id=?", [C, "r1"]))[0]).toMatchObject({ status: "recebida_parcial", received_amount: 99 });

    await categorizeTransaction(db, C, String(tarifa.id), "cat-tarifa", "demo-financeiro");
    await undoTransaction(db, C, String(tarifa.id));
    await ignoreTransaction(db, C, String(tarifa.id));
    await undoTransaction(db, C, String(boleto.id));
    expect((await db.select<Row[]>("SELECT * FROM payables WHERE company_id=? AND id=?", [C, "p1"]))[0]).toMatchObject({ status: "aberta", paid_amount: 0 });

    const manual = await addManualTransaction(db, C, { bankAccountId: "bank", postedAt: "2026-10-10", amount: -15, description: "Café" });
    expect((await db.select<Row[]>("SELECT * FROM bank_transactions WHERE company_id=? AND id=?", [C, manual]))[0]).toMatchObject({ source: "manual", status: "pendente", fitid: null });
  });
});
