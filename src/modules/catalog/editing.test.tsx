// Contrato da Tarefa 6 (grupo comercial) no Catálogo: cada tela tem EditableTable e Editar/Adicionar não abrem diálogo.
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import { expectInlineEditing } from "@/test/inlineEditing";
import { seedTradeFixture, type TradeFixture } from "@/lib/erp/tradeFixtures";
import { click, mountPage, until, type Mounted } from "./testHarness";
import CatalogPage from "./pages/CatalogPage";
import PriceListsPage from "./pages/PriceListsPage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));
vi.mock("@/lib/confirm", () => ({ confirmAction: vi.fn(async () => true) }));

const testDb = useTestDb();
let fx: TradeFixture;
let page: Mounted;

beforeEach(async () => {
  const { companyId } = await insertTestCompany(testDb(), { roles: ["ceo"] });
  fx = await seedTradeFixture(testDb(), companyId, "test-user-ceo");
});

afterEach(() => page?.unmount());

const open = (path: string) => mountPage({ companyId: fx.companyId, role: "ceo", path, routes: [{ path: "/catalog", element: <CatalogPage /> }, { path: "/catalog/tabelas-de-preco", element: <PriceListsPage /> }] });
const text = () => page.container.textContent ?? "";

describe("Catálogo: edição direto na tabela", () => {
  it("produtos", async () => {
    page = await open("/catalog");
    await until(() => text().includes("Switch 24 portas"), "lista do catálogo");
    await expectInlineEditing(page.container, ["products"]);
  });

  it("tabelas de preço e preços da tabela escolhida", async () => {
    page = await open("/catalog/tabelas-de-preco");
    await until(() => text().includes("Revenda"), "tabelas");
    await click([...page.container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Revenda" || button.getAttribute("aria-label") === "Abrir tabela Revenda"));
    await until(() => page.container.querySelectorAll("[data-editable-table]").length >= 2, "preços da tabela");
    await expectInlineEditing(page.container);
  });
});
