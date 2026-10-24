// Cadastro de item na tela de Estoque: o saldo inicial vira entrada no local escolhido, e nada é gravado (nem em dobro)
// quando o saldo inicial não tem local ou um número é inválido.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionContext } from "@/hooks/useSession";
import { useTestDb } from "@/test/mockDb";
import { insertTestCompany } from "@/test/sqlite";
import type { Session } from "@/types";
import InventoryPage from "./InventoryPage";

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
  ({ companyId } = await insertTestCompany(testDb(), { roles: ["estoquista"] }));
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
});

async function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SessionContext.Provider value={{ session: session(companyId), setSession: () => undefined }}>
          <MemoryRouter initialEntries={["/inventory"]}>
            <InventoryPage />
          </MemoryRouter>
        </SessionContext.Provider>
      </QueryClientProvider>,
    );
  });
  await until(() => text().includes("Nenhum item no estoque") || container.querySelector("tbody") !== null, "lista de itens");
}

async function until(condition: () => boolean | Promise<boolean>, what: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await condition()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
  throw new Error(`Tempo esgotado esperando: ${what}`);
}

const text = () => container.textContent ?? "";
// Avisos (role="alert"): o seletor de local vazio já mostra "Cadastre um local…", então o aviso do erro é procurado aqui.
const alerts = () => [...container.querySelectorAll('[role="alert"]')].map((element) => element.textContent ?? "").join(" ");
const button = (label: string) => [...container.querySelectorAll("button")].find((item) => item.textContent?.trim() === label);

async function click(element: Element | null | undefined) {
  if (!(element instanceof HTMLElement)) throw new Error("elemento não encontrado");
  await act(async () => {
    element.click();
  });
}

async function type(id: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`#${id}`);
  if (!input) throw new Error(`campo ${id} não encontrado`);
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  await act(async () => {
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function choose(id: string, value: string) {
  const select = container.querySelector<HTMLSelectElement>(`#${id}`);
  if (!select) throw new Error(`campo ${id} não encontrado`);
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, value);
  await act(async () => {
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function itemCount(): Promise<number> {
  const [row] = await testDb().select<{ n: number }[]>("SELECT count(*) AS n FROM inventory_items WHERE company_id=?", [companyId]);
  return row.n;
}

describe("InventoryPage — novo item", () => {
  it("lista tem os botões de importar/exportar do registro de importação (entidade inventory)", async () => {
    await render();
    expect(container.querySelector('[data-entity="inventory"]')).not.toBeNull();
  });

  it("saldo inicial sem local cadastrado: avisa e não grava o item, nem ao tentar de novo", async () => {
    await render();
    await click(button("Adicionar"));
    await type("new-item-name", "Parafuso M6");
    await type("new-item-initial_qty", "5");
    await click(button("Salvar"));
    await until(() => alerts().includes("Cadastre um local"), "aviso de local");
    expect(await itemCount()).toBe(0);

    await click(container.querySelector('[aria-label="Fechar aviso"]'));
    expect(alerts()).toBe("");
    await click(button("Salvar"));
    await until(() => alerts().includes("Cadastre um local"), "aviso de local de novo");
    expect(await itemCount()).toBe(0);
    expect(container.querySelector("#new-item-name")).not.toBeNull();
  });

  it("número inválido (custo digitado errado) não vira 0 sem aviso: nada é gravado", async () => {
    await testDb().execute("INSERT INTO stock_locations (id, company_id, name) VALUES ('loc-1', ?, 'Depósito')", [companyId]);
    await render();
    await click(button("Adicionar"));
    await type("new-item-name", "Parafuso M6");
    await type("new-item-cost", "1O,50");
    await click(button("Salvar"));
    await until(() => /custo/i.test(alerts()) && alerts().includes("número"), "aviso de custo inválido");
    expect(await itemCount()).toBe(0);
  });

  it("cria o item e lança o saldo inicial como entrada no local escolhido ('1.250' = mil duzentos e cinquenta)", async () => {
    const db = testDb();
    await db.execute("INSERT INTO stock_locations (id, company_id, name) VALUES ('loc-1', ?, 'Depósito')", [companyId]);
    await db.execute("INSERT INTO stock_locations (id, company_id, name) VALUES ('loc-2', ?, 'Loja')", [companyId]);
    await render();
    await click(button("Adicionar"));
    await type("new-item-name", "Parafuso M6");
    await type("new-item-cost", "0,35");
    await type("new-item-initial_qty", "1.250");
    await choose("new-item-location", "loc-2");
    await click(button("Salvar"));
    await until(async () => (await itemCount()) === 1 && !container.querySelector("#new-item-name"), "item gravado e formulário fechado");

    const [item] = await db.select<{ id: string; cost: number }[]>("SELECT * FROM inventory_items WHERE company_id=?", [companyId]);
    expect(item.cost).toBe(0.35);
    const balances = await db.select<{ location_id: string; quantity: number }[]>("SELECT * FROM stock_balances WHERE item_id=?", [item.id]);
    expect(balances.map((row) => [row.location_id, row.quantity])).toEqual([["loc-2", 1250]]);
    const movements = await db.select<{ type: string; to_location_id: string; quantity: number; note: string }[]>("SELECT * FROM stock_movements WHERE item_id=?", [item.id]);
    expect(movements).toEqual([expect.objectContaining({ type: "entrada", to_location_id: "loc-2", quantity: 1250, note: "Saldo inicial" })]);
  });
});
