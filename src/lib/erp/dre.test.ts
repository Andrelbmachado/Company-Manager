// DRE por competência com massa fixa: linhas do plano de contas (dre_group, herdado do pai), contas sem categoria,
// juros/multa/desconto das baixas e tarifas/rendimentos conciliados direto no extrato.
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, insertTestCompany, type TestDb } from "@/test/sqlite";
import { addBankAccount, addBankTransaction, addCategory, addPayable, addReceivable, addSettlement } from "@/test/financeFixtures";
import { dre, dreMonths } from "./dre";

let db: TestDb;
let companyId: string;

beforeEach(async () => {
  db = await createTestDb();
  ({ companyId } = await insertTestCompany(db, { roles: ["financeiro"] }));
  await addBankAccount(db, companyId, { id: "A" });
  await addCategory(db, companyId, { id: "c-1", code: "1", name: "Receitas", kind: "receita", dre_group: "receita" });
  await addCategory(db, companyId, { id: "c-1-1", code: "1.1", name: "Vendas", kind: "receita", dre_group: "receita", parent_id: "c-1" });
  await addCategory(db, companyId, { id: "c-2-1", code: "2.1", name: "Impostos", kind: "despesa", dre_group: "deducao" });
  await addCategory(db, companyId, { id: "c-3-1", code: "3.1", name: "CMV", kind: "despesa", dre_group: "custo" });
  await addCategory(db, companyId, { id: "c-4-1", code: "4.1", name: "Aluguel", kind: "despesa", dre_group: "despesa" });
  await addCategory(db, companyId, { id: "c-5", code: "5", name: "Financeiro", kind: "despesa", dre_group: "financeiro" });
  await addCategory(db, companyId, { id: "c-5-1", code: "5.1", name: "Tarifas", kind: "despesa", parent_id: "c-5" });
  await addCategory(db, companyId, { id: "c-5-2", code: "5.2", name: "Rendimentos", kind: "receita", parent_id: "c-5" });

  await addReceivable(db, companyId, { id: "r-venda", amount: 10000, competence: "2026-10", category_id: "c-1-1", due_date: "2026-11-10" });
  await addReceivable(db, companyId, { id: "r-sem-cat", amount: 2000, issue_date: "2026-10-03" });
  await addReceivable(db, companyId, { id: "r-setembro", amount: 5000, competence: "2026-09", category_id: "c-1-1" });
  await addReceivable(db, companyId, { id: "r-cancelada", amount: 999, competence: "2026-10", status: "cancelada" });
  await addReceivable(db, companyId, { id: "r-excluida", amount: 888, competence: "2026-10", deleted_at: "2026-10-05T00:00:00Z" });
  await addPayable(db, companyId, { id: "p-imposto", amount: 900, competence: "2026-10", category_id: "c-2-1" });
  await addPayable(db, companyId, { id: "p-cmv", amount: 3000, due_date: "2026-10-15", category_id: "c-3-1" });
  await addPayable(db, companyId, { id: "p-aluguel", amount: 2500, competence: "2026-10", category_id: "c-4-1", status: "paga", paid_amount: 2500 });
  await addPayable(db, companyId, { id: "p-sem-cat", amount: 400, competence: "2026-10" });

  await addSettlement(db, companyId, { id: "s-aluguel", payable_id: "p-aluguel", amount: 2500, interest: 12.5, fine: 2.5, paid_at: "2026-10-10", bank_account_id: "A" });
  await addSettlement(db, companyId, { id: "s-venda", receivable_id: "r-venda", amount: 10000, discount: 20, paid_at: "2026-10-11", bank_account_id: "A" });
  await addSettlement(db, companyId, { id: "s-estornada", receivable_id: "r-venda", amount: 1, interest: 500, paid_at: "2026-10-11", deleted_at: "2026-10-12T00:00:00Z" });

  await addBankTransaction(db, companyId, { id: "t-tarifa", bank_account_id: "A", posted_at: "2026-10-02", amount: -30, status: "conciliada", category_id: "c-5-1" });
  await addBankTransaction(db, companyId, { id: "t-rend", bank_account_id: "A", posted_at: "2026-10-05", amount: 42.17, status: "conciliada", category_id: "c-5-2" });
  await addBankTransaction(db, companyId, { id: "t-pendente", bank_account_id: "A", posted_at: "2026-10-06", amount: -99, status: "pendente", category_id: "c-5-1" });
  await addBankTransaction(db, companyId, { id: "t-ligada", bank_account_id: "A", posted_at: "2026-10-10", amount: -2515, status: "conciliada", payable_id: "p-aluguel" });
});

describe("dre", () => {
  it("bate os valores esperados do mês", async () => {
    const result = await dre(db, companyId, "2026-10");
    expect(result).toMatchObject({
      month: "2026-10",
      receita: 12000,
      deducoes: 900,
      receitaLiquida: 11100,
      custos: 3000,
      lucroBruto: 8100,
      despesas: 2900,
      resultadoOperacional: 5200,
      financeiro: -22.83,
      outros: 0,
      resultado: 5177.17,
    });
  });

  it("detalha por categoria (sem categoria em linha própria; filhas herdam a linha do pai)", async () => {
    const { linhas } = await dre(db, companyId, "2026-10");
    const value = (group: string, name: string) => linhas.find((line) => line.group === group && line.name === name)?.value;
    expect(value("receita", "Vendas")).toBe(10000);
    expect(value("receita", "Sem categoria")).toBe(2000);
    expect(value("deducao", "Impostos")).toBe(-900);
    expect(value("custo", "CMV")).toBe(-3000);
    expect(value("despesa", "Aluguel")).toBe(-2500);
    expect(value("despesa", "Sem categoria")).toBe(-400);
    expect(value("financeiro", "Tarifas")).toBe(-30);
    expect(value("financeiro", "Rendimentos")).toBe(42.17);
    expect(value("financeiro", "Juros e multas pagos")).toBe(-15);
    expect(value("financeiro", "Descontos concedidos")).toBe(-20);
  });

  it("outro mês e vários meses de uma vez", async () => {
    expect(await dre(db, companyId, "2026-09")).toMatchObject({ receita: 5000, resultado: 5000 });
    const months = await dreMonths(db, companyId, ["2026-09", "2026-10", "2026-11"]);
    expect(months.map((item) => [item.month, item.resultado])).toEqual([
      ["2026-09", 5000],
      ["2026-10", 5177.17],
      ["2026-11", 0],
    ]);
  });

  it("recusa mês inválido", async () => {
    await expect(dre(db, companyId, "2026-13")).rejects.toThrow(/Mês inválido/);
  });
});
