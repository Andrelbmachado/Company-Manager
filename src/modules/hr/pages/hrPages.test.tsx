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
import { addTimeEntry } from "@/lib/hr/timebank";
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

    await click("Aprovar");
    await waitFor(() => has("Nenhum lançamento aguardando"), "aprovação");
    const [entry] = await db.select<HrTimeEntry[]>("SELECT * FROM hr_time_entries WHERE id=?", [pending]);
    expect(entry).toMatchObject({ status: "aprovada", decided_by: "test-user-rh" });
    expect(has("+1h30")).toBe(true);

    await click("Lançar horas");
    await fill("Tipo", "debito");
    await fill("Duração", "0:30");
    await fill("Motivo", "Saída antecipada");
    await waitFor(() => has("Vai lançar −0h30"), "prévia da duração");
    await click(Array.from(container.querySelectorAll<HTMLElement>("[role=dialog] button")).find((button) => button.textContent === "Lançar")!);
    await waitFor(() => !container.querySelector("[role=dialog]"), "diálogo fechado");
    const rows = await db.select<HrTimeEntry[]>("SELECT * FROM hr_time_entries WHERE company_id=? AND employee_id=? ORDER BY minutes", [C, ana]);
    expect(rows.map((row) => [row.minutes, row.status])).toEqual([[-30, "aprovada"], [90, "aprovada"]]);
    await waitFor(() => has("+1h00"), "saldo atualizado");
  });
});

describe("Meu banco de horas (qualquer colaborador)", () => {
  it("informa horas (pendente para o RH) e retira o pedido", async () => {
    const db = testDb();
    await insertTestCompany(db);
    await render("tecnico", "/hr/banco-de-horas", "/hr/banco-de-horas", <MyTimeBankPage />);
    expect(container.querySelector("h1")?.textContent).toBe("Meu banco de horas");
    await waitFor(() => has("Nenhum lançamento ainda"), "extrato vazio");

    await click("Informar horas");
    await fill("Duração", "1h15");
    await fill("Motivo", "Plantão do servidor");
    await click("Enviar para o RH");
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
    await fill("Motivo", "Acordo entre as partes");
    await click(Array.from(container.querySelectorAll<HTMLElement>("[role=dialog] button")).find((button) => button.textContent === "Registrar desligamento")!);
    await waitFor(() => !container.querySelector("[role=dialog]") && has("Formalizar o desligamento"), "checklist de saída");
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

    await click("Nova admissão");
    await fill("Nome completo", "Gabi Nunes");
    await fill("Data de início", "2099-03-01");
    await click("Iniciar admissão");
    await waitFor(() => has("Gabi Nunes") && has("Receber documentos pessoais"), "admissão na lista");
    const [gabi] = await db.select<Employee[]>("SELECT * FROM employees WHERE company_id=? AND name=?", [C, "Gabi Nunes"]);
    expect(await db.select("SELECT * FROM hr_tasks WHERE employee_id=? AND category='admissao'", [gabi.id])).toHaveLength(6);
  });

  it("quem só vê não marca itens nem abre diálogos", async () => {
    const db = testDb();
    await insertTestCompany(db);
    await render("tecnico", "/hr/manage/admissoes", "/hr/manage/admissoes", <EmploymentCyclePage />);
    await waitFor(() => has("Nenhum processo em andamento"), "lista vazia");
    expect(() => clickable("Nova admissão")).toThrow();
  });
});

describe("Gestão de RH (lista)", () => {
  it("colaboradores abrem a ficha; novo colaborador vai para a ficha nova; importar fica no contrato", async () => {
    const db = testDb();
    await insertTestCompany(db);
    const id = await newEmployee("Helena Dias");
    await db.execute("INSERT INTO hr_tasks (id, company_id, employee_id, title, status, category) VALUES (?,?,?,?,?,?)", ["t1", C, id, "Assinar contrato", "pendente", "admissao"]);
    await render("rh", "/hr/manage", "/hr/manage", <HrManagePage />);
    await click("Colaboradores");
    await waitFor(() => has("Helena Dias"), "lista");
    expect(clickable("Helena Dias").getAttribute("href")).toBe(`/hr/manage/colaboradores/${id}`);
    expect(clickable("Novo colaborador").getAttribute("href")).toBe("/hr/manage/colaboradores/nova");
    expect(container.querySelector("[data-entity='employees']")).not.toBeNull();

    await click("Pendências");
    await waitFor(() => has("Assinar contrato"), "pendências");
    expect(clickable("Admissão").getAttribute("href")).toBe("/hr/manage/admissoes");
  });
});
