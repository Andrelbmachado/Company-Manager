// Tarefa 6 do redesign, grupo b (financeiro): cada lista é uma EditableTable com Editar/Adicionar/Atualizar, a
// edição acontece na própria tabela (nenhum role="dialog" ao editar ou adicionar), papel sem permissão vê os botões
// desativados com dica e o módulo não usa mais CrudDialog nem DetailDrawer.
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { addBankAccount, addBankTransaction, addCategory, addPayable, addReceivable, addRecurring } from "@/test/financeFixtures";
import { click, renderPage, until, type RenderedPage } from "@/test/pageHarness";
import type { Role } from "@/types";
import { editableTables, expectInlineEditing, filesWithDialogs, toolbarButton } from "./testing/editingContract";
import BankAccountsPage from "./pages/BankAccountsPage";
import FinanceCategoriesPage from "./pages/FinanceCategoriesPage";
import FinancePage from "./pages/FinancePage";
import ReconciliationPage from "./pages/ReconciliationPage";
import RecurringEntriesPage from "./pages/RecurringEntriesPage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));
vi.mock("@/lib/confirm", () => ({ confirmAction: vi.fn(async () => true) }));

const SOURCES = import.meta.glob<string>("./**/*.tsx", { query: "?raw", import: "default", eager: true });

const testDb = useTestDb();
let page: RenderedPage | null = null;

afterEach(() => {
  page?.unmount();
  page = null;
  document.body.innerHTML = "";
});

async function seed(role: Role) {
  const db = testDb();
  const { companyId } = await insertTestCompany(db, { companyId: "empresa-edicao", roles: [role] });
  await addBankAccount(db, companyId, { id: "banco", name: "Banco Principal", is_default: 1 });
  await addCategory(db, companyId, { id: "cat-d", name: "Aluguel", code: "4.1", kind: "despesa" });
  await addPayable(db, companyId, { id: "p1", description: "Aluguel da sala", amount: 1200, due_date: "2099-01-10" });
  await addReceivable(db, companyId, { id: "r1", description: "Projeto site", amount: 3000, due_date: "2099-01-20" });
  await addRecurring(db, companyId, { id: "rec", description: "Internet", amount: 150, day_of_month: 5, start_date: "2020-01-01" });
  await addBankTransaction(db, companyId, { id: "t1", bank_account_id: "banco", posted_at: "2026-10-02", amount: -35, description: "TARIFA" });
  return companyId;
}

const PAGES: [string, () => ReactElement, string?, string?][] = [
  ["Contas a receber", () => <FinancePage />],
  ["Contas a pagar", () => <FinancePage />, undefined, "A pagar"],
  ["Contas bancárias", () => <BankAccountsPage />],
  ["Plano de contas", () => <FinanceCategoriesPage />],
  ["Centros de custo", () => <FinanceCategoriesPage />, undefined, "Centros de custo"],
  ["Recorrências", () => <RecurringEntriesPage />],
  ["Conciliação", () => <ReconciliationPage />, "/finance/conciliacao?conta=banco"],
];

describe("financeiro: edição direto na tabela", () => {
  it.each(PAGES)("%s: EditableTable, sem modal ao editar ou adicionar", async (what, render, path, tab) => {
    const companyId = await seed("financeiro");
    page = await renderPage(render(), { companyId, path });
    const view = page;
    if (tab) {
      await until(() => Boolean(view.button(tab)), `aba ${tab}`);
      await click(view.button(tab));
    }
    expect(await expectInlineEditing(view, what)).toBeGreaterThan(0);
  });

  it("auditor vê Editar e Adicionar desativados, com a dica do motivo", async () => {
    const companyId = await seed("auditor");
    page = await renderPage(<FinancePage />, { companyId, role: "auditor" });
    const view = page;
    await until(() => editableTables(view.container).length > 0 && view.text().includes("Projeto site"), "lista");
    const [table] = editableTables(view.container);
    expect(toolbarButton(table, "Editar")?.disabled).toBe(true);
    expect(toolbarButton(table, "Editar")?.title).toMatch(/permissão/);
    expect(toolbarButton(table, "Adicionar")?.disabled).toBe(true);
  });

  it("nenhum arquivo do módulo usa CrudDialog ou DetailDrawer", () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(5);
    expect(filesWithDialogs(SOURCES)).toEqual([]);
  });
});
