// Tarefa 6 do redesign, grupo b (folha): a remuneração é editada na própria tabela (sem modal) e o módulo não usa
// mais CrudDialog nem DetailDrawer.
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { insertRow } from "@/test/financeFixtures";
import { renderPage, type RenderedPage } from "@/test/pageHarness";
import { expectInlineEditing, filesWithDialogs } from "@/modules/finance/testing/editingContract";
import PayrollPage from "./pages/PayrollPage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));

const SOURCES = import.meta.glob<string>("./**/*.tsx", { query: "?raw", import: "default", eager: true });

const testDb = useTestDb();
let page: RenderedPage | null = null;

afterEach(() => {
  page?.unmount();
  page = null;
  document.body.innerHTML = "";
});

describe("folha: edição direto na tabela", () => {
  it("Folha de pagamento: EditableTable, sem modal ao editar ou adicionar", async () => {
    const db = testDb();
    const { companyId } = await insertTestCompany(db, { companyId: "empresa-folha", roles: ["ceo"] });
    await insertRow(db, "employees", { id: "emp-1", company_id: companyId, name: "Ana Souza", department: "Comercial", position: "Vendedora", status: "ativo" });
    page = await renderPage(<PayrollPage />, { companyId, role: "ceo" });
    expect(await expectInlineEditing(page, "Folha")).toBe(1);
  });

  it("nenhum arquivo do módulo usa CrudDialog ou DetailDrawer", () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(0);
    expect(filesWithDialogs(SOURCES)).toEqual([]);
  });
});
