// Números financeiros do Dashboard com massa fixa em SQLite real: resultado do mês (recebido − pago), contas a pagar e
// a receber da semana (de hoje até domingo), trabalhos ativos conforme a área da empresa e o balanço anual com previsão.
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, insertTestCompany, type TestDb } from "@/test/sqlite";
import { addBankAccount, addBankTransaction, addCategory, addPayable, addReceivable, addRecurring, addSettlement, insertRow } from "@/test/financeFixtures";
import { setCompanySetting } from "@/lib/settings/companySettings";
import { AREA_PROFILE_SETTING } from "@/lib/labels/store";
import { runRecurring } from "@/lib/erp/recurring";
import { activeWorkCount, annualBalance, loadDashboardOverview, monthResult, weekPayables, weekRange, weekReceivables } from "./finance";

let db: TestDb;
let companyId: string;
// Quarta-feira: a semana do Dashboard vai de hoje até domingo, 25/10/2026.
const TODAY = "2026-10-21";

beforeEach(async () => {
  db = await createTestDb();
  ({ companyId } = await insertTestCompany(db, { roles: ["ceo"] }));
});

describe("weekRange", () => {
  it("de hoje até o domingo da semana; no domingo, só o próprio dia", () => {
    expect(weekRange("2026-10-21")).toEqual({ from: "2026-10-21", to: "2026-10-25" });
    expect(weekRange("2026-10-19")).toEqual({ from: "2026-10-19", to: "2026-10-25" });
    expect(weekRange("2026-10-24")).toEqual({ from: "2026-10-24", to: "2026-10-25" });
    expect(weekRange("2026-10-25")).toEqual({ from: "2026-10-25", to: "2026-10-25" });
    expect(weekRange("2026-12-28")).toEqual({ from: "2026-12-28", to: "2027-01-03" });
  });

  it("data inválida é recusada com mensagem legível", () => {
    expect(() => weekRange("21/10/2026")).toThrow(/AAAA-MM-DD/);
  });
});

describe("monthResult", () => {
  beforeEach(async () => {
    await addBankAccount(db, companyId, { id: "banco", is_default: 1 });
    // Recebido em março: R$ 6.000 por baixa e R$ 4.000 de conta antiga quitada sem baixa registrada = R$ 10.000.
    await addReceivable(db, companyId, { id: "R-A", amount: 6000, due_date: "2026-03-10", status: "recebida", received_amount: 6000, received_at: "2026-03-10" });
    await addSettlement(db, companyId, { id: "S-RA", receivable_id: "R-A", amount: 6000, paid_at: "2026-03-10", bank_account_id: "banco" });
    await addReceivable(db, companyId, { id: "R-B", amount: 4000, due_date: "2026-03-20", status: "recebida", received_amount: 4000, received_at: "2026-03-20" });
    // Pago em março: R$ 12.000 por baixa e R$ 500 de conta antiga quitada = R$ 12.500.
    await addPayable(db, companyId, { id: "P-A", amount: 12000, due_date: "2026-03-15", status: "paga", paid_amount: 12000, paid_at: "2026-03-15" });
    await addSettlement(db, companyId, { id: "S-PA", payable_id: "P-A", amount: 12000, paid_at: "2026-03-15", bank_account_id: "banco" });
    await addPayable(db, companyId, { id: "P-B", amount: 500, due_date: "2026-03-05", status: "paga", paid_amount: 500, paid_at: "2026-03-05" });
    // Fora do resultado de março: baixa de fevereiro, conta em aberto com vencimento em março, cancelada e excluída.
    await addReceivable(db, companyId, { id: "R-fev", amount: 700, due_date: "2026-02-27", status: "recebida", received_amount: 700, received_at: "2026-02-27" });
    await addReceivable(db, companyId, { id: "R-aberta", amount: 900, due_date: "2026-03-25" });
    await addPayable(db, companyId, { id: "P-cancelada", amount: 300, due_date: "2026-03-12", status: "cancelada" });
    await addPayable(db, companyId, { id: "P-excluida", amount: 450, due_date: "2026-03-12", status: "paga", paid_amount: 450, paid_at: "2026-03-12", deleted_at: "2026-03-13T00:00:00Z" });
  });

  it("R$ 10.000 recebidos e R$ 12.500 pagos no mês: resultado −2.500 (dívida)", async () => {
    const result = await monthResult(db, companyId, "2026-03");
    expect(result).toEqual({ month: "2026-03", income: 10000, expense: 12500, result: -2500 });
  });

  it("mês com mais recebido que pago dá lucro (positivo)", async () => {
    expect((await monthResult(db, companyId, "2026-02")).result).toBe(700);
    expect((await monthResult(db, companyId, "2026-04")).result).toBe(0);
  });

  it("baixa com juros, multa e desconto conta o dinheiro que saiu; extrato conciliado direto numa categoria também", async () => {
    await addCategory(db, companyId, { id: "tarifas", name: "Tarifas", kind: "despesa" });
    await addPayable(db, companyId, { id: "P-juros", amount: 100, due_date: "2026-05-02", status: "paga", paid_amount: 100, paid_at: "2026-05-10" });
    await addSettlement(db, companyId, { id: "S-juros", payable_id: "P-juros", amount: 100, interest: 3, fine: 2, discount: 1, paid_at: "2026-05-10", bank_account_id: "banco" });
    await addBankTransaction(db, companyId, { id: "T-tarifa", bank_account_id: "banco", posted_at: "2026-05-11", amount: -12.5, status: "conciliada", category_id: "tarifas" });
    await addBankTransaction(db, companyId, { id: "T-pendente", bank_account_id: "banco", posted_at: "2026-05-11", amount: -999, status: "pendente" });
    expect(await monthResult(db, companyId, "2026-05")).toEqual({ month: "2026-05", income: 0, expense: 116.5, result: -116.5 });
  });

  it("mês inválido é recusado", async () => {
    await expect(monthResult(db, companyId, "2026-13")).rejects.toThrow(/AAAA-MM/);
  });
});

describe("weekPayables / weekReceivables", () => {
  it("2 recebíveis abertos na semana (R$ 300 + R$ 200) = R$ 500; recebido, vencido, cancelado, excluído e próxima semana ficam fora", async () => {
    await addReceivable(db, companyId, { id: "hoje", amount: 300, due_date: "2026-10-21" });
    await addReceivable(db, companyId, { id: "domingo", amount: 200, due_date: "2026-10-25" });
    await addReceivable(db, companyId, { id: "recebida", amount: 700, due_date: "2026-10-23", status: "recebida", received_amount: 700, received_at: "2026-10-20" });
    await addReceivable(db, companyId, { id: "vencida", amount: 50, due_date: "2026-10-20" });
    await addReceivable(db, companyId, { id: "segunda", amount: 999, due_date: "2026-10-26" });
    await addReceivable(db, companyId, { id: "cancelada", amount: 80, due_date: "2026-10-22", status: "cancelada" });
    await addReceivable(db, companyId, { id: "excluida", amount: 60, due_date: "2026-10-22", deleted_at: "2026-10-01T00:00:00Z" });
    await addReceivable(db, companyId, { id: "sem-vencimento", amount: 40 });

    expect(await weekReceivables(db, companyId, TODAY)).toEqual({ from: "2026-10-21", to: "2026-10-25", total: 500, count: 2 });
    expect(await weekPayables(db, companyId, TODAY)).toEqual({ from: "2026-10-21", to: "2026-10-25", total: 0, count: 0 });
  });

  it("conta paga em parte entra só com o saldo em aberto; a pagar e a receber não se misturam", async () => {
    await addPayable(db, companyId, { id: "aluguel", amount: 1000, due_date: "2026-10-24", status: "paga_parcial", paid_amount: 600 });
    await addPayable(db, companyId, { id: "luz", amount: 230.45, due_date: "2026-10-22", status: "aprovada" });
    await addPayable(db, companyId, { id: "paga", amount: 90, due_date: "2026-10-22", status: "paga", paid_amount: 90, paid_at: "2026-10-21" });
    await addReceivable(db, companyId, { id: "fatura", amount: 1000, due_date: "2026-10-23", status: "recebida_parcial", received_amount: 250 });

    expect(await weekPayables(db, companyId, TODAY)).toMatchObject({ total: 630.45, count: 2 });
    expect(await weekReceivables(db, companyId, TODAY)).toMatchObject({ total: 750, count: 1 });
  });

  it("no domingo a semana é só o próprio dia", async () => {
    await addPayable(db, companyId, { id: "domingo", amount: 10, due_date: "2026-10-25" });
    await addPayable(db, companyId, { id: "segunda", amount: 20, due_date: "2026-10-26" });
    expect(await weekPayables(db, companyId, "2026-10-25")).toEqual({ from: "2026-10-25", to: "2026-10-25", total: 10, count: 1 });
  });
});

describe("activeWorkCount", () => {
  async function addProject(id: string, status: string, extra: Record<string, string | null> = {}) {
    await insertRow(db, "projects", { id, company_id: companyId, name: `Projeto ${id}`, status, ...extra });
  }

  beforeEach(async () => {
    for (const id of ["c1", "c2", "c3", "c-excluido"]) {
      await insertRow(db, "customers", { id, company_id: companyId, name: `Cliente ${id}`, deleted_at: id === "c-excluido" ? "2026-01-01T00:00:00Z" : null });
    }
    await addProject("p1", "planejado", { customer_id: "c1" });
    await addProject("p2", "andamento", { customer_id: "c1" });
    await addProject("p3", "andamento", { customer_id: "c2" });
    await addProject("p4", "andamento");
    await addProject("p5", "pausado", { customer_id: "c3" });
    await addProject("p6", "concluido", { customer_id: "c3" });
    await addProject("p7", "cancelado", { customer_id: "c3" });
    await addProject("p8", "andamento", { customer_id: "c3", deleted_at: "2026-01-01T00:00:00Z" });
    await addProject("p9", "andamento", { customer_id: "c-excluido" });
  });

  it("TI (padrão): projetos planejados ou em andamento (pausado, concluído, cancelado e excluído ficam fora)", async () => {
    expect(await activeWorkCount(db, companyId)).toBe(5);
  });

  it("advocacia: clientes com processo/caso ativo, cada cliente uma vez (projeto sem cliente ou de cliente excluído não conta)", async () => {
    await setCompanySetting(db, companyId, AREA_PROFILE_SETTING, "advocacia");
    expect(await activeWorkCount(db, companyId)).toBe(2);
    // O perfil também pode vir de quem chama (a tela já leu os rótulos).
    expect(await activeWorkCount(db, companyId, "ti")).toBe(5);
  });
});

describe("annualBalance", () => {
  beforeEach(async () => {
    await addBankAccount(db, companyId, { id: "banco", is_default: 1 });
    // Realizado: jan +1.000, fev −400, mar +250 − 50 de tarifa, out +2.000.
    await addReceivable(db, companyId, { id: "R-jan", amount: 1000, due_date: "2026-01-10", status: "recebida", received_amount: 1000, received_at: "2026-01-10" });
    await addSettlement(db, companyId, { id: "S-jan", receivable_id: "R-jan", amount: 1000, paid_at: "2026-01-10", bank_account_id: "banco" });
    await addPayable(db, companyId, { id: "P-fev", amount: 400, due_date: "2026-02-10", status: "paga", paid_amount: 400, paid_at: "2026-02-11" });
    await addReceivable(db, companyId, { id: "R-mar", amount: 250, due_date: "2026-03-10", status: "recebida", received_amount: 250, received_at: "2026-03-12" });
    await addBankTransaction(db, companyId, { id: "T-mar", bank_account_id: "banco", posted_at: "2026-03-31", amount: -50, status: "conciliada" });
    await addReceivable(db, companyId, { id: "R-out", amount: 2000, due_date: "2026-10-05", status: "recebida", received_amount: 2000, received_at: "2026-10-05" });
    await addSettlement(db, companyId, { id: "S-out", receivable_id: "R-out", amount: 2000, paid_at: "2026-10-05", bank_account_id: "banco" });
    // Ano passado não entra no balanço de 2026.
    await addReceivable(db, companyId, { id: "R-2025", amount: 333, due_date: "2025-12-20", status: "recebida", received_amount: 333, received_at: "2025-12-20" });

    // Em aberto: out +400 (vence 28/10), vencida de setembro +50 (conta como esperada agora, em outubro), out −150, nov +900.
    await addReceivable(db, companyId, { id: "R-out-aberta", amount: 400, due_date: "2026-10-28" });
    await addReceivable(db, companyId, { id: "R-set-vencida", amount: 50, due_date: "2026-09-01" });
    await addPayable(db, companyId, { id: "P-out-aberta", amount: 150, due_date: "2026-10-30", status: "aprovada" });
    await addReceivable(db, companyId, { id: "R-nov", amount: 900, due_date: "2026-11-10" });

    // Recorrências ainda não lançadas: aluguel −100/mês já gerado até outubro; mensalidade +300/mês (dia 15) desde
    // setembro, nunca gerada (começa no mês de hoje, como o runRecurring); pausada e excluída não entram.
    await addRecurring(db, companyId, { id: "aluguel", amount: 100, day_of_month: 5, start_date: "2026-01-01", last_competence: "2026-10" });
    await addRecurring(db, companyId, { id: "mensalidade", kind: "receber", amount: 300, day_of_month: 15, start_date: "2026-09-01" });
    await addRecurring(db, companyId, { id: "pausada", amount: 5000, start_date: "2026-01-01", active: 0 });
    await addRecurring(db, companyId, { id: "excluida", amount: 7000, start_date: "2026-01-01", deleted_at: "2026-01-02T00:00:00Z" });
  });

  it("12 meses; acumulado de março = soma de jan–mar; meses futuros sem realizado e com previsto", async () => {
    const points = await annualBalance(db, companyId, 2026, { today: TODAY });
    expect(points).toHaveLength(12);
    expect(points.map((point) => point.month)).toEqual(Array.from({ length: 12 }, (_, index) => `2026-${String(index + 1).padStart(2, "0")}`));

    const [jan, fev, mar] = points;
    expect([jan.realizado, fev.realizado, mar.realizado]).toEqual([1000, -400, 200]);
    expect(mar.acumulado).toBe(1000 - 400 + 200);
    expect(points[8]).toMatchObject({ month: "2026-09", realizado: 0, acumulado: 800, previsto: 0 });

    // Outubro (mês de hoje): realizado até agora; previsto = realizado + em aberto do mês (inclusive a vencida) + recorrência.
    expect(points[9]).toEqual({ month: "2026-10", realizado: 2000, acumulado: 2800, previsto: 2000 + 400 + 50 - 150 + 300 });
    // Novembro e dezembro: sem realizado nem acumulado; previsto = aberto + recorrências do mês.
    expect(points[10]).toEqual({ month: "2026-11", realizado: null, acumulado: null, previsto: 900 - 100 + 300 });
    expect(points[11]).toEqual({ month: "2026-12", realizado: null, acumulado: null, previsto: -100 + 300 });
    // Mês passado: a previsão é o próprio realizado (linha tracejada continua a realizada).
    expect(points.slice(0, 9).every((point) => point.previsto === point.realizado)).toBe(true);
  });

  it("competência já lançada (mesmo excluída) não entra de novo na previsão; recorrência encerrada para no fim", async () => {
    await insertRow(db, "receivables", {
      id: "mensalidade-nov",
      company_id: companyId,
      description: "Mensalidade (11/2026)",
      amount: 300,
      due_date: "2026-11-15",
      status: "aberta",
      competence: "2026-11",
      recurring_entry_id: "mensalidade",
      deleted_at: "2026-10-20T00:00:00Z",
    });
    await addRecurring(db, companyId, { id: "contrato", amount: 1000, day_of_month: 1, start_date: "2026-01-01", last_competence: "2026-10", end_date: "2026-11-30" });
    const points = await annualBalance(db, companyId, 2026, { today: TODAY });
    expect(points[10].previsto).toBe(900 - 100 - 1000);
    expect(points[11].previsto).toBe(-100 + 300);
  });

  it("ano que já passou: tudo realizado, previsto = realizado; ano futuro: só previsão", async () => {
    const past = await annualBalance(db, companyId, 2025, { today: TODAY });
    expect(past[11]).toEqual({ month: "2025-12", realizado: 333, acumulado: 333, previsto: 333 });
    expect(past.every((point) => point.realizado !== null && point.acumulado !== null)).toBe(true);

    const next = await annualBalance(db, companyId, 2027, { today: TODAY });
    expect(next.every((point) => point.realizado === null && point.acumulado === null)).toBe(true);
    expect(next[0].previsto).toBe(-100 + 300);
  });

  it("ano inválido é recusado", async () => {
    await expect(annualBalance(db, companyId, 99, { today: TODAY })).rejects.toThrow(/Ano/);
  });

  it("a previsão não muda quando o runRecurring lança as competências (nem some nem conta duas vezes)", async () => {
    // Semanal sem histórico, semanal com histórico, trimestral que só vence em novembro, mensal que vence depois de hoje e
    // mensal atrasada desde julho (agosto e setembro ainda por lançar: entram em outubro, como a conta vencida).
    await addRecurring(db, companyId, { id: "diarista", amount: 10, frequency: "semanal", start_date: "2026-09-02" });
    await addRecurring(db, companyId, { id: "limpeza", amount: 7, frequency: "semanal", start_date: "2026-08-04", last_competence: "2026-09-29" });
    await addRecurring(db, companyId, { id: "seguro", amount: 1000, frequency: "trimestral", day_of_month: 31, start_date: "2026-02-28" });
    await addRecurring(db, companyId, { id: "licenca", kind: "receber", amount: 55, day_of_month: 28, start_date: "2026-01-01", last_competence: "2026-09" });
    await addRecurring(db, companyId, { id: "atrasada", amount: 20, day_of_month: 5, start_date: "2026-01-01", last_competence: "2026-07" });
    const before = [await annualBalance(db, companyId, 2026, { today: TODAY }), await annualBalance(db, companyId, 2027, { today: TODAY })];

    expect((await runRecurring(db, companyId, TODAY)).created).toBeGreaterThan(0);
    expect([await annualBalance(db, companyId, 2026, { today: TODAY }), await annualBalance(db, companyId, 2027, { today: TODAY })]).toEqual(before);
    // Outubro: aberto e recorrências da massa (2.000 + 400 + 50 − 150 + 300), diarista 4 × −10, limpeza 4 × −7, licença +55
    // e atrasada 3 × −20 (agosto, setembro e outubro).
    expect(before[0][9].previsto).toBe(2000 + 400 + 50 - 150 + 300 - 40 - 28 + 55 - 3 * 20);
    expect(before[0][10].previsto).toBe(900 - 100 + 300 - 40 - 28 - 1000 + 55 - 20);
    // Agosto e setembro já fecharam: a previsão deles continua sendo o realizado.
    expect(before[0][7].previsto).toBe(before[0][7].realizado);
  });
});

describe("empresa", () => {
  it("números de outra empresa nunca entram (contas, baixas, recorrências e projetos)", async () => {
    const { companyId: other } = await insertTestCompany(db, { companyId: "outra-empresa", roles: ["admin"] });
    await addReceivable(db, other, { id: "R-outra", amount: 100, due_date: "2026-10-22" });
    await addPayable(db, other, { id: "P-outra", amount: 50, due_date: "2026-10-23" });
    await addReceivable(db, other, { id: "R-outra-recebida", amount: 70, due_date: "2026-10-02", status: "recebida", received_amount: 70, received_at: "2026-10-02" });
    await addSettlement(db, other, { id: "S-outra", receivable_id: "R-outra-recebida", amount: 70, paid_at: "2026-10-02" });
    await addRecurring(db, other, { id: "rec-outra", amount: 900, start_date: "2026-01-01" });
    await insertRow(db, "customers", { id: "c-outra", company_id: other, name: "Cliente da outra" });
    await insertRow(db, "projects", { id: "p-outra", company_id: other, name: "Projeto da outra", status: "andamento", customer_id: "c-outra" });

    expect(await monthResult(db, companyId, "2026-10")).toMatchObject({ income: 0, expense: 0, result: 0 });
    expect(await weekReceivables(db, companyId, TODAY)).toMatchObject({ total: 0, count: 0 });
    expect(await weekPayables(db, companyId, TODAY)).toMatchObject({ total: 0, count: 0 });
    expect(await activeWorkCount(db, companyId, "ti")).toBe(0);
    expect(await activeWorkCount(db, companyId, "advocacia")).toBe(0);
    const points = await annualBalance(db, companyId, 2026, { today: TODAY });
    expect(points.every((point) => point.previsto === 0 && (point.realizado ?? 0) === 0)).toBe(true);
    // A outra empresa enxerga os próprios números.
    expect((await weekReceivables(db, other, TODAY)).total).toBe(100);
  });
});

describe("loadDashboardOverview", () => {
  it("carrega só o que foi pedido e um número que falha não derruba os outros", async () => {
    await addReceivable(db, companyId, { id: "hoje", amount: 300, due_date: TODAY });
    await insertRow(db, "projects", { id: "p1", company_id: companyId, name: "Site", status: "andamento" });

    const onlyWork = await loadDashboardOverview(db, companyId, { today: TODAY, finance: false, work: true });
    expect(onlyWork).toEqual({ activeWork: { ok: true, value: 1 } });

    const all = await loadDashboardOverview(db, companyId, { today: TODAY, finance: true, work: true });
    expect(all.month).toEqual({ ok: true, value: { month: "2026-10", income: 0, expense: 0, result: 0 } });
    expect(all.receivables).toEqual({ ok: true, value: { from: TODAY, to: "2026-10-25", total: 300, count: 1 } });
    expect(all.payables).toMatchObject({ ok: true, value: { total: 0 } });
    expect(all.balance?.ok && all.balance.value).toHaveLength(12);

    const broken = {
      select: async <T,>(sql: string, binds?: unknown[]): Promise<T> => {
        if (sql.includes("projects")) throw new Error("tabela travada");
        return db.select<T>(sql, binds);
      },
      execute: (sql: string, binds?: unknown[]) => db.execute(sql, binds),
    };
    const partial = await loadDashboardOverview(broken, companyId, { today: TODAY, finance: true, work: true });
    expect(partial.activeWork).toEqual({ ok: false, error: "tabela travada" });
    expect(partial.receivables).toMatchObject({ ok: true, value: { total: 300 } });
  });
});
