// Recorrências na tela: cadastro na própria tabela, próximo lançamento, geração do mês sem duplicar, fornecedor do
// tipo certo, pausa e exclusão.
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { insertRow } from "@/test/financeFixtures";
import { click, renderPage, until, type RenderedPage } from "@/test/pageHarness";
import { todayIso } from "@/lib/utils";
import { addRow, editCell, saveError, saveTable, tableOf } from "../testing/tableActions";
import RecurringEntriesPage from "./RecurringEntriesPage";

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

describe("RecurringEntriesPage", () => {
  it("cadastra na tabela, gera o mês uma vez só, pausa e exclui", async () => {
    const db = testDb();
    const { companyId } = await insertTestCompany(db, { companyId: "empresa-recorrencias", roles: ["financeiro"] });
    await insertRow(db, "customers", { id: "cli-1", company_id: companyId, name: "Cliente Bom" });
    page = await renderPage(<RecurringEntriesPage />, { companyId });
    const view = page;
    await until(() => view.text().includes("Nenhuma recorrência"), "estado vazio");
    const table = tableOf(view.container, "finance");

    await addRow(table);
    await editCell(table, "nova", "description", "Aluguel do escritório");
    await editCell(table, "nova", "amount", "6.800,00");
    await editCell(table, "nova", "day_of_month", "5");
    await editCell(table, "nova", "start_date", "01/01/2020");
    await editCell(table, "nova", "party", "cliente:cli-1");
    expect(await saveError(table)).toContain("recorrência a pagar leva fornecedor");
    await editCell(table, "nova", "party", "");
    await saveTable(table);
    await until(() => view.text().includes("Aluguel do escritório") && view.text().includes("Mensal"), "recorrência na lista");
    expect(view.text()).toContain("R$ 6.800,00");
    const [saved] = await db.select<Row[]>("SELECT * FROM recurring_entries WHERE company_id = ?", [companyId]);
    expect(saved).toMatchObject({ kind: "pagar", amount: 6800, day_of_month: 5, start_date: "2020-01-01", frequency: "mensal", active: 1 });

    await click(view.button("Gerar lançamentos do mês"));
    await until(() => view.text().includes("1 lançamento(s) gerado(s): 1 a pagar e 0 a receber"), "geração do mês");
    const month = todayIso().slice(0, 7);
    const payables = await db.select<Row[]>("SELECT * FROM payables WHERE company_id = ?", [companyId]);
    expect(payables).toEqual([expect.objectContaining({ amount: 6800, competence: month, due_date: `${month}-05`, status: "aberta" })]);

    await click(view.button("Gerar lançamentos do mês"));
    await until(() => view.text().includes("Nada a gerar"), "segunda geração sem duplicar");
    expect(await db.select<Row[]>("SELECT * FROM payables WHERE company_id = ?", [companyId])).toHaveLength(1);

    await click(view.button("Pausar Aluguel do escritório"));
    await until(() => view.text().includes("Pausada"), "pausada");
    await click(view.button("Excluir Aluguel do escritório"));
    await click(view.button("Confirmar exclusão"));
    await until(() => view.text().includes("Nenhuma recorrência"), "excluída");
    expect(document.querySelector("[role=dialog]")).toBeNull();
  });
});
