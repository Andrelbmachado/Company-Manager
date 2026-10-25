// Contas bancárias na tela: cadastro na própria tabela (primeira vira padrão), saldo realizado, troca de padrão,
// exclusão só sem movimento e permissão também na gravação.
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { addBankTransaction, addSettlement, addPayable } from "@/test/financeFixtures";
import { click, findButton, renderPage, until, type RenderedPage } from "@/test/pageHarness";
import { saveBankAccountChanges } from "../data/bankAccountEditing";
import { addRow, editCell, saveTable, tableOf } from "../testing/tableActions";
import BankAccountsPage from "./BankAccountsPage";

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

describe("BankAccountsPage", () => {
  it("cria contas na tabela, mostra o saldo, troca a padrão e só exclui conta sem movimento", async () => {
    const db = testDb();
    const { companyId } = await insertTestCompany(db, { companyId: "empresa-bancos", roles: ["financeiro"] });
    page = await renderPage(<BankAccountsPage />, { companyId });
    const view = page;
    await until(() => view.text().includes("Nenhuma conta bancária"), "estado vazio");
    const table = tableOf(view.container, "bank");

    await addRow(table);
    await editCell(table, "nova", "name", "Banco Principal");
    await editCell(table, "nova", "opening_balance", "1.500,00");
    await editCell(table, "nova", "opening_date", "01/01/2020");
    await saveTable(table);
    await until(() => view.text().includes("Banco Principal") && view.text().includes("R$ 1.500,00"), "conta criada com saldo");
    const [first] = await db.select<Row[]>("SELECT * FROM bank_accounts WHERE company_id = ?", [companyId]);
    expect(first).toMatchObject({ name: "Banco Principal", is_default: 1, opening_balance: 1500, opening_date: "2020-01-01" });

    await addPayable(db, companyId, { id: "p1", amount: 200, status: "paga", paid_amount: 200 });
    await addSettlement(db, companyId, { id: "s1", payable_id: "p1", amount: 200, paid_at: "2020-02-01", bank_account_id: String(first.id) });
    await addBankTransaction(db, companyId, { id: "t1", bank_account_id: String(first.id), posted_at: "2020-02-01", amount: -200, balance_after: 1250, status: "conciliada", payable_id: "p1" });

    await addRow(table);
    await editCell(table, "nova", "name", "Caixa da loja");
    await editCell(table, "nova", "kind", "caixa");
    await editCell(table, "nova", "is_default", true);
    await saveTable(table);
    await until(() => view.text().includes("Caixa da loja"), "segunda conta");
    await until(() => view.text().includes("R$ 1.300,00") && view.text().includes("R$ 1.250,00") && view.text().includes("Diferença"), "saldo com a baixa e saldo do extrato");
    const accounts = await db.select<Row[]>("SELECT * FROM bank_accounts WHERE company_id = ? ORDER BY name", [companyId]);
    expect(accounts.map((item) => [item.name, item.is_default, item.kind])).toEqual([
      ["Banco Principal", 0, "corrente"],
      ["Caixa da loja", 1, "caixa"],
    ]);

    const firstRow = table.querySelector(`tr[data-row-key="${String(first.id)}"]`)!;
    await click(findButton(firstRow, "Excluir Banco Principal"));
    await click(findButton(firstRow, "Confirmar exclusão"));
    await until(() => view.text().includes("desative em vez de excluir"), "recusa excluir conta com movimento");
    expect(document.querySelector("[role=dialog]")).toBeNull();

    const second = accounts.find((item) => item.name === "Caixa da loja")!;
    const secondRow = table.querySelector(`tr[data-row-key="${String(second.id)}"]`)!;
    await click(findButton(secondRow, "Excluir Caixa da loja"));
    await click(findButton(secondRow, "Confirmar exclusão"));
    await until(() => !view.text().includes("Caixa da loja"), "conta excluída");
  });

  it("papel sem permissão em bank não grava, mesmo chamando a camada de dados", async () => {
    const db = testDb();
    const { companyId } = await insertTestCompany(db, { companyId: "empresa-bancos-gerente", roles: ["gerente"] });
    await expect(saveBankAccountChanges(db, { companyId, role: "gerente", userId: "test-user-gerente" }, { updated: [], created: [{ name: "Conta X", kind: "corrente" }] })).rejects.toThrow(/permissão/);
    expect(await db.select<Row[]>("SELECT * FROM bank_accounts WHERE company_id = ?", [companyId])).toHaveLength(0);
  });
});
