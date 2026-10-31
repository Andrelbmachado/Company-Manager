// Contrato do redesign (Tarefa 6, grupo d): telas do RH com EditableTable (Editar/Adicionar sem diálogo), cards só com
// título + número e o que tem data (férias, banco de horas, pendências, checklists) também no CalendarView. SQLite real.
import { Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { choose, click, findButton, findShownButton, isShown, renderPage, type as typeInto, until, type RenderedPage } from "@/test/pageHarness";
import { todayIso } from "@/lib/utils";
import { emptyEmployeeInput, saveEmployee } from "@/lib/hr/employees";
import { addTimeEntry } from "@/lib/hr/timebank";
import { saveRequestRows } from "@/lib/hr/tableEdits";
import { saveAreaLabels } from "@/lib/labels/store";
import type { Employee, HrRequest, HrTask, Role } from "@/types";
import HrManagePage from "./pages/HrManagePage";
import TimeBankPage from "./pages/TimeBankPage";
import MyTimeBankPage from "./pages/MyTimeBankPage";
import MyHrPage from "./pages/MyHrPage";
import EmploymentCyclePage from "./pages/EmploymentCyclePage";
import EmployeeDetailPage from "./pages/EmployeeDetailPage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));

const C = "test-company";
const testDb = useTestDb();
const rh = { role: "rh" as Role, userId: "test-user-rh" };
let page: RenderedPage | null = null;

afterEach(() => {
  page?.unmount();
  page = null;
});

// Abas e listas ficam montadas (escondidas) para não perder rascunho: os seletores olham só o que está visível.
const tables = () => [...page!.container.querySelectorAll<HTMLElement>("[data-editable-table]")].filter(isShown);
const table = () => tables()[0];
const field = (label: string) => [...page!.container.querySelectorAll<HTMLInputElement | HTMLSelectElement>(`[aria-label="${label}"]`)].find(isShown) ?? null;
const noDialog = () => expect(document.querySelector("[role=dialog]")).toBeNull();

async function employee(name: string, patch: Partial<ReturnType<typeof emptyEmployeeInput>> = {}): Promise<string> {
  return (await saveEmployee(testDb(), C, { ...emptyEmployeeInput(), name, hire_date: "2020-01-01", ...patch }, null, todayIso())).id;
}

/** Editar e Adicionar abrem campos na própria tabela, nunca um diálogo; Cancelar volta à leitura. */
async function editAndAddInPlace(scope: HTMLElement): Promise<void> {
  const edit = findButton(scope, "Editar");
  if (edit && !edit.disabled) {
    await click(edit);
    noDialog();
    await click(findButton(scope, "Cancelar"));
  }
  await click(findButton(scope, "Adicionar"));
  noDialog();
  expect(scope.querySelector("tr[data-row-key]")).not.toBeNull();
  await click(findButton(scope, "Cancelar"));
}

function onlyTitleAndNumber(): void {
  const cards = [...page!.container.querySelectorAll(".kpi-card")];
  expect(cards.length).toBeGreaterThan(0);
  for (const card of cards) expect(card.querySelectorAll("p").length).toBeLessThanOrEqual(2);
}

async function showsCalendar(label = "Calendário"): Promise<void> {
  await click(findShownButton(page!.container, label));
  await until(() => [...page!.container.querySelectorAll("[data-calendar-view]")].some(isShown), "calendário");
}

describe("Gestão de RH: tudo na tabela", () => {
  it("solicitações, colaboradores, comunicados e pendências editam no lugar (o calendário fica só na tela Calendário)", async () => {
    await insertTestCompany(testDb());
    const ana = await employee("Ana Lima", { department: "Comercial" });
    await saveRequestRows(testDb(), C, rh, { created: [{ employee_id: ana, type: "ferias", start_date: "2026-11-02", end_date: "2026-11-06" }], updated: [] }, todayIso());
    page = await renderPage(<HrManagePage />, { companyId: C, role: "rh", path: "/hr/manage" });
    await until(() => !!table() && page!.text().includes("Ana Lima"), "solicitações");
    onlyTitleAndNumber();
    expect(table().getAttribute("data-editable-table")).toBe("hr_admin");
    await editAndAddInPlace(table());

    await click(findButton(page.container, "Colaboradores"));
    await until(() => !!table() && page!.text().includes("Férias disponíveis"), "colaboradores");
    await click(findButton(table(), "Adicionar"));
    noDialog();
    await typeInto(field("Nome (nova linha)"), "Bruno Reis");
    await typeInto(field("E-mail (nova linha)"), "bruno@empresa.com");
    await typeInto(field("Admissão (nova linha)"), "01/02/2026");
    await click(findButton(table(), "Salvar"));
    await until(() => page!.text().includes("1 linha salva"), "colaborador salvo");
    const [bruno] = await testDb().select<Employee[]>("SELECT * FROM employees WHERE company_id=? AND name=?", [C, "Bruno Reis"]);
    expect(bruno).toMatchObject({ email: "bruno@empresa.com", hire_date: "2026-02-01" });

    await click(findButton(page.container, "Comunicados"));
    await until(() => !!table() && page!.text().includes("Fixado no topo"), "comunicados");
    await click(findButton(table(), "Adicionar"));
    noDialog();
    await typeInto(field("Título (nova linha)"), "Feriado municipal");
    await typeInto(field("Texto (nova linha)"), "Não haverá expediente na sexta.");
    await click(findButton(table(), "Salvar"));
    await until(() => page!.text().includes("1 linha salva"), "comunicado salvo");
    expect(await testDb().select("SELECT * FROM hr_announcements WHERE company_id=? AND title=?", [C, "Feriado municipal"])).toHaveLength(1);

    await click(findButton(page.container, "Pendências"));
    await until(() => !!table() && page!.text().includes("Prazo"), "pendências");
    await click(findButton(table(), "Adicionar"));
    noDialog();
    await choose(field("Colaborador (nova linha)"), ana);
    await typeInto(field("Pendência (nova linha)"), "Enviar exame periódico");
    await typeInto(field("Prazo (nova linha)"), "20/11/2026");
    await click(findButton(table(), "Salvar"));
    await until(() => page!.text().includes("1 linha salva"), "pendência salva");
    const [task] = await testDb().select<HrTask[]>("SELECT * FROM hr_tasks WHERE company_id=? AND title=?", [C, "Enviar exame periódico"]);
    expect(task).toMatchObject({ employee_id: ana, due_date: "2026-11-20", status: "pendente" });
    expect(findButton(page.container, "Calendário")).toBeUndefined();
  });
});

describe("Banco de horas: lançar e corrigir na tabela", () => {
  it("RH lança na tabela (já aprovado) e vê os lançamentos no calendário", async () => {
    await insertTestCompany(testDb());
    const ana = await employee("Ana Lima");
    await addTimeEntry(testDb(), C, { employeeId: ana, date: todayIso(), minutes: 60, reason: "Plantão" }, "test-user-comercial", todayIso());
    page = await renderPage(<TimeBankPage />, { companyId: C, role: "rh" });
    await until(() => !!table() && page!.text().includes("Plantão"), "lançamentos");
    onlyTitleAndNumber();
    await editAndAddInPlace(table());
    await showsCalendar();
  });

  it("colaborador informa horas na própria tabela (fica pendente) e vê no calendário", async () => {
    await insertTestCompany(testDb());
    page = await renderPage(<MyTimeBankPage />, { companyId: C, role: "tecnico" });
    await until(() => !!table() && page!.text().includes("Nenhum lançamento ainda"), "extrato vazio");
    onlyTitleAndNumber();
    await click(findButton(table(), "Adicionar"));
    noDialog();
    await typeInto(field("Horas (nova linha)"), "2:00");
    await typeInto(field("Motivo (nova linha)"), "Entrega do projeto");
    await click(findButton(table(), "Salvar"));
    await until(() => page!.text().includes("1 linha salva"), "salvo");
    const rows = await testDb().select<{ minutes: number; status: string }[]>("SELECT minutes, status FROM hr_time_entries WHERE company_id=?", [C]);
    expect(rows).toEqual([{ minutes: 120, status: "pendente" }]);
    await showsCalendar();
  });
});

describe("Meu RH: solicitações na tabela", () => {
  it("pede férias com Adicionar (sem diálogo); só lista, e a data leva ao Calendário naquele dia", async () => {
    await insertTestCompany(testDb());
    await employee("Teste tecnico", { email: "tecnico@teste.local" });
    page = await renderPage(<MyHrPage />, { companyId: C, role: "tecnico" });
    await until(() => !!table() && page!.text().includes("Nenhuma solicitação"), "solicitações vazias");
    onlyTitleAndNumber();
    await click(findButton(table(), "Adicionar"));
    noDialog();
    await typeInto(field("Início (nova linha)"), "02/11/2026");
    await typeInto(field("Fim (nova linha)"), "06/11/2026");
    await click(findButton(table(), "Salvar"));
    await until(() => page!.text().includes("1 linha salva"), "solicitação salva");
    const [request] = await testDb().select<HrRequest[]>("SELECT * FROM hr_requests WHERE company_id=?", [C]);
    expect(request).toMatchObject({ type: "ferias", start_date: "2026-11-02", end_date: "2026-11-06", status: "pendente", days: 5 });
    expect(findButton(page.container, "Calendário")).toBeUndefined();
    await until(() => !!table()?.querySelector("a[href='/calendar?dia=2026-11-02']"), "link da data de início");
    expect(table()?.querySelector("a[href='/calendar?dia=2026-11-06']")?.textContent).toBe("06/11/2026");
  });
});

describe("Admissões e desligamentos", () => {
  it("admissão pela tabela, desligamento num formulário no lugar e checklists no calendário", async () => {
    await insertTestCompany(testDb());
    await employee("Eva Prado");
    page = await renderPage(<EmploymentCyclePage />, { companyId: C, role: "rh" });
    await until(() => !!table(), "tabela de admissões");
    onlyTitleAndNumber();
    await editAndAddInPlace(table());

    await click(findButton(page.container, "Registrar desligamento"));
    noDialog();
    expect(page.container.querySelector("[data-termination-form]")).not.toBeNull();
    await click(findButton(page.container.querySelector("[data-termination-form]")!, "Cancelar"));
    expect(page.container.querySelector("[data-termination-form]")).toBeNull();

    await showsCalendar();
  });

  it("duas admissões na mesma gravação: se uma falha nenhuma entra, e salvar de novo não duplica", async () => {
    await insertTestCompany(testDb());
    await employee("Eva Prado", { email: "eva@empresa.com" });
    page = await renderPage(<EmploymentCyclePage />, { companyId: C, role: "rh" });
    await until(() => !!table(), "tabela de admissões");
    await click(findButton(table(), "Adicionar"));
    await click(findButton(table(), "Adicionar"));
    const cells = (header: string) => [...table().querySelectorAll<HTMLInputElement>(`[aria-label="${header} (nova linha)"]`)];
    // A linha de cima é gravada primeiro: a de baixo falha (e-mail de quem já tem ficha) depois dela.
    await typeInto(cells("Nome completo")[0], "Gabi Nunes");
    await typeInto(cells("Data de início")[0], "01/03/2099");
    await typeInto(cells("Nome completo")[1], "Eva Outra");
    await typeInto(cells("E-mail")[1], "eva@empresa.com");
    await typeInto(cells("Data de início")[1], "01/03/2099");
    await click(findButton(table(), "Salvar"));
    await until(() => page!.text().includes("Já existe um colaborador com este e-mail"), "erro da segunda linha");
    const names = async () => (await testDb().select<Employee[]>("SELECT * FROM employees WHERE company_id=? AND deleted_at IS NULL", [C])).map((item) => item.name).sort();
    expect(await names()).toEqual(["Eva Prado"]);

    await typeInto(cells("E-mail")[1], "eva.outra@empresa.com");
    await click(findButton(table(), "Salvar"));
    await until(() => page!.text().includes("2 linhas salvas"), "salvou");
    expect(await names()).toEqual(["Eva Outra", "Eva Prado", "Gabi Nunes"]);
  });
});

describe("Ficha do colaborador", () => {
  it("férias, banco de horas e outras pendências da pessoa em tabelas; desligamento no lugar", async () => {
    await insertTestCompany(testDb());
    const id = await employee("Davi Costa");
    page = await renderPage(
      <Routes><Route path="/hr/manage/colaboradores/:id" element={<EmployeeDetailPage />} /></Routes>,
      { companyId: C, role: "rh", path: `/hr/manage/colaboradores/${id}` },
    );
    await until(() => page!.container.querySelector("h1")?.textContent === "Davi Costa", "ficha");

    await click(findButton(page.container, "Férias e solicitações"));
    await until(() => !!table(), "tabela de solicitações");
    onlyTitleAndNumber();
    await click(findButton(table(), "Adicionar"));
    noDialog();
    await typeInto(field("Início (nova linha)"), "02/11/2026");
    await typeInto(field("Fim (nova linha)"), "04/11/2026");
    await click(findButton(table(), "Salvar"));
    await until(() => page!.text().includes("1 linha salva"), "solicitação salva");
    expect((await testDb().select<HrRequest[]>("SELECT * FROM hr_requests WHERE employee_id=?", [id]))[0]).toMatchObject({ type: "ferias", status: "pendente", days: 3 });
    await showsCalendar();

    await click(findButton(page.container, "Banco de horas"));
    await until(() => !!table(), "tabela do banco de horas");
    await click(findButton(table(), "Adicionar"));
    noDialog();
    await typeInto(field("Horas (nova linha)"), "1:30");
    await typeInto(field("Motivo (nova linha)"), "Inventário");
    await click(findButton(table(), "Salvar"));
    await until(() => page!.text().includes("1 linha salva"), "lançamento salvo");
    expect(await testDb().select("SELECT minutes, status FROM hr_time_entries WHERE employee_id=?", [id])).toEqual([{ minutes: 90, status: "aprovada" }]);

    await click(findButton(page.container, "Admissão e desligamento"));
    await until(() => tables().some((item) => item.textContent?.includes("Outras pendências")), "outras pendências");
    await click(findButton(page.container, "Registrar desligamento"));
    noDialog();
    expect(page.container.querySelector("[data-termination-form]")?.getAttribute("aria-label")).toBe("Registrar desligamento de Davi Costa");
  });
});

describe("Trocar de aba ou ver o calendário não perde o rascunho", () => {
  it("Gestão de RH: linha nova continua depois de trocar de aba", async () => {
    await insertTestCompany(testDb());
    await employee("Ana Lima");
    page = await renderPage(<HrManagePage />, { companyId: C, role: "rh", path: "/hr/manage" });
    await until(() => !!table(), "solicitações");

    await click(findButton(page.container, "Colaboradores"));
    await until(() => !!table() && page!.text().includes("Férias disponíveis"), "colaboradores");
    await click(findButton(table(), "Adicionar"));
    await typeInto(field("Nome (nova linha)"), "Bruno Reis");
    await click(findButton(page.container, "Comunicados"));
    await click(findButton(page.container, "Colaboradores"));
    expect(field("Nome (nova linha)")?.value).toBe("Bruno Reis");

    await click(findButton(page.container, "Pendências"));
    await click(findButton(table(), "Adicionar"));
    await typeInto(field("Pendência (nova linha)"), "Enviar exame periódico");
    await click(findButton(page.container, "Solicitações"));
    await click(findButton(page.container, "Pendências"));
    expect(field("Pendência (nova linha)")?.value).toBe("Enviar exame periódico");
    expect(await testDb().select("SELECT * FROM employees WHERE company_id=? AND name=?", [C, "Bruno Reis"])).toHaveLength(0);
  });

  it("ficha do colaborador: solicitação digitada continua depois de abrir outra aba e o calendário", async () => {
    await insertTestCompany(testDb());
    const id = await employee("Davi Costa");
    page = await renderPage(
      <Routes><Route path="/hr/manage/colaboradores/:id" element={<EmployeeDetailPage />} /></Routes>,
      { companyId: C, role: "rh", path: `/hr/manage/colaboradores/${id}` },
    );
    await until(() => page!.container.querySelector("h1")?.textContent === "Davi Costa", "ficha");
    await click(findButton(page.container, "Férias e solicitações"));
    await until(() => !!table(), "tabela de solicitações");
    await click(findButton(table(), "Adicionar"));
    await typeInto(field("Motivo (nova linha)"), "Casamento");

    await click(findButton(page.container, "Banco de horas"));
    await until(() => !!table() && page!.text().includes("Horas extras aprovadas"), "banco de horas");
    await click(findButton(page.container, "Férias e solicitações"));
    expect(field("Motivo (nova linha)")?.value).toBe("Casamento");
    await showsCalendar();
    await click(findShownButton(page.container, "Lista"));
    expect(field("Motivo (nova linha)")?.value).toBe("Casamento");
  });

  it.each([
    ["banco de horas do RH", <TimeBankPage key="rh" />, "rh" as Role],
    ["meu banco de horas", <MyTimeBankPage key="meu" />, "tecnico" as Role],
  ])("%s: o motivo digitado continua depois de ver o calendário", async (_name, element, role) => {
    await insertTestCompany(testDb());
    await employee("Teste tecnico", { email: "tecnico@teste.local" });
    page = await renderPage(element, { companyId: C, role });
    await until(() => !!table() && !findButton(table(), "Adicionar")?.disabled, "tabela");
    await click(findButton(table(), "Adicionar"));
    await typeInto(field("Motivo (nova linha)"), "Entrega do projeto");
    await showsCalendar();
    await click(findShownButton(page.container, "Lista"));
    expect(field("Motivo (nova linha)")?.value).toBe("Entrega do projeto");
  });
});

describe("Títulos vêm dos rótulos da área (Configurações)", () => {
  it("Gestão de RH e Meu RH usam o nome que a empresa deu ao módulo", async () => {
    await insertTestCompany(testDb());
    await saveAreaLabels(testDb(), C, { role: "ceo", userId: "test-user-ceo" }, { overrides: { "module.hr_manage": "Pessoas e Cultura", "module.hr": "Meu espaço" } });
    await employee("Teste tecnico", { email: "tecnico@teste.local" });
    page = await renderPage(<HrManagePage />, { companyId: C, role: "rh", path: "/hr/manage" });
    await until(() => page!.container.querySelector("h1")?.textContent === "Pessoas e Cultura", "título da Gestão de RH");
    page.unmount();
    page = await renderPage(<MyHrPage />, { companyId: C, role: "tecnico" });
    await until(() => page!.container.querySelector("h1")?.textContent === "Meu espaço", "título do Meu RH");
  });
});
