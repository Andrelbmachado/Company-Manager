// Fluxo de caixa com massa fixa: saldo inicial das contas, baixas (realizado), contas em aberto (previsto),
// extrato conciliado sem conta ligada (tarifas) e contas antigas quitadas sem baixa registrada.
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, insertTestCompany, type TestDb } from "@/test/sqlite";
import { addBankAccount, addBankTransaction, addCategory, addPayable, addReceivable, addSettlement } from "@/test/financeFixtures";
import { accountBalances, cashEvents, cashflow } from "./cashflow";

let db: TestDb;
let companyId: string;
const TODAY = "2026-10-10";

beforeEach(async () => {
  db = await createTestDb();
  ({ companyId } = await insertTestCompany(db, { roles: ["financeiro"] }));
  await addBankAccount(db, companyId, { id: "A", opening_balance: 1000, opening_date: "2026-01-01", is_default: 1 });
  await addBankAccount(db, companyId, { id: "B", opening_balance: 500 });
  await addCategory(db, companyId, { id: "cat-tarifa", name: "Tarifas", kind: "despesa", dre_group: "financeiro" });

  // Realizado
  await addReceivable(db, companyId, { id: "R1", amount: 1000, due_date: "2026-10-05", status: "recebida", received_amount: 1000, received_at: "2026-10-05" });
  await addSettlement(db, companyId, { id: "S-R1", receivable_id: "R1", amount: 1000, paid_at: "2026-10-05", bank_account_id: "A" });
  await addBankTransaction(db, companyId, { id: "T-R1", bank_account_id: "A", posted_at: "2026-10-05", amount: 1000, status: "conciliada", receivable_id: "R1" });
  await db.execute("UPDATE finance_settlements SET bank_transaction_id = ? WHERE id = ?", ["T-R1", "S-R1"]);
  await addPayable(db, companyId, { id: "P1", amount: 400, due_date: "2026-09-20", status: "paga", paid_amount: 400, paid_at: "2026-09-20" });
  await addSettlement(db, companyId, { id: "S-P1", payable_id: "P1", amount: 400, paid_at: "2026-09-20", bank_account_id: "A" });
  await addPayable(db, companyId, { id: "P2", amount: 300, due_date: "2026-10-15", status: "paga_parcial", paid_amount: 100 });
  await addSettlement(db, companyId, { id: "S-P2", payable_id: "P2", amount: 100, interest: 2, paid_at: "2026-10-08", bank_account_id: "A" });
  await addBankTransaction(db, companyId, { id: "T-tarifa", bank_account_id: "A", posted_at: "2026-10-03", amount: -30, status: "conciliada", category_id: "cat-tarifa" });
  await addBankTransaction(db, companyId, { id: "T-pendente", bank_account_id: "A", posted_at: "2026-10-04", amount: -99, status: "pendente" });
  await addBankTransaction(db, companyId, { id: "T-ignorada", bank_account_id: "A", posted_at: "2026-10-04", amount: -5000, status: "ignorada" });
  // Conta antiga quitada pela tela legada: sem baixa em finance_settlements.
  await addPayable(db, companyId, { id: "P6", amount: 120, due_date: "2026-10-01", status: "paga", paid_amount: 120, paid_at: "2026-10-02" });

  // Previsto
  await addReceivable(db, companyId, { id: "R2", amount: 750, due_date: "2026-10-20" });
  await addReceivable(db, companyId, { id: "R3", amount: 50, due_date: "2026-10-01" }); // vencida: entra hoje
  await addPayable(db, companyId, { id: "P3", amount: 999, due_date: "2026-10-12", status: "cancelada" });
  await addPayable(db, companyId, { id: "P4", amount: 777, due_date: "2026-10-12", deleted_at: "2026-10-01T00:00:00Z" });
  await addPayable(db, companyId, { id: "P5", amount: 80, due_date: "2026-11-05" });
});

describe("cashflow", () => {
  it("dia a dia: saldo inicial, entradas e saídas realizadas e previstas, saldo acumulado", async () => {
    const days = await cashflow(db, companyId, "2026-10-01", "2026-10-31", { today: TODAY });
    expect(days).toHaveLength(31);
    expect(days[0].date).toBe("2026-10-01");
    expect(days[30].date).toBe("2026-10-31");

    const pick = (date: string) => days.find((day) => day.date === date)!;
    expect(pick("2026-10-01")).toMatchObject({ in: 0, out: 0, balance: 1100 });
    expect(pick("2026-10-02")).toMatchObject({ in: 0, out: 120, outRealized: 120, balance: 980 });
    expect(pick("2026-10-03")).toMatchObject({ out: 30, balance: 950 });
    expect(pick("2026-10-04")).toMatchObject({ in: 0, out: 0, balance: 950 });
    expect(pick("2026-10-05")).toMatchObject({ in: 1000, inRealized: 1000, balance: 1950 });
    expect(pick("2026-10-08")).toMatchObject({ out: 102, balance: 1848 });
    expect(pick("2026-10-10")).toMatchObject({ in: 50, inForecast: 50, inRealized: 0, balance: 1898 });
    expect(pick("2026-10-12")).toMatchObject({ out: 0 });
    expect(pick("2026-10-15")).toMatchObject({ out: 200, outForecast: 200, balance: 1698 });
    expect(pick("2026-10-20")).toMatchObject({ in: 750, balance: 2448 });
    expect(pick("2026-10-31").balance).toBe(2448);

    const total = (key: "in" | "out") => Math.round(days.reduce((sum, day) => sum + day[key], 0) * 100) / 100;
    expect(total("in")).toBe(1800);
    expect(total("out")).toBe(452);
  });

  it("só realizado: sem previsão", async () => {
    const days = await cashflow(db, companyId, "2026-10-01", "2026-10-31", { today: TODAY, includeForecast: false });
    expect(days[30].balance).toBe(1848);
    expect(days.every((day) => day.inForecast === 0 && day.outForecast === 0)).toBe(true);
  });

  it("período futuro: o que vence antes do período entra no saldo inicial", async () => {
    const days = await cashflow(db, companyId, "2026-11-01", "2026-11-30", { today: TODAY });
    expect(days[0].balance).toBe(2448);
    expect(days.find((day) => day.date === "2026-11-05")).toMatchObject({ out: 80, balance: 2368 });
  });

  it("por conta bancária: só o saldo inicial e os movimentos daquela conta", async () => {
    await db.execute("UPDATE receivables SET bank_account_id = ? WHERE id = ?", ["B", "R2"]);
    const days = await cashflow(db, companyId, "2026-10-01", "2026-10-31", { today: TODAY, bankAccountId: "B" });
    expect(days[0].balance).toBe(500);
    expect(days[30].balance).toBe(1250);
  });

  it("saldo inicial da conta vale a partir da data de abertura; movimento anterior já está nele", async () => {
    await addBankAccount(db, companyId, { id: "C", opening_balance: 200, opening_date: "2026-10-06" });
    await addReceivable(db, companyId, { id: "R9", amount: 70, status: "recebida", received_amount: 70 });
    await addSettlement(db, companyId, { id: "S-R9", receivable_id: "R9", amount: 70, paid_at: "2026-10-04", bank_account_id: "C" });
    const days = await cashflow(db, companyId, "2026-10-01", "2026-10-10", { today: TODAY, bankAccountId: "C" });
    expect(days.find((day) => day.date === "2026-10-05")?.balance).toBe(0);
    expect(days.find((day) => day.date === "2026-10-06")).toMatchObject({ in: 0, balance: 200 });
  });

  it("recusa período invertido ou data inválida", async () => {
    await expect(cashflow(db, companyId, "2026-10-31", "2026-10-01")).rejects.toThrow(/período/i);
    await expect(cashflow(db, companyId, "2026-13-01", "2026-12-01")).rejects.toThrow(/inválida/);
  });
});

describe("cashEvents e accountBalances", () => {
  it("lista os movimentos com origem e não conta duas vezes o extrato conciliado com baixa", async () => {
    const events = await cashEvents(db, companyId, { today: TODAY });
    expect(events.filter((event) => event.date === "2026-10-05")).toEqual([
      expect.objectContaining({ amount: 1000, kind: "realized", source: "settlement", refId: "R1", bankAccountId: "A" }),
    ]);
    expect(events.find((event) => event.source === "bank")).toMatchObject({ amount: -30, refId: "T-tarifa", date: "2026-10-03" });
    expect(events.find((event) => event.source === "legacy")).toMatchObject({ amount: -120, refId: "P6", date: "2026-10-02" });
    expect(events.filter((event) => event.kind === "forecast").map((event) => [event.refId, event.date, event.amount])).toEqual([
      ["R3", "2026-10-10", 50],
      ["P2", "2026-10-15", -200],
      ["R2", "2026-10-20", 750],
      ["P5", "2026-11-05", -80],
    ]);
  });

  it("saldo de cada conta até a data (realizado)", async () => {
    const balances = await accountBalances(db, companyId, TODAY);
    expect(balances.map((item) => [item.accountId, item.balance])).toEqual([
      ["A", 1000 - 400 - 30 + 1000 - 102],
      ["B", 500],
    ]);
    expect((await accountBalances(db, companyId, "2026-10-04")).find((item) => item.accountId === "A")?.balance).toBe(570);
  });
});
