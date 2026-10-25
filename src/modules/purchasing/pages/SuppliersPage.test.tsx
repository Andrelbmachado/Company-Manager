// Fornecedores editados direto na tabela: Adicionar com endereço (sem modal), CNPJ repetido na barra da tabela,
// endereço na ficha (também tabela), exclusão bloqueada com pedido em andamento e gerência só consultando.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { click, findButton, renderPage, type, until, type RenderedPage } from "@/test/pageHarness";
import { insertTestCompany } from "@/test/sqlite";
import { createPurchaseOrder } from "@/lib/erp/receiving";
import { seedTradeFixture, type TradeFixture } from "@/lib/erp/tradeFixtures";
import type { Role, Supplier } from "@/types";
import SuppliersPage from "./SuppliersPage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));
vi.mock("@/lib/confirm", () => ({ confirmAction: vi.fn(async () => true) }));

const testDb = useTestDb();
let fx: TradeFixture;
let page: RenderedPage | null = null;

beforeEach(async () => {
  const { companyId } = await insertTestCompany(testDb(), { roles: ["estoquista", "gerente"] });
  fx = await seedTradeFixture(testDb(), companyId, "test-user-estoquista");
});

afterEach(() => {
  page?.unmount();
  page = null;
  document.body.innerHTML = "";
});

async function open(role: Role = "estoquista") {
  page = await renderPage(<SuppliersPage />, { companyId: fx.companyId, role, path: "/purchasing/fornecedores" });
  await until(() => page!.text().includes("Distribuidora Teste"), "lista de fornecedores");
  return page;
}

const table = () => page!.container.querySelector<HTMLElement>('[data-editable-table="suppliers"]')!;
const cell = (label: string) => page!.container.querySelector<HTMLInputElement | HTMLSelectElement>(`[aria-label="${label}"]`);
const suppliers = async () => testDb().select<Supplier[]>("SELECT * FROM suppliers WHERE company_id = ? AND deleted_at IS NULL ORDER BY name", [fx.companyId]);

describe("SuppliersPage — edição direto na tabela", () => {
  it("Adicionar grava com endereço e recusa CNPJ repetido na barra da tabela", async () => {
    await open();
    expect(page!.container.querySelector("h1")?.textContent).toBe("Fornecedores");
    expect(page!.container.querySelector('[data-entity="suppliers"]')).not.toBeNull();

    await click(findButton(table(), "Adicionar"));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await type(cell("Razão social / nome (nova linha)"), "Eletro Peças Ltda");
    await type(cell("CNPJ / CPF (nova linha)"), "45.723.174/0001-10");
    await type(cell("E-mail (nova linha)"), "Vendas@EletroPecas.com.br");
    await type(cell("Cidade (nova linha)"), "Sorocaba");
    await type(cell("UF (nova linha)"), "SP");
    await click(findButton(table(), "Salvar"));
    await until(async () => (await suppliers()).length === 2, "fornecedor gravado");
    const saved = (await suppliers()).find((row) => row.name === "Eletro Peças Ltda")!;
    expect(saved).toMatchObject({ email: "vendas@eletropecas.com.br", document: "45.723.174/0001-10" });
    expect(JSON.parse(saved.address_json)).toEqual({ cidade: "Sorocaba", uf: "SP" });
    await until(() => !table().hasAttribute("data-editing") && page!.text().includes("Sorocaba"), "tabela atualizada");

    await click(findButton(table(), "Adicionar"));
    await type(cell("Razão social / nome (nova linha)"), "Repetido");
    await type(cell("CNPJ / CPF (nova linha)"), "11222333000181");
    await click(findButton(table(), "Salvar"));
    await until(() => (table().querySelector("[role=alert]")?.textContent ?? "").includes("Já existe um fornecedor com este CNPJ/CPF: Distribuidora Teste."), "erro de CNPJ");
    expect(table().hasAttribute("data-editing")).toBe(true);
    expect(await suppliers()).toHaveLength(2);
  });

  it("ficha abre abaixo da tabela: endereço editável na tabela e pedidos do fornecedor", async () => {
    await createPurchaseOrder(testDb(), { companyId: fx.companyId, supplierId: fx.supplierId, items: [{ productId: fx.products.mouse, qty: 1 }] });
    await open();
    await click(page!.container.querySelector('[aria-label="Ficha de Distribuidora Teste"]'));
    const sheet = () => page!.container.querySelector<HTMLElement>('section[aria-label="Ficha de Distribuidora Teste"]');
    await until(() => (sheet()?.textContent ?? "").includes("PC-00001"), "pedidos na ficha");
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    const detail = sheet()!.querySelector<HTMLElement>("[data-editable-table]")!;
    await click(findButton(detail, "Editar"));
    await type(detail.querySelector('[aria-label="Bairro (linha 1)"]'), "Centro");
    await click(findButton(detail, "Salvar"));
    await until(async () => JSON.parse((await suppliers())[0].address_json ?? "{}").bairro === "Centro", "endereço gravado");
  });

  it("não exclui com pedido em andamento; gerência vê Editar/Adicionar desabilitados e sem excluir", async () => {
    await createPurchaseOrder(testDb(), { companyId: fx.companyId, supplierId: fx.supplierId, items: [{ productId: fx.products.mouse, qty: 1 }] });
    await open();
    await click(page!.container.querySelector('[aria-label="Ficha de Distribuidora Teste"]'));
    await click(findButton(page!.container, "Excluir fornecedor"));
    await until(() => page!.text().includes("pedidos de compra em andamento"), "erro de exclusão");
    expect(await suppliers()).toHaveLength(1);
    page!.unmount();
    page = null;

    await open("gerente");
    const edit = findButton(table(), "Editar")!;
    const add = findButton(table(), "Adicionar")!;
    expect(edit.disabled).toBe(true);
    expect(add.disabled).toBe(true);
    expect(add.title).toMatch(/não tem permissão/);
    await click(page!.container.querySelector('[aria-label="Ficha de Distribuidora Teste"]'));
    expect(findButton(page!.container, "Excluir fornecedor")).toBeUndefined();
  });
});
