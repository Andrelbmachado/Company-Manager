// Tabela de formulário (itens do pedido, da proposta, mapeamento de colunas, recebimento): clique no cabeçalho ordena
// e o filtro esconde linhas, mas digitar num campo não faz a linha pular de lugar nem sumir, e linha nova fica visível.
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { click, renderPage, type as typeInto, type RenderedPage } from "@/test/pageHarness";
import { SortableHeader, TableFilterBar, TableFilterButton, useDraftSortFilter, type SortFilterColumn } from ".";

interface Line {
  key: string;
  description: string;
  qty: string;
}

const COLUMNS: SortFilterColumn<Line>[] = [
  { key: "description", header: "Descrição", kind: "text" },
  { key: "qty", header: "Qtd.", kind: "number" },
];

const START: Line[] = [
  { key: "a", description: "Cabo", qty: "3" },
  { key: "b", description: "Antena", qty: "10" },
  { key: "c", description: "Bateria", qty: "1" },
];

function Editor() {
  const [lines, setLines] = useState(START);
  const view = useDraftSortFilter(lines, COLUMNS, (line) => line.key);
  return (
    <div>
      <TableFilterButton view={view} />
      <TableFilterBar view={view} />
      <button type="button" onClick={() => setLines((current) => [...current, { key: `n${current.length}`, description: "", qty: "1" }])}>
        Nova linha
      </button>
      <button type="button" onClick={() => setLines((current) => current.filter((line) => line.key !== "a"))}>
        Remover Cabo
      </button>
      <table>
        <thead>
          <tr>
            {COLUMNS.map((column) => (
              <SortableHeader key={column.key} label={column.header} sortKey={column.key} sort={view.sort} onSort={view.toggleSort} />
            ))}
          </tr>
        </thead>
        <tbody>
          {view.rows.map((line) => (
            <tr key={line.key} data-line={line.key}>
              <td>
                <input
                  aria-label={`Descrição ${line.key}`}
                  value={line.description}
                  onChange={(event) => setLines((current) => current.map((item) => (item.key === line.key ? { ...item, description: event.target.value } : item)))}
                />
              </td>
              <td>{line.qty}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

let page: RenderedPage | null = null;
afterEach(() => {
  page?.unmount();
  page = null;
});

const order = () => [...page!.container.querySelectorAll("tbody tr")].map((row) => row.getAttribute("data-line"));
const input = (key: string) => page!.container.querySelector<HTMLInputElement>(`[aria-label="Descrição ${key}"]`);

describe("useDraftSortFilter", () => {
  it("sem ordenação nem filtro mantém a ordem da lista", async () => {
    page = await renderPage(<Editor />, { companyId: "c1" });
    expect(order()).toEqual(["a", "b", "c"]);
  });

  it("clique no cabeçalho ordena pelo tipo da coluna e o terceiro clique volta à ordem da lista", async () => {
    page = await renderPage(<Editor />, { companyId: "c1" });
    await click(page.container.querySelector("th [data-sort-key='description']"));
    expect(order()).toEqual(["b", "c", "a"]);
    await click(page.container.querySelector("th [data-sort-key='qty']"));
    expect(order()).toEqual(["c", "a", "b"]);
    await click(page.container.querySelector("th [data-sort-key='qty']"));
    expect(order()).toEqual(["b", "a", "c"]);
    await click(page.container.querySelector("th [data-sort-key='qty']"));
    expect(order()).toEqual(["a", "b", "c"]);
  });

  it("digitar não faz a linha pular de lugar; o próximo clique reordena com o texto novo", async () => {
    page = await renderPage(<Editor />, { companyId: "c1" });
    await click(page.container.querySelector("th [data-sort-key='description']"));
    expect(order()).toEqual(["b", "c", "a"]);
    await typeInto(input("b"), "Zíper");
    expect(input("b")?.value).toBe("Zíper");
    expect(order()).toEqual(["b", "c", "a"]);
    await click(page.container.querySelector("th [data-sort-key='description']"));
    expect(order()).toEqual(["b", "a", "c"]);
  });

  it("filtro esconde pelo valor na hora do filtro; editar não some com a linha; linha nova fica visível no fim", async () => {
    page = await renderPage(<Editor />, { companyId: "c1" });
    await click(page.button("Filtrar"));
    await typeInto(page.container.querySelector("[aria-label='Descrição: contém']"), "ba");
    expect(order()).toEqual(["c"]);
    await typeInto(input("c"), "Pilha");
    expect(order()).toEqual(["c"]);
    await click(page.button("Nova linha"));
    expect(order()).toEqual(["c", "n3"]);
    await click(page.button("Remover Cabo"));
    expect(order()).toEqual(["c", "n3"]);
  });
});
