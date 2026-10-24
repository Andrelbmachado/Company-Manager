// RH completo no SQLite real: ficha do colaborador, admissão/desligamento com checklist e banco de horas.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, insertTestCompany, type TestDb } from "@/test/sqlite";
import { EMPTY_ADDRESS, emptyEmployeeInput, employeeToInput, fetchEmployee, formatAddress, parseAddress, saveEmployee, validateEmployee, type EmployeeInput } from "./employees";
import { ADMISSION_STEPS, TERMINATION_STEPS, applyDueTerminations, cancelTermination, cycleCases, setTaskDone, startAdmission, startTermination } from "./employment";
import { addTimeEntry, decideTimeEntry, fetchEmployeeTimeEntries, fetchTimeEntries, withdrawTimeEntry } from "./timebank";
import type { Employee, HrTask, HrTimeEntry } from "@/types";

const C = "test-company";
const TODAY = "2026-10-24";
const RH = "test-user-rh";
let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
  await insertTestCompany(db, { companyId: C });
});

afterEach(() => db.close());

const employees = () => db.select<Employee[]>("SELECT * FROM employees WHERE company_id=? AND deleted_at IS NULL ORDER BY name", [C]);
const tasksOf = (employeeId: string) => db.select<HrTask[]>("SELECT * FROM hr_tasks WHERE company_id=? AND employee_id=? AND deleted_at IS NULL ORDER BY due_date", [C, employeeId]);

function input(patch: Partial<EmployeeInput> = {}): EmployeeInput {
  return { ...emptyEmployeeInput(), name: "Maria Souza", email: "Maria@Empresa.com", ...patch };
}

describe("ficha do colaborador", () => {
  it("cria com dados pessoais, contrato e endereço; lê de volta igual (sem salário)", async () => {
    const { id, created } = await saveEmployee(db, C, input({
      department: "Comercial",
      position: "Vendedora",
      hire_date: "2024-03-01",
      contract_type: "clt",
      daily_minutes: 440,
      document: "123.456.789-09",
      pis: "120.12345.67-8",
      phone: "(15) 99999-0000",
      birth_date: "1990-05-20",
      address: { ...EMPTY_ADDRESS, logradouro: "Rua das Flores", numero: "10", bairro: "Centro", cidade: "Sorocaba", uf: "sp", cep: "18035-100" },
      emergency_contact_name: "João",
      emergency_contact_phone: "(15) 98888-1111",
    }), null, TODAY);
    expect(created).toBe(true);
    const saved = await fetchEmployee(db, C, id);
    expect(saved).toMatchObject({ name: "Maria Souza", email: "maria@empresa.com", daily_minutes: 440, contract_type: "clt", status: "ativo", document: "123.456.789-09" });
    expect(JSON.parse(saved!.address_json!)).toEqual({ logradouro: "Rua das Flores", numero: "10", bairro: "Centro", cidade: "Sorocaba", uf: "SP", cep: "18035-100" });
    const roundTrip = employeeToInput(saved!);
    expect(roundTrip.address.complemento).toBe("");
    expect(roundTrip.address.uf).toBe("SP");
    expect(Object.keys(saved!)).not.toContain("base_salary");
  });

  it("cadastrar com o e-mail de quem já tem cadastro (Meu RH) completa esse cadastro em vez de duplicar", async () => {
    await db.execute("INSERT INTO employees (id, company_id, user_id, name, email, status) VALUES (?,?,?,?,?,?)", ["e-self", C, "test-user-comercial", "Teste comercial", "maria@empresa.com", "ativo"]);
    const result = await saveEmployee(db, C, input({ position: "Vendedora" }), null, TODAY);
    expect(result).toEqual({ id: "e-self", created: false, merged: true });
    const rows = await employees();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: "test-user-comercial", name: "Maria Souza", position: "Vendedora" });
  });

  it("editar recusa e-mail e CPF de outro colaborador (CPF comparado só pelos dígitos)", async () => {
    const first = await saveEmployee(db, C, input({ document: "123.456.789-09" }), null, TODAY);
    const second = await saveEmployee(db, C, input({ name: "Pedro", email: "pedro@empresa.com" }), null, TODAY);
    await expect(saveEmployee(db, C, input({ name: "Pedro", email: "maria@empresa.com" }), second.id, TODAY)).rejects.toThrow(/e-mail: Maria Souza/);
    await expect(saveEmployee(db, C, input({ name: "Pedro", email: "pedro@empresa.com", document: "12345678909" }), second.id, TODAY)).rejects.toThrow(/CPF: Maria Souza/);
    await expect(saveEmployee(db, C, input({ manager_employee_id: first.id }), first.id, TODAY)).rejects.toThrow(/próprio gestor/);
    await expect(saveEmployee(db, C, input(), "nao-existe", TODAY)).rejects.toThrow(/não encontrado/);
  });

  it("validação da ficha", () => {
    const problem = (patch: Partial<EmployeeInput>) => validateEmployee(input(patch), TODAY);
    expect(problem({})).toBeNull();
    expect(problem({ name: "  " })).toMatch(/nome/);
    expect(problem({ email: "maria@" })).toMatch(/E-mail/);
    expect(problem({ document: "123.456" })).toMatch(/CPF/);
    expect(problem({ pis: "123" })).toMatch(/PIS/);
    expect(problem({ phone: "9999-0000" })).toMatch(/Telefone/);
    expect(problem({ birth_date: TODAY })).toMatch(/nascimento/);
    expect(problem({ birth_date: "1990-01-01", hire_date: "1989-01-01" })).toMatch(/admissão/);
    expect(problem({ daily_minutes: 30 })).toMatch(/Jornada/);
    expect(problem({ vacation_days_entitled: 61 })).toMatch(/férias/);
    expect(problem({ address: { ...EMPTY_ADDRESS, uf: "SPX" } })).toMatch(/UF/);
    expect(problem({ address: { ...EMPTY_ADDRESS, cep: "1803-100" } })).toMatch(/CEP/);
  });

  it("parseAddress tolera vazio, JSON inválido e números; formatAddress junta só o que existe", () => {
    expect(parseAddress(null)).toEqual(EMPTY_ADDRESS);
    expect(parseAddress("{}")).toEqual(EMPTY_ADDRESS);
    expect(parseAddress("não é json")).toEqual(EMPTY_ADDRESS);
    expect(parseAddress("[1,2]")).toEqual(EMPTY_ADDRESS);
    expect(parseAddress('{"numero":100,"cidade":"Sorocaba"}')).toEqual({ ...EMPTY_ADDRESS, numero: "100", cidade: "Sorocaba" });
    expect(formatAddress({ ...EMPTY_ADDRESS, logradouro: "Rua A", numero: "1", complemento: "Apto 2", bairro: "Centro", cidade: "Sorocaba", uf: "SP", cep: "18035-100" })).toBe("Rua A, 1 - Apto 2 · Centro · Sorocaba/SP · CEP 18035-100");
    expect(formatAddress(EMPTY_ADDRESS)).toBe("");
  });
});

describe("admissão e desligamento", () => {
  it("admissão cria o colaborador ativo e o checklist com prazos a partir do início", async () => {
    const { employeeId, taskIds } = await startAdmission(db, C, { name: "Rafael", email: "Rafael@Empresa.com", department: "TI", position: "Suporte", hire_date: "2026-11-02", contract_type: "clt" }, RH);
    const employee = await fetchEmployee(db, C, employeeId);
    expect(employee).toMatchObject({ name: "Rafael", email: "rafael@empresa.com", status: "ativo", hire_date: "2026-11-02", daily_minutes: 480 });
    const tasks = await tasksOf(employeeId);
    expect(taskIds).toHaveLength(ADMISSION_STEPS.length);
    expect(tasks.every((task) => task.category === "admissao" && task.status === "pendente" && task.created_by === RH)).toBe(true);
    expect(tasks[0].due_date).toBe("2026-10-28");
    expect(tasks.at(-1)?.due_date).toBe("2026-12-17");
    await expect(startAdmission(db, C, { name: "Outro", email: "rafael@empresa.com", department: "", position: "", hire_date: "2026-11-02", contract_type: "" }, RH)).rejects.toThrow(/Rafael/);
    await expect(startAdmission(db, C, { name: "Sem data", email: "", department: "", position: "", hire_date: "", contract_type: "" }, RH)).rejects.toThrow(/data de início/);
  });

  it("desligamento com data passada efetiva na hora; segundo desligamento é recusado", async () => {
    const { id } = await saveEmployee(db, C, input({ hire_date: "2020-01-10" }), null, TODAY);
    const result = await startTermination(db, C, id, { date: "2026-10-20", reason: "Pedido de demissão", notes: "Vai mudar de cidade" }, RH, TODAY);
    expect(result.effective).toBe(true);
    expect(await fetchEmployee(db, C, id)).toMatchObject({ status: "desligado", termination_date: "2026-10-20", termination_reason: "Pedido de demissão", notes: "Desligamento: Vai mudar de cidade" });
    expect((await tasksOf(id)).filter((task) => task.category === "desligamento")).toHaveLength(TERMINATION_STEPS.length);
    await expect(startTermination(db, C, id, { date: "2026-10-21", reason: "Outro" }, RH, TODAY)).rejects.toThrow(/já está desligad/);
    await expect(cancelTermination(db, C, id)).rejects.toThrow(/já foi efetivado/);
  });

  it("desligamento agendado: continua ativo até a data, pode ser cancelado, e applyDueTerminations efetiva na data", async () => {
    const { id } = await saveEmployee(db, C, input({ hire_date: "2020-01-10" }), null, TODAY);
    await expect(startTermination(db, C, id, { date: "2019-12-31", reason: "Outro" }, RH, TODAY)).rejects.toThrow(/antes da admissão/);
    const result = await startTermination(db, C, id, { date: "2026-11-15", reason: "Término de contrato" }, RH, TODAY);
    expect(result.effective).toBe(false);
    expect((await fetchEmployee(db, C, id))?.status).toBe("ativo");
    await expect(startTermination(db, C, id, { date: "2026-11-20", reason: "Outro" }, RH, TODAY)).rejects.toThrow(/em andamento/);

    expect(await applyDueTerminations(db, C, "2026-11-14")).toBe(0);
    expect(await applyDueTerminations(db, C, "2026-11-15")).toBe(1);
    expect((await fetchEmployee(db, C, id))?.status).toBe("desligado");
    expect(await applyDueTerminations(db, C, "2026-11-16")).toBe(0);
  });

  it("cancelar desligamento agendado limpa a data e retira só o checklist pendente de saída", async () => {
    const { id } = await saveEmployee(db, C, input(), null, TODAY);
    await db.execute("INSERT INTO hr_tasks (id, company_id, employee_id, title, status, category) VALUES (?,?,?,?,?,?)", ["geral-1", C, id, "Atualizar endereço", "pendente", "geral"]);
    const { taskIds } = await startTermination(db, C, id, { date: "2026-12-01", reason: "Outro" }, RH, TODAY);
    await setTaskDone(db, C, taskIds[0], true);
    await cancelTermination(db, C, id);
    expect(await fetchEmployee(db, C, id)).toMatchObject({ status: "ativo", termination_date: null, termination_reason: null });
    const left = await tasksOf(id);
    expect(left.map((task) => task.id).sort()).toEqual([taskIds[0], "geral-1"].sort());
    await expect(cancelTermination(db, C, id)).rejects.toThrow(/Não há desligamento/);
  });

  it("checklist: marcar e desmarcar; cycleCases agrupa, conta e ordena (em andamento primeiro)", async () => {
    const admission = await startAdmission(db, C, { name: "Bia", email: "", department: "", position: "", hire_date: "2026-10-26", contract_type: "pj" }, RH);
    const { id } = await saveEmployee(db, C, input({ hire_date: "2021-01-01" }), null, TODAY);
    const termination = await startTermination(db, C, id, { date: "2026-10-01", reason: "Outro" }, RH, TODAY);
    for (const taskId of termination.taskIds) await setTaskDone(db, C, taskId, true);
    await setTaskDone(db, C, admission.taskIds[0], true);
    await setTaskDone(db, C, admission.taskIds[0], false);
    await setTaskDone(db, C, admission.taskIds[1], true);

    const all = await db.select<Employee[]>("SELECT * FROM employees WHERE company_id=? AND deleted_at IS NULL", [C]);
    const tasks = await db.select<HrTask[]>("SELECT * FROM hr_tasks WHERE company_id=? AND deleted_at IS NULL", [C]);
    const cases = cycleCases(all, tasks, TODAY);
    expect(cases.map((item) => [item.employee.name, item.kind, item.complete])).toEqual([["Bia", "admissao", false], ["Maria Souza", "desligamento", true]]);
    expect(cases[0]).toMatchObject({ date: "2026-10-26", done: 1, total: ADMISSION_STEPS.length, late: 1 });
    expect(cases[1]).toMatchObject({ date: "2026-10-01", done: TERMINATION_STEPS.length, late: 0 });
    expect(cycleCases(all.filter((employee) => employee.name !== "Bia"), tasks, TODAY)).toHaveLength(1);
  });
});

describe("banco de horas no banco", () => {
  let employeeId: string;
  beforeEach(async () => {
    employeeId = (await saveEmployee(db, C, input(), null, TODAY)).id;
  });

  it("colaborador lança pendente; RH lança já aprovado; validação vale para os dois", async () => {
    await addTimeEntry(db, C, { employeeId, date: "2026-10-20", minutes: 90, reason: "Fechamento" }, "test-user-comercial", TODAY);
    await addTimeEntry(db, C, { employeeId, date: "2026-10-21", minutes: -60, reason: "Saída antecipada" }, RH, TODAY, RH);
    const entries = await fetchEmployeeTimeEntries(db, C, employeeId);
    expect(entries.map((entry) => [entry.entry_date, entry.minutes, entry.status, entry.decided_by])).toEqual([
      ["2026-10-21", -60, "aprovada", RH],
      ["2026-10-20", 90, "pendente", null],
    ]);
    await expect(addTimeEntry(db, C, { employeeId, date: "2026-10-25", minutes: 60, reason: "Futuro" }, RH, TODAY, RH)).rejects.toThrow(/futuro/);
  });

  it("aprovar/recusar só o que está pendente (confere no banco)", async () => {
    const id = await addTimeEntry(db, C, { employeeId, date: "2026-10-20", minutes: 30, reason: "Reunião" }, "test-user-comercial", TODAY);
    await decideTimeEntry(db, C, id, true, RH);
    const [entry] = await db.select<HrTimeEntry[]>("SELECT * FROM hr_time_entries WHERE id=?", [id]);
    expect(entry).toMatchObject({ status: "aprovada", decided_by: RH });
    expect(entry.decided_at).toBeTruthy();
    await expect(decideTimeEntry(db, C, id, false, RH)).rejects.toThrow(/já foi decidido/);
    await expect(decideTimeEntry(db, C, "x", true, RH)).rejects.toThrow(/não encontrado/);
  });

  it("retirar lançamento: só o próprio e só pendente", async () => {
    const pending = await addTimeEntry(db, C, { employeeId, date: "2026-10-20", minutes: 30, reason: "Reunião" }, "test-user-comercial", TODAY);
    const approved = await addTimeEntry(db, C, { employeeId, date: "2026-10-19", minutes: 30, reason: "Reunião" }, RH, TODAY, RH);
    await expect(withdrawTimeEntry(db, C, pending, "outro-colaborador")).rejects.toThrow(/não encontrado/);
    await expect(withdrawTimeEntry(db, C, approved, employeeId)).rejects.toThrow(/pendente/);
    await withdrawTimeEntry(db, C, pending, employeeId);
    expect((await fetchTimeEntries(db, C)).map((entry) => entry.id)).toEqual([approved]);
  });
});
