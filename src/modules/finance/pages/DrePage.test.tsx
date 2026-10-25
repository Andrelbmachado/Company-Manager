// DRE na tela: receita e despesa por categoria, subtotais, margem e detalhe por categoria liga/desliga; cabeçalho
// ordena e Filtrar filtra as categorias dentro de cada seção (seções e subtotais ficam na ordem da demonstração).
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { addCategory, addPayable, addReceivable } from "@/test/financeFixtures";
import { click, renderPage, type as typeInto, until, type RenderedPage } from "@/test/pageHarness";
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
    const resultCard = [...view.container.querySelectorAll(".kpi-card")].find((card) => card.firstElementChild?.textContent === "Resultado");
    expect(resultCard?.querySelector("[data-kpi-value]")?.textContent?.replace(/\u00a0/g, " ")).toBe("R$ 600,00");
    expect(view.text()).toContain("4.1 · Aluguel");
    const result = [...view.container.querySelectorAll("tr")].find((row) => row.textContent?.includes("= Resultado do período"));
    expect(result?.textContent?.replace(/ /g, " ")).toContain("R$ 600,00");

    await click(view.container.querySelector("input[type=checkbox]"));
    await until(() => !view.text().includes("3.1 · Vendas"), "sem detalhe por categoria");
  });

  it("ordena e filtra as categorias dentro da seção sem mexer nos subtotais", async () => {
    const db = testDb();
    const { companyId } = await insertTestCompany(db, { companyId: "empresa-dre-ordem", roles: ["financeiro"] });
    const month = todayIso().slice(0, 7);
    await addCategory(db, companyId, { id: "aluguel", name: "Aluguel", code: "4.1", kind: "despesa", dre_group: "despesa" });
    await addCategory(db, companyId, { id: "energia", name: "Energia", code: "4.2", kind: "despesa", dre_group: "despesa" });
    await addCategory(db, companyId, { id: "vendas", name: "Vendas", code: "3.1", kind: "receita", dre_group: "receita" });
    await addReceivable(db, companyId, { id: "r1", amount: 1000, competence: month, category_id: "vendas" });
    await addPayable(db, companyId, { id: "p1", amount: 400, competence: month, category_id: "aluguel" });
    await addPayable(db, companyId, { id: "p2", amount: 90, competence: month, category_id: "energia" });

    page = await renderPage(<DrePage />, { companyId });
    const view = page;
    await until(() => view.text().includes("4.2 · Energia"), "DRE montada");
    const labels = () => [...view.container.querySelectorAll("tbody tr td:first-child")].map((cell) => cell.textContent ?? "");
    const between = () => {
      const all = labels();
      return all.slice(all.indexOf("(−) Despesas operacionais") + 1, all.indexOf("= Resultado operacional"));
    };
    expect(between()).toEqual(["4.1 · Aluguel", "4.2 · Energia"]);

    // Despesa entra com sinal negativo: crescente põe a maior despesa primeiro, decrescente a menor.
    await click(view.container.querySelector("th [data-sort-key='m0']"));
    expect(between()).toEqual(["4.1 · Aluguel", "4.2 · Energia"]);
    await click(view.container.querySelector("th [data-sort-key='m0']"));
    expect(between()).toEqual(["4.2 · Energia", "4.1 · Aluguel"]);
    await click(view.container.querySelector("th [data-sort-key='label']"));
    expect(between()).toEqual(["4.1 · Aluguel", "4.2 · Energia"]);
    await click(view.container.querySelector("th [data-sort-key='label']"));
    expect(between()).toEqual(["4.2 · Energia", "4.1 · Aluguel"]);
    expect(labels().indexOf("= Resultado operacional")).toBeGreaterThan(labels().indexOf("(−) Despesas operacionais"));

    await click(view.button("Filtrar"));
    await typeInto(view.container.querySelector("[aria-label='Demonstração: contém']"), "alug");
    expect(between()).toEqual(["4.1 · Aluguel"]);
    expect(labels()).toContain("= Resultado do período");
    expect(labels()).not.toContain("3.1 · Vendas");
  });
});
