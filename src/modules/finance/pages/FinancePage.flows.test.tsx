// Tela de contas: baixa parcial pela lista, estorno, aprovação, exclusão, parcelas e recorrências geradas ao abrir.
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { addBankAccount, addPayable, addRecurring } from "@/test/financeFixtures";
import { choose, click, dialog, fieldIn, findButton, plain, renderPage, type, until, type RenderedPage } from "@/test/pageHarness";
import FinancePage from "./FinancePage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));

const testDb = useTestDb();
let page: RenderedPage | null = null;

afterEach(() => {
  page?.unmount();
  page = null;
  document.body.innerHTML = "";
});

type Row = Record<string, unknown>;
const payable = async (id: string) => (await testDb().select<Row[]>("SELECT * FROM payables WHERE id = ?", [id]))[0];

async function openPayables(companyId: string) {
  page = await renderPage(<FinancePage />, { companyId });
  await click(page.button("A pagar"));
  return page;
}

describe("FinancePage: baixas e ações", () => {
  it("baixa parcial pela lista, estorno pela gaveta", async () => {
    const db = testDb();
    const { companyId } = await insertTestCompany(db, { companyId: "empresa-baixa", roles: ["financeiro"] });
    await addBankAccount(db, companyId, { id: "banco", name: "Banco Principal", is_default: 1 });
    await addPayable(db, companyId, { id: "p1", description: "Aluguel", amount: 1000, due_date: "2099-01-10" });
    const view = await openPayables(companyId);
    await until(() => view.text().includes("Aluguel"), "conta na lista");

    await click(view.button("Baixar Aluguel"));
    const settle = dialog("Registrar pagamento")!;
    expect((fieldIn(settle, "Conta bancária") as HTMLSelectElement).value).toBe("banco");
    await type(fieldIn(settle, "Valor (principal)"), "400");
    await type(fieldIn(settle, "Juros"), "2,50");
    await until(() => plain(settle.textContent).includes("R$ 402,50"), "total com juros");
    await click(findButton(settle, "Confirmar pagamento"));
    await until(async () => (await payable("p1")).status === "paga_parcial", "baixa parcial gravada");
    expect(await payable("p1")).toMatchObject({ paid_amount: 400 });
    const [settlement] = await db.select<Row[]>("SELECT * FROM finance_settlements WHERE payable_id = ?", ["p1"]);
    expect(settlement).toMatchObject({ amount: 400, interest: 2.5, bank_account_id: "banco" });

    await click([...view.container.querySelectorAll("tr")].find((row) => row.textContent?.includes("Aluguel")));
    const drawer = dialog("Aluguel")!;
    await until(() => plain(drawer.textContent).includes("Principal R$ 400,00"), "baixa na gaveta");
    await click(findButton(drawer, "Estornar"));
    await click(findButton(drawer, "Confirmar estorno"));
    await until(async () => (await payable("p1")).status === "aberta", "estorno gravado");
    expect(await payable("p1")).toMatchObject({ paid_amount: 0 });
  });

  it("aprova, recusa cancelar com baixa e exclui", async () => {
    const db = testDb();
    const { companyId } = await insertTestCompany(db, { companyId: "empresa-acoes", roles: ["financeiro"] });
    await addPayable(db, companyId, { id: "p2", description: "Licença de software", amount: 300, due_date: "2099-02-01" });
    const view = await openPayables(companyId);
    await until(() => view.text().includes("Licença de software"), "conta na lista");
    await click([...view.container.querySelectorAll("tr")].find((row) => row.textContent?.includes("Licença de software")));
    const drawer = () => dialog("Licença de software")!;
    await click(findButton(drawer(), "Aprovar"));
    await until(async () => (await payable("p2")).status === "aprovada", "aprovação gravada");
    expect(await payable("p2")).toMatchObject({ approver_id: "test-user-financeiro" });

    await click(findButton(drawer(), "Excluir"));
    await click(findButton(drawer(), "Confirmar exclusão"));
    await until(async () => Boolean((await payable("p2")).deleted_at), "exclusão gravada");
    await until(() => !view.text().includes("Licença de software"), "conta some da lista");
  });

  it("nova conta a pagar em 3 parcelas", async () => {
    const db = testDb();
    const { companyId } = await insertTestCompany(db, { companyId: "empresa-parcelas", roles: ["financeiro"] });
    const view = await openPayables(companyId);
    await click(view.button("Nova conta a pagar"));
    const form = dialog("Novo lançamento")!;
    await type(fieldIn(form, "Descrição"), "Notebook");
    await type(fieldIn(form, "Valor total"), "1.000,00");
    await type(fieldIn(form, "Vencimento"), "2099-01-31");
    await type(fieldIn(form, "Parcelas"), "3");
    await choose(fieldIn(form, "Forma de pagamento"), "boleto");
    await click(findButton(form, "Salvar"));
    await until(async () => (await db.select<Row[]>("SELECT * FROM payables WHERE company_id = ?", [companyId])).length === 3, "parcelas gravadas");
    const rows = await db.select<Row[]>("SELECT * FROM payables WHERE company_id = ? ORDER BY installment_number", [companyId]);
    expect(rows.map((row) => [row.description, row.amount, row.due_date, row.payment_method])).toEqual([
      ["Notebook (1/3)", 333.33, "2099-01-31", "boleto"],
      ["Notebook (2/3)", 333.33, "2099-02-28", "boleto"],
      ["Notebook (3/3)", 333.34, "2099-03-31", "boleto"],
    ]);
    await until(() => view.text().includes("Notebook (3/3)"), "parcelas na lista");
  });

  it("gera as recorrências do mês ao abrir e avisa", async () => {
    const db = testDb();
    const { companyId } = await insertTestCompany(db, { companyId: "empresa-recorrente", roles: ["financeiro"] });
    await addRecurring(db, companyId, { id: "rec", description: "Internet", amount: 199.9, day_of_month: 5, start_date: "2020-01-01" });
    const view = await openPayables(companyId);
    await until(() => view.text().includes("1 lançamento recorrente foi gerado"), "aviso de recorrência");
    await until(() => /Internet \(\d{2}\/\d{4}\)/.test(view.text()), "conta gerada na lista");
    expect(await db.select<Row[]>("SELECT * FROM payables WHERE recurring_entry_id = ?", ["rec"])).toHaveLength(1);
  });

  it("gerente vê e aprova, mas não cria, não baixa nem exclui", async () => {
    const db = testDb();
    const { companyId } = await insertTestCompany(db, { companyId: "empresa-gerente", roles: ["gerente"] });
    await addPayable(db, companyId, { id: "p3", description: "Consultoria", amount: 500, due_date: "2099-03-01" });
    page = await renderPage(<FinancePage />, { companyId, role: "gerente" });
    const view = page;
    await click(view.button("A pagar"));
    await until(() => view.text().includes("Consultoria"), "conta na lista");
    expect(view.button("Nova conta a pagar")).toBeUndefined();
    expect(view.button("Baixar Consultoria")).toBeUndefined();
    await click([...view.container.querySelectorAll("tr")].find((row) => row.textContent?.includes("Consultoria")));
    const drawer = dialog("Consultoria")!;
    expect(findButton(drawer, "Aprovar")).toBeDefined();
    expect(findButton(drawer, "Excluir")).toBeUndefined();
    expect(findButton(drawer, "Editar")).toBeUndefined();
  });
});
