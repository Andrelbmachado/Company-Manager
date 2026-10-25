// Telas do RH completo no SQLite real: banco de horas (equipe e meu), ficha do colaborador, admissões/desligamentos
// e a lista da Gestão de RH ligada à ficha.
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionContext } from "@/hooks/useSession";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { todayIso } from "@/lib/utils";
import { addTimeEntry, decideTimeEntry } from "@/lib/hr/timebank";
import { saveEmployee, emptyEmployeeInput } from "@/lib/hr/employees";
import { startTermination } from "@/lib/hr/employment";
import type { Employee, HrTask, HrTimeEntry, Role, Session } from "@/types";
import TimeBankPage from "./TimeBankPage";
import MyTimeBankPage from "./MyTimeBankPage";
import EmployeeDetailPage from "./EmployeeDetailPage";
import EmploymentCyclePage from "./EmploymentCyclePage";
import HrManagePage from "./HrManagePage";
import MyHrPage from "./MyHrPage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const C = "test-company";
const testDb = useTestDb();
let root: Root | null = null;
let container: HTMLDivElement;

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
});

function sessionFor(role: Role): Session {
  const stamp = "2026-01-01T00:00:00.000Z";
  return {
    user: { id: `test-user-${role}`, name: `Teste ${role}`, email: `${role}@teste.local`, status: "active", locale: "pt-BR", created_at: stamp, updated_at: stamp },
    membership: { id: `test-member-${C}-${role}`, company_id: C, user_id: `test-user-${role}`, role, scope: "setor", created_at: stamp, updated_at: stamp },
    company: { id: C, name: "Empresa de Teste", settings_json: "{}", created_at: stamp, updated_at: stamp },
  } as Session;
}

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

async function render(role: Role, path: string, routePath: string, page: ReactElement): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SessionContext.Provider value={{ session: sessionFor(role), setSession: () => undefined }}>
          <MemoryRouter initialEntries={[path]}>
            <Routes><Route path={routePath} element={<>{page}<Where /></>} /></Routes>
          </MemoryRouter>
        </SessionContext.Provider>
      </QueryClientProvider>,
    );
  });
}

async function waitFor(check: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (check()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
  throw new Error(`Não apareceu: ${what}. Tela: ${container.textContent?.slice(0, 400)}`);
}

const text = () => (container.textContent ?? "").replace(/\s/g, " ");
const has = (value: string) => text().includes(value);

function control(label: string): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  const found = Array.from(container.querySelectorAll("label")).find((element) => (element.firstChild?.textContent ?? "").trim() === label);
  const input = found?.querySelector("input, select, textarea");
  if (!input) throw new Error(`Campo não encontrado: ${label}`);
  return input as HTMLInputElement;
}

async function fill(label: string, value: string): Promise<void> {
  const element = control(label);
  const proto = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

function clickable(label: string): HTMLElement {
  const found = Array.from(container.querySelectorAll<HTMLElement>("button, a")).find((element) => element.textContent?.trim() === label || element.getAttribute("aria-label") === label);
  if (!found) throw new Error(`Botão não encontrado: ${label}`);
  return found;
}

/** Campo de uma célula da EditableTable pelo aria-label ("Horas (nova linha)", "Status (linha 1)"). */
function cell(label: string): HTMLInputElement | HTMLSelectElement {
  const found = container.querySelector<HTMLInputElement | HTMLSelectElement>(`[aria-label="${label}"]`);
  if (!found) throw new Error(`Célula não encontrada: ${label}`);
  return found;
}

async function setCell(label: string, value: string): Promise<void> {
  const element = cell(label);
  const proto = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

function tableButton(label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll<HTMLButtonElement>("[data-editable-table] button")).find((button) => button.textContent?.trim() === label);
  if (!found) throw new Error(`Botão da tabela não encontrado: ${label}`);
  return found;
}

async function click(target: string | HTMLElement): Promise<void> {
  const element = typeof target === "string" ? clickable(target) : target;
  await act(async () => {
    element.click();
  });
}

async function newEmployee(name: string, patch: Partial<ReturnType<typeof emptyEmployeeInput>> = {}): Promise<string> {
  return (await saveEmployee(testDb(), C, { ...emptyEmployeeInput(), name, ...patch }, null, todayIso())).id;
}

describe("Banco de horas da equipe (RH)", () => {
  it("aprova o que o colaborador informou, mostra o saldo e lança horas já aprovadas", async () => {
    const db = testDb();
    await insertTestCompany(db);
    const ana = await newEmployee("Ana Lima", { department: "Comercial" });
    const pending = await addTimeEntry(db, C, { employeeId: ana, date: todayIso(), minutes: 90, reason: "Fechamento" }, "test-user-comercial", todayIso());

    await render("rh", "/hr/manage/banco-de-horas", "/hr/manage/banco-de-horas", <TimeBankPage />);
    expect(container.querySelector("h1")?.textContent).toBe("Banco de horas da equipe");
    await waitFor(() => has("Fechamento") && !!container.querySelector("a[href$='/hr/manage/colaboradores/" + ana + "']"), "lançamento pendente");

    await click("Aguardando aprovação (1)");
    await click("Aprovar");
    await waitFor(() => has("Nenhum lançamento aguardando"), "aprovação");
    const [entry] = await db.select<HrTimeEntry[]>("SELECT * FROM hr_time_entries WHERE id=?", [pending]);
    expect(entry).toMatchObject({ status: "aprovada", decided_by: "test-user-rh" });
    expect(has("+1h30")).toBe(true);

    // Lançamento do RH direto na tabela (sem diálogo): entra já aprovado.
    await click("Todos");
    await click(tableButton("Adicionar"));
    expect(container.querySelector("[role=dialog]")).toBeNull();
    await setCell("Colaborador (nova linha)", ana);
    await setCell("Horas (nova linha)", "-0:30");
    await setCell("Motivo (nova linha)", "Saída antecipada");
    await click(tableButton("Salvar"));
    await waitFor(() => has("1 linha salva"), "lançamento salvo");
    const rows = await db.select<HrTimeEntry[]>("SELECT * FROM hr_time_entries WHERE company_id=? AND employee_id=? ORDER BY minutes", [C, ana]);
    expect(rows.map((row) => [row.minutes, row.status])).toEqual([[-30, "aprovada"], [90, "aprovada"]]);
    await waitFor(() => has("+1h00"), "saldo atualizado");
  });
});

describe("Saldo por colaborador", () => {
  it("ordena pelo saldo (negativo antes) e filtra o colaborador e o saldo em horas", async () => {
    const db = testDb();
    await insertTestCompany(db);
    const ana = await newEmployee("Ana Lima");
    const bruno = await newEmployee("Bruno Reis");
    for (const [employeeId, minutes] of [[ana, -60], [bruno, 150]] as const) {
      const id = await addTimeEntry(db, C, { employeeId, date: todayIso(), minutes, reason: "Ajuste" }, "test-user-rh", todayIso());
      await decideTimeEntry(db, C, id, true, "test-user-rh");
    }
    await render("rh", "/hr/manage/banco-de-horas", "/hr/manage/banco-de-horas", <TimeBankPage />);
    const panel = () => container.querySelector<HTMLElement>("section[aria-label='Saldo por colaborador']")!;
    const people = () => [...panel().querySelectorAll("tbody tr")].map((row) => row.querySelector("a")?.textContent);
    await waitFor(() => people().length === 2 && has("+2h30"), "saldos");

    await click(panel().querySelector<HTMLElement>("th [data-sort-key='balance']")!);
    expect(people()).toEqual(["Ana Lima", "Bruno Reis"]);
    await click(panel().querySelector<HTMLElement>("th [data-sort-key='balance']")!);
    expect(people()).toEqual(["Bruno Reis", "Ana Lima"]);

    await click(panel().querySelector<HTMLElement>("button[aria-label='Filtrar']")!);
    await setCell("Colaborador: contém", "bru");
    expect(people()).toEqual(["Bruno Reis"]);
    await setCell("Colaborador: contém", "");
    await setCell("Saldo: máximo", "0");
    expect(people()).toEqual(["Ana Lima"]);
  });
});

describe("Lançamentos do banco de horas", () => {
  it("Horas ordena e filtra pelo tempo (negativo maior antes), não pelo texto", async () => {
    const db = testDb();
    await insertTestCompany(db);
    const ana = await newEmployee("Ana Lima");
    for (const minutes of [-30, 90, -120]) {
      const id = await addTimeEntry(db, C, { employeeId: ana, date: todayIso(), minutes, reason: `Ajuste ${minutes}` }, "test-user-rh", todayIso());
      await decideTimeEntry(db, C, id, true, "test-user-rh");
    }
    await render("rh", "/hr/manage/banco-de-horas", "/hr/manage/banco-de-horas", <TimeBankPage />);
    await waitFor(() => has("Ajuste -120"), "lançamentos");
    await click("Todos");
    const table = () => container.querySelector<HTMLElement>("[data-editable-table]")!;
    const hoursOf = () => [...table().querySelectorAll("tr[data-row-key] td[data-column='hours']")].map((item) => item.textContent?.replace("−", "-"));
    await waitFor(() => hoursOf().length === 3, "três lançamentos");
    await click(table().querySelector<HTMLElement>("th [data-sort-key='hours']")!);
    expect(hoursOf()).toEqual(["-2h00", "-0h30", "+1h30"]);

    await click(table().querySelector<HTMLElement>("button[aria-label='Filtrar']")!);
    await setCell("Horas: mínimo", "-1");
    expect(hoursOf()).toEqual(["-0h30", "+1h30"]);
  });
});

describe("Meu banco de horas (qualquer colaborador)", () => {
  it("informa horas (pendente para o RH) e retira o pedido", async () => {
    const db = testDb();
    await insertTestCompany(db);
    await render("tecnico", "/hr/banco-de-horas", "/hr/banco-de-horas", <MyTimeBankPage />);
    expect(container.querySelector("h1")?.textContent).toBe("Meu banco de horas");
    await waitFor(() => has("Nenhum lançamento ainda"), "extrato vazio");

    await click(tableButton("Adicionar"));
    expect(container.querySelector("[role=dialog]")).toBeNull();
    await setCell("Horas (nova linha)", "1h15");
    await setCell("Motivo (nova linha)", "Plantão do servidor");
    await click(tableButton("Salvar"));
    await waitFor(() => has("Plantão do servidor"), "lançamento no extrato");
    const [entry] = await db.select<HrTimeEntry[]>("SELECT * FROM hr_time_entries WHERE company_id=?", [C]);
    expect(entry).toMatchObject({ minutes: 75, status: "pendente", decided_by: null });
    const [me] = await db.select<Employee[]>("SELECT * FROM employees WHERE id=?", [entry.employee_id]);
    expect(me.user_id).toBe("test-user-tecnico");

    await click(container.querySelector<HTMLElement>("button[aria-label^='Retirar']")!);
    await waitFor(() => has("Nenhum lançamento ainda"), "retirado");
  });
});

describe("Meu RH (qualquer colaborador)", () => {
  it("checklist de admissão/desligamento é do RH: não aparece nem conta nas pendências da própria pessoa", async () => {
    const db = testDb();
    await insertTestCompany(db);
    const me = await newEmployee("Teste tecnico", { email: "tecnico@teste.local", hire_date: "2020-01-01" });
    // Desligamento agendado: a pessoa não descobre pelo Meu RH nem marca itens do checklist do RH.
    await startTermination(db, C, me, { date: "2099-01-01", reason: "Outro" }, "test-user-rh", todayIso());
    await db.execute("INSERT INTO hr_tasks (id, company_id, employee_id, title, status, category) VALUES (?,?,?,?,?,?)", ["g1", C, me, "Enviar comprovante de endereço", "pendente", "geral"]);

    await render("tecnico", "/hr", "/hr", <MyHrPage />);
    await waitFor(() => has("Enviar comprovante de endereço"), "pendência geral");
    expect(has("Formalizar o desligamento")).toBe(false);
    const card = Array.from(container.querySelectorAll("p")).find((element) => element.textContent === "Pendências abertas")?.parentElement;
    expect(card?.querySelectorAll("p")[1]?.textContent).toBe("1");
  });
});

describe("Ficha do colaborador", () => {
  it("cadastra uma ficha nova completa e abre a página dela", async () => {
    const db = testDb();
    await insertTestCompany(db);
    await render("rh", "/hr/manage/colaboradores/nova", "/hr/manage/colaboradores/:id", <EmployeeDetailPage />);
    expect(container.querySelector("h1")?.textContent).toBe("Novo colaborador");
    expect(has("Documentos")).toBe(false);

    await fill("Nome completo", "Bruno Reis");
    await fill("E-mail", "Bruno@Empresa.com");
    await fill("CPF", "123.456.789-09");
    await fill("Contrato", "pj");
    await fill("Jornada diária", "6h");
    await fill("Cidade", "Sorocaba");
    await fill("UF", "sp");
    await click("Cadastrar colaborador");

    await waitFor(() => !container.querySelector("[data-testid=where]")?.textContent?.endsWith("/nova"), "navegou para a ficha");
    const [saved] = await db.select<Employee[]>("SELECT * FROM employees WHERE company_id=?", [C]);
    expect(saved).toMatchObject({ name: "Bruno Reis", email: "bruno@empresa.com", contract_type: "pj", daily_minutes: 360, document: "123.456.789-09" });
    expect(JSON.parse(saved.address_json ?? "{}")).toEqual({ cidade: "Sorocaba", uf: "SP" });
    expect(container.querySelector("[data-testid=where]")?.textContent).toBe(`/hr/manage/colaboradores/${saved.id}`);
    await waitFor(() => container.querySelector("h1")?.textContent === "Bruno Reis", "título com o nome");
    expect(has("Colaborador cadastrado")).toBe(true);
  });

  it("mostra erro de validação sem gravar", async () => {
    const db = testDb();
    await insertTestCompany(db);
    await render("rh", "/hr/manage/colaboradores/nova", "/hr/manage/colaboradores/:id", <EmployeeDetailPage />);
    await fill("Nome completo", "Carla");
    await fill("CPF", "123");
    await click("Cadastrar colaborador");
    await waitFor(() => has("O CPF precisa ter 11 dígitos."), "erro do CPF");
    expect(await db.select("SELECT * FROM employees WHERE company_id=?", [C])).toHaveLength(0);
  });

  it("ficha existente: abas, desligamento com checklist e documentos (sem salário)", async () => {
    const db = testDb();
    await insertTestCompany(db);
    const id = await newEmployee("Davi Costa", { hire_date: "2022-02-01", position: "Técnico" });
    await render("rh", `/hr/manage/colaboradores/${id}`, "/hr/manage/colaboradores/:id", <EmployeeDetailPage />);
    await waitFor(() => container.querySelector("h1")?.textContent === "Davi Costa", "ficha carregada");
    expect((control("Nome completo") as HTMLInputElement).value).toBe("Davi Costa");
    expect(text().toLowerCase()).not.toContain("salário");

    await click("Registrar desligamento");
    expect(container.querySelector("[role=dialog]")).toBeNull();
    const form = container.querySelector<HTMLFormElement>("[data-termination-form]")!;
    expect(form.getAttribute("aria-label")).toBe("Registrar desligamento de Davi Costa");
    const reason = Array.from(form.querySelectorAll("label")).find((label) => label.firstChild?.textContent === "Motivo")!.querySelector("select")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(reason, "Acordo entre as partes");
      reason.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await click(Array.from(form.querySelectorAll<HTMLElement>("button")).find((button) => button.textContent === "Confirmar desligamento")!);
    await waitFor(() => !container.querySelector("[data-termination-form]") && has("Formalizar o desligamento"), "checklist de saída");
    expect((await db.select<Employee[]>("SELECT * FROM employees WHERE id=?", [id]))[0]).toMatchObject({ status: "desligado", termination_reason: "Acordo entre as partes" });

    const first = container.querySelector<HTMLInputElement>("input[type=checkbox][aria-label^='Formalizar']")!;
    await click(first);
    await waitFor(() => has("1 de 6 itens"), "item marcado");
    const tasks = await db.select<HrTask[]>("SELECT * FROM hr_tasks WHERE employee_id=? AND status='concluida'", [id]);
    expect(tasks).toHaveLength(1);

    await click("Documentos");
    const attachments = container.querySelector("[data-entity-type='employee']");
    expect(attachments?.getAttribute("data-entity-id")).toBe(id);
  });
});

describe("Readmissão pela ficha", () => {
  it("desligado volta a Ativo pela ficha: o desligamento e o checklist de saída deixam de valer", async () => {
    const db = testDb();
    await insertTestCompany(db);
    const id = await newEmployee("Ivo Ramos", { hire_date: "2020-01-01" });
    await startTermination(db, C, id, { date: "2020-06-01", reason: "Outro" }, "test-user-rh", todayIso());
    await render("rh", `/hr/manage/colaboradores/${id}`, "/hr/manage/colaboradores/:id", <EmployeeDetailPage />);
    await waitFor(() => container.querySelector("h1")?.textContent === "Ivo Ramos" && has("Para readmitir"), "ficha do desligado");

    await fill("Situação", "ativo");
    // Dá para voltar atrás antes de salvar: "Desligado" continua na lista.
    expect(Array.from((control("Situação") as HTMLSelectElement).options).map((option) => option.value)).toContain("desligado");
    await click("Salvar ficha");
    await waitFor(() => has("Ficha salva."), "ficha salva");
    expect((await db.select<Employee[]>("SELECT * FROM employees WHERE id=?", [id]))[0]).toMatchObject({ status: "ativo", termination_date: null, termination_reason: null });
    expect(await db.select<HrTask[]>("SELECT * FROM hr_tasks WHERE employee_id=? AND deleted_at IS NULL", [id])).toHaveLength(0);
    await waitFor(() => has("Registrar desligamento"), "pode desligar de novo");
  });
});

describe("Admissões e desligamentos", () => {
  it("inicia admissão com checklist, efetiva desligamento agendado vencido e cancela um agendado futuro", async () => {
    const db = testDb();
    await insertTestCompany(db);
    const leaving = await newEmployee("Eva Prado", { hire_date: "2020-01-01" });
    const later = await newEmployee("Fábio Melo", { hire_date: "2020-01-01" });
    // Agendado no passado (simula a data que chegou): a tela efetiva ao abrir.
    await startTermination(db, C, leaving, { date: "2099-01-01", reason: "Término de contrato" }, "test-user-rh", todayIso());
    await db.execute("UPDATE employees SET termination_date=? WHERE id=?", ["2020-06-01", leaving]);
    await startTermination(db, C, later, { date: "2099-01-01", reason: "Outro" }, "test-user-rh", todayIso());

    await render("rh", "/hr/manage/admissoes", "/hr/manage/admissoes", <EmploymentCyclePage />);
    await waitFor(() => has("Eva Prado") && has("Fábio Melo"), "processos");
    expect((await db.select<Employee[]>("SELECT * FROM employees WHERE id=?", [leaving]))[0].status).toBe("desligado");
    expect((await db.select<Employee[]>("SELECT * FROM employees WHERE id=?", [later]))[0].status).toBe("ativo");

    await click("Cancelar desligamento agendado");
    await waitFor(() => !has("Fábio Melo"), "desligamento cancelado");
    expect((await db.select<Employee[]>("SELECT * FROM employees WHERE id=?", [later]))[0]).toMatchObject({ status: "ativo", termination_date: null });

    await click(tableButton("Adicionar"));
    expect(container.querySelector("[role=dialog]")).toBeNull();
    await setCell("Nome completo (nova linha)", "Gabi Nunes");
    await setCell("Data de início (nova linha)", "01/03/2099");
    await click(tableButton("Salvar"));
    await waitFor(() => has("Gabi Nunes") && has("Receber documentos pessoais"), "admissão na lista");
    const [gabi] = await db.select<Employee[]>("SELECT * FROM employees WHERE company_id=? AND name=?", [C, "Gabi Nunes"]);
    expect(await db.select("SELECT * FROM hr_tasks WHERE employee_id=? AND category='admissao'", [gabi.id])).toHaveLength(6);
  });

  it("quem só vê não adiciona admissão nem registra desligamento", async () => {
    const db = testDb();
    await insertTestCompany(db);
    await render("tecnico", "/hr/manage/admissoes", "/hr/manage/admissoes", <EmploymentCyclePage />);
    await waitFor(() => has("Nenhum processo em andamento"), "lista vazia");
    expect(tableButton("Adicionar").disabled).toBe(true);
    expect(() => clickable("Registrar desligamento")).toThrow();
  });
});

describe("Gestão de RH (lista)", () => {
  it("colaboradores abrem a ficha; novo colaborador entra pela tabela; importar fica no contrato", async () => {
    const db = testDb();
    await insertTestCompany(db);
    const id = await newEmployee("Helena Dias");
    await db.execute("INSERT INTO hr_tasks (id, company_id, employee_id, title, status, category) VALUES (?,?,?,?,?,?)", ["t1", C, id, "Assinar contrato", "pendente", "admissao"]);
    await render("rh", "/hr/manage", "/hr/manage", <HrManagePage />);
    await click("Colaboradores");
    await waitFor(() => has("Helena Dias"), "lista");
    expect(clickable("Helena Dias").getAttribute("href")).toBe(`/hr/manage/colaboradores/${id}`);
    expect(tableButton("Adicionar").disabled).toBe(false);
    expect(container.querySelector("[data-entity='employees']")).not.toBeNull();

    await click("Pendências");
    await waitFor(() => has("Assinar contrato"), "pendências");
    expect(clickable("Admissão").getAttribute("href")).toBe("/hr/manage/admissoes");
  });
});
