// Fornecedores pela tela: cadastro com endereço, CNPJ repetido, exclusão bloqueada com pedido em andamento.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { createPurchaseOrder } from "@/lib/erp/receiving";
import { seedTradeFixture, type TradeFixture } from "@/lib/erp/tradeFixtures";
import { buttonIn, click, dialog, field, mountPage, typeInto, until, type Mounted } from "@/modules/catalog/testHarness";
import type { Supplier } from "@/types";
import SuppliersPage from "./SuppliersPage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));

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

describe("SuppliersPage", () => {
  it("cadastra com endereço e recusa CNPJ repetido", async () => {
    page = await open("estoquista");
    await until(() => text().includes("Distribuidora Teste"), "lista");
    expect(page.container.querySelector("h1")?.textContent).toBe("Fornecedores");

    await click(buttonIn(page.container, "Novo fornecedor"));
    let form = dialog("Novo fornecedor");
    await typeInto(field(form, "Razão social"), "Eletro Peças Ltda");
    await typeInto(field(form, "CNPJ"), "45.723.174/0001-10");
    await typeInto(field(form, "E-mail"), "Vendas@EletroPecas.com.br");
    await typeInto(field(form, "Cidade"), "Sorocaba");
    await typeInto(field(form, "UF"), "SP");
    await click(buttonIn(form, "Salvar"));
    await until(async () => (await suppliers()).length === 2, "fornecedor gravado");
    const saved = (await suppliers()).find((row) => row.name === "Eletro Peças Ltda")!;
    expect(saved).toMatchObject({ email: "vendas@eletropecas.com.br", document: "45.723.174/0001-10" });
    expect(JSON.parse(saved.address_json)).toEqual({ cidade: "Sorocaba", uf: "SP" });
    await until(() => (document.body.textContent ?? "").includes("Sorocaba/SP"), "detalhe com endereço");

    await click(document.querySelector("[role=dialog][aria-label='Eletro Peças Ltda'] button[aria-label=Fechar]"));
    await click(buttonIn(page.container, "Novo fornecedor"));
    form = dialog("Novo fornecedor");
    await typeInto(field(form, "Razão social"), "Repetido");
    await typeInto(field(form, "CNPJ"), "11222333000181");
    await click(buttonIn(form, "Salvar"));
    await until(() => (dialog("Novo fornecedor").textContent ?? "").includes("Já existe um fornecedor com este CNPJ/CPF: Distribuidora Teste."), "erro de CNPJ");
  });

  it("não exclui com pedido em andamento; gerência só consulta", async () => {
    await createPurchaseOrder(testDb(), { companyId: fx.companyId, supplierId: fx.supplierId, items: [{ productId: fx.products.mouse, qty: 1 }] });
    page = await open("estoquista");
    await until(() => text().includes("Distribuidora Teste"), "lista");
    await click([...page.container.querySelectorAll("tr")].find((row) => row.textContent?.includes("Distribuidora Teste")));
    await until(() => (dialog("Distribuidora Teste").textContent ?? "").includes("PC-00001"), "pedidos do fornecedor");
    await click(buttonIn(dialog("Distribuidora Teste"), "Excluir fornecedor"));
    await click(buttonIn(dialog("Excluir fornecedor?"), "Excluir"));
    await until(() => (dialog("Excluir fornecedor?").textContent ?? "").includes("pedidos de compra em andamento"), "erro de exclusão");
    expect(await suppliers()).toHaveLength(1);
    page.unmount();

    page = await open("gerente");
    await until(() => text().includes("Distribuidora Teste"), "lista");
    expect(buttonIn(page.container, "Novo fornecedor")).toBeUndefined();
    await click([...page.container.querySelectorAll("tr")].find((row) => row.textContent?.includes("Distribuidora Teste")));
    expect(buttonIn(dialog("Distribuidora Teste"), "Excluir fornecedor")).toBeUndefined();
  });
});
