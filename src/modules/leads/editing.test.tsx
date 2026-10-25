// Contrato da Tarefa 6 (grupo comercial) na Prospecção: a lista de leads é EditableTable, Editar/Adicionar não abrem
// diálogo e os detalhes do lead (converter, indicação, contato) ficam na própria página.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { expectInlineEditing, expectNoDialog } from "@/test/inlineEditing";
import { click, findButton, renderPage, until, type RenderedPage } from "@/test/pageHarness";
import { addRow, cellField, editCell, tableOf } from "@/modules/finance/testing/tableActions";
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

  it("link do WhatsApp (tabela e detalhes) segue o tema monocromático, sem verde fixo", async () => {
    await testDb().execute("UPDATE leads SET whatsapp=? WHERE id=?", ["(15) 99999-0000", "lead-1"]);
    page = await renderPage(<LeadsPage />, { companyId, role: "ceo", path: "/leads" });
    await until(() => Boolean(page!.container.querySelector("[aria-label='Abrir WhatsApp de Pet Shop Amigo']")), "link do WhatsApp na tabela");
    await click(page.container.querySelector("[aria-label='Detalhes de Pet Shop Amigo']"));
    await until(() => Boolean(page!.container.querySelector("[aria-label='Detalhes: Pet Shop Amigo']")), "detalhes do lead na página");
    const links = [...page.container.querySelectorAll("button")].filter((button) => button.textContent?.includes("(15) 99999-0000"));
    expect(links).toHaveLength(2);
    for (const link of links) expect(link.className).not.toMatch(/emerald|green-\d/);
  });

  it("lead novo continua na tabela depois de abrir outra aba e voltar", async () => {
    page = await renderPage(<LeadsPage />, { companyId, role: "ceo", path: "/leads" });
    await until(() => page!.text().includes("Pet Shop Amigo"), "lista de leads");
    await addRow(tableOf(page.container, "leads"));
    await editCell(tableOf(page.container, "leads"), "nova", "name", "Clínica Nova");
    await click(findButton(page.container, "Pacotes e preços"));
    await click(findButton(page.container, "Cronograma de abordagem"));
    await click(findButton(page.container, "Leads"));
    expect(cellField(tableOf(page.container, "leads"), "nova", "name").value).toBe("Clínica Nova");
    expect(await testDb().select("SELECT * FROM leads WHERE company_id=? AND name=?", [companyId, "Clínica Nova"])).toHaveLength(0);
  });
});
