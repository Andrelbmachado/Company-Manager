// @vitest-environment jsdom
// Importação de colaboradores pela entidade única do registro (src/lib/importexport/importers/employees.ts), com as
// regras do RH: mesma pessoa = mesmo CPF ou e-mail (inclusive o cadastro que o Meu RH criou no primeiro acesso), célula
// vazia não apaga, sem salário e planilha que volta um desligado para Ativo é readmissão. SQLite real e banco demo.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDemoDb, DEMO_COMPANY_ID, type DatabaseLike } from "@/lib/db/demo";
import { registry } from "@/lib/importexport/registry";
import { runImport } from "@/lib/importexport/runImport";
import { createTestDb, insertTestCompany, type TestDb } from "@/test/sqlite";
import { emptyEmployeeInput, fetchEmployee, parseAddress, saveEmployee } from "./employees";
import { applyDueTerminations, startTermination } from "./employment";
import type { Employee, HrTask } from "@/types";

const C = "test-company";
const TODAY = "2026-10-24";
let db: TestDb;

beforeEach(async () => {
  localStorage.clear();
  db = await createTestDb();
  await insertTestCompany(db, { companyId: C });
});

afterEach(() => db.close());

const MAPPING = {
  name: "Nome",
  email: "E-mail",
  document: "CPF",
  phone: "Telefone",
  department: "Setor",
  position: "Cargo",
  contract_type: "Contrato",
  status: "Situação",
  endereco_bairro: "Bairro",
  endereco_cidade: "Cidade",
  endereco_uf: "UF",
};

const importEmployees = (target: DatabaseLike, companyId: string, rows: Record<string, string>[], mode: "all-or-nothing" | "skip-errors" = "all-or-nothing") =>
  runImport("employees", MAPPING, rows, { db: target, companyId, userId: null, mode, dryRun: false });

const employees = (target: DatabaseLike = db, companyId = C) =>
  target.select<Employee[]>("SELECT * FROM employees WHERE company_id=? AND deleted_at IS NULL ORDER BY name", [companyId]);

describe("entidade de colaboradores", () => {
  it("é a do registro: recurso de RH, sem salário e sem campo repetido", () => {
    expect(registry.employees).toMatchObject({ key: "employees", resource: "hr_admin" });
    const keys = registry.employees.fields.map((field) => field.key);
    expect(keys.filter((key) => /sal[aá]rio|salary/i.test(key))).toEqual([]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("cria, depois atualiza pelo e-mail ou CPF só os campos preenchidos, sem duplicar", async () => {
    expect(
      await importEmployees(db, C, [
        { Nome: "Ana Lima", "E-mail": "ana@x.com", Setor: "Comercial", Cidade: "Sorocaba", UF: "SP" },
        { Nome: "Bruno Reis", CPF: "529.982.247-25", Cargo: "Técnico" },
      ]),
    ).toMatchObject({ errors: [], inserted: 2, updated: 0 });

    expect(
      await importEmployees(db, C, [
        { Nome: "Ana Lima", "E-mail": "ANA@x.com", Telefone: "(15) 99999-0000", Bairro: "Centro" },
        { Nome: "Bruno R.", CPF: "52998224725", Contrato: "PJ" },
        { Nome: "Carla Dias" },
      ]),
    ).toMatchObject({ errors: [], inserted: 1, updated: 2 });

    const [ana, bruno, carla] = await employees();
    expect(ana).toMatchObject({ email: "ana@x.com", department: "Comercial", status: "ativo" });
    expect(parseAddress(ana.address_json)).toMatchObject({ cidade: "Sorocaba", uf: "SP", bairro: "Centro" });
    expect(bruno).toMatchObject({ name: "Bruno R.", position: "Técnico", contract_type: "pj" });
    expect(carla).toMatchObject({ name: "Carla Dias", status: "ativo", vacation_days_entitled: 30, daily_minutes: 480 });
  });

  it("o cadastro que o Meu RH criou (só e-mail) é completado pela planilha com CPF, sem duplicar", async () => {
    const { id } = await saveEmployee(db, C, { ...emptyEmployeeInput(), name: "Ana Lima", email: "ana@x.com" }, null, TODAY);
    expect(await importEmployees(db, C, [{ Nome: "Ana Lima", "E-mail": "ana@x.com", CPF: "529.982.247-25", Cargo: "Vendedora" }])).toMatchObject({ errors: [], inserted: 0, updated: 1 });
    expect(await employees()).toHaveLength(1);
    expect(await fetchEmployee(db, C, id)).toMatchObject({ document: "529.982.247-25", position: "Vendedora" });
  });

  it("planilha que volta um desligado para Ativo é readmissão, como na ficha: o desligamento sai e não volta a desligar", async () => {
    const { id } = await saveEmployee(db, C, { ...emptyEmployeeInput(), name: "Ana Lima", email: "ana@x.com", hire_date: "2020-01-10" }, null, TODAY);
    await startTermination(db, C, id, { date: "2026-10-01", reason: "Pedido de demissão" }, "test-user-rh", TODAY);
    await applyDueTerminations(db, C, TODAY);
    const exitTasks = () => db.select<HrTask[]>("SELECT * FROM hr_tasks WHERE company_id=? AND employee_id=? AND category='desligamento' AND deleted_at IS NULL", [C, id]);
    expect((await exitTasks()).length).toBeGreaterThan(0);

    // Linha sem a coluna Situação não mexe no desligamento.
    await importEmployees(db, C, [{ Nome: "Ana Lima", "E-mail": "ana@x.com", Telefone: "(15) 99999-0000" }]);
    expect(await fetchEmployee(db, C, id)).toMatchObject({ status: "desligado", termination_date: "2026-10-01" });

    expect(await importEmployees(db, C, [{ Nome: "Ana Lima", "E-mail": "ana@x.com", Situação: "Ativo" }])).toMatchObject({ errors: [], inserted: 0, updated: 1 });
    expect(await fetchEmployee(db, C, id)).toMatchObject({ status: "ativo", termination_date: null, termination_reason: null });
    expect(await exitTasks()).toHaveLength(0);
    // Sem isso a próxima abertura das telas de RH desligaria a pessoa de novo pela data antiga.
    expect(await applyDueTerminations(db, C, TODAY)).toBe(0);
    expect((await fetchEmployee(db, C, id))?.status).toBe("ativo");
  });

  const importWithExit = (rows: Record<string, string>[]) =>
    runImport("employees", { ...MAPPING, termination_date: "Desligamento", termination_reason: "Motivo" }, rows, { db, companyId: C, userId: null, mode: "all-or-nothing", dryRun: false });

  it("data de desligamento futura na planilha agenda, como na ficha: continua ativo até a data", async () => {
    const { id } = await saveEmployee(db, C, { ...emptyEmployeeInput(), name: "Ana Lima", email: "ana@x.com", hire_date: "2020-01-10" }, null, TODAY);
    expect(
      await importWithExit([
        { Nome: "Ana Lima", "E-mail": "ana@x.com", Desligamento: "31/12/2099", Motivo: "Pedido de demissão" },
        { Nome: "Bruno Reis", "E-mail": "bruno@x.com", Desligamento: "31/12/2099" },
        { Nome: "Carla Dias", "E-mail": "carla@x.com", Desligamento: "01/10/2026" },
      ]),
    ).toMatchObject({ errors: [], inserted: 2, updated: 1 });
    expect(await fetchEmployee(db, C, id)).toMatchObject({ status: "ativo", termination_date: "2099-12-31", termination_reason: "Pedido de demissão" });
    const [, bruno, carla] = await employees();
    expect(bruno).toMatchObject({ name: "Bruno Reis", status: "ativo", termination_date: "2099-12-31" });
    // Data passada sem a coluna Situação: já desligado.
    expect(carla).toMatchObject({ name: "Carla Dias", status: "desligado", termination_date: "2026-10-01" });
    expect(await applyDueTerminations(db, C, TODAY)).toBe(0);
    expect(await applyDueTerminations(db, C, "2099-12-31")).toBe(2);
  });

  it("planilha exportada que volta o desligado para Ativo (com a data e o motivo antigos) também é readmissão", async () => {
    const { id } = await saveEmployee(db, C, { ...emptyEmployeeInput(), name: "Ana Lima", email: "ana@x.com", hire_date: "2020-01-10" }, null, TODAY);
    await startTermination(db, C, id, { date: "2026-10-01", reason: "Pedido de demissão" }, "test-user-rh", TODAY);
    await applyDueTerminations(db, C, TODAY);
    expect(
      await importWithExit([{ Nome: "Ana Lima", "E-mail": "ana@x.com", Situação: "Ativo", Desligamento: "01/10/2026", Motivo: "Pedido de demissão" }]),
    ).toMatchObject({ errors: [], inserted: 0, updated: 1 });
    expect(await fetchEmployee(db, C, id)).toMatchObject({ status: "ativo", termination_date: null, termination_reason: null });
    expect(await db.select("SELECT id FROM hr_tasks WHERE company_id=? AND employee_id=? AND category='desligamento' AND deleted_at IS NULL", [C, id])).toEqual([]);
    expect(await applyDueTerminations(db, C, TODAY)).toBe(0);
    expect((await fetchEmployee(db, C, id))?.status).toBe("ativo");
  });

  it("falha no meio desfaz também a readmissão (diário da importação)", async () => {
    const { id } = await saveEmployee(db, C, { ...emptyEmployeeInput(), name: "Ana Lima", email: "ana@x.com", hire_date: "2020-01-10" }, null, TODAY);
    await startTermination(db, C, id, { date: "2026-10-01", reason: "Pedido de demissão" }, "test-user-rh", TODAY);
    await applyDueTerminations(db, C, TODAY);
    // Gatilho que recusa a gravação de tarefas de RH: a readmissão falha depois de o colaborador já ter sido gravado.
    await db.execute("CREATE TRIGGER block_hr_tasks BEFORE UPDATE ON hr_tasks BEGIN SELECT RAISE(ABORT, 'bloqueado no teste'); END");
    const result = await importEmployees(db, C, [{ Nome: "Ana Lima", "E-mail": "ana@x.com", Situação: "Ativo", Cargo: "Vendedora" }]);
    expect(result.status).toBe("falhou");
    expect(await fetchEmployee(db, C, id)).toMatchObject({ status: "desligado", termination_date: "2026-10-01", termination_reason: "Pedido de demissão", position: null });
  });

  it("banco demo: atualiza pelo e-mail, cria os novos e readmite", async () => {
    const demo = createDemoDb();
    const result = await importEmployees(demo, DEMO_COMPANY_ID, [
      { Nome: "Camila Martins", "E-mail": "comercial@techflow.com", Cidade: "Sorocaba", UF: "SP" },
      { Nome: "Novo Estagiário", Contrato: "Estágio" },
    ]);
    expect(result).toMatchObject({ errors: [], inserted: 1, updated: 1 });
    expect(parseAddress((await fetchEmployee(demo, DEMO_COMPANY_ID, "employee-demo-comercial"))?.address_json)).toMatchObject({ cidade: "Sorocaba", uf: "SP" });
    const [intern] = (await employees(demo, DEMO_COMPANY_ID)).filter((employee) => employee.name === "Novo Estagiário");
    expect(intern).toMatchObject({ contract_type: "estagio", status: "ativo" });

    await startTermination(demo, DEMO_COMPANY_ID, "employee-demo-comercial", { date: "2026-10-01", reason: "Pedido de demissão" }, "demo-rh", TODAY);
    await applyDueTerminations(demo, DEMO_COMPANY_ID, TODAY);
    await importEmployees(demo, DEMO_COMPANY_ID, [{ Nome: "Camila Martins", "E-mail": "comercial@techflow.com", Situação: "Ativo" }]);
    expect(await applyDueTerminations(demo, DEMO_COMPANY_ID, TODAY)).toBe(0);
    expect(await fetchEmployee(demo, DEMO_COMPANY_ID, "employee-demo-comercial")).toMatchObject({ status: "ativo", termination_date: null });
  });
});
