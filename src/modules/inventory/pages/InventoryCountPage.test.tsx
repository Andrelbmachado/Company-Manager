// Folha da contagem na tabela editável: o contado é lançado em Editar (sem modal), item novo entra por Adicionar,
// concluir não vale com a tabela em edição, perfil que só consulta vê os botões desabilitados; /nova volta para a lista.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buttonIn, choose, click, mountPage, typeInto, until, type Mounted } from "@/modules/catalog/testHarness";
import { openInventoryCount } from "@/lib/inventory/counts";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import type { InventoryCountItem, Role } from "@/types";
import InventoryCountPage from "./InventoryCountPage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));
vi.mock("@/lib/confirm", () => ({ confirmAction: vi.fn(async () => true) }));

const testDb = useTestDb();
let mounted: Mounted | null = null;
let companyId: string;
let countId: string;

beforeEach(async () => {
  const db = testDb();
  ({ companyId } = await insertTestCompany(db, { roles: ["estoquista", "gerente"] }));
  await db.execute("INSERT INTO stock_locations (id, company_id, name) VALUES ('loc-1', ?, 'Depósito')", [companyId]);
  await db.execute("INSERT INTO inventory_items (id, company_id, name, unit) VALUES ('item-1', ?, 'Cabo Cat6', 'cx')", [companyId]);
  await db.execute("INSERT INTO inventory_items (id, company_id, name, unit) VALUES ('item-2', ?, 'Switch', 'un')", [companyId]);
  await db.execute("INSERT INTO stock_balances (id, company_id, item_id, location_id, quantity) VALUES ('b1', ?, 'item-1', 'loc-1', 10)", [companyId]);
  ({ id: countId } = await openInventoryCount(db, { companyId, locationId: "loc-1" }));
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
});

async function open(role: Role, path = `/inventory/inventarios/${countId}`) {
  mounted = await mountPage({
    companyId,
    role,
    path,
    routes: [
      { path: "/inventory/inventarios", element: <p>lista de contagens</p> },
      { path: "/inventory/inventarios/:id", element: <InventoryCountPage /> },
    ],
  });
  return mounted;
}

const table = () => mounted!.container.querySelector<HTMLElement>("[data-editable-table]")!;
const cell = (label: string) => mounted!.container.querySelector(`[aria-label="${label}"]`);
const lines = async () => testDb().select<InventoryCountItem[]>("SELECT * FROM inventory_count_items WHERE count_id=? AND deleted_at IS NULL ORDER BY item_id", [countId]);

describe("InventoryCountPage", () => {
  it("/inventory/inventarios/nova volta para a lista (abrir contagem é Adicionar na tabela)", async () => {
    await open("estoquista", "/inventory/inventarios/nova");
    await until(() => mounted!.path() === "/inventory/inventarios", "voltar para a lista");
  });

  it("lança o contado em Editar e inclui item por Adicionar, sem modal; concluir com a tabela em edição é recusado", async () => {
    await testDb().execute("UPDATE inventory_count_items SET counted_qty=10 WHERE count_id=?", [countId]);
    await open("estoquista");
    await until(() => table() !== null && mounted!.container.querySelector("tr[data-row-key]") !== null, "folha carregada");
    await click(buttonIn(table(), "Editar"));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await typeInto(cell("Contado (linha 1)"), "8,5");
    await click(buttonIn(mounted!.container, "Concluir e ajustar estoque"));
    expect(mounted!.container.textContent).toContain("Salve ou cancele as alterações da tabela");
    await click(buttonIn(table(), "Adicionar"));
    await choose(cell("Item (nova linha)"), "item-2");
    await typeInto(cell("Contado (nova linha)"), "1");
    await click(buttonIn(table(), "Salvar"));
    await until(async () => (await lines()).length === 2, "item incluído");
    expect((await lines()).map((line) => [line.item_id, line.counted_qty])).toEqual([
      ["item-1", 8.5],
      ["item-2", 1],
    ]);
  });

  it("gerente (só consulta o estoque) vê Editar e Adicionar desabilitados e não conclui", async () => {
    await open("gerente");
    await until(() => mounted!.container.querySelector("tr[data-row-key]") !== null, "folha carregada");
    expect(buttonIn(table(), "Editar")!.disabled).toBe(true);
    expect(buttonIn(table(), "Adicionar")!.disabled).toBe(true);
    expect(buttonIn(mounted!.container, "Concluir e ajustar estoque")).toBeUndefined();
  });
});
