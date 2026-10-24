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
    const report = buildAgingReport(data, "receber", AS_OF);
    expect(report.count).toBe(7);
    expect(report.total).toBe(2880);
    expect(report.overdue).toBe(1330);
    expect(report.entries.map((entry) => entry.id)).toEqual(["r6", "r5", "r4", "r3", "r2", "r1", "r7"]);
    expect(report.entries.find((entry) => entry.id === "r2")).toMatchObject({ party: "Alfa Ltda", amount: 500, settled: 200, open: 300, daysOverdue: 0, bucket: "a_vencer" });
    expect(report.entries.find((entry) => entry.id === "r7")).toMatchObject({ description: "Venda balcão", party: "Sem cliente", daysOverdue: null, bucket: "sem_vencimento" });
  });

  it("separa por faixa de atraso: hoje é a vencer, 30 dias é 1–30, 31 é 31–60", () => {
    const report = buildAgingReport(data, "receber", AS_OF);
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
    const report = buildAgingReport(data, "receber", AS_OF);
    expect(report.byParty.map((row) => [row.label, row.total, row.overdue, row.buckets["61_90"], row.buckets.a_vencer])).toEqual([
      ["Beta ME", 1270, 1270, 800, 0],
      ["Alfa Ltda", 1360, 60, 0, 1300],
      ["Sem cliente", 250, 0, 0, 0],
    ]);
  });

  it("contas a pagar usam o valor pago e o fornecedor", () => {
    const report = buildAgingReport(data, "pagar", AS_OF);
    expect(report.total).toBe(270);
    expect(report.overdue).toBe(150);
    expect(report.entries.map((entry) => [entry.id, entry.party, entry.open, entry.bucket])).toEqual([
      ["p1", "Fornecedor X", 150, "1_30"],
      ["p3", "Sem fornecedor", 120, "a_vencer"],
    ]);
  });

  it("tabelas de exportação: faixas, por cliente/fornecedor e títulos", () => {
    const receber = buildAgingReport(data, "receber", AS_OF);
    const faixas = agingTable(receber, "faixas");
    expect(faixas.rows.map((row) => row.label)).toEqual(["A vencer", "1 a 30 dias", "31 a 60 dias", "61 a 90 dias", "Mais de 90 dias", "Sem vencimento"]);
    expect(faixas.totals).toMatchObject({ label: "Total", count: 7, total: 2880, share: 100 });
    expect(faixas.fileName).toBe("contas-a-receber-faixas-em-2026-10-24");

    const titulos = agingTable(receber, "titulos");
    expect(titulos.columns.map((column) => column.label)).toEqual(["Vencimento", "Descrição", "Cliente", "Valor (R$)", "Recebido (R$)", "Em aberto (R$)", "Dias de atraso", "Faixa"]);
    expect(titulos.rows[0]).toMatchObject({ due_date: "2026-06-01", party: "Beta ME", open: 400, days: 145, bucket: "Mais de 90 dias" });
    expect(titulos.totals).toMatchObject({ amount: 3080, settled: 200, open: 2880 });

    const pagar = agingTable(buildAgingReport(data, "pagar", AS_OF), "parceiros");
    expect(pagar.columns[0].label).toBe("Fornecedor");
    expect(pagar.fileName).toBe("contas-a-pagar-parceiros-em-2026-10-24");
    expect(agingTable(buildAgingReport(data, "pagar", AS_OF), "titulos").columns.map((column) => column.label)).toContain("Pago (R$)");
  });
});
