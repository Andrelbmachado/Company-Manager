// Plano de contas na tela: árvore com linha da DRE herdada, subcategoria, exclusão recusada com filhas, centros de custo.
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { addCategory, addPayable } from "@/test/financeFixtures";
import { choose, click, dialog, fieldIn, findButton, renderPage, type, until, type RenderedPage } from "@/test/pageHarness";
import FinanceCategoriesPage from "./FinanceCategoriesPage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));

const testDb = useTestDb();
let page: RenderedPage | null = null;

afterEach(() => {
  page?.unmount();
  page = null;
});

type Row = Record<string, unknown>;

describe("FinanceCategoriesPage", () => {
  it("mostra a árvore, cria subcategoria, recusa excluir pai e cuida dos centros de custo", async () => {
    const db = testDb();
    const { companyId } = await insertTestCompany(db, { companyId: "empresa-plano", roles: ["financeiro"] });
    await addCategory(db, companyId, { id: "desp", name: "Despesas administrativas", code: "4", kind: "despesa", dre_group: "despesa" });
    page = await renderPage(<FinanceCategoriesPage />, { companyId });
    const view = page;
    await until(() => view.text().includes("4 · Despesas administrativas"), "categoria na árvore");

    await click(view.button("Nova subcategoria de Despesas administrativas"));
    const form = dialog("Nova categoria")!;
    expect((fieldIn(form, "Categoria pai") as HTMLSelectElement).value).toBe("desp");
    await type(fieldIn(form, "Nome"), "Aluguel");
    await type(fieldIn(form, "Código"), "4.1");
    await click(findButton(form, "Salvar"));
    await until(() => view.text().includes("4.1 · Aluguel"), "subcategoria criada");
    expect(view.text()).toContain("Despesas operacionais (herdada)");
    const [child] = await db.select<Row[]>("SELECT * FROM finance_categories WHERE code = ?", ["4.1"]);
    expect(child).toMatchObject({ parent_id: "desp", kind: "despesa", dre_group: null });

    await click(view.button("Excluir Despesas administrativas"));
    await click(view.button("Confirmar exclusão"));
    await until(() => view.text().includes("subcategorias"), "recusa excluir com subcategorias");

    const childRow = [...view.container.querySelectorAll("tr")].find((row) => row.textContent?.includes("4.1 · Aluguel"))!;
    await click(findButton(childRow, "Desativar"));
    await until(async () => (await db.select<Row[]>("SELECT * FROM finance_categories WHERE id = ?", [String(child.id)]))[0].active === 0, "subcategoria desativada");

    await click(view.button("Centros de custo"));
    await click(view.button("Novo centro de custo"));
    const costForm = dialog("Novo centro de custo")!;
    await type(fieldIn(costForm, "Nome"), "Comercial");
    await click(findButton(costForm, "Salvar"));
    await until(() => view.text().includes("Comercial"), "centro de custo criado");
    const [costCenter] = await db.select<Row[]>("SELECT * FROM cost_centers WHERE company_id = ?", [companyId]);
    await addPayable(db, companyId, { id: "p1", amount: 10, cost_center_id: String(costCenter.id) });
    await click(view.button("Excluir Comercial"));
    await click(view.button("Confirmar exclusão"));
    await until(() => view.text().includes("em uso"), "recusa excluir centro em uso");
  });

  it("auditor só consulta", async () => {
    const db = testDb();
    const { companyId } = await insertTestCompany(db, { companyId: "empresa-plano-auditor", roles: ["auditor"] });
    await addCategory(db, companyId, { id: "rec", name: "Vendas", code: "3", kind: "receita" });
    page = await renderPage(<FinanceCategoriesPage />, { companyId, role: "auditor" });
    const view = page;
    await until(() => view.text().includes("3 · Vendas"), "categoria");
    expect(view.text()).toContain("Receita bruta (herdada)");
    expect(view.button("Nova categoria")).toBeUndefined();
    expect(view.button("Excluir Vendas")).toBeUndefined();
    expect(view.button("Desativar")).toBeUndefined();
    await choose(view.container.querySelector("select"), "despesa");
    await until(() => view.text().includes("Nenhuma categoria"), "filtro por tipo");
  });
});
