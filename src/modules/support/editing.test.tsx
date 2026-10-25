// Contrato do redesign (Tarefa 6, grupo d): a lista de tickets é uma EditableTable, Editar/Adicionar não abrem diálogo
// e a ficha do ticket edita no próprio lugar. SQLite real.
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { click, choose, findButton, renderPage, type as typeInto, until, type RenderedPage } from "@/test/pageHarness";
import type { Ticket } from "@/types";
import SupportPage from "./pages/SupportPage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));

const C = "test-company";
const testDb = useTestDb();
let page: RenderedPage | null = null;

afterEach(() => {
  page?.unmount();
  page = null;
});

const table = () => page!.container.querySelector<HTMLElement>("[data-editable-table]");
const cell = (label: string) => page!.container.querySelector<HTMLInputElement | HTMLSelectElement>(`[aria-label="${label}"]`);

async function seed() {
  const db = testDb();
  await insertTestCompany(db);
  await db.execute("INSERT INTO tickets (id, company_id, subject, priority, status, opened_by, requester_area, created_at) VALUES (?,?,?,?,?,?,?,?)", [
    "t-1", C, "VPN caiu", "alta", "aberto", "test-user-tecnico", "TI / Operações", "2026-10-20 12:00:00",
  ]);
}

describe("Suporte: edição direto na tabela", () => {
  it("a lista é uma EditableTable e Editar/Adicionar não abrem diálogo", async () => {
    await seed();
    page = await renderPage(<SupportPage />, { companyId: C, role: "tecnico" });
    await until(() => page!.text().includes("VPN caiu"), "lista de tickets");
    expect(table()?.getAttribute("data-editable-table")).toBe("tickets");
    await click(findButton(table()!, "Editar"));
    expect(document.querySelector("[role=dialog]")).toBeNull();
    await click(findButton(table()!, "Cancelar"));
    await click(findButton(table()!, "Adicionar"));
    expect(document.querySelector("[role=dialog]")).toBeNull();
    expect(page.container.querySelector("tr[data-new]")).not.toBeNull();
  });

  it("adiciona e altera tickets pela tabela", async () => {
    await seed();
    page = await renderPage(<SupportPage />, { companyId: C, role: "tecnico" });
    await until(() => page!.text().includes("VPN caiu"), "lista de tickets");

    await click(findButton(table()!, "Adicionar"));
    await typeInto(cell("Assunto (nova linha)"), "Monitor piscando");
    await choose(cell("Prioridade (nova linha)"), "urgente");
    await click(findButton(table()!, "Salvar"));
    await until(() => page!.text().includes("1 linha salva"), "salvou a linha nova");
    const [created] = await testDb().select<Ticket[]>("SELECT * FROM tickets WHERE company_id=? AND subject=?", [C, "Monitor piscando"]);
    expect(created).toMatchObject({ priority: "urgente", status: "aberto", opened_by: "test-user-tecnico" });

    await until(() => page!.container.querySelectorAll("tr[data-row-key]").length === 2, "duas linhas");
    await click(findButton(table()!, "Editar"));
    const row = [...page.container.querySelectorAll<HTMLTableRowElement>("tr[data-row-key]")].find((tr) => tr.getAttribute("data-row-key") === "t-1")!;
    await choose(row.querySelector("td[data-column=status] select"), "resolvido");
    await click(findButton(table()!, "Salvar"));
    await until(async () => (await testDb().select<Ticket[]>("SELECT * FROM tickets WHERE id=?", ["t-1"]))[0].status === "resolvido", "status gravado");
  });

  it("quem só abre ticket vê Editar desativado e a ficha sem edição", async () => {
    await seed();
    await testDb().execute("UPDATE tickets SET opened_by=? WHERE id=?", ["test-user-comercial", "t-1"]);
    page = await renderPage(<SupportPage />, { companyId: C, role: "comercial" });
    await until(() => page!.text().includes("VPN caiu"), "lista");
    expect(findButton(table()!, "Editar")?.disabled).toBe(true);
    expect(findButton(table()!, "Adicionar")?.disabled).toBe(false);
  });

  it("a ficha do ticket edita assunto, prioridade e descrição no próprio lugar", async () => {
    await seed();
    page = await renderPage(<SupportPage />, { companyId: C, role: "tecnico" });
    await until(() => page!.text().includes("VPN caiu"), "lista");
    await click(findButton(page.container, "VPN caiu"));
    await until(() => page!.text().includes("Linha do tempo"), "ficha do ticket");
    await click(findButton(page.container, "Editar"));
    expect(document.querySelector("[role=dialog]")).toBeNull();
    await typeInto(page.container.querySelector('input[aria-label="Assunto"]'), "VPN fora do ar");
    await typeInto(page.container.querySelector('textarea[aria-label="Descrição"]'), "Desde as 9h");
    await click(findButton(page.container, "Salvar"));
    await until(() => page!.container.querySelector("h1")?.textContent === "VPN fora do ar", "título atualizado");
    expect((await testDb().select<Ticket[]>("SELECT * FROM tickets WHERE id=?", ["t-1"]))[0]).toMatchObject({ subject: "VPN fora do ar", description: "Desde as 9h" });
  });
});
