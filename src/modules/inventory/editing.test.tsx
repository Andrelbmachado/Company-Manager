// Contrato da Tarefa 6, grupo logística (estoque, custódia, OS e fornecedores): cada lista é uma tabela editável e
// Editar / Adicionar trabalham na própria tabela, sem abrir modal; nenhuma tela do grupo usa CrudDialog/DetailDrawer.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buttonIn, click, mountPage, until, type Mounted } from "@/modules/catalog/testHarness";
import { openInventoryCount } from "@/lib/inventory/counts";
import { recordStockMovement, transferStock } from "@/lib/inventory/stock";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import CustodyPage from "@/modules/custody/pages/CustodyPage";
import WorkOrdersPage from "@/modules/operations/pages/WorkOrdersPage";
import SuppliersPage from "@/modules/purchasing/pages/SuppliersPage";
import InventoryCountPage from "./pages/InventoryCountPage";
import InventoryCountsPage from "./pages/InventoryCountsPage";
import InventoryPage from "./pages/InventoryPage";
import StockLocationsPage from "./pages/StockLocationsPage";
import StockMovementsPage from "./pages/StockMovementsPage";
import StockTransfersPage from "./pages/StockTransfersPage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));
vi.mock("@/lib/confirm", () => ({ confirmAction: vi.fn(async () => true) }));

const testDb = useTestDb();
let mounted: Mounted | null = null;
let companyId: string;
let countId: string;

beforeEach(async () => {
  const db = testDb();
  ({ companyId } = await insertTestCompany(db, { roles: ["admin"] }));
  await db.execute("INSERT INTO stock_locations (id, company_id, name) VALUES ('loc-1', ?, 'Depósito')", [companyId]);
  await db.execute("INSERT INTO stock_locations (id, company_id, name) VALUES ('loc-2', ?, 'Loja')", [companyId]);
  await db.execute("INSERT INTO inventory_items (id, company_id, name, unit) VALUES ('item-1', ?, 'Cabo Cat6', 'cx')", [companyId]);
  await db.execute("INSERT INTO stock_balances (id, company_id, item_id, location_id, quantity) VALUES ('b1', ?, 'item-1', 'loc-1', 10)", [companyId]);
  await db.execute("INSERT INTO suppliers (id, company_id, name) VALUES ('sup-1', ?, 'NetPrime')", [companyId]);
  await db.execute("INSERT INTO work_orders (id, company_id, number) VALUES ('wo-1', ?, 'OS-0001')", [companyId]);
  await db.execute("INSERT INTO custodies (id, company_id, item_id, holder_id, quantity) VALUES ('cu-1', ?, 'item-1', 'test-user-admin', 1)", [companyId]);
  await recordStockMovement(db, { companyId, itemId: "item-1", type: "entrada", quantity: 5, toLocationId: "loc-1" });
  await transferStock(db, { companyId, fromLocationId: "loc-1", toLocationId: "loc-2", lines: [{ itemId: "item-1", quantity: 2 }] });
  ({ id: countId } = await openInventoryCount(db, { companyId, locationId: "loc-1" }));
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
});

const PAGES: ReadonlyArray<{ name: string; path: string; route: string; element: ReactNode }> = [
  { name: "Estoque", path: "/inventory", route: "/inventory", element: <InventoryPage /> },
  { name: "Locais", path: "/inventory/locais", route: "/inventory/locais", element: <StockLocationsPage /> },
  { name: "Inventário (contagens)", path: "/inventory/inventarios", route: "/inventory/inventarios", element: <InventoryCountsPage /> },
  { name: "Folha da contagem aberta", path: "/inventory/inventarios/:count", route: "/inventory/inventarios/:id", element: <InventoryCountPage /> },
  { name: "Movimentações", path: "/inventory/movimentacoes", route: "/inventory/movimentacoes", element: <StockMovementsPage /> },
  { name: "Transferências", path: "/inventory/transferencias", route: "/inventory/transferencias", element: <StockTransfersPage /> },
  { name: "Custódia", path: "/custody", route: "/custody", element: <CustodyPage /> },
  { name: "Ordens de serviço", path: "/work-orders", route: "/work-orders", element: <WorkOrdersPage /> },
  { name: "Fornecedores", path: "/purchasing/fornecedores", route: "/purchasing/fornecedores", element: <SuppliersPage /> },
];

describe("logística — edição direto na tabela (contrato)", () => {
  it.each(PAGES)("$name: tabela editável; Editar e Adicionar sem modal", async ({ path, route, element }) => {
    mounted = await mountPage({ companyId, role: "admin", path: path.replace(":count", countId), routes: [{ path: route, element }] });
    const table = () => mounted!.container.querySelector<HTMLElement>("[data-editable-table]");
    await until(() => {
      const edit = table() && buttonIn(table()!, "Editar");
      return Boolean(edit && !edit.disabled && table()!.querySelector("tr[data-row-key]"));
    }, "tabela editável com linhas");

    await click(buttonIn(table()!, "Editar"));
    expect(table()!.hasAttribute("data-editing")).toBe(true);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await click(buttonIn(table()!, "Cancelar"));
    await until(() => !table()!.hasAttribute("data-editing"), "fim da edição");

    await click(buttonIn(table()!, "Adicionar"));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(table()!.querySelector('[aria-label$="(nova linha)"]')).not.toBeNull();
    await click(buttonIn(table()!, "Cancelar"));
  });
});

describe("logística — sem CrudDialog/DetailDrawer", () => {
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return sources(full);
      return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
    });
  }

  it("as telas do grupo não importam os modais de edição antigos", () => {
    const root = join(process.cwd(), "src", "modules");
    const files = [...["inventory", "custody", "operations"].flatMap((folder) => sources(join(root, folder))), join(root, "purchasing", "pages", "SuppliersPage.tsx")];
    expect(files.length).toBeGreaterThan(8);
    const offenders = files.filter((file) => /CrudDialog|DetailDrawer/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});
