// Tela de contas: baixa parcial pela lista, estorno, aprovação, exclusão (ficha aberta abaixo da lista, sem modal),
// parcelas ao adicionar na tabela, aviso de alteração não salva, calendário dos vencimentos e recorrências geradas.
import { afterEach, describe, expect, it, vi } from "vitest";
import { confirmAction } from "@/lib/confirm";
import { todayIso } from "@/lib/utils";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { addBankAccount, addPayable, addRecurring } from "@/test/financeFixtures";
import { click, fieldIn, findButton, plain, renderPage, type, until, type RenderedPage } from "@/test/pageHarness";
import { addRow, cellField, editCell, saveTable, startEditing, tableOf } from "../testing/tableActions";
import FinancePage from "./FinancePage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));
vi.mock("@/lib/confirm", () => ({ confirmAction: vi.fn(async () => true) }));

const testDb = useTestDb();
let page: RenderedPage | null = null;

afterEach(() => {
  page?.unmount();
  page = null;
  document.body.innerHTML = "";
  vi.mocked(confirmAction).mockReset().mockResolvedValue(true);
});

type Row = Record<string, unknown>;
const payable = async (id: string) => (await testDb().select<Row[]>("SELECT * FROM payables WHERE id = ?", [id]))[0];
const panel = (title: string) => document.querySelector<HTMLElement>(`section[aria-label="${title}"]`);

async function openPayables(companyId: string) {
  page = await renderPage(<FinancePage />, { companyId });
  await click(page.button("A pagar"));
  return page;
}

describe("FinancePage: baixas e ações", () => {
  it("baixa parcial pela lista e estorno pela ficha, sem modal", async () => {
    const db = testDb();
    const { companyId } = await insertTestCompany(db, { companyId: "empresa-baixa", roles: ["financeiro"] });
    await addBankAccount(db, companyId, { id: "banco", name: "Banco Principal", is_default: 1 });
    await addPayable(db, companyId, { id: "p1", description: "Aluguel", amount: 1000, due_date: "2099-01-10" });
    const view = await openPayables(companyId);
    await until(() => view.text().includes("Aluguel"), "conta na lista");

    await click(view.button("Baixar Aluguel"));
    expect(document.querySelector("[role=dialog]")).toBeNull();
    const settle = document.querySelector<HTMLElement>('form[aria-label="Registrar pagamento"]')!;
    expect((fieldIn(settle, "Conta bancária") as HTMLSelectElement).value).toBe("banco");
    await type(fieldIn(settle, "Valor (principal)"), "400");
    await type(fieldIn(settle, "Juros"), "2,50");
    await until(() => plain(settle.textContent).includes("R$ 402,50"), "total com juros");
    await click(findButton(settle, "Confirmar pagamento"));
    await until(async () => (await payable("p1")).status === "paga_parcial", "baixa parcial gravada");
    expect(await payable("p1")).toMatchObject({ paid_amount: 400 });
    const [settlement] = await db.select<Row[]>("SELECT * FROM finance_settlements WHERE payable_id = ?", ["p1"]);
    expect(settlement).toMatchObject({ amount: 400, interest: 2.5, bank_account_id: "banco" });

    const ficha = panel("Aluguel")!;
    await until(() => plain(ficha.textContent).includes("Principal R$ 400,00"), "baixa na ficha");
    await click(findButton(ficha, "Estornar"));
    await click(findButton(ficha, "Confirmar estorno"));
    await until(async () => (await payable("p1")).status === "aberta", "estorno gravado");
    expect(await payable("p1")).toMatchObject({ paid_amount: 0 });
  });

  it("aprova e exclui pela ficha", async () => {
    const db = testDb();
    const { companyId } = await insertTestCompany(db, { companyId: "empresa-acoes", roles: ["financeiro"] });
    await addPayable(db, companyId, { id: "p2", description: "Licença de software", amount: 300, due_date: "2099-02-01" });
    const view = await openPayables(companyId);
    await until(() => view.text().includes("Licença de software"), "conta na lista");
    await click(view.button("Ficha de Licença de software"));
    const ficha = () => panel("Licença de software")!;
    await click(findButton(ficha(), "Aprovar"));
    await until(async () => (await payable("p2")).status === "aprovada", "aprovação gravada");
    expect(await payable("p2")).toMatchObject({ approver_id: "test-user-financeiro" });

    await click(findButton(ficha(), "Excluir"));
    await click(findButton(ficha(), "Confirmar exclusão"));
    await until(async () => Boolean((await payable("p2")).deleted_at), "exclusão gravada");
    await until(() => !view.text().includes("Licença de software"), "conta some da lista");
  });

  it("nova conta a pagar em 3 parcelas, digitada na própria tabela", async () => {
    const db = testDb();
    const { companyId } = await insertTestCompany(db, { companyId: "empresa-parcelas", roles: ["financeiro"] });
    const view = await openPayables(companyId);
    const table = tableOf(view.container, "payables");
    await addRow(table);
    await editCell(table, "nova", "description", "Notebook");
    await editCell(table, "nova", "amount", "1.000,00");
    await editCell(table, "nova", "due_date", "31/01/2099");
    await editCell(table, "nova", "installments", "3");
    await editCell(table, "nova", "payment_method", "boleto");
    await saveTable(table);
    await until(async () => (await db.select<Row[]>("SELECT * FROM payables WHERE company_id = ?", [companyId])).length === 3, "parcelas gravadas");
    const rows = await db.select<Row[]>("SELECT * FROM payables WHERE company_id = ? ORDER BY installment_number", [companyId]);
    expect(rows.map((row) => [row.description, row.amount, row.due_date, row.payment_method])).toEqual([
      ["Notebook (1/3)", 333.33, "2099-01-31", "boleto"],
      ["Notebook (2/3)", 333.33, "2099-02-28", "boleto"],
      ["Notebook (3/3)", 333.34, "2099-03-31", "boleto"],
    ]);
    await until(() => view.text().includes("Notebook (3/3)") && view.text().includes("3/3"), "parcelas na lista");
  });

  it("Atualizar com alteração não salva pergunta antes e mantém o rascunho se a pessoa continuar editando", async () => {
    const db = testDb();
    const { companyId } = await insertTestCompany(db, { companyId: "empresa-rascunho", roles: ["financeiro"] });
    await addPayable(db, companyId, { id: "p4", description: "Energia", amount: 250, due_date: "2099-01-05" });
    const view = await openPayables(companyId);
    await until(() => view.text().includes("Energia"), "conta na lista");
    const table = tableOf(view.container, "payables");
    await startEditing(table);
    await editCell(table, "p4", "amount", "1.234,56");
    vi.mocked(confirmAction).mockResolvedValueOnce(false);
    await click(findButton(table, "Atualizar"));
    expect(confirmAction).toHaveBeenCalledWith(expect.stringContaining("alterações não salvas"), expect.anything());
    expect(cellField(table, "p4", "amount").value).toBe("1.234,56");
    await saveTable(table);
    await until(async () => Number((await payable("p4")).amount) === 1234.56, "valor gravado");
  });

  it("calendário mostra os vencimentos e abre a ficha da conta", async () => {
    const db = testDb();
    const { companyId } = await insertTestCompany(db, { companyId: "empresa-agenda", roles: ["financeiro"] });
    await addPayable(db, companyId, { id: "p5", description: "Internet", amount: 120, due_date: todayIso() });
    const view = await openPayables(companyId);
    await until(() => view.text().includes("Internet"), "conta na lista");
    await click(view.button("Calendário"));
    await until(() => Boolean(view.container.querySelector('[data-item-id="p5"]')), "vencimento no calendário");
    expect(plain(view.container.querySelector('[data-item-id="p5"]')?.textContent)).toContain("Internet · R$ 120,00");
    await click(view.container.querySelector('[data-item-id="p5"]'));
    await until(() => Boolean(panel("Internet")), "ficha aberta");
    expect(document.querySelector("[role=dialog]")).toBeNull();
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

  it("gerente vê e aprova, mas não edita, não adiciona, não baixa nem exclui", async () => {
    const db = testDb();
    const { companyId } = await insertTestCompany(db, { companyId: "empresa-gerente", roles: ["gerente"] });
    await addPayable(db, companyId, { id: "p3", description: "Consultoria", amount: 500, due_date: "2099-03-01" });
    page = await renderPage(<FinancePage />, { companyId, role: "gerente" });
    const view = page;
    await click(view.button("A pagar"));
    await until(() => view.text().includes("Consultoria"), "conta na lista");
    const table = tableOf(view.container, "payables");
    expect(findButton(table, "Editar")?.disabled).toBe(true);
    expect(findButton(table, "Adicionar")?.disabled).toBe(true);
    expect(view.button("Baixar Consultoria")).toBeUndefined();
    await click(view.button("Ficha de Consultoria"));
    const ficha = panel("Consultoria")!;
    expect(findButton(ficha, "Aprovar")).toBeDefined();
    expect(findButton(ficha, "Excluir")).toBeUndefined();
    expect(findButton(ficha, "Registrar pagamento")).toBeUndefined();
  });
});
