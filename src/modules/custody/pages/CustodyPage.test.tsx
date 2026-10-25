// Custódia editada direto na tabela: Adicionar com data brasileira (31/12/2025) e responsável padrão = quem lança,
// Devolvido marca a devolução, aba Calendário com as devoluções previstas, perfil sem permissão com botões desabilitados.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { choose, click, findButton, renderPage, type, until, type RenderedPage } from "@/test/pageHarness";
import { insertTestCompany } from "@/test/sqlite";
import { todayIso } from "@/lib/utils";
import type { Custody, Role } from "@/types";
import CustodyPage from "./CustodyPage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));
vi.mock("@/lib/confirm", () => ({ confirmAction: vi.fn(async () => true) }));

const testDb = useTestDb();
let page: RenderedPage | null = null;
let companyId: string;

beforeEach(async () => {
  const db = testDb();
  ({ companyId } = await insertTestCompany(db, { roles: ["estoquista", "tecnico"] }));
  await db.execute("INSERT INTO inventory_items (id, company_id, name, unit) VALUES ('item-1', ?, 'Alicate', 'un')", [companyId]);
  await db.execute("INSERT INTO inventory_items (id, company_id, name, unit) VALUES ('item-2', ?, 'Multímetro', 'un')", [companyId]);
  await db.execute("INSERT INTO custodies (id, company_id, item_id, holder_id, quantity, due_back_at) VALUES ('cu-1', ?, 'item-1', 'test-user-tecnico', 1, ?)", [companyId, todayIso()]);
});

afterEach(() => {
  page?.unmount();
  page = null;
  document.body.innerHTML = "";
});

async function open(role: Role = "estoquista") {
  page = await renderPage(<CustodyPage />, { companyId, role, path: "/custody" });
  await until(() => page!.container.querySelector('tr[data-row-key="cu-1"]') !== null, "lista de custódias");
  return page;
}

const table = () => page!.container.querySelector<HTMLElement>('[data-editable-table="custody"]')!;
const cell = (label: string) => page!.container.querySelector<HTMLInputElement | HTMLSelectElement>(`[aria-label="${label}"]`);
const custody = async (id: string) => (await testDb().select<Custody[]>("SELECT * FROM custodies WHERE id=?", [id]))[0];

describe("CustodyPage — edição direto na tabela", () => {
  it("Adicionar grava com 31/12/2025 e o responsável padrão; Devolvido marca a devolução", async () => {
    await open();
    await click(findButton(table(), "Adicionar"));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await choose(cell("Item (nova linha)"), "item-2");
    await type(cell("Devolução prevista (nova linha)"), "31/12/2025");
    await click(findButton(table(), "Salvar"));
    await until(async () => (await testDb().select<Custody[]>("SELECT * FROM custodies WHERE item_id='item-2'")).length === 1, "custódia gravada");
    const [created] = await testDb().select<Custody[]>("SELECT * FROM custodies WHERE item_id='item-2'");
    expect(created).toMatchObject({ holder_id: "test-user-estoquista", quantity: 1, status: "em_custodia" });
    expect(String(created.due_back_at).slice(0, 10)).toBe("2025-12-31");
    await until(() => !table().hasAttribute("data-editing"), "tabela atualizada");

    await click(findButton(table(), "Editar"));
    const row = [...table().querySelectorAll("tr[data-row-key]")].findIndex((tr) => tr.getAttribute("data-row-key") === "cu-1") + 1;
    await choose(cell(`Status (linha ${row})`), "devolvido");
    await click(findButton(table(), "Salvar"));
    await until(async () => (await custody("cu-1")).status === "devolvido", "status gravado");
    expect((await custody("cu-1")).returned_at).toBeTruthy();
  });

  it("aba Calendário mostra a devolução prevista", async () => {
    await open();
    await click(page!.container.querySelector("#custodia-tab-calendario") ?? findButton(page!.container, "Calendário"));
    await until(() => page!.text().includes("Alicate · Teste tecnico") || page!.text().includes("Alicate ·"), "devolução no calendário");
  });

  it("técnico (só consulta/solicita) vê Editar e Adicionar desabilitados com o motivo", async () => {
    await open("tecnico");
    expect(findButton(table(), "Editar")!.disabled).toBe(true);
    expect(findButton(table(), "Adicionar")!.disabled).toBe(true);
    expect(findButton(table(), "Adicionar")!.title).toMatch(/não tem permissão/);
    expect(page!.container.querySelector('[aria-label^="Remover custódia"]')).toBeNull();
  });
});
