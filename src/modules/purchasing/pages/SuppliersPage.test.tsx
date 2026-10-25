// Fornecedores pela tela: cadastro na própria tabela (com endereço), CNPJ repetido, ficha no próprio lugar e exclusão
// em dois passos bloqueada com pedido em andamento; gerência só consulta.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { createPurchaseOrder } from "@/lib/erp/receiving";
import { seedTradeFixture, type TradeFixture } from "@/lib/erp/tradeFixtures";
import { buttonIn, click, mountPage, until, type Mounted } from "@/modules/catalog/testHarness";
import { addRow, editCell, saveError, saveTable, tableOf } from "@/modules/finance/testing/tableActions";
import type { Supplier } from "@/types";
import SuppliersPage from "./SuppliersPage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));
vi.mock("@/lib/confirm", () => ({ confirmAction: vi.fn(async () => true) }));

const testDb = useTestDb();
let fx: TradeFixture;
let page: Mounted;

beforeEach(async () => {
  const { companyId } = await insertTestCompany(testDb(), { roles: ["estoquista", "gerente"] });
  fx = await seedTradeFixture(testDb(), companyId, "test-user-estoquista");
});

afterEach(() => page?.unmount());

const text = () => page.container.textContent ?? "";
const open = (role: "estoquista" | "gerente") => mountPage({ companyId: fx.companyId, role, path: "/purchasing/fornecedores", routes: [{ path: "/purchasing/fornecedores", element: <SuppliersPage /> }] });
const suppliers = async () => testDb().select<Supplier[]>("SELECT * FROM suppliers WHERE company_id = ? AND deleted_at IS NULL ORDER BY name", [fx.companyId]);
const loaded = () => until(() => Boolean(page.container.querySelector(`tr[data-row-key="${fx.supplierId}"]`)), "lista");

describe("SuppliersPage", () => {
  it("cadastra na tabela com endereço e recusa CNPJ repetido", async () => {
    page = await open("estoquista");
    await loaded();
    expect(page.container.querySelector("h1")?.textContent).toBe("Fornecedores");
    const table = tableOf(page.container, "suppliers");

    await addRow(table);
    expect(document.querySelector("[role=dialog]")).toBeNull();
    await editCell(table, "nova", "name", "Eletro Peças Ltda");
    await editCell(table, "nova", "document", "45.723.174/0001-10");
    await editCell(table, "nova", "email", "Vendas@EletroPecas.com.br");
    await editCell(table, "nova", "cidade", "Sorocaba");
    await editCell(table, "nova", "uf", "SP");
    await saveTable(table);
    await until(async () => (await suppliers()).length === 2, "fornecedor gravado");
    const saved = (await suppliers()).find((row) => row.name === "Eletro Peças Ltda")!;
    expect(saved).toMatchObject({ email: "vendas@eletropecas.com.br", document: "45.723.174/0001-10" });
    expect(JSON.parse(saved.address_json)).toEqual({ cidade: "Sorocaba", uf: "SP" });

    await until(() => Boolean(page.container.querySelector("button[aria-label='Ficha de Eletro Peças Ltda']")), "linha gravada");
    await click(page.container.querySelector("button[aria-label='Ficha de Eletro Peças Ltda']"));
    await until(() => (page.container.querySelector("section[aria-label='Eletro Peças Ltda']")?.textContent ?? "").includes("Sorocaba/SP"), "ficha com endereço");

    await addRow(table);
    await editCell(table, "nova", "name", "Repetido");
    await editCell(table, "nova", "document", "11222333000181");
    expect(await saveError(table)).toContain("Já existe um fornecedor com este CNPJ/CPF: Distribuidora Teste.");
    expect(await suppliers()).toHaveLength(2);
  });

  it("não exclui com pedido em andamento; gerência só consulta", async () => {
    await createPurchaseOrder(testDb(), { companyId: fx.companyId, supplierId: fx.supplierId, items: [{ productId: fx.products.mouse, qty: 1 }] });
    page = await open("estoquista");
    await loaded();
    await click(page.container.querySelector("button[aria-label='Ficha de Distribuidora Teste']"));
    await until(() => (page.container.querySelector("section[aria-label='Distribuidora Teste']")?.textContent ?? "").includes("PC-00001"), "pedidos do fornecedor");
    await click(page.container.querySelector("button[aria-label='Excluir Distribuidora Teste']"));
    await click(buttonIn(page.container, "Confirmar exclusão"));
    await until(() => text().includes("pedidos de compra em andamento"), "erro de exclusão");
    expect(await suppliers()).toHaveLength(1);
    page.unmount();

    page = await open("gerente");
    await loaded();
    const table = tableOf(page.container, "suppliers");
    const add = [...table.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Adicionar")!;
    expect(add.disabled).toBe(true);
    expect(add.title).toBe("Seu perfil não tem permissão para adicionar neste cadastro.");
    expect(page.container.querySelector("button[aria-label='Excluir Distribuidora Teste']")).toBeNull();
  });
});
