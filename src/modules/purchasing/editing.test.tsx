// Tarefa 6 do redesign, grupo b (compras): pedidos, itens do pedido, recebimentos e fornecedores são editados na
// própria tabela (nenhum role="dialog" ao editar ou adicionar) e o módulo não usa mais CrudDialog nem DetailDrawer.
import type { ReactElement } from "react";
import { Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { createPurchaseOrder } from "@/lib/erp/receiving";
import { seedTradeFixture } from "@/lib/erp/tradeFixtures";
import { renderPage, type RenderedPage } from "@/test/pageHarness";
import { expectInlineEditing, filesWithDialogs } from "@/modules/finance/testing/editingContract";
import GoodsReceiptsPage from "./pages/GoodsReceiptsPage";
import PurchaseOrderPage from "./pages/PurchaseOrderPage";
import PurchasingPage from "./pages/PurchasingPage";
import SuppliersPage from "./pages/SuppliersPage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));
vi.mock("@/lib/confirm", () => ({ confirmAction: vi.fn(async () => true) }));

const SOURCES = import.meta.glob<string>("./**/*.tsx", { query: "?raw", import: "default", eager: true });

const testDb = useTestDb();
let page: RenderedPage | null = null;

afterEach(() => {
  page?.unmount();
  page = null;
  document.body.innerHTML = "";
});

const PAGES: [string, (orderId: string) => ReactElement, (orderId: string) => string][] = [
  ["Pedidos de compra", () => <PurchasingPage />, () => "/purchasing"],
  ["Fornecedores", () => <SuppliersPage />, () => "/purchasing/fornecedores"],
  ["Recebimentos", () => <GoodsReceiptsPage />, () => "/purchasing/recebimentos"],
  [
    "Itens do pedido",
    () => (
      <Routes>
        <Route path="/purchasing/pedidos/:id" element={<PurchaseOrderPage />} />
      </Routes>
    ),
    (orderId) => `/purchasing/pedidos/${orderId}`,
  ],
];

describe("compras: edição direto na tabela", () => {
  it.each(PAGES)("%s: EditableTable, sem modal ao editar ou adicionar", async (what, render, path) => {
    const db = testDb();
    const { companyId } = await insertTestCompany(db, { companyId: "empresa-compras", roles: ["ceo"] });
    const fx = await seedTradeFixture(db, companyId, "test-user-ceo");
    const orderId = await createPurchaseOrder(db, { companyId, supplierId: fx.supplierId, items: [{ productId: fx.products.mouse, qty: 2 }] });
    page = await renderPage(render(orderId), { companyId, role: "ceo", path: path(orderId) });
    expect(await expectInlineEditing(page, what)).toBeGreaterThan(0);
  });

  it("nenhum arquivo do módulo usa CrudDialog ou DetailDrawer", () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(3);
    expect(filesWithDialogs(SOURCES)).toEqual([]);
  });
});
