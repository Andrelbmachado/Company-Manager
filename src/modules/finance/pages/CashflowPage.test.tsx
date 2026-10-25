// Fluxo de caixa na tela: saldo inicial da conta, realizado (baixa) e previsto (conta em aberto), detalhe do dia.
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { addBankAccount, addReceivable, addSettlement } from "@/test/financeFixtures";
import { click, renderPage, until, type RenderedPage } from "@/test/pageHarness";
import { todayIso } from "@/lib/utils";
import CashflowPage from "./CashflowPage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));

const testDb = useTestDb();
let page: RenderedPage | null = null;

afterEach(() => {
  page?.unmount();
  page = null;
});

describe("CashflowPage", () => {
  it("mostra saldo inicial, entradas realizadas e previstas e o detalhe do dia", async () => {
    const db = testDb();
    const { companyId } = await insertTestCompany(db, { companyId: "empresa-fluxo", roles: ["financeiro"] });
    const month = todayIso().slice(0, 7);
    await addBankAccount(db, companyId, { id: "banco", name: "Banco Principal", opening_balance: 1000, opening_date: "2020-01-01", is_default: 1 });
    await addReceivable(db, companyId, { id: "r1", description: "Venda balcão", amount: 500, status: "recebida", received_amount: 500, received_at: `${month}-01` });
    await addSettlement(db, companyId, { id: "s1", receivable_id: "r1", amount: 500, paid_at: `${month}-01`, bank_account_id: "banco" });
    await addReceivable(db, companyId, { id: "r2", description: "Mensalidade cliente", amount: 300, due_date: `${month}-28` });

    page = await renderPage(<CashflowPage />, { companyId });
    const view = page;
    await until(() => view.text().includes("R$ 1.800,00"), "saldo final com o previsto");
    expect(view.text()).toContain("R$ 1.000,00");
    expect(view.text()).toContain("R$ 300,00 previstas");

    await click([...view.container.querySelectorAll("tbody tr")].find((row) => row.textContent?.includes(`01/${month.slice(5, 7)}/${month.slice(0, 4)}`)));
    await until(() => view.text().includes("Venda balcão"), "movimento do dia");
    expect(view.text()).toContain("Realizado · Baixa · Banco Principal");

    await click([...view.container.querySelectorAll<HTMLInputElement>("input[type=checkbox]")][0]);
    await until(() => view.text().includes("R$ 1.500,00") && view.text().includes("Só realizado"), "só realizado");
  });
});
