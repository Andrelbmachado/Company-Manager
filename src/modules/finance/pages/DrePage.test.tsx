// DRE na tela: receita e despesa por categoria, subtotais, margem e detalhe por categoria liga/desliga.
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { addCategory, addPayable, addReceivable } from "@/test/financeFixtures";
import { click, renderPage, until, type RenderedPage } from "@/test/pageHarness";
import { todayIso } from "@/lib/utils";
import DrePage from "./DrePage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));

const testDb = useTestDb();
let page: RenderedPage | null = null;

afterEach(() => {
  page?.unmount();
  page = null;
});

describe("DrePage", () => {
  it("mostra a DRE do mês com categorias, resultado e margem", async () => {
    const db = testDb();
    const { companyId } = await insertTestCompany(db, { companyId: "empresa-dre", roles: ["financeiro"] });
    const month = todayIso().slice(0, 7);
    await addCategory(db, companyId, { id: "vendas", name: "Vendas", code: "3.1", kind: "receita", dre_group: "receita" });
    await addCategory(db, companyId, { id: "aluguel", name: "Aluguel", code: "4.1", kind: "despesa", dre_group: "despesa" });
    await addReceivable(db, companyId, { id: "r1", amount: 1000, competence: month, category_id: "vendas" });
    await addPayable(db, companyId, { id: "p1", amount: 400, competence: month, category_id: "aluguel" });

    page = await renderPage(<DrePage />, { companyId });
    const view = page;
    await until(() => view.text().includes("= Resultado do período") && view.text().includes("3.1 · Vendas"), "DRE montada");
    expect(view.text()).toContain("Margem: 60,0%");
    expect(view.text()).toContain("4.1 · Aluguel");
    const result = [...view.container.querySelectorAll("tr")].find((row) => row.textContent?.includes("= Resultado do período"));
    expect(result?.textContent?.replace(/ /g, " ")).toContain("R$ 600,00");

    await click(view.container.querySelector("input[type=checkbox]"));
    await until(() => !view.text().includes("3.1 · Vendas"), "sem detalhe por categoria");
  });
});
