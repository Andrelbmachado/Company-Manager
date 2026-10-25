// Conciliação na tela: importa OFX (concilia sozinho o exato, não duplica), casa pendente com conta e categoriza na
// ficha aberta abaixo da lista (sem modal), desfaz, e lançamento manual adicionado e editado na própria tabela.
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { addBankAccount, addCategory, addPayable, addReceivable } from "@/test/financeFixtures";
import { choose, click, findButton, renderPage, until, type RenderedPage } from "@/test/pageHarness";
import { addRow, editCell, saveError, saveTable, startEditing, tableOf } from "../testing/tableActions";
import ReconciliationPage from "./ReconciliationPage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));
vi.mock("@/lib/confirm", () => ({ confirmAction: vi.fn(async () => true) }));

const panel = (title: string) => document.querySelector<HTMLElement>(`section[aria-label="${title}"]`);

const testDb = useTestDb();
let page: RenderedPage | null = null;

afterEach(() => {
  page?.unmount();
  page = null;
  document.body.innerHTML = "";
});

type Row = Record<string, unknown>;

const OFX = `OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261007<TRNAMT>-250.50<FITID>F1<MEMO>PAGTO BOLETO ENERGIA</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261008<TRNAMT>99.00<FITID>F2<MEMO>PIX RECEBIDO</STMTTRN>
<STMTTRN><TRNTYPE>FEE<DTPOSTED>20261009<TRNAMT>12.00<FITID>F3<MEMO>TARIFA PACOTE</STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>836.50<DTASOF>20261009</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

async function upload(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("ReconciliationPage", () => {
  it("importa o extrato, concilia, categoriza e desfaz", async () => {
    const db = testDb();
    const { companyId } = await insertTestCompany(db, { companyId: "empresa-conciliacao", roles: ["financeiro"] });
    await addBankAccount(db, companyId, { id: "banco", name: "Banco Principal", opening_balance: 1000, opening_date: "2026-01-01", is_default: 1 });
    await addCategory(db, companyId, { id: "tarifas", name: "Tarifas bancárias", kind: "despesa", dre_group: "financeiro" });
    await addPayable(db, companyId, { id: "p1", description: "Conta de energia", amount: 250.5, due_date: "2026-10-06" });
    await addReceivable(db, companyId, { id: "r1", description: "Mensalidade cliente", amount: 300, due_date: "2026-10-08" });

    page = await renderPage(<ReconciliationPage />, { companyId, path: "/finance/conciliacao?conta=banco" });
    const view = page;
    await until(() => view.text().includes("Nada para conciliar"), "conta sem extrato");

    const input = view.container.querySelector<HTMLInputElement>("input[type=file]")!;
    await upload(input, new File([OFX], "extrato.ofx", { type: "application/x-ofx" }));
    await until(() => view.text().includes("extrato.ofx: 3 lançamento(s) importado(s), 1 conciliado(s) automaticamente, 2 pendente(s)"), "resumo da importação");
    expect(view.text()).toContain("Saldo do extrato: R$ 836,50");
    expect(await db.select<Row[]>("SELECT * FROM payables WHERE id = ?", ["p1"])).toEqual([expect.objectContaining({ status: "paga", paid_amount: 250.5 })]);

    await upload(input, new File([OFX], "extrato.ofx", { type: "application/x-ofx" }));
    await until(() => view.text().includes("0 lançamento(s) importado(s)") && view.text().includes("3 já importado(s) antes"), "reimportação sem duplicar");

    await click(findButton(view.container, "Conciliar PIX RECEBIDO"));
    expect(document.querySelector("[role=dialog]")).toBeNull();
    let drawer = panel("PIX RECEBIDO")!;
    await until(() => drawer.textContent?.includes("Mensalidade cliente") ?? false, "sugestão de conta a receber");
    expect(drawer.textContent).toContain("Baixa parcial");
    await click(findButton(drawer, "Conciliar com Mensalidade cliente"));
    await until(async () => (await db.select<Row[]>("SELECT * FROM receivables WHERE id = ?", ["r1"]))[0].status === "recebida_parcial", "baixa parcial pela conciliação");

    await click(findButton(view.container, "Conciliar TARIFA PACOTE"));
    drawer = panel("TARIFA PACOTE")!;
    await choose(drawer.querySelector("section[aria-label=\"Sem conta ligada\"] select"), "tarifas");
    await click(findButton(drawer, "Categorizar"));
    await until(() => view.text().includes("Nada para conciliar"), "nada pendente");

    await click(view.button("Conciliados (3)"));
    await until(() => view.text().includes("Categoria: Tarifas bancárias") && view.text().includes("Conta a pagar: Conta de energia"), "lista de conciliados");
    const row = [...view.container.querySelectorAll("tr")].find((item) => item.textContent?.includes("PAGTO BOLETO ENERGIA"))!;
    await click(findButton(row, "Desfazer"));
    await click(findButton(row, "Confirmar"));
    await until(async () => (await db.select<Row[]>("SELECT * FROM payables WHERE id = ?", ["p1"]))[0].status === "aberta", "conciliação desfeita");
  });

  it("conta da URL que não é da empresa (ou não existe) não libera importar nem lançar", async () => {
    const db = testDb();
    const { companyId } = await insertTestCompany(db, { companyId: "empresa-url", roles: ["financeiro"] });
    await insertTestCompany(db, { companyId: "outra-empresa", roles: [] });
    await addBankAccount(db, companyId, { id: "minha", name: "Minha conta", is_default: 1 });
    await addBankAccount(db, "outra-empresa", { id: "alheia", name: "Conta alheia" });

    page = await renderPage(<ReconciliationPage />, { companyId, path: "/finance/conciliacao?conta=alheia" });
    const view = page;
    await until(() => view.text().includes("Minha conta"), "contas da empresa carregadas");
    expect(view.text()).toContain("Escolha a conta bancária");
    expect(view.button("Importar extrato")?.disabled).toBe(true);
    expect(view.container.querySelector("[data-editable-table]")).toBeNull();

    const input = view.container.querySelector<HTMLInputElement>("input[type=file]")!;
    await upload(input, new File([OFX], "extrato.ofx", { type: "application/x-ofx" }));
    await until(() => view.text().includes("Escolha a conta bancária do extrato."), "importação recusada");
    expect(await db.select<Row[]>("SELECT * FROM bank_transactions WHERE bank_account_id = ?", ["alheia"])).toEqual([]);
  });

  it("lançamento manual: adicionado na tabela e editado só enquanto pendente; o importado só muda a observação", async () => {
    const db = testDb();
    const { companyId } = await insertTestCompany(db, { companyId: "empresa-manual", roles: ["financeiro"] });
    await addBankAccount(db, companyId, { id: "banco", name: "Banco Principal", is_default: 1 });
    page = await renderPage(<ReconciliationPage />, { companyId, path: "/finance/conciliacao?conta=banco" });
    const view = page;
    await until(() => Boolean(view.container.querySelector("[data-editable-table]")), "tabela do extrato");
    const table = tableOf(view.container, "bank");

    await addRow(table);
    await editCell(table, "nova", "posted_at", "02/10/2026");
    await editCell(table, "nova", "description", "Sangria do caixa");
    await editCell(table, "nova", "amount", "-1.234,56");
    await saveTable(table);
    let manual: Row | undefined;
    await until(async () => {
      [manual] = await db.select<Row[]>("SELECT * FROM bank_transactions WHERE company_id = ?", [companyId]);
      return Boolean(manual);
    }, "lançamento manual gravado");
    expect(manual).toMatchObject({ posted_at: "2026-10-02", description: "Sangria do caixa", amount: -1234.56, source: "manual", status: "pendente" });

    await until(() => view.text().includes("Sangria do caixa"), "lançamento na lista");
    await startEditing(table);
    await editCell(table, String(manual!.id), "amount", "-1.200,00");
    await saveTable(table);
    await until(async () => (await db.select<Row[]>("SELECT * FROM bank_transactions WHERE id = ?", [manual!.id]))[0].amount === -1200, "valor editado");

    await db.execute("INSERT INTO bank_transactions (id, company_id, bank_account_id, posted_at, amount, description, source, status, fitid) VALUES (?,?,?,?,?,?,?,?,?)", ["ofx-1", companyId, "banco", "2026-10-03", -10, "TARIFA", "ofx", "pendente", "F9"]);
    await click(findButton(table, "Atualizar"));
    await until(() => view.text().includes("TARIFA"), "importado na lista");
    await startEditing(table);
    await editCell(table, "ofx-1", "amount", "-20");
    expect(await saveError(table)).toContain("só a observação muda");
  });
});
