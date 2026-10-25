import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, insertTestCompany, type TestDb } from "@/test/sqlite";
import { buildDreReport, dreTable, loadDreData, type DreData } from "./dre";

const C = "test-company";
let db: TestDb;
let data: DreData;

async function category(id: string, code: string, name: string, kind: string, group: string | null, parent: string | null = null) {
  await db.execute("INSERT INTO finance_categories (id, company_id, parent_id, code, name, kind, dre_group) VALUES (?,?,?,?,?,?,?)", [id, C, parent, code, name, kind, group]);
}

interface Entry {
  category?: string | null;
  competence?: string | null;
  issue?: string | null;
  due?: string | null;
  status?: string;
  deleted?: boolean;
}

async function receivable(id: string, amount: number, entry: Entry) {
  await db.execute("INSERT INTO receivables (id, company_id, description, amount, category_id, competence, issue_date, due_date, status, deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?)", [
    id,
    C,
    `Receita ${id}`,
    amount,
    entry.category ?? null,
    entry.competence ?? null,
    entry.issue ?? null,
    entry.due ?? null,
    entry.status ?? "aberta",
    entry.deleted ? "2026-10-01T10:00:00.000Z" : null,
  ]);
}

async function payable(id: string, amount: number, entry: Entry) {
  await db.execute("INSERT INTO payables (id, company_id, description, amount, category_id, competence, issue_date, due_date, status, deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?)", [
    id,
    C,
    `Despesa ${id}`,
    amount,
    entry.category ?? null,
    entry.competence ?? null,
    entry.issue ?? null,
    entry.due ?? null,
    entry.status ?? "aberta",
    entry.deleted ? "2026-10-01T10:00:00.000Z" : null,
  ]);
}

beforeEach(async () => {
  db = await createTestDb();
  await insertTestCompany(db);
  await category("cR", "1", "Receitas", "receita", "receita");
  await category("cR1", "1.1", "Vendas de produtos", "receita", null, "cR");
  await category("cD", "2.1", "Impostos sobre vendas", "despesa", "deducao");
  await category("cC", "3.1", "Custo das mercadorias", "despesa", "custo");
  await category("cE", "4.1", "Aluguel", "despesa", "despesa");
  await category("cE2", "4.2", "Marketing", "despesa", null);
  await category("cF", "5.1", "Juros", "despesa", "financeiro");
  await category("cO", "6.1", "Venda de ativo", "receita", "outros");

  await receivable("a", 1000, { category: "cR1", competence: "2026-10" });
  await receivable("b", 2000, { category: "cR1", issue: "2026-09-15", status: "recebida" });
  await receivable("c", 500, { due: "2026-08-10" });
  await receivable("d", 300, { category: "cO", competence: "2026-10" });
  await receivable("e", 999, { category: "cR1", competence: "2026-10", status: "cancelada" });
  await receivable("f", 100, { category: "cR1", competence: "2026-07" });
  await payable("g", 150, { category: "cD", competence: "2026-10" });
  await payable("h", 400, { category: "cC", competence: "2026-10" });
  await payable("i", 600, { category: "cE", competence: "2026-09" });
  await payable("j", 600, { category: "cE", competence: "2026-10", status: "paga" });
  await payable("k", 200, { category: "cE2", competence: "2026-10" });
  await payable("l", 50, { category: "cF", competence: "2026-10" });
  await payable("m", 70, { competence: "2026-10" });
  await payable("n", 5000, { category: "cE", competence: "2026-10", deleted: true });
  data = await loadDreData(db, C);
});

describe("DRE comparativa", () => {
  it("meses do período terminando no mês escolhido", () => {
    const report = buildDreReport(data, { endMonth: "2026-10", months: 3 });
    expect(report.months).toEqual(["2026-08", "2026-09", "2026-10"]);
  });

  it("competência; sem ela, emissão; sem ela, vencimento. Cancelada e excluída ficam fora", () => {
    const report = buildDreReport(data, { endMonth: "2026-10", months: 3 });
    const line = (key: string) => report.lines.find((row) => row.key === key);
    expect(line("receita")?.values).toEqual([500, 2000, 1000]);
    expect(line("receita:cR1")).toMatchObject({ label: "1.1 Vendas de produtos", kind: "category", values: [0, 2000, 1000], total: 3000 });
    expect(line("receita:none")).toMatchObject({ label: "Sem categoria", values: [500, 0, 0] });
  });

  it("estrutura: receita bruta, deduções, receita líquida, custos, lucro bruto, despesas, financeiro, outros, resultado", () => {
    const report = buildDreReport(data, { endMonth: "2026-10", months: 3 });
    const totals = report.lines.filter((row) => row.kind !== "category").map((row) => [row.key, row.values, row.total]);
    expect(totals).toEqual([
      ["receita", [500, 2000, 1000], 3500],
      ["deducao", [0, 0, -150], -150],
      ["receita_liquida", [500, 2000, 850], 3350],
      ["custo", [0, 0, -400], -400],
      ["lucro_bruto", [500, 2000, 450], 2950],
      ["despesa", [0, -600, -870], -1470],
      ["financeiro", [0, 0, -50], -50],
      ["outros", [0, 0, 300], 300],
      ["resultado", [500, 1400, -170], 1730],
    ]);
  });

  it("grupo herdado da categoria pai ou do tipo da categoria; detalhe por categoria", () => {
    const report = buildDreReport(data, { endMonth: "2026-10", months: 3 });
    const despesas = report.lines.filter((row) => row.group === "despesa" && row.kind === "category").map((row) => [row.label, row.total]);
    expect(despesas).toEqual([
      ["4.1 Aluguel", -1200],
      ["4.2 Marketing", -200],
      ["Sem categoria", -70],
    ]);
    expect(report.lines.find((row) => row.key === "resultado")?.share).toBe(49.4);
    expect(report.lines.find((row) => row.key === "despesa")?.share).toBe(-42);
  });

  it("tabela de exportação com um mês por coluna", () => {
    const table = dreTable(buildDreReport(data, { endMonth: "2026-10", months: 3 }));
    expect(table.columns.map((column) => column.label)).toEqual(["Conta", "ago/2026", "set/2026", "out/2026", "Total", "% da receita"]);
    expect(table.rows.at(-1)).toMatchObject({ label: "Resultado líquido", m_2026_08: 500, m_2026_09: 1400, m_2026_10: -170, total: 1730, share: 49.4 });
    expect(table.styles?.[0]).toBe("strong");
    expect(table.styles?.[1]).toBe("indent");
    expect(table.fileName).toBe("dre-2026-08-a-2026-10");
  });
});
