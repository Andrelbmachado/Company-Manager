// Itens gravados de pedido/fatura (somente leitura): clique no cabeçalho ordena pelo tipo da coluna (quantidade e
// valores pelo número, inclusive a coluna extra com valor) e Filtrar filtra por coluna.
import { afterEach, describe, expect, it } from "vitest";
import { click, renderPage, type as typeInto, type RenderedPage } from "@/test/pageHarness";
import type { LineItemBase } from "@/types";
import { DocumentItemsTable } from "./DocumentItemsTable";

type Item = LineItemBase & { delivered_qty: number };

const item = (position: number, description: string, qty: number, total: number, delivered: number): Item => ({
  id: `i${position}`,
  company_id: "empresa-1",
  description,
  unit: "un",
  qty,
  unit_price: total / qty,
  discount: 0,
  tax_rate: 0,
  total,
  position,
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
  delivered_qty: delivered,
});

const ITEMS = [item(1, "Switch", 2, 5400, 1), item(2, "Cabo", 10, 150, 10), item(3, "Mouse", 3, 240, 0)];

let page: RenderedPage | null = null;

afterEach(() => {
  page?.unmount();
  page = null;
});

const descriptions = () => [...document.querySelectorAll("tbody tr")].map((row) => row.querySelectorAll("td")[1]?.textContent);

describe("DocumentItemsTable", () => {
  it("ordena por quantidade, total e coluna extra e filtra por descrição", async () => {
    page = await renderPage(<DocumentItemsTable<Item> items={ITEMS} extra={[{ header: "Entregue", cell: (row) => String(row.delivered_qty), value: (row) => row.delivered_qty }]} />, { companyId: "empresa-1" });
    expect(descriptions()).toEqual(["Switch", "Cabo", "Mouse"]);
    await click(document.querySelector("th [data-sort-key='qty']"));
    expect(descriptions()).toEqual(["Switch", "Mouse", "Cabo"]);
    await click(document.querySelector("th [data-sort-key='total']"));
    await click(document.querySelector("th [data-sort-key='total']"));
    expect(descriptions()).toEqual(["Switch", "Mouse", "Cabo"]);
    await click(document.querySelector("th [data-sort-key='extra:Entregue']"));
    expect(descriptions()).toEqual(["Mouse", "Switch", "Cabo"]);

    await click(page.button("Filtrar"));
    await typeInto(document.querySelector('[aria-label="Descrição: contém"]'), "mou");
    expect(descriptions()).toEqual(["Mouse"]);
  });
});
