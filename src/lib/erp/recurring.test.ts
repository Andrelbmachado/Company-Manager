// Recorrências: geram os lançamentos do mês (e as competências que faltam desde a última), nunca duplicam.
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, insertTestCompany, type TestDb } from "@/test/sqlite";
import { addCategory, addRecurring, insertRow } from "@/test/financeFixtures";
import { competencesDue, nextOccurrence, runRecurring } from "./recurring";
import type { RecurringEntry } from "@/types";

let db: TestDb;
let companyId: string;
const TODAY = "2026-10-24";

interface Row {
  [key: string]: unknown;
}
const payables = async () => db.select<Row[]>("SELECT * FROM payables WHERE company_id = ? ORDER BY competence", [companyId]);
const receivables = async () => db.select<Row[]>("SELECT * FROM receivables WHERE company_id = ? ORDER BY competence", [companyId]);
const recurring = async (id: string) => (await db.select<Row[]>("SELECT * FROM recurring_entries WHERE id = ?", [id]))[0];

beforeEach(async () => {
  db = await createTestDb();
  ({ companyId } = await insertTestCompany(db, { roles: ["financeiro"] }));
});

const entry = (fields: Partial<RecurringEntry>): RecurringEntry =>
  ({ id: "r", company_id: "c", kind: "pagar", description: "x", amount: 10, frequency: "mensal", start_date: "2026-01-01", active: 1, created_at: "", updated_at: "", ...fields }) as RecurringEntry;

describe("competencesDue", () => {
  it("mensal sem histórico: só a competência do mês de hoje, com o dia do vencimento", () => {
    expect(competencesDue(entry({ day_of_month: 5 }), TODAY)).toEqual([{ competence: "2026-10", dueDate: "2026-10-05" }]);
  });

  it("dia 31 em fevereiro vira o último dia do mês; sem dia, usa o dia do início", () => {
    expect(competencesDue(entry({ day_of_month: 31 }), "2027-02-10")).toEqual([{ competence: "2027-02", dueDate: "2027-02-28" }]);
    expect(competencesDue(entry({ start_date: "2026-03-17" }), TODAY)).toEqual([{ competence: "2026-10", dueDate: "2026-10-17" }]);
  });

  it("trimestral e anual só nos meses do ciclo, contados a partir do início", () => {
    expect(competencesDue(entry({ frequency: "trimestral", start_date: "2026-01-15" }), TODAY)).toEqual([{ competence: "2026-10", dueDate: "2026-10-15" }]);
    expect(competencesDue(entry({ frequency: "trimestral", start_date: "2026-02-15" }), TODAY)).toEqual([]);
    expect(competencesDue(entry({ frequency: "anual", start_date: "2025-11-20" }), TODAY)).toEqual([]);
    expect(competencesDue(entry({ frequency: "anual", start_date: "2025-10-20" }), TODAY)).toEqual([{ competence: "2026-10", dueDate: "2026-10-20" }]);
  });

  it("com última competência gerada, recupera as que faltam até o mês de hoje", () => {
    expect(competencesDue(entry({ day_of_month: 10, last_competence: "2026-07" }), TODAY).map((item) => item.competence)).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(competencesDue(entry({ last_competence: "2026-10" }), TODAY)).toEqual([]);
  });

  it("não gera antes do início nem depois do fim", () => {
    expect(competencesDue(entry({ start_date: "2026-11-01" }), TODAY)).toEqual([]);
    expect(competencesDue(entry({ day_of_month: 25, start_date: "2026-10-26" }), TODAY)).toEqual([]);
    expect(competencesDue(entry({ day_of_month: 5, end_date: "2026-09-30" }), TODAY)).toEqual([]);
    expect(competencesDue(entry({ day_of_month: 5, last_competence: "2026-07", end_date: "2026-09-05" }), TODAY).map((item) => item.competence)).toEqual(["2026-08", "2026-09"]);
  });

  it("semanal: as ocorrências do mês de hoje, competência = dia", () => {
    expect(competencesDue(entry({ frequency: "semanal", start_date: "2026-10-02" }), TODAY)).toEqual(
      ["2026-10-02", "2026-10-09", "2026-10-16", "2026-10-23", "2026-10-30"].map((day) => ({ competence: day, dueDate: day })),
    );
    expect(competencesDue(entry({ frequency: "semanal", start_date: "2026-09-04", last_competence: "2026-10-16" }), TODAY).map((item) => item.competence)).toEqual(["2026-10-23", "2026-10-30"]);
  });

  it("próxima ocorrência depois da última gerada (para a tela)", () => {
    expect(nextOccurrence(entry({ day_of_month: 5, last_competence: "2026-10" }), TODAY)).toEqual({ competence: "2026-11", dueDate: "2026-11-05" });
    expect(nextOccurrence(entry({ day_of_month: 5, last_competence: "2026-10", end_date: "2026-10-31" }), TODAY)).toBeNull();
  });
});

describe("runRecurring", () => {
  it("gera a conta a pagar do mês e não duplica ao rodar de novo", async () => {
    await addCategory(db, companyId, { id: "cat-aluguel", name: "Aluguel", kind: "despesa" });
    await insertRow(db, "suppliers", { id: "sup-1", company_id: companyId, name: "Imobiliária" });
    await addRecurring(db, companyId, { id: "rec-aluguel", description: "Aluguel do escritório", amount: 6800, day_of_month: 5, start_date: "2026-01-01", category_id: "cat-aluguel", supplier_id: "sup-1" });

    const first = await runRecurring(db, companyId, TODAY);
    expect(first).toMatchObject({ created: 1 });
    const rows = await payables();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      description: "Aluguel do escritório (10/2026)",
      amount: 6800,
      due_date: "2026-10-05",
      status: "aberta",
      competence: "2026-10",
      recurring_entry_id: "rec-aluguel",
      category_id: "cat-aluguel",
      supplier_id: "sup-1",
      issue_date: TODAY,
      paid_amount: 0,
    });
    expect(await recurring("rec-aluguel")).toMatchObject({ last_competence: "2026-10" });

    const second = await runRecurring(db, companyId, TODAY);
    expect(second).toMatchObject({ created: 0 });
    expect(await payables()).toHaveLength(1);
  });

  it("recupera os meses que faltam desde a última competência", async () => {
    await addRecurring(db, companyId, { id: "rec-1", amount: 100, day_of_month: 10, start_date: "2026-01-01", last_competence: "2026-07" });
    expect(await runRecurring(db, companyId, TODAY)).toMatchObject({ created: 3 });
    expect((await payables()).map((row) => [row.competence, row.due_date])).toEqual([
      ["2026-08", "2026-08-10"],
      ["2026-09", "2026-09-10"],
      ["2026-10", "2026-10-10"],
    ]);
  });

  it("recorrência a receber gera conta a receber com cliente, categoria e conta bancária", async () => {
    await insertRow(db, "customers", { id: "cus-1", company_id: companyId, name: "Cliente" });
    await insertRow(db, "bank_accounts", { id: "bank-1", company_id: companyId, name: "Conta" });
    await addRecurring(db, companyId, { id: "rec-sup", kind: "receber", description: "Suporte mensal", amount: 3000, day_of_month: 15, start_date: "2026-06-01", customer_id: "cus-1", bank_account_id: "bank-1" });
    await runRecurring(db, companyId, TODAY);
    expect(await receivables()).toEqual([
      expect.objectContaining({ description: "Suporte mensal (10/2026)", amount: 3000, due_date: "2026-10-15", customer_id: "cus-1", bank_account_id: "bank-1", competence: "2026-10", recurring_entry_id: "rec-sup", status: "aberta", received_amount: 0 }),
    ]);
    expect(await payables()).toEqual([]);
  });

  it("inativa, excluída, de outra empresa ou de tipo não pedido não gera", async () => {
    await addRecurring(db, companyId, { id: "inativa", amount: 1, start_date: "2026-01-01", active: 0 });
    await addRecurring(db, companyId, { id: "excluida", amount: 1, start_date: "2026-01-01", deleted_at: "2026-10-01T00:00:00Z" });
    await addRecurring(db, companyId, { id: "receber", kind: "receber", amount: 1, start_date: "2026-01-01" });
    await insertTestCompany(db, { companyId: "outra", roles: [] });
    await addRecurring(db, "outra", { id: "outra-empresa", amount: 1, start_date: "2026-01-01" });
    expect(await runRecurring(db, companyId, TODAY, { kinds: ["pagar"] })).toMatchObject({ created: 0 });
    expect(await receivables()).toEqual([]);
    expect(await runRecurring(db, companyId, TODAY)).toMatchObject({ created: 1 });
  });

  it("lançamento gerado e depois excluído não volta sozinho (nem com a última competência apagada)", async () => {
    await addRecurring(db, companyId, { id: "rec-1", amount: 100, day_of_month: 5, start_date: "2026-01-01" });
    await runRecurring(db, companyId, TODAY);
    await db.execute("UPDATE payables SET deleted_at = datetime('now') WHERE company_id = ?", [companyId]);
    await db.execute("UPDATE recurring_entries SET last_competence = NULL WHERE id = ?", ["rec-1"]);
    expect(await runRecurring(db, companyId, TODAY)).toMatchObject({ created: 0 });
    expect(await recurring("rec-1")).toMatchObject({ last_competence: "2026-10" });
  });

  it("competência já lançada por fora (seed/importação) não duplica e avança a última competência", async () => {
    await addRecurring(db, companyId, { id: "rec-1", amount: 100, day_of_month: 5, start_date: "2026-01-01" });
    await insertRow(db, "payables", { id: "manual", company_id: companyId, description: "Aluguel", amount: 100, recurring_entry_id: "rec-1", competence: "2026-10" });
    expect(await runRecurring(db, companyId, TODAY)).toMatchObject({ created: 0 });
    expect(await payables()).toHaveLength(1);
    expect(await recurring("rec-1")).toMatchObject({ last_competence: "2026-10" });
  });

  it("semanal grava a competência com o dia", async () => {
    await addRecurring(db, companyId, { id: "rec-sem", amount: 50, frequency: "semanal", start_date: "2026-10-02" });
    expect(await runRecurring(db, companyId, TODAY)).toMatchObject({ created: 5 });
    expect((await payables()).map((row) => row.competence)).toEqual(["2026-10-02", "2026-10-09", "2026-10-16", "2026-10-23", "2026-10-30"]);
    expect(await recurring("rec-sem")).toMatchObject({ last_competence: "2026-10-30" });
  });
});
