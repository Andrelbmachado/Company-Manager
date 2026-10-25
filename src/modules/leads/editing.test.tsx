// Contrato da Tarefa 6 (grupo comercial) na Prospecção: a lista de leads é EditableTable, Editar/Adicionar não abrem
// diálogo e os detalhes do lead (converter, indicação, contato) ficam na própria página.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { expectInlineEditing, expectNoDialog } from "@/test/inlineEditing";
import { click, renderPage, until, type RenderedPage } from "@/test/pageHarness";
import LeadsPage from "./pages/LeadsPage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));
vi.mock("@/lib/confirm", () => ({ confirmAction: vi.fn(async () => true) }));

const testDb = useTestDb();
let companyId: string;
let page: RenderedPage | null = null;

beforeEach(async () => {
  ({ companyId } = await insertTestCompany(testDb(), { roles: ["ceo"] }));
  await testDb().execute("INSERT INTO leads (id, company_id, name, status, category, estimated_revenue, priority_rank) VALUES (?,?,?,?,?,?,?)", ["lead-1", companyId, "Pet Shop Amigo", "novo", "Pet shop", 4800, 1]);
});

afterEach(() => {
  page?.unmount();
  page = null;
});

describe("Prospecção: edição direto na tabela", () => {
  it("leads", async () => {
    page = await renderPage(<LeadsPage />, { companyId, role: "ceo", path: "/leads" });
    await until(() => page!.text().includes("Pet Shop Amigo"), "lista de leads");
    await expectInlineEditing(page.container, ["leads"]);
    await click(page.container.querySelector("[aria-label='Detalhes de Pet Shop Amigo']"));
    await until(() => Boolean(page!.container.querySelector("[aria-label='Detalhes: Pet Shop Amigo']")), "detalhes do lead na página");
    expectNoDialog("detalhes do lead");
    expect(page.text()).toContain("Programa de indicação");
  });
});
