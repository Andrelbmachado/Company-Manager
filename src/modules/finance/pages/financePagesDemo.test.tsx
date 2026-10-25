// As telas do financeiro também rodam no banco demo do navegador (SQL só por padrões de texto): cada página abre com
// dados de exemplo sem erro na tela, e a baixa e a edição na própria tabela funcionam lá.
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDemoDb } from "@/lib/db/demo";
import { addBankAccount, addBankTransaction, addCategory, addPayable, addReceivable, addRecurring, insertRow } from "@/test/financeFixtures";
import { click, findButton, renderPage, type, until, type RenderedPage } from "@/test/pageHarness";
import { editCell, saveTable, startEditing, tableOf } from "../testing/tableActions";
import { todayIso } from "@/lib/utils";
import BankAccountsPage from "./BankAccountsPage";
import CashflowPage from "./CashflowPage";
import DrePage from "./DrePage";
import FinanceCategoriesPage from "./FinanceCategoriesPage";
import FinancePage from "./FinancePage";
import ReconciliationPage from "./ReconciliationPage";
import RecurringEntriesPage from "./RecurringEntriesPage";

const demo = vi.hoisted(() => ({ db: null as ReturnType<typeof import("@/lib/db/demo").createDemoDb> | null }));
vi.mock("@/lib/db/client", () => ({ getDb: async () => demo.db, isTauriRuntime: () => false }));
vi.mock("@/lib/confirm", () => ({ confirmAction: vi.fn(async () => true) }));

const C = "empresa-telas-demo";
let page: RenderedPage | null = null;

beforeEach(async () => {
  localStorage.clear();
  const db = createDemoDb();
  demo.db = db;
  const month = todayIso().slice(0, 7);
  await insertRow(db, "suppliers", { id: "sup", company_id: C, name: "Imobiliária Centro" });
  await addBankAccount(db, C, { id: "banco", name: "Banco Demo", opening_balance: 5000, opening_date: "2020-01-01", is_default: 1 });
  await addCategory(db, C, { id: "cat-r", name: "Vendas", code: "3.1", kind: "receita", dre_group: "receita" });
  await addCategory(db, C, { id: "cat-d", name: "Aluguel", code: "4.1", kind: "despesa", dre_group: "despesa" });
  await insertRow(db, "cost_centers", { id: "cc", company_id: C, name: "Administrativo" });
  await addPayable(db, C, { id: "p1", description: "Aluguel da sala", amount: 1200, due_date: `${month}-10`, competence: month, category_id: "cat-d", supplier_id: "sup" });
  await addReceivable(db, C, { id: "r1", description: "Projeto site", amount: 3000, due_date: `${month}-20`, competence: month, category_id: "cat-r" });
  await addBankTransaction(db, C, { id: "t1", bank_account_id: "banco", posted_at: `${month}-02`, amount: -35, description: "TARIFA", status: "pendente" });
  await addRecurring(db, C, { id: "rec", description: "Internet", amount: 150, day_of_month: 5, start_date: "2020-01-01" });
});

afterEach(() => {
  page?.unmount();
  page = null;
  document.body.innerHTML = "";
});

const PAGES: [string, () => ReactElement, string, string?][] = [
  ["FinancePage", () => <FinancePage />, "Projeto site"],
  ["CashflowPage", () => <CashflowPage />, "Saldo final"],
  ["DrePage", () => <DrePage />, "3.1 · Vendas"],
  ["BankAccountsPage", () => <BankAccountsPage />, "Banco Demo"],
  ["ReconciliationPage", () => <ReconciliationPage />, "TARIFA", "/finance/conciliacao?conta=banco"],
  ["FinanceCategoriesPage", () => <FinanceCategoriesPage />, "Aluguel"],
  ["RecurringEntriesPage", () => <RecurringEntriesPage />, "Internet"],
];

describe("telas do financeiro no banco demo", () => {
  it.each(PAGES)("%s abre sem erro", async (_name, render, expected, path) => {
    page = await renderPage(render(), { companyId: C, path });
    const view = page;
    await until(() => view.text().includes(expected), expected);
    expect(view.container.querySelector("[role=alert]")?.textContent ?? null).toBeNull();
  });

  it("baixa parcial pela lista no demo", async () => {
    page = await renderPage(<FinancePage />, { companyId: C });
    const view = page;
    await click(view.button("A pagar"));
    await until(() => view.text().includes("Aluguel da sala"), "conta a pagar");
    await click(view.button("Baixar Aluguel da sala"));
    const settle = document.querySelector<HTMLElement>('form[aria-label="Registrar pagamento"]')!;
    await type(settle.querySelector("input"), "200");
    await click(findButton(settle, "Confirmar pagamento"));
    await until(async () => (await demo.db!.select<{ status: string }[]>("SELECT * FROM payables WHERE company_id=? AND id=?", [C, "p1"]))[0].status === "paga_parcial", "baixa no demo");
  });

  it("edição na própria tabela grava no demo", async () => {
    page = await renderPage(<FinancePage />, { companyId: C });
    const view = page;
    await click(view.button("A pagar"));
    await until(() => view.text().includes("Aluguel da sala"), "conta a pagar");
    const table = tableOf(view.container, "payables");
    await startEditing(table);
    await editCell(table, "p1", "amount", "1.350,75");
    await editCell(table, "p1", "document_number", "NF-77");
    await saveTable(table);
    await until(async () => Number((await demo.db!.select<{ amount: number }[]>("SELECT * FROM payables WHERE company_id=? AND id=?", [C, "p1"]))[0].amount) === 1350.75, "edição no demo");
    expect((await demo.db!.select<{ document_number: string }[]>("SELECT * FROM payables WHERE company_id=? AND id=?", [C, "p1"]))[0].document_number).toBe("NF-77");
  });
});
