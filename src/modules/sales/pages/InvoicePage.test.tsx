// Faturas pela tela: status derivado das parcelas na lista, detalhe com parcelas e cancelamento com motivo (painel na
// página), nota fiscal editada na tabela e fatura emitida pelo Adicionar da lista.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { confirmSalesOrder, createSalesOrder, invoiceSalesOrder } from "@/lib/erp/orders";
import { seedTradeFixture, type TradeFixture } from "@/lib/erp/tradeFixtures";
import { buttonIn, choose, click, field, mountPage, typeInto, until, type Mounted } from "@/modules/catalog/testHarness";
import type { Invoice, Receivable, SalesOrder } from "@/types";
import InvoicePage from "./InvoicePage";
import InvoicesPage from "./InvoicesPage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));

const testDb = useTestDb();
let fx: TradeFixture;
let page: Mounted;
let invoiceId: string;
let orderId: string;

beforeEach(async () => {
  const { companyId } = await insertTestCompany(testDb(), { roles: ["financeiro", "comercial"] });
  fx = await seedTradeFixture(testDb(), companyId, "test-user-financeiro");
  orderId = await createSalesOrder(testDb(), { companyId, customerId: fx.customerId, items: [{ productId: fx.products.visita, qty: 2 }] });
  await confirmSalesOrder(testDb(), orderId, { companyId });
  ({ invoiceId } = await invoiceSalesOrder(testDb(), orderId, { companyId, installments: 2, issueDate: "2020-01-10" }));
});

afterEach(() => page?.unmount());

const text = () => page.container.textContent ?? "";
const routes = [
  { path: "/sales/faturas", element: <InvoicesPage /> },
  { path: "/sales/faturas/:id", element: <InvoicePage /> },
];

describe("Faturas", () => {
  it("lista com status pelas parcelas (vencida) e abre o detalhe", async () => {
    page = await mountPage({ companyId: fx.companyId, role: "comercial", path: "/sales/faturas", routes });
    await until(() => text().includes("FAT-00001"), "lista de faturas");
    expect(text()).toContain("Vencida");
    expect(text()).toContain("PV-00001");
    expect(buttonIn(page.container, "Editar")?.disabled).toBe(true);
    await click(buttonIn(page.container, "FAT-00001"));
    await until(() => page.path() === `/sales/faturas/${invoiceId}` && text().includes("Parcelas (contas a receber)") && text().includes("2/2"), "detalhe da fatura");
    expect(buttonIn(page.container, "Cancelar fatura")).toBeUndefined();
  });

  it("financeiro cancela com motivo e o pedido pode ser faturado de novo", async () => {
    page = await mountPage({ companyId: fx.companyId, role: "financeiro", path: `/sales/faturas/${invoiceId}`, routes });
    await until(() => Boolean(buttonIn(page.container, "Cancelar fatura")), "detalhe");
    await click(buttonIn(page.container, "Cancelar fatura"));
    const form = page.container.querySelector<HTMLElement>("[aria-label='Cancelar fatura FAT-00001']")!;
    expect(document.querySelector("[role=dialog]")).toBeNull();
    await typeInto(field(form, "Motivo"), "Emitida com o valor errado");
    await click(buttonIn(form, "Cancelar fatura"));
    await until(async () => (await testDb().select<Invoice[]>("SELECT * FROM invoices WHERE id = ?", [invoiceId]))[0].status === "cancelada", "fatura cancelada");
    const parcels = await testDb().select<Receivable[]>("SELECT * FROM receivables WHERE invoice_id = ?", [invoiceId]);
    expect(parcels.map((row) => row.status)).toEqual(["cancelada", "cancelada"]);
    expect((await testDb().select<SalesOrder[]>("SELECT * FROM sales_orders WHERE id = ?", [orderId]))[0]).toMatchObject({ status: "confirmado", invoiced_at: null });
    await until(() => text().includes("Cancelada"), "status na tela");
  });

  it("financeiro grava a nota fiscal na tabela e fatura outro pedido pelo Adicionar", async () => {
    const other = await createSalesOrder(testDb(), { companyId: fx.companyId, customerId: fx.otherCustomerId, items: [{ productId: fx.products.visita, qty: 1 }] });
    await confirmSalesOrder(testDb(), other, { companyId: fx.companyId });
    page = await mountPage({ companyId: fx.companyId, role: "financeiro", path: "/sales/faturas", routes });
    await until(() => text().includes("FAT-00001"), "lista");
    const table = page.container.querySelector<HTMLElement>("[data-editable-table='invoices']")!;
    await click(buttonIn(table, "Editar"));
    await typeInto(table.querySelector("input[aria-label='Nota fiscal (linha 1)']"), "NF-123");
    await click(buttonIn(table, "Salvar"));
    await until(async () => (await testDb().select<Invoice[]>("SELECT * FROM invoices WHERE id = ?", [invoiceId]))[0].fiscal_number === "NF-123", "nota fiscal gravada");

    await click(buttonIn(table, "Adicionar"));
    await choose(table.querySelector("select[aria-label='Pedido (nova linha)']"), other);
    await choose(table.querySelector("select[aria-label='Forma de pagamento (nova linha)']"), "pix");
    await click(buttonIn(table, "Salvar"));
    await until(async () => (await testDb().select<Invoice[]>("SELECT * FROM invoices WHERE sales_order_id = ?", [other])).length === 1, "fatura do outro pedido");
    expect((await testDb().select<Invoice[]>("SELECT * FROM invoices WHERE sales_order_id = ?", [other]))[0]).toMatchObject({ status: "emitida", payment_method: "pix" });
    expect(document.querySelector("[role=dialog]")).toBeNull();
  });

  it("lista ordena e filtra Cliente pelo nome (não pelo código) e Status pelo rótulo, em múltipla escolha", async () => {
    const other = await createSalesOrder(testDb(), { companyId: fx.companyId, customerId: fx.otherCustomerId, items: [{ productId: fx.products.visita, qty: 1 }] });
    await confirmSalesOrder(testDb(), other, { companyId: fx.companyId });
    await invoiceSalesOrder(testDb(), other, { companyId: fx.companyId, installments: 1, issueDate: "2999-01-10" });
    page = await mountPage({ companyId: fx.companyId, role: "financeiro", path: "/sales/faturas", routes });
    await until(() => text().includes("FAT-00002"), "duas faturas");
    const table = page.container.querySelector<HTMLElement>("[data-editable-table='invoices']")!;
    const customers = () => [...table.querySelectorAll("tr[data-row-key] td[data-column='customer_id']")].map((cell) => cell.textContent);

    // fx-cust-1 = Cliente Revenda, fx-cust-2 = Cliente Final: pelo código a Revenda viria primeiro.
    await click(table.querySelector("th [data-sort-key='customer_id']"));
    expect(customers()).toEqual(["Cliente Final", "Cliente Revenda"]);

    await click(buttonIn(table, "Filtrar"));
    await typeInto(table.querySelector("[aria-label='Cliente: contém']"), "revenda");
    expect(customers()).toEqual(["Cliente Revenda"]);
    await click(buttonIn(table, "Limpar filtros"));

    const status = [...table.querySelectorAll("[data-filter-bar] fieldset")].find((item) => item.querySelector("legend")?.textContent === "Status")!;
    const choices = [...status.querySelectorAll("label")];
    expect(choices.map((label) => label.textContent)).toEqual(["Emitida", "Vencida"]);
    await click(choices.find((label) => label.textContent === "Vencida")!.querySelector("input"));
    expect(customers()).toEqual(["Cliente Revenda"]);
  });

  it("parcelas do detalhe ordenam pelo cabeçalho e filtram por coluna", async () => {
    page = await mountPage({ companyId: fx.companyId, role: "financeiro", path: `/sales/faturas/${invoiceId}`, routes });
    await until(() => text().includes("2/2"), "parcelas");
    const section = page.container.querySelector<HTMLElement>("section[aria-label='Parcelas (contas a receber)']")!;
    const parcels = () => [...section.querySelectorAll("tbody tr")].map((row) => row.querySelector("td")?.textContent);
    expect(parcels()).toEqual(["1/2", "2/2"]);
    await click(section.querySelector("th [data-sort-key='due_date']"));
    await click(section.querySelector("th [data-sort-key='due_date']"));
    expect(parcels()).toEqual(["2/2", "1/2"]);
    await click(buttonIn(section, "Filtrar"));
    await typeInto(section.querySelector("[aria-label='Parcela: mínimo']"), "2");
    expect(parcels()).toEqual(["2/2"]);
    await typeInto(section.querySelector("[aria-label='Parcela: mínimo']"), "3");
    expect(section.textContent).toContain("Nenhum registro com esses filtros.");
  });

  it("'nova' leva aos pedidos: fatura nasce do pedido", async () => {
    page = await mountPage({ companyId: fx.companyId, role: "financeiro", path: "/sales/faturas/nova", routes });
    await until(() => text().includes("Fature pelo pedido") && text().includes("Ver pedidos de venda"), "atalho para os pedidos");
  });
});
