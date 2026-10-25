// Estoque editado direto na tabela: Adicionar e Editar sem modal, formatos brasileiros (1.234,56), número inválido
// não grava, perfil sem permissão vê os botões desabilitados, ficha do item abaixo da tabela.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { click, findButton, renderPage, type, until, type RenderedPage } from "@/test/pageHarness";
import { insertTestCompany } from "@/test/sqlite";
import type { InventoryItem, Role } from "@/types";
import InventoryPage from "./InventoryPage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));
vi.mock("@/lib/confirm", () => ({ confirmAction: vi.fn(async () => true) }));

const testDb = useTestDb();
let page: RenderedPage | null = null;
let companyId: string;

beforeEach(async () => {
  ({ companyId } = await insertTestCompany(testDb(), { roles: ["estoquista", "auditor"] }));
  const db = testDb();
  await db.execute("INSERT INTO stock_locations (id, company_id, name) VALUES ('loc-1', ?, 'Depósito')", [companyId]);
  await db.execute("INSERT INTO suppliers (id, company_id, name) VALUES ('sup-1', ?, 'NetPrime')", [companyId]);
  await db.execute("INSERT INTO inventory_items (id, company_id, name, sku, unit, min_stock, cost) VALUES ('item-1', ?, 'Cabo Cat6', 'CAB', 'cx', 5, 10)", [companyId]);
  await db.execute("INSERT INTO stock_balances (id, company_id, item_id, location_id, quantity) VALUES ('b1', ?, 'item-1', 'loc-1', 12)", [companyId]);
});

afterEach(() => {
  page?.unmount();
  page = null;
  document.body.innerHTML = "";
});

async function render(role: Role = "estoquista") {
  page = await renderPage(<InventoryPage />, { companyId, role, path: "/inventory" });
  await until(() => page!.container.querySelector('tr[data-row-key="item-1"]') !== null, "lista de itens");
  return page;
}

const cell = (label: string) => page!.container.querySelector<HTMLInputElement | HTMLSelectElement>(`[aria-label="${label}"]`);
const table = () => page!.container.querySelector<HTMLElement>("[data-editable-table]")!;
const item = async (id: string) => (await testDb().select<InventoryItem[]>("SELECT * FROM inventory_items WHERE id=?", [id]))[0];
const itemCount = async () => (await testDb().select<{ n: number }[]>("SELECT count(*) AS n FROM inventory_items WHERE company_id=? AND deleted_at IS NULL", [companyId]))[0].n;

describe("InventoryPage — edição direto na tabela", () => {
  it("tem os botões de importar/exportar e a tabela editável", async () => {
    await render();
    expect(page!.container.querySelector('[data-entity="inventory"]')).not.toBeNull();
    expect(table().getAttribute("data-editable-table")).toBe("inventory");
    expect(page!.text()).toContain("12 cx");
  });

  it("Adicionar abre linha nova na tabela (sem modal) e grava com 1.234,56 e 1.234,5", async () => {
    await render();
    await click(findButton(table(), "Adicionar"));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await type(cell("Item (nova linha)"), "Parafuso M6");
    await type(cell("Custo unit. (nova linha)"), "1.234,56");
    await type(cell("Mínimo (nova linha)"), "1.234,5");
    await click(findButton(table(), "Salvar"));
    await until(async () => (await itemCount()) === 2, "item gravado");
    const [created] = await testDb().select<InventoryItem[]>("SELECT * FROM inventory_items WHERE name='Parafuso M6'");
    expect(created).toMatchObject({ cost: 1234.56, min_stock: 1234.5, unit: "un" });
    await until(() => page!.text().includes("Parafuso M6") && !table().hasAttribute("data-editing"), "tabela atualizada");
  });

  it("Editar troca as células por campos (sem modal) e grava só o que mudou", async () => {
    await render();
    await click(findButton(table(), "Editar"));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(cell("Saldo total (linha 1)")).toBeNull();
    await type(cell("Custo unit. (linha 1)"), "12,345");
    await click(findButton(table(), "Salvar"));
    await until(async () => (await item("item-1")).cost === 12.35, "custo gravado");
    expect(await item("item-1")).toMatchObject({ name: "Cabo Cat6", sku: "CAB", min_stock: 5 });
  });

  it("número inválido não vira 0 sem aviso: nada é gravado", async () => {
    await render();
    await click(findButton(table(), "Adicionar"));
    await type(cell("Item (nova linha)"), "Parafuso M6");
    await type(cell("Custo unit. (nova linha)"), "1O,50");
    await click(findButton(table(), "Salvar"));
    await until(() => /Corrija os campos/.test(page!.text()), "aviso de campo inválido");
    expect(await itemCount()).toBe(1);
  });

  it("perfil sem permissão (auditor) vê Editar e Adicionar desabilitados com o motivo", async () => {
    await render("auditor");
    const edit = findButton(table(), "Editar")!;
    const add = findButton(table(), "Adicionar")!;
    expect(edit.disabled).toBe(true);
    expect(add.disabled).toBe(true);
    expect(edit.title).toMatch(/não tem permissão/);
    expect(add.title).toMatch(/não tem permissão/);
    expect(page!.container.querySelector('[aria-label="Remover Cabo Cat6"]')).toBeNull();
  });

  it("ficha do item abre abaixo da tabela, sem modal; remover pede confirmação e exclui (soft delete)", async () => {
    await render();
    await click(page!.container.querySelector('[aria-label="Ficha de Cabo Cat6"]'));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    const ficha = page!.container.querySelector('section[aria-label="Ficha de Cabo Cat6"]');
    expect(ficha?.textContent).toContain("Saldo por local");
    expect(ficha?.textContent).toContain("Depósito");
    await click(page!.container.querySelector('[aria-label="Remover Cabo Cat6"]'));
    await until(async () => (await itemCount()) === 0, "item removido");
    expect((await item("item-1")).deleted_at).toBeTruthy();
  });
});
