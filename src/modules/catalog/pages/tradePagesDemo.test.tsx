// As telas de Catálogo, Vendas e Compras no banco demo do navegador: cada consulta tem de caber no SQL do demo
// (sem JOIN/soma) e os dados gravados pelas regras (pedido, fatura, compra, recebimento) têm de aparecer.
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDemoDb, DEMO_COMPANY_ID, type DatabaseLike } from "@/lib/db/demo";
import { confirmSalesOrder, createSalesOrder, deliverSalesOrder, invoiceSalesOrder } from "@/lib/erp/orders";
import { approvePurchaseOrder, createPurchaseOrder, loadPurchaseOrderItems, receivePurchaseOrder } from "@/lib/erp/receiving";
import { seedTradeFixture, type TradeFixture } from "@/lib/erp/tradeFixtures";
import { mountPage, until, type Mounted } from "../testHarness";
import GoodsReceiptsPage from "@/modules/purchasing/pages/GoodsReceiptsPage";
import PurchaseOrderPage from "@/modules/purchasing/pages/PurchaseOrderPage";
import PurchasingPage from "@/modules/purchasing/pages/PurchasingPage";
import SuppliersPage from "@/modules/purchasing/pages/SuppliersPage";
import InvoicePage from "@/modules/sales/pages/InvoicePage";
import InvoicesPage from "@/modules/sales/pages/InvoicesPage";
import SalesOrderPage from "@/modules/sales/pages/SalesOrderPage";
import SalesPage from "@/modules/sales/pages/SalesPage";
import CatalogPage from "./CatalogPage";
import PriceListsPage from "./PriceListsPage";

const state = vi.hoisted(() => ({ db: null as DatabaseLike | null }));
vi.mock("@/lib/db/client", () => ({ getDb: async () => state.db, isTauriRuntime: () => false }));

const C = DEMO_COMPANY_ID;
let fx: TradeFixture;
let ids: { order: string; invoice: string; purchase: string; receipt: string };
let page: Mounted | null = null;

beforeEach(async () => {
  localStorage.clear();
  const db = createDemoDb();
  state.db = db;
  fx = await seedTradeFixture(db, C, "demo-ceo");
  const order = await createSalesOrder(db, { companyId: C, customerId: fx.customerId, locationId: fx.locationId, items: [{ productId: fx.products.switch, qty: 1 }, { productId: fx.products.visita, qty: 1 }] });
  await confirmSalesOrder(db, order, { companyId: C });
  const { invoiceId } = await invoiceSalesOrder(db, order, { companyId: C, installments: 2 });
  await deliverSalesOrder(db, order, { companyId: C });
  await createSalesOrder(db, { companyId: C, customerId: fx.otherCustomerId, items: [{ productId: fx.products.mouse, qty: 12 }] });
  const purchase = await createPurchaseOrder(db, { companyId: C, supplierId: fx.supplierId, items: [{ productId: fx.products.mouse, qty: 10, unitPrice: 40 }] });
  await approvePurchaseOrder(db, purchase, { companyId: C });
  const [line] = await loadPurchaseOrderItems(db, C, purchase);
  const { receiptId } = await receivePurchaseOrder(db, purchase, [{ itemId: line.id, qty: 4, locationId: fx.locationId }], { companyId: C, supplierInvoiceNumber: "NF-9" });
  ids = { order, invoice: invoiceId, purchase, receipt: receiptId };
});

afterEach(() => {
  page?.unmount();
  page = null;
});

async function show(path: string, route: string, element: ReactNode, expected: readonly string[]) {
  const errors: unknown[] = [];
  const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { errors.push(args); });
  page = await mountPage({ companyId: C, role: "ceo", path, routes: [{ path: route, element }] });
  try {
    await until(() => expected.every((piece) => (document.body.textContent ?? "").includes(piece)), `${path}: ${expected.join(", ")}`);
  } finally {
    spy.mockRestore();
  }
  expect(document.body.textContent).not.toMatch(/não suportad|nao suportad|Não foi possível/);
  expect(errors.map(String).join("\n")).not.toMatch(/demo/i);
}

describe("telas de comércio no banco demo", () => {
  it("catálogo e tabelas de preço", async () => {
    await show("/catalog", "/catalog", <CatalogPage />, ["Switch 24 portas", "Visita técnica"]);
    page!.unmount();
    page = null;
    await show("/catalog/tabelas-de-preco", "/catalog/tabelas-de-preco", <PriceListsPage />, ["Tabela padrão", "Revenda", "Mouse USB"]);
  });

  it("vendas: lista, pedido, faturas e fatura", async () => {
    await show("/sales", "/sales", <SalesPage />, ["PV-00002", "Cliente Final", "840,00", "2.950,00"]);
    page!.unmount();
    page = null;
    await show(`/sales/pedidos/${ids.order}`, "/sales/pedidos/:id", <SalesOrderPage />, ["Pedido PV-00001", "FAT-00001", "Switch 24 portas", "−1"]);
    page!.unmount();
    page = null;
    await show("/sales/pedidos/nova", "/sales/pedidos/:id", <SalesOrderPage />, ["Novo pedido de venda", "Cliente Final", "Revenda"]);
    page!.unmount();
    page = null;
    await show("/sales/faturas", "/sales/faturas", <InvoicesPage />, ["FAT-00001", "PV-00001"]);
    page!.unmount();
    page = null;
    await show(`/sales/faturas/${ids.invoice}`, "/sales/faturas/:id", <InvoicePage />, ["Fatura FAT-00001", "2/2", "Visita técnica"]);
  });

  it("compras: lista, pedido, recebimentos e fornecedores", async () => {
    await show("/purchasing", "/purchasing", <PurchasingPage />, ["PC-00001", "Distribuidora Teste"]);
    page!.unmount();
    page = null;
    await show(`/purchasing/pedidos/${ids.purchase}`, "/purchasing/pedidos/:id", <PurchaseOrderPage />, ["Pedido de compra PC-00001", "REC-00001", "4 de 10", "Distribuidora Teste - PC-00001"]);
    page!.unmount();
    page = null;
    await show(`/purchasing/recebimentos?rec=${ids.receipt}`, "/purchasing/recebimentos", <GoodsReceiptsPage />, ["Recebimento REC-00001", "NF-9", "Mouse USB"]);
    page!.unmount();
    page = null;
    await show("/purchasing/fornecedores", "/purchasing/fornecedores", <SuppliersPage />, ["Fornecedores", "Distribuidora Teste", "11.222.333/0001-81"]);
  });
});
