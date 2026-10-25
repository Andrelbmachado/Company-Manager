// Problemas da importação: a tabela ordena pelo cabeçalho e filtra por coluna sobre todos os erros (não só os 100
// mostrados), e o aviso de "Mostrando 100 de N" conta o que o filtro deixou.
import { afterEach, describe, expect, it } from "vitest";
import { click, renderPage, type as typeInto, type RenderedPage } from "@/test/pageHarness";
import type { ImportRowError } from "@/lib/importexport/errors";
import type { ImportEntity } from "@/lib/importexport/registry";
import { ResultReport, type ResultSummary } from "./ResultReport";

const entity = { label: "Clientes", fields: [{ key: "name", label: "Nome" }, { key: "email", label: "E-mail" }] } as unknown as ImportEntity<unknown>;

const errors: ImportRowError[] = [
  { row: 3, field: "email", message: "E-mail inválido", value: "joao@" },
  { row: 2, field: "name", message: "Nome obrigatório", value: "" },
  ...Array.from({ length: 120 }, (_, index) => ({ row: 10 + index, field: "email", message: "E-mail repetido", value: `x${index}@a.com` })),
  { row: 500, field: "name", message: "Nome muito longo", value: "N".repeat(10) },
];

const result: ResultSummary = { status: "com_erros", dryRun: false, mode: "skip-errors", total: 600, ok: 477, inserted: 400, updated: 77, rowsWithErrors: 123, errors };

let page: RenderedPage | null = null;

afterEach(() => {
  page?.unmount();
  page = null;
});

const rowNumbers = () => [...document.querySelectorAll("tbody tr")].map((row) => row.querySelector("td")?.textContent);

describe("ResultReport", () => {
  it("ordena os problemas pela linha e filtra todos os erros pela coluna e pelo texto", async () => {
    page = await renderPage(<ResultReport entity={entity} result={result} />, { companyId: "empresa-1" });
    expect(rowNumbers().slice(0, 2)).toEqual(["3", "2"]);
    expect(page.text()).toContain("Mostrando 100 de 123 problemas");
    await click(document.querySelector("th [data-sort-key='row']"));
    expect(rowNumbers().slice(0, 3)).toEqual(["2", "3", "10"]);

    await click(page.button("Filtrar"));
    await typeInto(document.querySelector('[aria-label="Problema: contém"]'), "nome");
    expect(rowNumbers()).toEqual(["2", "500"]);
    expect(page.text()).not.toContain("Mostrando 100");
  });
});
