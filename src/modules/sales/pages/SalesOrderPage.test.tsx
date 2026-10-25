// Pedido de venda pela tela: preço da tabela do cliente, salvar e confirmar, faturar em parcelas e entregar com baixa
// (faturar, entregar e cancelar em painéis na própria página), itens editados na tabela do pedido.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { seedTradeFixture, type TradeFixture } from "@/lib/erp/tradeFixtures";
import { buttonIn, choose, click, field, mountPage, typeInto, until, type Mounted } from "@/modules/catalog/testHarness";
import type { Invoice, Receivable, SalesOrder, StockBalance } from "@/types";
import SalesOrderPage from "./SalesOrderPage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));
vi.mock("@/lib/confirm", () => ({ confirmAction: vi.fn(async () => true) }));

const testDb = useTestDb();
let fx: TradeFixture;
let page: Mounted;

beforeEach(async () => {
  const { companyId } = await insertTestCompany(testDb(), { roles: ["ceo", "comercial"] });
  fx = await seedTradeFixture(testDb(), companyId, "test-user-ceo");
});

afterEach(() => page?.unmount());

const text = () => page.container.textContent ?? "";
const open = (role: "ceo" | "comercial", path: string) => mountPage({ companyId: fx.companyId, role, path, routes: [{ path: "/sales/pedidos/:id", element: <SalesOrderPage /> }] });
const panel = (label: string) => {
  const found = page.container.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  if (!found) throw new Error(`painel "${label}" não aberto`);
  return found;
};
const order = async () => (await testDb().select<SalesOrder[]>("SELECT * FROM sales_orders WHERE company_id = ?", [fx.companyId]))[0];

describe("SalesOrderPage", () => {
  it("cria com o preço da tabela do cliente, confirma, fatura em 2 parcelas e entrega baixando o estoque", async () => {
    page = await open("ceo", "/sales/pedidos/nova");
    await until(() => text().includes("Cliente Revenda") && text().includes("Switch"), "cliente e produtos carregados");

    await choose(field<HTMLSelectElement>(page.container, "Cliente"), fx.customerId);
    await choose(page.container.querySelector("select[aria-label='Produto do item 1']"), `p:${fx.products.switch}`);
    expect(page.container.querySelector<HTMLInputElement>("input[aria-label='Preço unit. do item 1']")?.value).toBe("2700");
    await typeInto(page.container.querySelector("input[aria-label='Quantidade do item 1']"), "2");
    await until(() => text().includes("5.400,00"), "total do pedido");

    await click(buttonIn(page.container, "Salvar e confirmar"));
    await until(async () => Boolean((await order())?.id) && page.path() !== "/sales/pedidos/nova", "pedido gravado e aberto");
    const saved = await order();
    expect(saved).toMatchObject({ status: "confirmado", total: 5400, price_list_id: fx.priceLists.revenda, customer_id: fx.customerId });
    expect(page.path()).toBe(`/sales/pedidos/${saved.id}`);

    await until(() => Boolean(buttonIn(page.container, "Faturar")), "botão Faturar");
    await click(buttonIn(page.container, "Faturar"));
    expect(document.querySelector("[role=dialog]")).toBeNull();
    const invoicePanel = panel("Faturar pedido PV-00001");
    await typeInto(field(invoicePanel, "Parcelas"), "2");
    await until(() => (panel("Faturar pedido PV-00001").textContent ?? "").includes("2/2"), "prévia das parcelas");
    await click(buttonIn(invoicePanel, "Emitir fatura"));
    await until(async () => (await testDb().select<Invoice[]>("SELECT * FROM invoices WHERE company_id = ?", [fx.companyId])).length === 1, "fatura gravada");
    const receivables = await testDb().select<Receivable[]>("SELECT * FROM receivables WHERE company_id = ? ORDER BY installment_number", [fx.companyId]);
    expect(receivables.map((row) => row.amount)).toEqual([2700, 2700]);
    await until(() => text().includes("FAT-00001"), "fatura listada no pedido");

    await until(() => Boolean(buttonIn(page.container, "Entregar")), "botão Entregar");
    await click(buttonIn(page.container, "Entregar"));
    const deliverPanel = panel("Entregar pedido PV-00001");
    expect(field<HTMLSelectElement>(deliverPanel, "Local de saída").value).toBe(fx.locationId);
    await click(buttonIn(deliverPanel, "Confirmar entrega"));
    await until(async () => (await order()).status === "entregue", "pedido entregue");
    const [balance] = await testDb().select<StockBalance[]>("SELECT * FROM stock_balances WHERE item_id = ? AND location_id = ?", [fx.items.switch, fx.locationId]);
    expect(balance.quantity).toBe(8);
    await until(() => text().includes("Saídas do estoque") && text().includes("−2"), "saída listada");
  });

  it("mostra o erro de regra (sem cliente) e não grava", async () => {
    page = await open("ceo", "/sales/pedidos/nova");
    await until(() => text().includes("Switch"), "produtos carregados");
    await choose(page.container.querySelector("select[aria-label='Produto do item 1']"), `p:${fx.products.mouse}`);
    await click(buttonIn(page.container, "Salvar e confirmar"));
    await until(() => text().includes("Escolha o cliente."), "mensagem de erro");
    expect(await order()).toBeUndefined();
  });

  it("comercial confirma mas não fatura; cancelar pede motivo", async () => {
    page = await open("comercial", "/sales/pedidos/nova");
    await until(() => text().includes("Cliente Final"), "clientes carregados");
    await choose(field<HTMLSelectElement>(page.container, "Cliente"), fx.otherCustomerId);
    await choose(page.container.querySelector("select[aria-label='Produto do item 1']"), `p:${fx.products.visita}`);
    await click(buttonIn(page.container, "Salvar rascunho"));
    await until(async () => (await order())?.status === "rascunho" && text().includes("Pedido PV-00001"), "rascunho aberto");

    expect(buttonIn(page.container, "Faturar")).toBeUndefined();
    await click(buttonIn(page.container, "Confirmar"));
    await until(async () => (await order()).status === "confirmado", "confirmado");
    await until(() => !buttonIn(page.container, "Confirmar") || buttonIn(page.container, "Confirmar")?.textContent?.trim() !== "Confirmar", "botão some");
    expect(buttonIn(page.container, "Faturar")).toBeUndefined();

    await click(buttonIn(page.container, "Cancelar"));
    const cancelPanel = panel("Cancelar pedido PV-00001");
    expect(buttonIn(cancelPanel, "Cancelar pedido")?.disabled).toBe(true);
    await typeInto(field(cancelPanel, "Motivo"), "Cliente desistiu");
    await click(buttonIn(cancelPanel, "Cancelar pedido"));
    await until(async () => (await order()).status === "cancelado", "cancelado");
    expect((await order()).cancel_reason).toBe("Cliente desistiu");
  });
});

describe("itens do pedido na tabela", () => {
  it("rascunho criado pela lista recebe itens na tabela do pedido e o total é recalculado", async () => {
    const { createSalesOrder } = await import("@/lib/erp/orders");
    const id = await createSalesOrder(testDb(), { companyId: fx.companyId, customerId: fx.customerId, items: [{ productId: fx.products.mouse, qty: 1 }] });
    page = await open("ceo", `/sales/pedidos/${id}`);
    await until(() => text().includes("Pedido PV-00001") && text().includes("Mouse USB"), "pedido aberto");
    const items = page.container.querySelector<HTMLElement>("[data-editable-table='sales_orders']")!;
    await click(buttonIn(items, "Adicionar"));
    await choose(items.querySelector("select[aria-label='Produto (nova linha)']"), fx.products.switch);
    await typeInto(items.querySelector("input[aria-label='Qtd. (nova linha)']"), "2");
    await click(buttonIn(items, "Salvar"));
    await until(async () => Number((await order()).total) === 80 + 5400, "total com o switch (preço da tabela Revenda)");
    expect(document.querySelector("[role=dialog]")).toBeNull();
  });
});
