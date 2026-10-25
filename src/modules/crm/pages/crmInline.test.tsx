// Fluxos de edição no lugar do CRM (Tarefa 6) da tela até o SQLite real: cadastro da ficha, atividade nova e concluída
// pela tabela, etapa da oportunidade pela tabela e follow-up atrasado concluído com um clique.
import type { ReactNode } from "react";
import { Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { expectNoDialog } from "@/test/inlineEditing";
import { choose, click, fieldIn, findButton, renderPage, type, until, type RenderedPage } from "@/test/pageHarness";
import { createActivity } from "@/lib/crm/activities";
import { OverdueFollowUps } from "../components/Activities";
import ActivitiesPage from "./ActivitiesPage";
import CustomerDetailPage from "./CustomerDetailPage";
import OpportunitiesPage from "./OpportunitiesPage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));
vi.mock("@/lib/confirm", () => ({ confirmAction: vi.fn(async () => true) }));

const testDb = useTestDb();
const USER = "test-user-comercial";
type Row = Record<string, unknown>;
let companyId: string;
let page: RenderedPage | null = null;

beforeEach(async () => {
  ({ companyId } = await insertTestCompany(testDb(), { roles: ["comercial"] }));
  await testDb().execute("INSERT INTO customers (id, company_id, name, segment, owner_id, status) VALUES (?,?,?,?,?,?)", ["cust-1", companyId, "Clínica Vida", "Saúde", USER, "active"]);
});

afterEach(() => {
  page?.unmount();
  page = null;
});

const open = (path: string, routePath: string, element: ReactNode) =>
  renderPage(
    <Routes>
      <Route path={routePath} element={element} />
      <Route path="*" element={<p data-testid="outra-rota">outra rota</p>} />
    </Routes>,
    { companyId, role: "comercial", path },
  );
const one = async (sql: string, binds: unknown[]) => (await testDb().select<Row[]>(sql, binds))[0];
const input = (label: string) => page!.container.querySelector<HTMLInputElement | HTMLSelectElement>(`[aria-label="${label}"]`);

describe("CRM: edição no lugar até o banco", () => {
  it("ficha: Editar cadastro troca o bloco pelo formulário e grava", async () => {
    page = await open("/crm/clientes/cust-1", "/crm/clientes/:id", <CustomerDetailPage />);
    await until(() => page!.container.querySelector("h1")?.textContent === "Clínica Vida", "ficha carregada");
    await click(findButton(page.container, "Editar cadastro"));
    const form = page.container.querySelector<HTMLFormElement>("form[aria-label='Editar cadastro de Clínica Vida']")!;
    expect(page.container.querySelector("section[aria-label='Cadastro']")).toBeNull();
    await type(fieldIn(form, "Segmento"), "Odontologia");
    await type(fieldIn(form, "Condição de pagamento"), "30/60 dias");
    await click(findButton(form, "Salvar"));
    await until(async () => (await one("SELECT segment FROM customers WHERE id=?", ["cust-1"]))?.segment === "Odontologia", "cadastro gravado");
    expect(await one("SELECT segment, payment_terms FROM customers WHERE id=?", ["cust-1"])).toEqual({ segment: "Odontologia", payment_terms: "30/60 dias" });
    await until(() => Boolean(page!.container.querySelector("section[aria-label='Cadastro']")), "volta para a leitura");
    expectNoDialog("ficha");
  });

  it("atividades: Adicionar grava com cliente e prazo; Feita conclui", async () => {
    page = await open("/crm/atividades", "/crm/atividades", <ActivitiesPage />);
    await until(() => Boolean(page!.container.querySelector("[data-editable-table='crm_activities']")) && !findButton(page!.container, "Adicionar")!.disabled, "tabela de atividades");
    await click(findButton(page.container, "Adicionar"));
    await type(input("Assunto (nova linha)"), "Reunião de apresentação");
    await choose(input("Cliente (nova linha)"), "cust-1");
    await type(input("Prazo (nova linha)"), "2099-05-10");
    await type(input("Hora (nova linha)"), "14h30");
    await click(findButton(page.container, "Salvar"));
    await until(async () => Boolean(await one("SELECT * FROM crm_activities WHERE company_id=?", [companyId])), "atividade gravada");
    const created = (await one("SELECT * FROM crm_activities WHERE company_id=?", [companyId]))!;
    expect(created).toMatchObject({ entity_type: "customer", entity_id: "cust-1", customer_id: "cust-1", kind: "ligacao", subject: "Reunião de apresentação", user_id: USER, done_at: null });
    const due = new Date(String(created.due_at));
    expect([due.getFullYear(), due.getMonth() + 1, due.getDate(), due.getHours(), due.getMinutes()]).toEqual([2099, 5, 10, 14, 30]);

    await until(() => page!.text().includes("Reunião de apresentação") && !page!.container.querySelector("tr[data-new]"), "atividade na lista");
    await click(findButton(page.container, "Editar"));
    await click(input("Feita (linha 1)"));
    await type(input("Resultado (linha 1)"), "Pediu proposta");
    await click(findButton(page.container, "Salvar"));
    await until(async () => Boolean((await one("SELECT done_at FROM crm_activities WHERE id=?", [created.id]))?.done_at), "atividade concluída");
    expect(await one("SELECT outcome FROM crm_activities WHERE id=?", [created.id])).toEqual({ outcome: "Pediu proposta" });
  });

  it("oportunidades: trocar a etapa na tabela volta para a probabilidade da etapa", async () => {
    await testDb().execute("INSERT INTO opportunities (id, company_id, customer_id, title, value, stage, probability, status, owner_id) VALUES (?,?,?,?,?,?,?,?,?)", ["opp-1", companyId, "cust-1", "Site novo", 3000, "novo", 10, "open", USER]);
    page = await open("/opportunities", "/opportunities", <OpportunitiesPage />);
    await until(() => page!.text().includes("Site novo") && !findButton(page!.container, "Editar")!.disabled, "lista de oportunidades");
    await click(findButton(page.container, "Editar"));
    await choose(input("Etapa (linha 1)"), "proposta");
    await click(findButton(page.container, "Salvar"));
    await until(async () => (await one("SELECT stage FROM opportunities WHERE id=?", ["opp-1"]))?.stage === "proposta", "etapa gravada");
    expect(await one("SELECT stage, probability, status FROM opportunities WHERE id=?", ["opp-1"])).toEqual({ stage: "proposta", probability: 50, status: "open" });
  });

  it("atividades: Registro e Situação ordenam e filtram pelo que a tabela mostra (nome e situação), não pelo código", async () => {
    await testDb().execute("INSERT INTO customers (id, company_id, name, owner_id, status) VALUES (?,?,?,?,?)", ["cust-2", companyId, "Aurora Ltda", USER, "active"]);
    await createActivity(testDb(), companyId, USER, { entity_type: "customer", entity_id: "cust-1", kind: "ligacao", subject: "Ligar para a Clínica", due_at: "2020-01-01T12:00:00.000Z" });
    await createActivity(testDb(), companyId, USER, { entity_type: "customer", entity_id: "cust-2", kind: "reuniao", subject: "Reunião com a Aurora", due_at: "2999-01-01T12:00:00.000Z" });
    page = await open("/crm/atividades", "/crm/atividades", <ActivitiesPage />);
    const table = () => page!.container.querySelector<HTMLElement>("[data-editable-table='crm_activities']")!;
    const subjects = () => [...table().querySelectorAll("tr[data-row-key] td[data-column='subject']")].map((cell) => cell.textContent);
    await until(() => subjects().length === 2 && (table().textContent ?? "").includes("Aurora Ltda"), "duas atividades com o nome do cliente");

    // Pelo código, cust-1 (Clínica Vida) viria antes de cust-2 (Aurora Ltda).
    await click(table().querySelector("th [data-sort-key='entity_id']"));
    expect(subjects()).toEqual(["Reunião com a Aurora", "Ligar para a Clínica"]);

    await click(findButton(table(), "Filtrar"));
    await type(table().querySelector("[aria-label='Registro: contém']"), "aurora");
    expect(subjects()).toEqual(["Reunião com a Aurora"]);
    await click(findButton(table(), "Limpar filtros"));

    const situation = [...table().querySelectorAll("[data-filter-bar] fieldset")].find((item) => item.querySelector("legend")?.textContent === "Situação")!;
    const choices = [...situation.querySelectorAll("label")];
    expect(choices.map((label) => label.textContent)).toEqual(["Atrasada", "Pendente"]);
    await click(choices.find((label) => label.textContent === "Atrasada")!.querySelector("input"));
    expect(subjects()).toEqual(["Ligar para a Clínica"]);
  });

  it("follow-up atrasado: Concluir grava sem diálogo", async () => {
    const id = await createActivity(testDb(), companyId, USER, { entity_type: "customer", entity_id: "cust-1", kind: "ligacao", subject: "Ligar para a Clínica Vida", due_at: "2020-01-01T12:00:00.000Z" });
    page = await renderPage(<OverdueFollowUps userId={USER} />, { companyId, role: "comercial" });
    await until(() => page!.text().includes("Ligar para a Clínica Vida"), "follow-up atrasado");
    await click(findButton(page.container, "Concluir"));
    expectNoDialog("Concluir follow-up");
    await until(async () => Boolean((await one("SELECT done_at FROM crm_activities WHERE id=?", [id]))?.done_at), "follow-up concluído");
    await until(() => page!.text().includes("Nenhum follow-up atrasado"), "lista vazia");
  });
});
