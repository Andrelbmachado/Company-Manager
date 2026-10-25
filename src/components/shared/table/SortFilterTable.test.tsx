// Peças reutilizáveis para tabelas que não usam EditableTable: useSortFilter + SortableHeader (clique ordena,
// aria-sort) + FilterButton/FilterBar (filtros por tipo, contador e limpar) + IconButton (só ícone, com dica).
import { afterEach, describe, expect, it } from "vitest";
import { Plus } from "lucide-react";
import { click, plain, renderPage, type as typeInto, type RenderedPage } from "@/test/pageHarness";
import { FilterBar, FilterButton, IconButton, SortableHeader, useSortFilter, type SortFilterColumn } from ".";

interface Row {
  id: string;
  name: string;
  amount: number | null;
  day: string | null;
  status: string;
}

const ROWS: Row[] = [
  { id: "r-1", name: "Bruno", amount: 10, day: "2025-03-02", status: "aberto" },
  { id: "r-2", name: "Álvaro", amount: 9, day: "2025-01-10", status: "pago" },
  { id: "r-3", name: "carla", amount: null, day: null, status: "aberto" },
  { id: "r-4", name: "Ana", amount: 1500, day: "2024-12-31", status: "cancelado" },
];

const COLUMNS: SortFilterColumn<Row>[] = [
  { key: "name", header: "Nome", kind: "text" },
  { key: "amount", header: "Valor", kind: "money" },
  { key: "day", header: "Vencimento", kind: "date" },
  {
    key: "status",
    header: "Situação",
    kind: "select",
    options: [
      { value: "aberto", label: "Em aberto" },
      { value: "pago", label: "Pago" },
      { value: "cancelado", label: "Cancelado" },
    ],
  },
];

function PlainTable() {
  const view = useSortFilter(ROWS, COLUMNS);
  return (
    <div>
      <FilterButton open={view.filtersOpen} onToggle={view.toggleFilters} activeCount={view.activeCount} controls={view.filtersId} />
      <IconButton label="Adicionar" icon={Plus} onClick={() => undefined} />
      {view.filtersOpen && <FilterBar id={view.filtersId} rows={ROWS} columns={COLUMNS} filters={view.filters} onChange={view.setFilter} onClear={view.clearFilters} />}
      <table aria-label="Contas">
        <thead>
          <tr>
            {COLUMNS.map((column) => (
              <SortableHeader key={column.key} label={column.header} sortKey={column.key} sort={view.sort} onSort={view.toggleSort} align={column.kind === "money" ? "right" : "left"} />
            ))}
          </tr>
        </thead>
        <tbody>
          {view.rows.map((row) => (
            <tr key={row.id} data-row-key={row.id}>
              <td>{row.name}</td>
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

async function open() {
  page = await renderPage(<PlainTable />, { companyId: "empresa-1", role: "ceo" });
  return page;
}

const order = () => [...document.querySelectorAll("tbody tr")].map((row) => row.getAttribute("data-row-key"));
const header = (label: string) => [...document.querySelectorAll("th")].find((th) => th.textContent === label)!;
const headerButton = (label: string) => header(label).querySelector("button")!;
const input = (label: string) => document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);

describe("tabela comum com useSortFilter", () => {
  it("clique no cabeçalho: crescente, decrescente e volta à ordem original, com aria-sort e seta", async () => {
    await open();
    expect(order()).toEqual(["r-1", "r-2", "r-3", "r-4"]);
    expect(header("Nome").getAttribute("aria-sort")).toBeNull();

    await click(headerButton("Nome"));
    expect(order()).toEqual(["r-2", "r-4", "r-1", "r-3"]);
    expect(header("Nome").getAttribute("aria-sort")).toBe("ascending");
    expect(header("Nome").querySelector("svg.lucide-arrow-up")).not.toBeNull();

    await click(headerButton("Nome"));
    expect(order()).toEqual(["r-3", "r-1", "r-4", "r-2"]);
    expect(header("Nome").getAttribute("aria-sort")).toBe("descending");
    expect(header("Nome").querySelector("svg.lucide-arrow-down")).not.toBeNull();

    await click(headerButton("Nome"));
    expect(order()).toEqual(["r-1", "r-2", "r-3", "r-4"]);
    expect(header("Nome").getAttribute("aria-sort")).toBeNull();
  });

  it("valor ordena pelo número e vazio fica no fim; trocar de coluna tira a seta da anterior", async () => {
    await open();
    await click(headerButton("Nome"));
    await click(headerButton("Valor"));
    expect(header("Nome").getAttribute("aria-sort")).toBeNull();
    expect(order()).toEqual(["r-2", "r-1", "r-4", "r-3"]);
    await click(headerButton("Valor"));
    expect(order()).toEqual(["r-4", "r-1", "r-2", "r-3"]);
    expect(headerButton("Valor").title).toMatch(/Valor/);
  });

  it("botões só com ícone: nome acessível e dica, sem texto visível", async () => {
    await open();
    const filter = page!.button("Filtrar")!;
    const add = page!.button("Adicionar")!;
    for (const button of [filter, add]) {
      expect(button.textContent?.trim()).toBe("");
      expect(button.title).toBeTruthy();
      expect(button.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    }
    expect(filter.querySelector("svg.lucide-list-filter")).not.toBeNull();
  });

  it("Filtrar abre a linha de filtros por tipo; texto sem acento, faixa de valor, contador e limpar", async () => {
    await open();
    const filter = page!.button("Filtrar")!;
    expect(filter.getAttribute("aria-expanded")).toBe("false");
    expect(input("Nome: contém")).toBeNull();

    await click(filter);
    expect(filter.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(filter.getAttribute("aria-controls")!)).not.toBeNull();
    expect(input("Valor: mínimo")).not.toBeNull();
    expect(input("Valor: máximo")).not.toBeNull();
    expect(input("Vencimento: de")?.type).toBe("date");
    expect(input("Vencimento: até")?.type).toBe("date");
    expect(document.querySelector("fieldset legend")?.textContent).toBe("Situação");

    await typeInto(input("Nome: contém"), "alvaro");
    expect(order()).toEqual(["r-2"]);
    expect(filter.textContent).toBe("1");
    expect(filter.getAttribute("aria-label")).toBe("Filtrar");
    expect(plain(page!.text())).toMatch(/1 filtro ativo/);

    await typeInto(input("Nome: contém"), "");
    await typeInto(input("Valor: mínimo"), "9,50");
    await typeInto(input("Valor: máximo"), "1.000");
    expect(order()).toEqual(["r-1"]);

    await click(page!.button("Limpar filtros"));
    expect(order()).toEqual(["r-1", "r-2", "r-3", "r-4"]);
    expect(input("Valor: mínimo")?.value).toBe("");
    expect(filter.textContent).toBe("");
  });

  it("múltipla escolha de situação e período de vencimento", async () => {
    await open();
    await click(page!.button("Filtrar"));
    const aberto = [...document.querySelectorAll<HTMLLabelElement>("fieldset label")].find((label) => label.textContent === "Em aberto")!.querySelector("input")!;
    await click(aberto);
    expect(aberto.checked).toBe(true);
    expect(order()).toEqual(["r-1", "r-3"]);
    await click(aberto);
    expect(order()).toEqual(["r-1", "r-2", "r-3", "r-4"]);

    await typeInto(input("Vencimento: de"), "2025-01-01");
    expect(order()).toEqual(["r-1", "r-2"]);
    await typeInto(input("Vencimento: até"), "2025-02-28");
    expect(order()).toEqual(["r-2"]);
    expect(plain(page!.text())).toMatch(/1 filtro ativo/);
  });

  it("filtro e ordenação juntos", async () => {
    await open();
    await click(page!.button("Filtrar"));
    await typeInto(input("Valor: mínimo"), "9");
    await click(headerButton("Nome"));
    expect(order()).toEqual(["r-2", "r-4", "r-1"]);
  });
});
