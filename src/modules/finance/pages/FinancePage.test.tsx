// Contas a receber da tela Financeiro: a descrição vai em `description` (0008), não mais em `ref_id`; criar e editar
// acontecem na própria tabela.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { renderPage, until, type RenderedPage } from "@/test/pageHarness";
import { addRow, cellField, editCell, saveTable, startEditing, tableOf } from "../testing/tableActions";
import FinancePage from "./FinancePage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));
vi.mock("@/lib/confirm", () => ({ confirmAction: vi.fn(async () => true) }));

const testDb = useTestDb();
let page: RenderedPage;

interface ReceivableRow {
  id: string;
  description: string | null;
  ref_type: string | null;
  ref_id: string | null;
  amount: number;
}

beforeEach(async () => {
  const db = testDb();
  const { companyId } = await insertTestCompany(db, { roles: ["financeiro"] });
  // Gravado pela tela antiga depois da 0008: só ref_id, description NULL (a migração só copiou o que já existia).
  await db.execute("INSERT INTO receivables (id, company_id, ref_type, ref_id, amount, status) VALUES (?, ?, ?, ?, ?, ?)", ["rec-old", companyId, "Manual", "Contrato antigo", 500, "aberta"]);
  await db.execute("INSERT INTO receivables (id, company_id, description, ref_type, ref_id, amount, status) VALUES (?, ?, ?, ?, ?, ?, ?)", ["rec-new", companyId, "Parcela 1/3 da fatura", "invoice", "inv-1", 300, "aberta"]);
  page = await renderPage(<FinancePage />, { companyId });
});

afterEach(() => {
  page.unmount();
  document.body.innerHTML = "";
});

const receivable = async (id: string) => (await testDb().select<ReceivableRow[]>("SELECT * FROM receivables WHERE id = ?", [id]))[0];

describe("FinancePage (contas a receber)", () => {
  it("mostra a descrição nova e, nas contas antigas, o texto que ficou em ref_id", async () => {
    await until(() => page.text().includes("Contrato antigo") && page.text().includes("Parcela 1/3 da fatura"), "lista de contas a receber");
    expect(page.text()).not.toContain("inv-1");
  });

  it("conta nova (Adicionar) grava a descrição em description e aceita valor no formato brasileiro", async () => {
    await until(() => page.text().includes("Contrato antigo"), "lista de contas a receber");
    const table = tableOf(page.container, "receivables");
    await addRow(table);
    await editCell(table, "nova", "description", "Mensalidade de novembro");
    await editCell(table, "nova", "amount", "1.250,50");
    await editCell(table, "nova", "due_date", "31/12/2099");
    await saveTable(table);
    let id = "";
    await until(async () => {
      const rows = await testDb().select<ReceivableRow[]>("SELECT * FROM receivables WHERE description = ?", ["Mensalidade de novembro"]);
      id = rows[0]?.id ?? "";
      return id !== "";
    }, "conta gravada");
    expect(await receivable(id)).toMatchObject({ description: "Mensalidade de novembro", ref_type: "Manual", ref_id: null, amount: 1250.5, due_date: "2099-12-31" });
    await until(() => page.text().includes("Mensalidade de novembro"), "conta nova na lista");
  });

  it("editar na tabela grava description e não apaga a referência (ref_id)", async () => {
    await until(() => page.text().includes("Parcela 1/3 da fatura"), "lista de contas a receber");
    const table = tableOf(page.container, "receivables");
    await startEditing(table);
    expect(cellField(table, "rec-old", "description").value).toBe("Contrato antigo");
    await editCell(table, "rec-new", "description", "Parcela 1/3 - renegociada");
    await editCell(table, "rec-old", "description", "Contrato antigo (revisado)");
    await saveTable(table);
    await until(async () => (await receivable("rec-new")).description === "Parcela 1/3 - renegociada", "edição gravada");
    expect(await receivable("rec-new")).toMatchObject({ ref_type: "invoice", ref_id: "inv-1", amount: 300 });
    expect(await receivable("rec-old")).toMatchObject({ description: "Contrato antigo (revisado)", amount: 500 });
  });
});
