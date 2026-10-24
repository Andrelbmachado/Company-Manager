// @vitest-environment jsdom
// O RH completo também roda no banco demo do navegador (SQL só nos padrões do demo; nada de JOIN, IN ou "<").
import { beforeEach, describe, expect, it } from "vitest";
import { createDemoDb, DEMO_COMPANY_ID } from "@/lib/db/demo";
import { emptyEmployeeInput, fetchEmployee, saveEmployee } from "./employees";
import { applyDueTerminations, cancelTermination, cycleCases, setTaskDone, startAdmission, startTermination } from "./employment";
import { addTimeEntry, decideTimeEntry, fetchEmployeeTimeEntries, fetchTimeEntries, withdrawTimeEntry } from "./timebank";
import { employeeImportSchema, upsertEmployees, type EmployeeImportRow } from "./employeeImport";
import type { Employee, HrTask } from "@/types";

const C = DEMO_COMPANY_ID;
const TODAY = "2026-10-24";
const RH = "demo-rh";

beforeEach(() => localStorage.clear());

describe("RH no banco demo", () => {
  it("ficha, admissão, desligamento (agendado, cancelado e efetivado) e checklist", async () => {
    const db = createDemoDb();
    const before = (await db.select<Employee[]>("SELECT * FROM employees WHERE company_id=? AND deleted_at IS NULL", [C])).length;

    // Mesmo e-mail de um colaborador do demo: completa o cadastro dele.
    const merged = await saveEmployee(db, C, { ...emptyEmployeeInput(), name: "Camila Martins", email: "comercial@techflow.com", position: "Vendedora", document: "111.222.333-44" }, null, TODAY);
    expect(merged).toMatchObject({ id: "employee-demo-comercial", merged: true });
    expect(await fetchEmployee(db, C, merged.id)).toMatchObject({ position: "Vendedora", document: "111.222.333-44" });

    const admission = await startAdmission(db, C, { name: "Novo Técnico", email: "novo@techflow.com", department: "TI", position: "Suporte", hire_date: "2026-11-02", contract_type: "clt" }, RH);
    await setTaskDone(db, C, admission.taskIds[0], true);

    const scheduled = await startTermination(db, C, merged.id, { date: "2026-12-01", reason: "Término de contrato" }, RH, TODAY);
    expect(scheduled.effective).toBe(false);
    await cancelTermination(db, C, merged.id);
    expect(await fetchEmployee(db, C, merged.id)).toMatchObject({ status: "ativo", termination_date: null });

    await startTermination(db, C, merged.id, { date: "2026-11-10", reason: "Pedido de demissão" }, RH, TODAY);
    expect(await applyDueTerminations(db, C, "2026-11-10")).toBe(1);
    expect((await fetchEmployee(db, C, merged.id))?.status).toBe("desligado");

    const employees = await db.select<Employee[]>("SELECT * FROM employees WHERE company_id=? AND deleted_at IS NULL", [C]);
    expect(employees).toHaveLength(before + 1);
    const tasks = await db.select<HrTask[]>("SELECT * FROM hr_tasks WHERE company_id=? AND deleted_at IS NULL", [C]);
    const cases = cycleCases(employees, tasks, TODAY);
    expect(cases.map((item) => [item.employee.name, item.kind])).toEqual([["Novo Técnico", "admissao"], ["Camila Martins", "desligamento"]]);
    expect(cases[0].done).toBe(1);
  });

  it("banco de horas: lançar, aprovar e retirar", async () => {
    const db = createDemoDb();
    const employeeId = "employee-demo-comercial";
    const pending = await addTimeEntry(db, C, { employeeId, date: "2026-10-20", minutes: 90, reason: "Fechamento" }, "demo-comercial", TODAY);
    const other = await addTimeEntry(db, C, { employeeId, date: "2026-10-21", minutes: 30, reason: "Reunião" }, "demo-comercial", TODAY);
    await addTimeEntry(db, C, { employeeId, date: "2026-10-22", minutes: -60, reason: "Compensação" }, RH, TODAY, RH);
    await decideTimeEntry(db, C, pending, true, RH);
    await withdrawTimeEntry(db, C, other, employeeId);
    const entries = await fetchEmployeeTimeEntries(db, C, employeeId);
    expect(entries.map((entry) => [entry.minutes, entry.status])).toEqual([[-60, "aprovada"], [90, "aprovada"]]);
    expect((await fetchTimeEntries(db, C)).length).toBeGreaterThanOrEqual(2);
  });

  it("importação de colaboradores: atualiza pelo e-mail e cria os novos", async () => {
    const db = createDemoDb();
    const rows = [
      { name: "Camila Martins", email: "comercial@techflow.com", pis: "120.12345.67-8", cidade: "Sorocaba", uf: "sp" },
      { name: "Novo Estagiário", contract_type: "Estágio", hire_date: "01/11/2026" },
    ].map((raw) => employeeImportSchema.parse(raw) as EmployeeImportRow);
    expect(await upsertEmployees(db, C, rows)).toEqual({ inserted: 1, updated: 1 });
    expect(await fetchEmployee(db, C, "employee-demo-comercial")).toMatchObject({ pis: "120.12345.67-8", address_json: JSON.stringify({ cidade: "Sorocaba", uf: "SP" }) });
    const [intern] = (await db.select<Employee[]>("SELECT * FROM employees WHERE company_id=? AND deleted_at IS NULL", [C])).filter((employee) => employee.name === "Novo Estagiário");
    expect(intern).toMatchObject({ contract_type: "estagio", hire_date: "2026-11-01", status: "ativo" });
  });
});
