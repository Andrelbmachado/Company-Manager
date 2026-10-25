// Contrato do redesign (Tarefa 6, grupo d): Projetos com EditableTable (Editar/Adicionar sem diálogo), cards só com
// título + número e o cronograma (projetos, etapas, tarefas) no CalendarView. O painel do módulo Project Manager
// continua acessível. SQLite real.
import { Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { choose, click, findButton, renderPage, type as typeInto, until, type RenderedPage } from "@/test/pageHarness";
import { createProjectRepository, type Project } from "@/modules/project-manager";
import type { Role } from "@/types";
import ProjectsPage from "./pages/ProjectsPage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));

const C = "test-company";
const testDb = useTestDb();
let page: RenderedPage | null = null;

afterEach(() => {
  page?.unmount();
  page = null;
});

const table = () => page!.container.querySelector<HTMLElement>('[data-editable-table="projects"]');
const field = (label: string) => page!.container.querySelector<HTMLInputElement | HTMLSelectElement>(`[aria-label="${label}"]`);
const noDialog = () => expect(document.querySelector("[role=dialog]")).toBeNull();
const projects = () => testDb().select<Project[]>("SELECT * FROM projects WHERE company_id=? AND deleted_at IS NULL", [C]);

async function open(role: Role): Promise<void> {
  page = await renderPage(<Routes><Route path="/projects/*" element={<ProjectsPage />} /></Routes>, { companyId: C, role, path: "/projects" });
}

describe("Projetos: edição direto na tabela", () => {
  it("adiciona e edita projetos sem diálogo; cards só com título e número", async () => {
    await insertTestCompany(testDb());
    await open("gerente");
    await until(() => !!table() && page!.text().includes("Nenhum projeto"), "tabela vazia");

    await click(findButton(table()!, "Adicionar"));
    noDialog();
    await typeInto(field("Nome (nova linha)"), "Portal B2B");
    await typeInto(field("Orçamento (nova linha)"), "12000");
    await typeInto(field("Início (nova linha)"), "01/11/2026");
    await typeInto(field("Prazo (nova linha)"), "15/12/2026");
    await click(findButton(table()!, "Salvar"));
    await until(() => page!.text().includes("1 linha salva"), "salvou");
    expect(await projects()).toMatchObject([{ name: "Portal B2B", status: "planejado", budget: 12000, start_date: "2026-11-01", end_date: "2026-12-15", owner_id: "test-user-gerente" }]);

    await until(() => page!.text().includes("Portal B2B"), "linha gravada");
    const [saved] = await projects();
    expect(table()!.querySelector(`a[href="/projects/${saved.id}"]`)).not.toBeNull();
    await click(findButton(table()!, "Editar"));
    noDialog();
    await choose(field("Status (linha 1)"), "andamento");
    await click(findButton(table()!, "Salvar"));
    await until(async () => (await projects())[0]?.status === "andamento", "status gravado");

    const cards = [...page!.container.querySelectorAll(".kpi-card")];
    expect(cards.length).toBe(4);
    for (const card of cards) expect(card.querySelectorAll("p").length).toBeLessThanOrEqual(2);
  });

  it("cronograma no calendário e painel do módulo; quem só vê não edita", async () => {
    await insertTestCompany(testDb());
    const repo = createProjectRepository(testDb(), C, "test-user-gerente");
    const id = await repo.createProject({ name: "Portal", status: "andamento", budget: 0, start_date: "2026-11-02", end_date: "2026-11-20" });
    await repo.createStage(id, { name: "Desenho", description: null, status: "a_seguir", start_date: "2026-11-02", end_date: "2026-11-06" });
    await open("tecnico");
    await until(() => !!table() && page!.text().includes("Portal"), "lista");
    expect(findButton(table()!, "Adicionar")?.disabled).toBe(true);
    expect(findButton(table()!, "Editar")?.disabled).toBe(true);
    expect(page!.text()).toContain("Desenho");

    await click(findButton(page!.container, "Cronograma"));
    await until(() => !!page!.container.querySelector("[data-calendar-view]"), "calendário");
    expect(table()).toBeNull();

    await click(findButton(page!.container, "Painel"));
    await until(() => page!.text().includes("Plano em etapas"), "painel do módulo");
    expect(table()).toBeNull();
  });
});
