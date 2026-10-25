// Reposição: gerar os pedidos de compra em rascunho, com o local de entrega escolhido (ou "Definir no pedido").
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionContext } from "@/hooks/useSession";
import { seedStockFixture } from "@/lib/inventory/testFixtures";
import { useTestDb } from "@/test/mockDb";
import type { Session } from "@/types";
import ReorderPage from "./ReorderPage";

vi.mock("@/lib/db/client", () => import("@/test/mockDb"));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const testDb = useTestDb();

let root: Root | null = null;
let container: HTMLDivElement;
let companyId: string;

const session = (id: string) =>
  ({
    user: { id: "test-user-estoquista", name: "Teste estoquista", email: "estoquista@teste.local" },
    membership: { id: `test-member-${id}-estoquista`, company_id: id, user_id: "test-user-estoquista", role: "estoquista", scope: "setor" },
    company: { id, name: "Empresa de Teste" },
  }) as unknown as Session;

beforeEach(async () => {
  ({ companyId } = await seedStockFixture(testDb()));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SessionContext.Provider value={{ session: session(companyId), setSession: () => undefined }}>
          <MemoryRouter initialEntries={["/inventory/reposicao"]}>
            <ReorderPage />
          </MemoryRouter>
        </SessionContext.Provider>
      </QueryClientProvider>,
    );
  });
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
});

async function until(condition: () => boolean | Promise<boolean>, what: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await condition()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
  throw new Error(`Tempo esgotado esperando: ${what}`);
}

const generateButton = () => [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Gerar 2 pedidos"));
const locationSelect = () => container.querySelector<HTMLSelectElement>("#reorder-location");

async function chooseLocation(value: string) {
  const select = locationSelect()!;
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, value);
  await act(async () => {
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  // Deixa os efeitos rodarem: a escolha não pode voltar sozinha para o primeiro local.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

async function generate(): Promise<{ location_id: string | null }[]> {
  await act(async () => {
    generateButton()!.click();
  });
  let orders: { location_id: string | null }[] = [];
  await until(async () => {
    orders = await testDb().select<{ location_id: string | null }[]>("SELECT * FROM purchase_orders WHERE company_id=?", [companyId]);
    return orders.length === 2;
  }, "pedidos de compra gravados");
  return orders;
}

describe("ReorderPage", () => {
  it("começa entregando no primeiro local e grava o local escolhido nos pedidos", async () => {
    await until(() => Boolean(generateButton()) && locationSelect()?.value === "loc-a", "sugestão carregada com o primeiro local");
    await chooseLocation("loc-b");
    expect(locationSelect()!.value).toBe("loc-b");
    const orders = await generate();
    expect(orders.map((order) => order.location_id)).toEqual(["loc-b", "loc-b"]);
  });

  it("\"Definir no pedido\" fica escolhido e os pedidos saem sem local", async () => {
    await until(() => Boolean(generateButton()) && locationSelect()?.value === "loc-a", "sugestão carregada com o primeiro local");
    await chooseLocation("");
    expect(locationSelect()!.value).toBe("");
    const orders = await generate();
    expect(orders.map((order) => order.location_id)).toEqual([null, null]);
  });
});
