// Gravação das tabelas editáveis do RH (colaboradores, solicitações, pendências, comunicados e banco de horas):
// permissão e regras conferidas na camada de dados. SQLite real.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, insertTestCompany, type TestDb } from "@/test/sqlite";
import { emptyEmployeeInput, saveEmployee } from "./employees";
import { addTimeEntry } from "./timebank";
import {
  requestCalendarItems,
  saveAnnouncementRows,
  saveEmployeeRows,
  saveRequestRows,
  saveTaskRows,
  saveTimeEntryRows,
  taskCalendarItems,
  timeEntryCalendarItems,
  timeEntryRows,
} from "./tableEdits";
import type { Employee, HrAnnouncement, HrRequest, HrTask, HrTimeEntry } from "@/types";

const C = "test-company";
const TODAY = "2026-10-25";
const rh = { role: "rh" as const, userId: "test-user-rh" };
let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
  await insertTestCompany(db);
});
afterEach(() => db.close());

const employee = async (name: string, patch: Partial<ReturnType<typeof emptyEmployeeInput>> = {}) => (await saveEmployee(db, C, { ...emptyEmployeeInput(), name, hire_date: "2020-01-01", ...patch }, null, TODAY)).id;
const one = async <T,>(sql: string, args: unknown[]) => (await db.select<T[]>(sql, args))[0];

describe("colaboradores na tabela", () => {
  it("cria e altera só os campos da tabela, mantendo o resto da ficha", async () => {
    const { created } = await saveEmployeeRows(db, C, "rh", { created: [{ name: "Ana Lima", email: "Ana@Empresa.com", department: "Comercial", hire_date: "2024-03-01", contract_type: "clt" }], updated: [] }, TODAY);
    const id = created[0];
    await db.execute("UPDATE employees SET phone=? WHERE id=?", ["(15) 99999-0000", id]);
    await saveEmployeeRows(db, C, "rh", { created: [], updated: [{ id, position: "Vendedora", contract_type: "pj" }] }, TODAY);
    expect(await one<Employee>("SELECT * FROM employees WHERE id=?", [id])).toMatchObject({ name: "Ana Lima", email: "ana@empresa.com", department: "Comercial", position: "Vendedora", contract_type: "pj", phone: "(15) 99999-0000", hire_date: "2024-03-01" });
  });

  it("confere permissão e as regras da ficha", async () => {
    await expect(saveEmployeeRows(db, C, "comercial", { created: [{ name: "X" }], updated: [] }, TODAY)).rejects.toThrow(/permissão/);
    await expect(saveEmployeeRows(db, C, "rh", { created: [{ name: "Y", email: "sem-arroba" }], updated: [] }, TODAY)).rejects.toThrow(/E-mail inválido/);
    await expect(saveEmployeeRows(db, C, "rh", { created: [], updated: [{ id: "nao-existe", name: "Z" }] }, TODAY)).rejects.toThrow(/não encontrado/);
  });
});

describe("solicitações na tabela", () => {
  it("RH registra em nome do colaborador e corrige só a pendente", async () => {
    const ana = await employee("Ana");
    const { created } = await saveRequestRows(db, C, rh, { created: [{ employee_id: ana, type: "ferias", start_date: "2026-11-02", end_date: "2026-11-11", reason: "Viagem" }], updated: [] }, TODAY);
    expect(await one<HrRequest>("SELECT * FROM hr_requests WHERE id=?", [created[0]])).toMatchObject({ employee_id: ana, days: 10, status: "pendente" });
    await saveRequestRows(db, C, rh, { created: [], updated: [{ id: created[0], end_date: "2026-11-06" }] }, TODAY);
    expect((await one<HrRequest>("SELECT * FROM hr_requests WHERE id=?", [created[0]])).days).toBe(5);
    await db.execute("UPDATE hr_requests SET status='aprovada' WHERE id=?", [created[0]]);
    await expect(saveRequestRows(db, C, rh, { created: [], updated: [{ id: created[0], reason: "Outro" }] }, TODAY)).rejects.toThrow(/já foi decidida/);
  });

  it("colaborador pede para si (Meu RH) com as regras de saldo e não altera", async () => {
    const me = await employee("Bia", { vacation_days_entitled: 5 });
    const self = { role: "tecnico" as const, userId: "test-user-tecnico" };
    await expect(saveRequestRows(db, C, self, { created: [{ type: "ferias", start_date: "2026-11-02", end_date: "2026-11-11" }], updated: [] }, TODAY, { employeeId: me, self: true })).rejects.toThrow(/5 dia\(s\) de férias/);
    const { created } = await saveRequestRows(db, C, self, { created: [{ type: "folga", start_date: "2026-11-02", end_date: "2026-11-02" }], updated: [] }, TODAY, { employeeId: me, self: true });
    expect(await one<HrRequest>("SELECT * FROM hr_requests WHERE id=?", [created[0]])).toMatchObject({ employee_id: me, type: "folga", days: 1 });
    await expect(saveRequestRows(db, C, self, { created: [], updated: [{ id: created[0], reason: "X" }] }, TODAY, { employeeId: me, self: true })).rejects.toThrow(/RH/);
    await expect(saveRequestRows(db, C, { role: "comercial", userId: "test-user-comercial" }, { created: [{ employee_id: me, type: "folga", start_date: "2026-11-03", end_date: "2026-11-03" }], updated: [] }, TODAY)).rejects.toThrow(/permissão/);
  });
});

describe("pendências e comunicados na tabela", () => {
  it("pendência para todos os ativos, edição de prazo e conclusão", async () => {
    const a = await employee("Ana");
    const b = await employee("Bruno");
    const { created } = await saveTaskRows(db, C, rh, { created: [{ employee_id: "todos", title: "Atualizar endereço", due_date: "2026-11-30" }], updated: [] }, [a, b]);
    expect(created).toHaveLength(2);
    await saveTaskRows(db, C, rh, { created: [], updated: [{ id: created[0], due_date: "2026-12-15", status: "concluida" }] }, [a, b]);
    expect(await one<HrTask>("SELECT * FROM hr_tasks WHERE id=?", [created[0]])).toMatchObject({ due_date: "2026-12-15", status: "concluida", category: "geral" });
    await expect(saveTaskRows(db, C, rh, { created: [{ employee_id: a, title: " " }], updated: [] }, [a, b])).rejects.toThrow(/pendência/);
    await expect(saveTaskRows(db, C, { role: "gerente", userId: "test-user-gerente" }, { created: [{ employee_id: a, title: "X" }], updated: [] }, [a, b])).rejects.toThrow(/permissão/);
  });

  it("comunicado novo e edição (fixar, texto)", async () => {
    const { created } = await saveAnnouncementRows(db, C, rh, { created: [{ title: "Recesso", body: "Dias 24 e 31", category: "comunicado" }], updated: [] });
    await saveAnnouncementRows(db, C, rh, { created: [], updated: [{ id: created[0], pinned: 1, body: "Dias 24 e 31 de dezembro" }] });
    expect(await one<HrAnnouncement>("SELECT * FROM hr_announcements WHERE id=?", [created[0]])).toMatchObject({ title: "Recesso", pinned: 1, body: "Dias 24 e 31 de dezembro", published_by: "test-user-rh" });
    await expect(saveAnnouncementRows(db, C, rh, { created: [{ title: "Sem texto", body: "" }], updated: [] })).rejects.toThrow(/texto/);
  });
});

describe("banco de horas na tabela", () => {
  it("RH lança aprovado com sinal no texto; só pendente se altera", async () => {
    const ana = await employee("Ana");
    const { created } = await saveTimeEntryRows(db, C, rh, { created: [{ employee_id: ana, entry_date: TODAY, hours: "-0:30", reason: "Saída antecipada" }], updated: [] }, TODAY, { mode: "rh" });
    expect(await one<HrTimeEntry>("SELECT * FROM hr_time_entries WHERE id=?", [created[0]])).toMatchObject({ minutes: -30, status: "aprovada", decided_by: "test-user-rh" });
    await expect(saveTimeEntryRows(db, C, rh, { created: [], updated: [{ id: created[0], reason: "X" }] }, TODAY, { mode: "rh" })).rejects.toThrow(/já decidido/);
    const pending = await addTimeEntry(db, C, { employeeId: ana, date: TODAY, minutes: 60, reason: "Plantão" }, "test-user-tecnico", TODAY);
    await saveTimeEntryRows(db, C, rh, { created: [], updated: [{ id: pending, hours: "1h30" }] }, TODAY, { mode: "rh" });
    expect((await one<HrTimeEntry>("SELECT * FROM hr_time_entries WHERE id=?", [pending])).minutes).toBe(90);
    await expect(saveTimeEntryRows(db, C, rh, { created: [{ employee_id: ana, entry_date: TODAY, hours: "abc", reason: "X" }], updated: [] }, TODAY, { mode: "rh" })).rejects.toThrow(/duração/);
  });

  it("colaborador informa pendente para si e não altera", async () => {
    const me = await employee("Caio");
    const self = { role: "tecnico" as const, userId: "test-user-tecnico" };
    const { created } = await saveTimeEntryRows(db, C, self, { created: [{ entry_date: TODAY, hours: "1h15", reason: "Plantão" }], updated: [] }, TODAY, { mode: "self", employeeId: me });
    expect(await one<HrTimeEntry>("SELECT * FROM hr_time_entries WHERE id=?", [created[0]])).toMatchObject({ employee_id: me, minutes: 75, status: "pendente", decided_by: null });
    await expect(saveTimeEntryRows(db, C, self, { created: [], updated: [{ id: created[0], hours: "2h" }] }, TODAY, { mode: "self", employeeId: me })).rejects.toThrow(/RH/);
  });

  it("trocar o colaborador de um lançamento é recusado, não ignorado", async () => {
    const ana = await employee("Ana");
    const bia = await employee("Bia");
    const pending = await addTimeEntry(db, C, { employeeId: ana, date: TODAY, minutes: 60, reason: "Plantão" }, "test-user-tecnico", TODAY);
    await expect(saveTimeEntryRows(db, C, rh, { created: [], updated: [{ id: pending, employee_id: bia }] }, TODAY, { mode: "rh" })).rejects.toThrow(/outro lançamento/);
    expect((await one<HrTimeEntry>("SELECT * FROM hr_time_entries WHERE id=?", [pending])).employee_id).toBe(ana);
  });
});

// A tabela mantém todos os rascunhos quando a gravação falha: se uma linha errada só aparecesse depois de outras já
// gravadas, salvar de novo duplicaria essas outras. Por isso tudo é conferido antes da primeira escrita.
describe("lote com uma linha errada não grava nenhuma", () => {
  const count = async (table: string) => (await db.select<{ n: number }[]>(`SELECT COUNT(*) AS n FROM ${table} WHERE company_id=? AND deleted_at IS NULL`, [C]))[0].n;

  it("banco de horas: o RH lança duas horas e a segunda está errada", async () => {
    const ana = await employee("Ana");
    await expect(saveTimeEntryRows(db, C, rh, { created: [{ employee_id: ana, entry_date: TODAY, hours: "2:00", reason: "Plantão" }, { employee_id: ana, entry_date: TODAY, hours: "abc", reason: "X" }], updated: [] }, TODAY, { mode: "rh" })).rejects.toThrow(/duração/);
    expect(await count("hr_time_entries")).toBe(0);
    const pending = await addTimeEntry(db, C, { employeeId: ana, date: TODAY, minutes: 60, reason: "Plantão" }, "test-user-tecnico", TODAY);
    await expect(saveTimeEntryRows(db, C, rh, { created: [{ employee_id: "nao-existe", entry_date: TODAY, hours: "1:00", reason: "X" }], updated: [{ id: pending, hours: "3:00" }] }, TODAY, { mode: "rh" })).rejects.toThrow(/não encontrado/);
    expect((await one<HrTimeEntry>("SELECT * FROM hr_time_entries WHERE id=?", [pending])).minutes).toBe(60);
    expect(await count("hr_time_entries")).toBe(1);
  });

  it("solicitações: o saldo de férias conta as outras linhas do mesmo lote", async () => {
    const ana = await employee("Ana", { vacation_days_entitled: 15 });
    const twoVacations = [
      { employee_id: ana, type: "ferias" as const, start_date: "2026-11-02", end_date: "2026-11-11" },
      { employee_id: ana, type: "ferias" as const, start_date: "2026-12-01", end_date: "2026-12-10" },
    ];
    await expect(saveRequestRows(db, C, rh, { created: twoVacations, updated: [] }, TODAY)).rejects.toThrow(/5 dia\(s\) de férias/);
    expect(await count("hr_requests")).toBe(0);
    await expect(saveRequestRows(db, C, rh, { created: [{ employee_id: ana, type: "folga", start_date: "2026-11-02", end_date: "2026-11-02" }, { employee_id: ana, type: "folga", start_date: "2026-11-05", end_date: "2026-11-04" }], updated: [] }, TODAY)).rejects.toThrow(/anterior/);
    expect(await count("hr_requests")).toBe(0);

    const { created } = await saveRequestRows(db, C, rh, { created: [twoVacations[0]], updated: [] }, TODAY);
    // Aumentar a pendente para 12 dias e pedir mais 10 passa do direito (15): nada muda.
    await expect(saveRequestRows(db, C, rh, { created: [twoVacations[1]], updated: [{ id: created[0], end_date: "2026-11-13" }] }, TODAY)).rejects.toThrow(/3 dia\(s\) de férias/);
    expect(await count("hr_requests")).toBe(1);
    expect((await one<HrRequest>("SELECT * FROM hr_requests WHERE id=?", [created[0]])).days).toBe(10);
  });

  it("pendências e comunicados", async () => {
    const a = await employee("Ana");
    await expect(saveTaskRows(db, C, rh, { created: [{ employee_id: a, title: "Assinar contrato" }, { employee_id: a, title: " " }], updated: [] }, [a])).rejects.toThrow(/pendência/);
    expect(await count("hr_tasks")).toBe(0);
    const { created } = await saveTaskRows(db, C, rh, { created: [{ employee_id: a, title: "Assinar contrato" }], updated: [] }, [a]);
    await expect(saveTaskRows(db, C, rh, { created: [{ employee_id: "inativo", title: "Outra" }], updated: [{ id: created[0], status: "concluida" }] }, [a])).rejects.toThrow(/para quem/);
    expect((await one<HrTask>("SELECT * FROM hr_tasks WHERE id=?", [created[0]])).status).toBe("pendente");

    await expect(saveAnnouncementRows(db, C, rh, { created: [{ title: "Recesso", body: "Dia 24" }, { title: "Sem texto", body: "" }], updated: [] })).rejects.toThrow(/texto/);
    expect(await count("hr_announcements")).toBe(0);
  });

  it("colaboradores: regras da ficha e e-mail de outra pessoa conferidos antes de gravar", async () => {
    const a = await employee("Ana", { email: "ana@empresa.com" });
    const b = await employee("Bruno");
    await employee("Eduardo", { email: "edu@empresa.com", status: "desligado" });
    const before = await count("employees");

    await expect(saveEmployeeRows(db, C, "rh", { created: [{ name: "Caio" }, { name: "Duda", email: "sem-arroba" }], updated: [{ id: a, position: "Gerente" }] }, TODAY)).rejects.toThrow(/E-mail inválido/);
    await expect(saveEmployeeRows(db, C, "rh", { created: [], updated: [{ id: a, position: "Gerente" }, { id: b, email: "ANA@empresa.com" }] }, TODAY)).rejects.toThrow(/Já existe um colaborador com este e-mail: Ana/);
    await expect(saveEmployeeRows(db, C, "rh", { created: [{ name: "Caio" }, { name: "Edu", email: "edu@empresa.com" }], updated: [] }, TODAY)).rejects.toThrow(/desligado/);
    expect(await count("employees")).toBe(before);
    expect((await one<Employee>("SELECT * FROM employees WHERE id=?", [a])).position).toBeNull();

    // Trocar e-mails entre duas pessoas no mesmo lote continua possível (vale o resultado final).
    await saveEmployeeRows(db, C, "rh", { created: [], updated: [{ id: a, email: "ana.lima@empresa.com" }, { id: b, email: "ana@empresa.com" }] }, TODAY);
    expect((await one<Employee>("SELECT * FROM employees WHERE id=?", [b])).email).toBe("ana@empresa.com");
  });
});

describe("itens do calendário", () => {
  it("férias com fim exclusivo, horas no dia e prazos das pendências", () => {
    const names = new Map([["e1", "Ana"]]);
    const requests = [
      { id: "r1", employee_id: "e1", type: "ferias", start_date: "2026-11-02", end_date: "2026-11-06", status: "aprovada" },
      { id: "r2", employee_id: "e1", type: "folga", start_date: "2026-11-09", end_date: "2026-11-09", status: "recusada" },
    ] as HrRequest[];
    expect(requestCalendarItems(requests, names)).toEqual([{ id: "r1", title: "Ana: Férias", start: "2026-11-02", end: "2026-11-07", allDay: true, sourceLabel: "Aprovada" }]);
    const entries = timeEntryRows([{ id: "t1", employee_id: "e1", entry_date: "2026-10-20", minutes: 90, status: "pendente" } as HrTimeEntry]);
    expect(entries[0].hours).toBe("+1h30");
    expect(timeEntryCalendarItems(entries, names)).toEqual([{ id: "t1", title: "Ana +1h30", start: "2026-10-20", allDay: true, sourceLabel: "Pendente" }]);
    expect(taskCalendarItems([{ id: "k1", employee_id: "e1", title: "Assinar", due_date: "2026-10-30", status: "pendente" } as HrTask, { id: "k2", employee_id: "e1", title: "Sem prazo", status: "pendente" } as HrTask], names)).toEqual([{ id: "k1", title: "Ana: Assinar", start: "2026-10-30", allDay: true, sourceLabel: "Pendente" }]);
  });
});
