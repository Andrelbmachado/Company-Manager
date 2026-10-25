// Tabela dos relatórios na tela: clique no cabeçalho ordena pelo tipo da coluna, Filtrar abre os filtros por coluna e,
// com filtro tirando linhas, o total do rodapé (do período inteiro) sai para não somar o que não está na tela. Na DRE
// (linhas com estilo de demonstrativo: grupo, subtotal, detalhe) grupos e subtotais ficam no lugar e o cabeçalho e o
// filtro valem para as linhas de detalhe dentro de cada grupo.
import { afterEach, describe, expect, it } from "vitest";
import { click, renderPage, type as typeInto, type RenderedPage } from "@/test/pageHarness";
import type { ReportTable } from "@/lib/reports/common";
import { ReportDataTable } from "./ReportDataTable";

const SALES: ReportTable = {
  title: "Vendas por cliente",
  fileName: "vendas",
  columns: [
    { key: "customer", label: "Cliente", kind: "text" },
    { key: "orders", label: "Pedidos", kind: "integer" },
    { key: "revenue", label: "Receita", kind: "money" },
    { key: "last", label: "Última venda", kind: "date" },
  ],
  rows: [
    { customer: "Bruno Peças", orders: 3, revenue: 900, last: "2026-03-10" },
    { customer: "Álvaro Comércio", orders: 10, revenue: 120.5, last: "2026-01-02" },
    { customer: "Clínica Vida", orders: 1, revenue: 5000, last: null },
  ],
  totals: { customer: "Total", orders: 14, revenue: 6020.5, last: null },
};

let page: RenderedPage | null = null;

afterEach(() => {
  page?.unmount();
  page = null;
});

const customers = () => [...document.querySelectorAll("tbody tr")].map((row) => row.querySelector("td")?.textContent);
const header = (label: string) => [...document.querySelectorAll("th")].find((th) => th.textContent === label)!;

describe("ReportDataTable", () => {
  it("ordena pelo tipo da coluna ao clicar no cabeçalho e volta à ordem do relatório no terceiro clique", async () => {
    page = await renderPage(<ReportDataTable table={SALES} />, { companyId: "empresa-1" });
    await click(header("Cliente").querySelector("[role=button]"));
    expect(customers()).toEqual(["Álvaro Comércio", "Bruno Peças", "Clínica Vida"]);
    await click(header("Receita").querySelector("[role=button]"));
    expect(customers()).toEqual(["Álvaro Comércio", "Bruno Peças", "Clínica Vida"]);
    await click(header("Receita").querySelector("[role=button]"));
    expect(customers()).toEqual(["Clínica Vida", "Bruno Peças", "Álvaro Comércio"]);
    expect(header("Receita").getAttribute("aria-sort")).toBe("descending");
    await click(header("Receita").querySelector("[role=button]"));
    expect(customers()).toEqual(["Bruno Peças", "Álvaro Comércio", "Clínica Vida"]);
    await click(header("Última venda").querySelector("[role=button]"));
    expect(customers()).toEqual(["Álvaro Comércio", "Bruno Peças", "Clínica Vida"]);
  });

  it("Filtrar filtra por coluna; com linha escondida o total do rodapé sai e volta ao limpar", async () => {
    page = await renderPage(<ReportDataTable table={SALES} />, { companyId: "empresa-1" });
    expect(document.querySelector("tfoot")?.textContent).toContain("Total");
    await click(page.button("Filtrar"));
    await typeInto(document.querySelector('[aria-label="Cliente: contém"]'), "comercio");
    expect(customers()).toEqual(["Álvaro Comércio"]);
    expect(document.querySelector("tfoot")).toBeNull();
    await typeInto(document.querySelector('[aria-label="Cliente: contém"]'), "zzz");
    expect(page.text()).toContain("Nenhum registro com esses filtros.");
    await click(page.button("Limpar filtros"));
    expect(customers()).toHaveLength(3);
    expect(document.querySelector("tfoot")?.textContent).toContain("Total");
  });

  it("demonstrativo com estilo por linha (DRE): ordena e filtra o detalhe dentro do grupo, grupos e subtotais no lugar", async () => {
    const dre: ReportTable = {
      title: "DRE",
      fileName: "dre",
      columns: [
        { key: "line", label: "Linha", kind: "text" },
        { key: "amount", label: "Valor", kind: "money" },
      ],
      rows: [
        { line: "Receita bruta", amount: 1000 },
        { line: "Serviços", amount: 700 },
        { line: "Produtos", amount: 300 },
        { line: "Despesas", amount: -600 },
        { line: "Aluguel", amount: -400 },
        { line: "Energia", amount: -200 },
        { line: "Resultado", amount: 400 },
      ],
      styles: ["strong", "indent", "indent", "strong", "indent", "indent", "strong"],
    };
    page = await renderPage(<ReportDataTable table={dre} />, { companyId: "empresa-1" });
    expect(customers()).toEqual(["Receita bruta", "Serviços", "Produtos", "Despesas", "Aluguel", "Energia", "Resultado"]);
    await click(header("Linha").querySelector("[role=button]"));
    expect(customers()).toEqual(["Receita bruta", "Produtos", "Serviços", "Despesas", "Aluguel", "Energia", "Resultado"]);
    await click(header("Valor").querySelector("[role=button]"));
    await click(header("Valor").querySelector("[role=button]"));
    expect(customers()).toEqual(["Receita bruta", "Serviços", "Produtos", "Despesas", "Energia", "Aluguel", "Resultado"]);
    await click(page.button("Filtrar"));
    await typeInto(document.querySelector('[aria-label="Linha: contém"]'), "alu");
    expect(customers()).toEqual(["Receita bruta", "Despesas", "Aluguel", "Resultado"]);
    await typeInto(document.querySelector('[aria-label="Linha: contém"]'), "zzz");
    expect(customers()).toEqual(["Receita bruta", "Despesas", "Resultado"]);
  });
});
