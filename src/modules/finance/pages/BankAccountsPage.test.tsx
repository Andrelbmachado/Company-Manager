// Contas bancárias na tela: cadastro (primeira vira padrão), saldo realizado, troca de padrão e exclusão.
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { addBankTransaction, addSettlement, addPayable } from "@/test/financeFixtures";
import { choose, click, dialog, fieldIn, findButton, renderPage, type, until, type RenderedPage } from "@/test/pageHarness";
import BankAccountsPage from "./BankAccountsPage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));

const testDb = useTestDb();
let page: RenderedPage | null = null;

afterEach(() => {
  page?.unmount();
  page = null;
});

type Row = Record<string, unknown>;

describe("BankAccountsPage", () => {
  it("cria contas, mostra o saldo, troca a padrão e só exclui conta sem movimento", async () => {
    const db = testDb();
    const { companyId } = await insertTestCompany(db, { companyId: "empresa-bancos", roles: ["financeiro"] });
    page = await renderPage(<BankAccountsPage />, { companyId });
    const view = page;
    await until(() => view.text().includes("Nenhuma conta bancária"), "estado vazio");

    await click(view.button("Nova conta bancária"));
    let form = dialog("Nova conta bancária")!;
    await type(fieldIn(form, "Nome"), "Banco Principal");
    await type(fieldIn(form, "Saldo inicial"), "1.500,00");
    await type(fieldIn(form, "Data do saldo inicial"), "2020-01-01");
    await click(findButton(form, "Salvar"));
    await until(() => view.text().includes("Banco Principal") && view.text().includes("R$ 1.500,00"), "conta criada com saldo");
    const [first] = await db.select<Row[]>("SELECT * FROM bank_accounts WHERE company_id = ?", [companyId]);
    expect(first).toMatchObject({ name: "Banco Principal", is_default: 1, opening_balance: 1500 });

    await addPayable(db, companyId, { id: "p1", amount: 200, status: "paga", paid_amount: 200 });
    await addSettlement(db, companyId, { id: "s1", payable_id: "p1", amount: 200, paid_at: "2020-02-01", bank_account_id: String(first.id) });
    await addBankTransaction(db, companyId, { id: "t1", bank_account_id: String(first.id), posted_at: "2020-02-01", amount: -200, balance_after: 1250, status: "conciliada", payable_id: "p1" });

    await click(view.button("Nova conta bancária"));
    form = dialog("Nova conta bancária")!;
    await type(fieldIn(form, "Nome"), "Caixa da loja");
    await choose(fieldIn(form, "Tipo"), "caixa");
    await choose(fieldIn(form, "Conta padrão"), "1");
    await click(findButton(form, "Salvar"));
    await until(() => view.text().includes("Caixa da loja"), "segunda conta");
    await until(() => view.text().includes("R$ 1.300,00") && view.text().includes("R$ 1.250,00"), "saldo com a baixa e saldo do extrato");
    const accounts = await db.select<Row[]>("SELECT * FROM bank_accounts WHERE company_id = ? ORDER BY name", [companyId]);
    expect(accounts.map((item) => [item.name, item.is_default, item.kind])).toEqual([
      ["Banco Principal", 0, "corrente"],
      ["Caixa da loja", 1, "caixa"],
    ]);

    await click([...view.container.querySelectorAll("tr")].find((row) => row.textContent?.includes("Banco Principal")));
    let drawer = dialog("Banco Principal")!;
    await click(findButton(drawer, "Excluir"));
    await click(findButton(drawer, "Confirmar exclusão"));
    await until(() => (dialog("Banco Principal")?.textContent ?? "").includes("desative em vez de excluir"), "recusa excluir conta com movimento");
    await click(findButton(drawer, "Fechar"));

    await click([...view.container.querySelectorAll("tr")].find((row) => row.textContent?.includes("Caixa da loja")));
    drawer = dialog("Caixa da loja")!;
    await click(findButton(drawer, "Excluir"));
    await click(findButton(drawer, "Confirmar exclusão"));
    await until(() => !view.text().includes("Caixa da loja"), "conta excluída");
  });
});
