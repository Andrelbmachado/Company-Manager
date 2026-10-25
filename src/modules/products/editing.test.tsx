// Contrato do redesign (Tarefa 6, grupo d): Desenvolvimento de Produtos com EditableTable (sem diálogo), cards só com
// título + número e os marcos no CalendarView. SQLite real.
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { choose, click, findButton, renderPage, type as typeInto, until, type RenderedPage } from "@/test/pageHarness";
import { loadInitiatives, saveInitiativeChanges } from "@/lib/products/initiatives";
import { todayIso } from "@/lib/utils";
import ProductDevelopmentPage from "./pages/ProductDevelopmentPage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));

const C = "test-company";
const testDb = useTestDb();
let page: RenderedPage | null = null;

afterEach(() => {
  page?.unmount();
  page = null;
});

const table = () => page!.container.querySelector<HTMLElement>("[data-editable-table]");
const field = (label: string) => page!.container.querySelector<HTMLInputElement | HTMLSelectElement>(`[aria-label="${label}"]`);

describe("Desenvolvimento de Produtos: edição direto na tabela", () => {
  it("adiciona e edita iniciativas sem diálogo; cards só com título e número", async () => {
    await insertTestCompany(testDb());
    page = await renderPage(<ProductDevelopmentPage />, { companyId: C, role: "produtos" });
    await until(() => !!table() && page!.text().includes("Nenhuma iniciativa"), "tabela vazia");
    expect(table()?.getAttribute("data-editable-table")).toBe("product_development");

    await click(findButton(table()!, "Adicionar"));
    expect(document.querySelector("[role=dialog]")).toBeNull();
    await typeInto(field("Produto (nova linha)"), "Sensor Edge");
    await choose(field("Tipo (nova linha)"), "fisico");
    await typeInto(field("Data do marco (nova linha)"), "18/11/2026");
    await click(findButton(table()!, "Salvar"));
    await until(() => page!.text().includes("1 linha salva"), "salvou");
    expect(await loadInitiatives(testDb(), C)).toMatchObject([{ name: "Sensor Edge", type: "fisico", status: "planejado", milestone_date: "2026-11-18" }]);

    await until(() => page!.text().includes("Sensor Edge"), "linha gravada");
    await click(findButton(table()!, "Editar"));
    expect(document.querySelector("[role=dialog]")).toBeNull();
    await choose(field("Status (linha 1)"), "em_validacao");
    await click(findButton(table()!, "Salvar"));
    await until(async () => (await loadInitiatives(testDb(), C))[0]?.status === "em_validacao", "status gravado");

    const cards = [...page.container.querySelectorAll(".kpi-card")];
    expect(cards.length).toBe(3);
    for (const card of cards) expect(card.querySelectorAll("p").length).toBeLessThanOrEqual(2);
  });

  it("os marcos aparecem no calendário", async () => {
    await insertTestCompany(testDb());
    // Marco no mês corrente: o calendário abre no mês de hoje.
    await saveInitiativeChanges(testDb(), C, "ceo", { created: [{ name: "Portal", type: "digital", next_milestone: "Beta interno", milestone_date: todayIso() }], updated: [] });
    page = await renderPage(<ProductDevelopmentPage />, { companyId: C, role: "gerente" });
    await until(() => page!.text().includes("Portal"), "lista");
    expect(findButton(table()!, "Adicionar")?.disabled).toBe(true);
    await click(findButton(page.container, "Calendário"));
    await until(() => !!page!.container.querySelector("[data-calendar-view]"), "calendário");
    expect(page.container.querySelector("[data-calendar-view]")?.textContent).toContain("Portal: Beta interno");
    expect(page.container.querySelector("[data-editable-table]")).toBeNull();
  });
});
