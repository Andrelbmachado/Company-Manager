// Baixas (pagamento/recebimento total ou parcial), estorno, aprovação, cancelamento e exclusão, no SQLite real.
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, insertTestCompany, type TestDb } from "@/test/sqlite";
import { addBankAccount, addPayable, addReceivable } from "@/test/financeFixtures";
import { approvePayable, cancelEntry, deleteEntry, listSettlements, reverseSettlement, settleEntry } from "./settlements";
import { settlementCash } from "./financeCommon";

let db: TestDb;
let companyId: string;
const USER = "test-user-financeiro";

interface Row {
  [key: string]: unknown;
}
const row = async (table: string, id: string) => (await db.select<Row[]>(`SELECT * FROM ${table} WHERE id = ?`, [id]))[0];

beforeEach(async () => {
  db = await createTestDb();
  ({ companyId } = await insertTestCompany(db, { roles: ["financeiro"] }));
  await addBankAccount(db, companyId, { id: "bank-1" });
  await addPayable(db, companyId, { id: "pay-1", amount: 1000, due_date: "2026-10-15" });
  await addReceivable(db, companyId, { id: "rec-1", amount: 300, due_date: "2026-10-20" });
});

describe("settleEntry", () => {
  it("baixa parcial e depois o restante com juros e multa quitam a conta a pagar", async () => {
    const first = await settleEntry(db, companyId, { kind: "payable", id: "pay-1", amount: 400, paidAt: "2026-10-10", bankAccountId: "bank-1", paymentMethod: "pix", userId: USER });
    expect(first).toMatchObject({ status: "paga_parcial", paid: 400, remaining: 600, cash: 400 });
    expect(await row("payables", "pay-1")).toMatchObject({ status: "paga_parcial", paid_amount: 400, paid_at: null });

    const second = await settleEntry(db, companyId, { kind: "payable", id: "pay-1", amount: 600, interest: 10, fine: 5, paidAt: "2026-10-20", bankAccountId: "bank-1", userId: USER });
    expect(second).toMatchObject({ status: "paga", paid: 1000, remaining: 0, cash: 615 });
    expect(await row("payables", "pay-1")).toMatchObject({ status: "paga", paid_amount: 1000, paid_at: "2026-10-20" });

    const settlements = await listSettlements(db, companyId, "payable", "pay-1");
    expect(settlements.map((item) => [item.amount, item.paid_at, item.interest, item.fine])).toEqual([
      [400, "2026-10-10", 0, 0],
      [600, "2026-10-20", 10, 5],
    ]);
    expect(settlements.map(settlementCash)).toEqual([400, 615]);
    expect(settlements[0]).toMatchObject({ bank_account_id: "bank-1", payment_method: "pix", created_by: USER, receivable_id: null });
  });

  it("conta a receber recebida por inteiro grava received_amount e received_at", async () => {
    const result = await settleEntry(db, companyId, { kind: "receivable", id: "rec-1", amount: 300, paidAt: "2026-10-19", bankAccountId: "bank-1" });
    expect(result).toMatchObject({ status: "recebida", paid: 300, remaining: 0 });
    expect(await row("receivables", "rec-1")).toMatchObject({ status: "recebida", received_amount: 300, received_at: "2026-10-19" });
  });

  it("desconto baixa o principal inteiro e o caixa sai menor", async () => {
    const result = await settleEntry(db, companyId, { kind: "payable", id: "pay-1", amount: 1000, discount: 50, paidAt: "2026-10-12" });
    expect(result).toMatchObject({ status: "paga", cash: 950 });
  });

  it("três baixas de centavos quebrados quitam exatamente (sem erro de ponto flutuante)", async () => {
    await settleEntry(db, companyId, { kind: "payable", id: "pay-1", amount: 333.33, paidAt: "2026-10-01" });
    await settleEntry(db, companyId, { kind: "payable", id: "pay-1", amount: 333.33, paidAt: "2026-10-02" });
    const last = await settleEntry(db, companyId, { kind: "payable", id: "pay-1", amount: 333.34, paidAt: "2026-10-03" });
    expect(last).toMatchObject({ status: "paga", paid: 1000, remaining: 0 });
  });

  it("recusa valor acima do saldo, zero, negativo, data inválida, conta cancelada, quitada ou excluída", async () => {
    await expect(settleEntry(db, companyId, { kind: "payable", id: "pay-1", amount: 1000.01, paidAt: "2026-10-10" })).rejects.toThrow(/saldo em aberto/);
    await expect(settleEntry(db, companyId, { kind: "payable", id: "pay-1", amount: 0, paidAt: "2026-10-10" })).rejects.toThrow(/maior que zero/);
    await expect(settleEntry(db, companyId, { kind: "payable", id: "pay-1", amount: -5, paidAt: "2026-10-10" })).rejects.toThrow(/maior que zero/);
    await expect(settleEntry(db, companyId, { kind: "payable", id: "pay-1", amount: 10, paidAt: "10/10/2026" })).rejects.toThrow(/Data/);
    await expect(settleEntry(db, companyId, { kind: "payable", id: "pay-1", amount: 10, discount: 20, paidAt: "2026-10-10" })).rejects.toThrow(/desconto/i);

    await cancelEntry(db, companyId, "receivable", "rec-1");
    await expect(settleEntry(db, companyId, { kind: "receivable", id: "rec-1", amount: 10, paidAt: "2026-10-10" })).rejects.toThrow(/cancelada/);

    await settleEntry(db, companyId, { kind: "payable", id: "pay-1", amount: 1000, paidAt: "2026-10-10" });
    await expect(settleEntry(db, companyId, { kind: "payable", id: "pay-1", amount: 1, paidAt: "2026-10-10" })).rejects.toThrow(/quitada/);

    await expect(settleEntry(db, companyId, { kind: "payable", id: "nao-existe", amount: 1, paidAt: "2026-10-10" })).rejects.toThrow(/não encontrada/);
    expect(await listSettlements(db, companyId, "payable", "pay-1")).toHaveLength(1);
  });

  it("outra empresa não baixa a conta", async () => {
    await insertTestCompany(db, { companyId: "outra", roles: [] });
    await expect(settleEntry(db, "outra", { kind: "payable", id: "pay-1", amount: 10, paidAt: "2026-10-10" })).rejects.toThrow(/não encontrada/);
  });
});

describe("reverseSettlement", () => {
  it("estorno devolve o saldo, volta ao status anterior (aprovada) e marca a baixa como excluída", async () => {
    await approvePayable(db, companyId, "pay-1", USER);
    const { settlementId } = await settleEntry(db, companyId, { kind: "payable", id: "pay-1", amount: 400, paidAt: "2026-10-10" });
    await reverseSettlement(db, companyId, settlementId);
    expect(await row("payables", "pay-1")).toMatchObject({ status: "aprovada", paid_amount: 0, approver_id: USER });
    expect((await row("finance_settlements", settlementId)).deleted_at).toBeTruthy();
    expect(await listSettlements(db, companyId, "payable", "pay-1")).toEqual([]);
    await expect(reverseSettlement(db, companyId, settlementId)).rejects.toThrow(/não encontrada/);
  });

  it("estornar uma de duas baixas deixa a conta paga em parte", async () => {
    await settleEntry(db, companyId, { kind: "receivable", id: "rec-1", amount: 100, paidAt: "2026-10-10" });
    const { settlementId } = await settleEntry(db, companyId, { kind: "receivable", id: "rec-1", amount: 200, paidAt: "2026-10-11" });
    await reverseSettlement(db, companyId, settlementId);
    expect(await row("receivables", "rec-1")).toMatchObject({ status: "recebida_parcial", received_amount: 100, received_at: null });
  });

  it("estorno de baixa conciliada devolve o lançamento do extrato para pendente", async () => {
    await db.execute("INSERT INTO bank_transactions (id, company_id, bank_account_id, posted_at, amount, status, payable_id, reconciled_at, reconciled_by) VALUES (?,?,?,?,?,?,?,?,?)", ["tx-1", companyId, "bank-1", "2026-10-10", -1000, "conciliada", "pay-1", "2026-10-10T12:00:00Z", USER]);
    const { settlementId } = await settleEntry(db, companyId, { kind: "payable", id: "pay-1", amount: 1000, paidAt: "2026-10-10", bankTransactionId: "tx-1" });
    await reverseSettlement(db, companyId, settlementId);
    expect(await row("bank_transactions", "tx-1")).toMatchObject({ status: "pendente", payable_id: null, receivable_id: null, reconciled_at: null, reconciled_by: null });
    expect(await row("payables", "pay-1")).toMatchObject({ status: "aberta", paid_amount: 0, paid_at: null });
  });
});

describe("aprovar, cancelar e excluir", () => {
  it("aprova conta a pagar em aberto e recusa aprovar conta paga", async () => {
    await approvePayable(db, companyId, "pay-1", USER);
    expect(await row("payables", "pay-1")).toMatchObject({ status: "aprovada", approver_id: USER });
    await settleEntry(db, companyId, { kind: "payable", id: "pay-1", amount: 1000, paidAt: "2026-10-10" });
    await expect(approvePayable(db, companyId, "pay-1", USER)).rejects.toThrow(/em aberto/);
  });

  it("cancelar e excluir exigem estornar as baixas antes; excluir é soft delete", async () => {
    const { settlementId } = await settleEntry(db, companyId, { kind: "payable", id: "pay-1", amount: 100, paidAt: "2026-10-10" });
    await expect(cancelEntry(db, companyId, "payable", "pay-1")).rejects.toThrow(/Estorne/);
    await expect(deleteEntry(db, companyId, "payable", "pay-1")).rejects.toThrow(/Estorne/);
    await reverseSettlement(db, companyId, settlementId);
    await cancelEntry(db, companyId, "payable", "pay-1");
    expect(await row("payables", "pay-1")).toMatchObject({ status: "cancelada" });
    await deleteEntry(db, companyId, "payable", "pay-1");
    expect((await row("payables", "pay-1")).deleted_at).toBeTruthy();
    await expect(deleteEntry(db, companyId, "payable", "pay-1")).rejects.toThrow(/não encontrada/);
  });
});
