// Plano de contas na tela: árvore com linha da DRE herdada, subcategoria adicionada na própria tabela, tipo da
// categoria pai conferido, exclusão recusada com filhas, desativar na tabela e centros de custo.
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { addCategory, addPayable } from "@/test/financeFixtures";
import { choose, click, findButton, renderPage, until, type RenderedPage } from "@/test/pageHarness";
import { addRow, editCell, saveError, saveTable, startEditing, tableOf } from "../testing/tableActions";
import FinanceCategoriesPage from "./FinanceCategoriesPage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));
vi.mock("@/lib/confirm", () => ({ confirmAction: vi.fn(async () => true) }));

const testDb = useTestDb();
let page: RenderedPage | null = null;

afterEach(() => {
  page?.unmount();
  page = null;
  document.body.innerHTML = "";
});

type Row = Record<string, unknown>;
const category = async (code: string) => (await testDb().select<Row[]>("SELECT * FROM finance_categories WHERE code = ?", [code]))[0];

describe("FinanceCategoriesPage", () => {
  it("mostra a árvore, cria subcategoria na tabela, recusa pai de outro tipo, recusa excluir pai e cuida dos centros de custo", async () => {
    const db = testDb();
    const { companyId } = await insertTestCompany(db, { companyId: "empresa-plano", roles: ["financeiro"] });
    await addCategory(db, companyId, { id: "desp", name: "Despesas administrativas", code: "4", kind: "despesa", dre_group: "despesa" });
    await addCategory(db, companyId, { id: "rec", name: "Vendas", code: "3", kind: "receita" });
    page = await renderPage(<FinanceCategoriesPage />, { companyId });
    const view = page;
    await until(() => view.text().includes("Despesas administrativas"), "categoria na árvore");
    const table = tableOf(view.container, "finance");

    await addRow(table);
    await editCell(table, "nova", "name", "Aluguel");
    await editCell(table, "nova", "code", "4.1");
    await editCell(table, "nova", "parent_id", "rec");
    expect(await saveError(table)).toContain("Aluguel: a categoria pai precisa ser do mesmo tipo");
    await editCell(table, "nova", "parent_id", "desp");
    await saveTable(table);
    await until(() => view.text().includes("Aluguel"), "subcategoria criada");
    expect(view.text()).toContain("Despesas operacionais (herdada)");
    const child = await category("4.1");
    expect(child).toMatchObject({ parent_id: "desp", kind: "despesa", dre_group: null });

    await click(view.button("Excluir Despesas administrativas"));
    await click(view.button("Confirmar exclusão"));
    await until(() => view.text().includes("subcategorias"), "recusa excluir com subcategorias");

    await startEditing(table);
    await editCell(table, String(child.id), "active", false);
    await saveTable(table);
    await until(async () => (await category("4.1")).active === 0, "subcategoria desativada");

    await click(view.button("Centros de custo"));
    const costTable = tableOf(view.container, "finance");
    await addRow(costTable);
    await editCell(costTable, "nova", "name", "Comercial");
    await saveTable(costTable);
    await until(() => Boolean(view.button("Excluir Comercial")), "centro de custo criado");
    const [costCenter] = await db.select<Row[]>("SELECT * FROM cost_centers WHERE company_id = ?", [companyId]);
    await addPayable(db, companyId, { id: "p1", amount: 10, cost_center_id: String(costCenter.id) });
    await click(view.button("Excluir Comercial"));
    await click(view.button("Confirmar exclusão"));
    await until(() => view.text().includes("em uso"), "recusa excluir centro em uso");
    expect(document.querySelector("[role=dialog]")).toBeNull();
  });

  it("auditor só consulta", async () => {
    const db = testDb();
    const { companyId } = await insertTestCompany(db, { companyId: "empresa-plano-auditor", roles: ["auditor"] });
    await addCategory(db, companyId, { id: "rec", name: "Vendas", code: "3", kind: "receita" });
    page = await renderPage(<FinanceCategoriesPage />, { companyId, role: "auditor" });
    const view = page;
    await until(() => Boolean(view.container.querySelector('tr[data-row-key="rec"]')), "categoria");
    expect(view.text()).toContain("Receita bruta (herdada)");
    const table = tableOf(view.container, "finance");
    expect(findButton(table, "Editar")?.disabled).toBe(true);
    expect(findButton(table, "Adicionar")?.disabled).toBe(true);
    expect(view.button("Excluir Vendas")).toBeUndefined();
    await choose(view.container.querySelector("select"), "despesa");
    await until(() => view.text().includes("Nenhuma categoria."), "filtro por tipo");
  });
});
