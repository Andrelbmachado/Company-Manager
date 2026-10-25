// Folha na tela: salário editado na própria tabela (formato brasileiro), sem valor no histórico de atividades,
// remuneração nova por Adicionar e permissão da folha conferida também na gravação.
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { insertRow } from "@/test/financeFixtures";
import { renderPage, until, type RenderedPage } from "@/test/pageHarness";
import { addRow, editCell, saveError, saveTable, startEditing, tableOf } from "@/modules/finance/testing/tableActions";
import { saveCompensationChanges } from "../data/compensationEditing";
import PayrollPage from "./PayrollPage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));
vi.mock("@/lib/confirm", () => ({ confirmAction: vi.fn(async () => true) }));

const testDb = useTestDb();
let page: RenderedPage | null = null;

afterEach(() => {
  page?.unmount();
  page = null;
  document.body.innerHTML = "";
});

type Row = Record<string, unknown>;

async function seed() {
  const db = testDb();
  const { companyId } = await insertTestCompany(db, { companyId: "empresa-folha-tela", roles: ["ceo", "rh"] });
  await insertRow(db, "employees", { id: "emp-1", company_id: companyId, name: "Ana Souza", department: "Comercial", position: "Vendedora", status: "ativo" });
  await insertRow(db, "employees", { id: "emp-2", company_id: companyId, name: "Bruno Lima", department: "TI", position: "Analista", status: "ativo" });
  return { db, companyId };
}

describe("PayrollPage", () => {
  it("edita o salário na tabela e não grava o valor no histórico", async () => {
    const { db, companyId } = await seed();
    page = await renderPage(<PayrollPage />, { companyId, role: "ceo" });
    const view = page;
    await until(() => view.text().includes("Ana Souza") && view.text().includes("Bruno Lima"), "colaboradores");
    const table = tableOf(view.container, "payroll");
    await startEditing(table);
    await editCell(table, "emp-1", "base_salary", "4.500,00");
    await editCell(table, "emp-1", "effective_from", "01/03/2026");
    await saveTable(table);
    await until(async () => (await db.select<Row[]>("SELECT * FROM employee_compensation WHERE employee_id = ?", ["emp-1"])).length === 1, "remuneração gravada");
    const [entry] = await db.select<Row[]>("SELECT * FROM employee_compensation WHERE employee_id = ?", ["emp-1"]);
    expect(entry).toMatchObject({ base_salary: 4500, effective_from: "2026-03-01", updated_by: "test-user-ceo" });
    await until(() => view.text().includes("R$ 4.500,00"), "folha mensal atualizada");
    const activities = await db.select<Row[]>("SELECT * FROM activities WHERE company_id = ? AND action = ?", [companyId, "payroll.salary_updated"]);
    expect(activities).toHaveLength(1);
    expect(JSON.stringify(activities[0])).not.toContain("4500");

    await startEditing(table);
    await editCell(table, "emp-1", "employee_id", "emp-2");
    expect(await saveError(table)).toContain("o colaborador da linha não muda");
  });

  it("Adicionar grava a remuneração do colaborador escolhido", async () => {
    const { db, companyId } = await seed();
    page = await renderPage(<PayrollPage />, { companyId, role: "ceo" });
    const view = page;
    await until(() => view.text().includes("Bruno Lima"), "colaboradores");
    const table = tableOf(view.container, "payroll");
    await addRow(table);
    await editCell(table, "nova", "employee_id", "emp-2");
    await editCell(table, "nova", "base_salary", "6.200,50");
    await saveTable(table);
    await until(async () => (await db.select<Row[]>("SELECT * FROM employee_compensation WHERE employee_id = ?", ["emp-2"])).length === 1, "remuneração nova");
    expect((await db.select<Row[]>("SELECT * FROM employee_compensation WHERE employee_id = ?", ["emp-2"]))[0]).toMatchObject({ base_salary: 6200.5 });
  });

  it("RH não grava salário nem chamando a camada de dados", async () => {
    const { db, companyId } = await seed();
    await expect(saveCompensationChanges(db, { companyId, role: "rh", userId: "test-user-rh" }, { updated: [{ id: "emp-1", base_salary: 9999 }], created: [] })).rejects.toThrow(/permissão/);
    expect(await db.select<Row[]>("SELECT * FROM employee_compensation WHERE company_id = ?", [companyId])).toHaveLength(0);
  });
});
