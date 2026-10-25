import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, insertTestCompany, type TestDb } from "@/test/sqlite";
import { agingTable, buildAgingReport, loadAgingData, type AgingData } from "./aging";

const C = "test-company";
const AS_OF = "2026-10-24";
let db: TestDb;
let data: AgingData;

async function receivable(id: string, customer: string | null, amount: number, received: number, due: string | null, status: string, extra: { description?: string | null; refId?: string; deleted?: boolean } = {}) {
  await db.execute(
    "INSERT INTO receivables (id, company_id, customer_id, description, ref_id, amount, received_amount, due_date, status, deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [id, C, customer, extra.description === undefined ? `Recebível ${id}` : extra.description, extra.refId ?? null, amount, received, due, status, extra.deleted ? "2026-10-20T10:00:00.000Z" : null],
  );
}

async function payable(id: string, supplier: string | null, amount: number, paid: number, due: string | null, status: string) {
  await db.execute("INSERT INTO payables (id, company_id, description, supplier_id, amount, paid_amount, due_date, status) VALUES (?,?,?,?,?,?,?,?)", [id, C, `Conta ${id}`, supplier, amount, paid, due, status]);
}

beforeEach(async () => {
  db = await createTestDb();
  await insertTestCompany(db);
  await db.execute("INSERT INTO customers (id, company_id, name) VALUES (?,?,?), (?,?,?)", ["c1", C, "Alfa Ltda", "c2", C, "Beta ME"]);
  await db.execute("INSERT INTO suppliers (id, company_id, name) VALUES (?,?,?)", ["s1", C, "Fornecedor X"]);
  await receivable("r1", "c1", 1000, 0, "2026-10-30", "aberta");
  await receivable("r2", "c1", 500, 200, "2026-10-24", "recebida_parcial");
  await receivable("r3", "c1", 60, 0, "2026-09-24", "aberta");
  await receivable("r4", "c2", 70, 0, "2026-09-23", "vencida");
  await receivable("r5", "c2", 800, 0, "2026-08-20", "vencida");
  await receivable("r6", "c2", 400, 0, "2026-06-01", "aberta");
  await receivable("r7", null, 250, 0, null, "aberta", { description: null, refId: "Venda balcão" });
  await receivable("r8", "c1", 300, 300, "2026-09-01", "recebida");
  await receivable("r9", "c1", 100, 0, "2026-09-01", "cancelada");
  await receivable("r10", "c1", 999, 0, "2026-09-01", "aberta", { deleted: true });
  await receivable("r11", "c1", 90, 90, "2026-09-01", "aberta");
  await payable("p1", "s1", 200, 50, "2026-10-01", "paga_parcial");
  await payable("p2", "s1", 1000, 1000, "2026-10-01", "paga");
  await payable("p3", null, 120, 0, "2026-11-15", "aprovada");
  data = await loadAgingData(db, C);
});

describe("aging de contas a receber e a pagar", () => {
  it("considera só o saldo em aberto (sem quitadas, canceladas, excluídas ou zeradas)", () => {
    const report = buildAgingReport(data, "receber", AS_OF, AS_OF);
    expect(report.count).toBe(7);
    expect(report.total).toBe(2880);
    expect(report.overdue).toBe(1330);
    expect(report.entries.map((entry) => entry.id)).toEqual(["r6", "r5", "r4", "r3", "r2", "r1", "r7"]);
    expect(report.entries.find((entry) => entry.id === "r2")).toMatchObject({ party: "Alfa Ltda", amount: 500, settled: 200, open: 300, daysOverdue: 0, bucket: "a_vencer" });
    expect(report.entries.find((entry) => entry.id === "r7")).toMatchObject({ description: "Venda balcão", party: "Sem cliente", daysOverdue: null, bucket: "sem_vencimento" });
  });

  it("separa por faixa de atraso: hoje é a vencer, 30 dias é 1–30, 31 é 31–60", () => {
    const report = buildAgingReport(data, "receber", AS_OF, AS_OF);
    expect(report.buckets.map((bucket) => [bucket.key, bucket.count, bucket.total, bucket.share])).toEqual([
      ["a_vencer", 2, 1300, 45.1],
      ["1_30", 1, 60, 2.1],
      ["31_60", 1, 70, 2.4],
      ["61_90", 1, 800, 27.8],
      ["90_mais", 1, 400, 13.9],
      ["sem_vencimento", 1, 250, 8.7],
    ]);
    expect(report.entries.find((entry) => entry.id === "r3")?.daysOverdue).toBe(30);
    expect(report.entries.find((entry) => entry.id === "r4")?.bucket).toBe("31_60");
  });

  it("agrupa por cliente, mais vencido primeiro", () => {
    const report = buildAgingReport(data, "receber", AS_OF, AS_OF);
    expect(report.byParty.map((row) => [row.label, row.total, row.overdue, row.buckets["61_90"], row.buckets.a_vencer])).toEqual([
      ["Beta ME", 1270, 1270, 800, 0],
      ["Alfa Ltda", 1360, 60, 0, 1300],
      ["Sem cliente", 250, 0, 0, 0],
    ]);
  });

  it("contas a pagar usam o valor pago e o fornecedor", () => {
    const report = buildAgingReport(data, "pagar", AS_OF, AS_OF);
    expect(report.total).toBe(270);
    expect(report.overdue).toBe(150);
    expect(report.entries.map((entry) => [entry.id, entry.party, entry.open, entry.bucket])).toEqual([
      ["p1", "Fornecedor X", 150, "1_30"],
      ["p3", "Sem fornecedor", 120, "a_vencer"],
    ]);
  });

  it("tabelas de exportação: faixas, por cliente/fornecedor e títulos", () => {
    const receber = buildAgingReport(data, "receber", AS_OF, AS_OF);
    const faixas = agingTable(receber, "faixas");
    expect(faixas.rows.map((row) => row.label)).toEqual(["A vencer", "1 a 30 dias", "31 a 60 dias", "61 a 90 dias", "Mais de 90 dias", "Sem vencimento"]);
    expect(faixas.totals).toMatchObject({ label: "Total", count: 7, total: 2880, share: 100 });
    expect(faixas.fileName).toBe("contas-a-receber-faixas-em-2026-10-24");

    const titulos = agingTable(receber, "titulos");
    expect(titulos.columns.map((column) => column.label)).toEqual(["Vencimento", "Descrição", "Cliente", "Valor (R$)", "Recebido (R$)", "Em aberto (R$)", "Dias de atraso", "Faixa"]);
    expect(titulos.rows[0]).toMatchObject({ due_date: "2026-06-01", party: "Beta ME", open: 400, days: 145, bucket: "Mais de 90 dias" });
    expect(titulos.totals).toMatchObject({ amount: 3080, settled: 200, open: 2880 });

    const pagar = agingTable(buildAgingReport(data, "pagar", AS_OF, AS_OF), "parceiros");
    expect(pagar.columns[0].label).toBe("Fornecedor");
    expect(pagar.fileName).toBe("contas-a-pagar-parceiros-em-2026-10-24");
    expect(agingTable(buildAgingReport(data, "pagar", AS_OF, AS_OF), "titulos").columns.map((column) => column.label)).toContain("Pago (R$)");
  });
});

describe("aging numa data-base passada", () => {
  const PAST = "2026-09-30";
  const TODAY = "2026-10-24";

  async function insert(table: "receivables" | "payables" | "finance_settlements", row: Record<string, unknown>) {
    const values = { company_id: C, ...row };
    const columns = Object.keys(values);
    await db.execute(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`, Object.values(values));
  }

  beforeEach(async () => {
    db = await createTestDb();
    await insertTestCompany(db);
    await db.execute("INSERT INTO suppliers (id, company_id, name) VALUES (?,?,?)", ["s1", C, "Fornecedor X"]);
    // Recebida em 05/10 pela tela antiga (sem baixa registrada): em 30/09 estava em aberto e vencida.
    await insert("receivables", { id: "h1", description: "h1", amount: 1000, received_amount: 1000, status: "recebida", issue_date: "2026-09-01", due_date: "2026-09-20", received_at: "2026-10-05T13:00:00.000Z" });
    // Baixas de 200 em 26/09 e 400 em 03/10: em 30/09 faltavam 400.
    await insert("receivables", { id: "h2", description: "h2", amount: 600, received_amount: 600, status: "recebida", issue_date: "2026-09-01", due_date: "2026-09-25" });
    await insert("finance_settlements", { id: "s-h2-1", receivable_id: "h2", amount: 200, paid_at: "2026-09-26" });
    await insert("finance_settlements", { id: "s-h2-2", receivable_id: "h2", amount: 400, paid_at: "2026-10-03" });
    // Quitada antes da data-base: fora.
    await insert("receivables", { id: "h3", description: "h3", amount: 300, received_amount: 300, status: "recebida", issue_date: "2026-09-01", due_date: "2026-09-10" });
    await insert("finance_settlements", { id: "s-h3", receivable_id: "h3", amount: 300, paid_at: "2026-09-28" });
    // Emitidas depois da data-base (pela emissão ou, sem ela, pela criação): fora em 30/09, em aberto hoje.
    await insert("receivables", { id: "h4", description: "h4", amount: 500, status: "aberta", issue_date: "2026-10-10", due_date: "2026-11-10" });
    await insert("receivables", { id: "h5", description: "h5", amount: 250, status: "aberta", due_date: "2026-11-15", created_at: "2026-10-15 12:00:00" });
    // Quitada pela tela antiga sem valor nem data de recebimento: continua quitada.
    await insert("receivables", { id: "h6", description: "h6", amount: 80, status: "recebida", issue_date: "2026-09-01", due_date: "2026-09-15" });
    // Baixa estornada (excluída) não conta.
    await insert("receivables", { id: "h7", description: "h7", amount: 120, status: "aberta", issue_date: "2026-09-01", due_date: "2026-09-29" });
    await insert("finance_settlements", { id: "s-h7", receivable_id: "h7", amount: 120, paid_at: "2026-09-15", deleted_at: "2026-09-16T10:00:00.000Z" });
    // A pagar com baixa parcial depois da data-base.
    await insert("payables", { id: "hp1", supplier_id: "s1", description: "Compra parcial", amount: 900, paid_amount: 300, status: "paga_parcial", issue_date: "2026-09-05", due_date: "2026-09-30" });
    await insert("finance_settlements", { id: "s-hp1", payable_id: "hp1", amount: 300, paid_at: "2026-10-02" });
    data = await loadAgingData(db, C);
  });

  it("reconstrói o saldo daquele dia: desfaz baixas posteriores e deixa fora o que ainda não existia", () => {
    const report = buildAgingReport(data, "receber", PAST, TODAY);
    expect(report.entries.map((entry) => [entry.id, entry.settled, entry.open, entry.daysOverdue, entry.bucket])).toEqual([
      ["h1", 0, 1000, 10, "1_30"],
      ["h2", 200, 400, 5, "1_30"],
      ["h7", 0, 120, 1, "1_30"],
    ]);
    expect(report.total).toBe(1520);
    expect(report.overdue).toBe(1520);
    expect(agingTable(report, "titulos").subtitle).toBe("Saldo em aberto em 30/09/2026");
  });

  it("contas a pagar também: baixa parcial feita depois volta a ficar em aberto", () => {
    const report = buildAgingReport(data, "pagar", PAST, TODAY);
    expect(report.entries.map((entry) => [entry.id, entry.settled, entry.open, entry.bucket])).toEqual([["hp1", 0, 900, "a_vencer"]]);
    expect(buildAgingReport(data, "pagar", TODAY, TODAY).entries.map((entry) => [entry.id, entry.open])).toEqual([["hp1", 600]]);
  });

  it("de hoje em diante vale o saldo atual; a data-base futura só muda os dias de atraso", () => {
    const today = buildAgingReport(data, "receber", TODAY, TODAY);
    expect(today.entries.map((entry) => [entry.id, entry.open])).toEqual([
      ["h7", 120],
      ["h4", 500],
      ["h5", 250],
    ]);
    const future = buildAgingReport(data, "receber", "2026-11-12", TODAY);
    expect(future.entries.map((entry) => [entry.id, entry.bucket])).toEqual([
      ["h7", "31_60"],
      ["h4", "1_30"],
      ["h5", "a_vencer"],
    ]);
  });
});
