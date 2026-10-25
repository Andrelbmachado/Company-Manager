// Recorrências na tela: cadastro, próximo lançamento, geração do mês sem duplicar, pausa e exclusão.
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { click, dialog, fieldIn, findButton, renderPage, type, until, type RenderedPage } from "@/test/pageHarness";
import { todayIso } from "@/lib/utils";
import RecurringEntriesPage from "./RecurringEntriesPage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));

const testDb = useTestDb();
let page: RenderedPage | null = null;

afterEach(() => {
  page?.unmount();
  page = null;
});

type Row = Record<string, unknown>;

describe("RecurringEntriesPage", () => {
  it("cadastra, gera o mês uma vez só, pausa e exclui", async () => {
    const db = testDb();
    const { companyId } = await insertTestCompany(db, { companyId: "empresa-recorrencias", roles: ["financeiro"] });
    page = await renderPage(<RecurringEntriesPage />, { companyId });
    const view = page;
    await until(() => view.text().includes("Nenhuma recorrência"), "estado vazio");

    await click(view.button("Nova recorrência"));
    const form = dialog("Nova recorrência")!;
    await type(fieldIn(form, "Descrição"), "Aluguel do escritório");
    await type(fieldIn(form, "Valor"), "6.800,00");
    await type(fieldIn(form, "Dia do vencimento"), "5");
    await type(fieldIn(form, "Início"), "2020-01-01");
    await click(findButton(form, "Salvar"));
    await until(() => view.text().includes("Aluguel do escritório") && view.text().includes("Mensal, dia 5"), "recorrência na lista");
    expect(view.text()).toContain("R$ 6.800,00");

    await click(view.button("Gerar lançamentos do mês"));
    await until(() => view.text().includes("1 lançamento(s) gerado(s): 1 a pagar e 0 a receber"), "geração do mês");
    const month = todayIso().slice(0, 7);
    const payables = await db.select<Row[]>("SELECT * FROM payables WHERE company_id = ?", [companyId]);
    expect(payables).toEqual([expect.objectContaining({ amount: 6800, competence: month, due_date: `${month}-05`, status: "aberta" })]);

    await click(view.button("Gerar lançamentos do mês"));
    await until(() => view.text().includes("Nada a gerar"), "segunda geração sem duplicar");
    expect(await db.select<Row[]>("SELECT * FROM payables WHERE company_id = ?", [companyId])).toHaveLength(1);

    await click(view.button("Pausar"));
    await until(() => view.text().includes("Pausada"), "pausada");
    await click(view.button("Excluir Aluguel do escritório"));
    await click(view.button("Confirmar exclusão"));
    await until(() => view.text().includes("Nenhuma recorrência"), "excluída");
  });
});
