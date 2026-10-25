// Tabela editável no próprio lugar (sem modal): Editar / Adicionar / Atualizar / Salvar / Cancelar, permissão por
// recurso, valores digitados no formato brasileiro e confirmação antes de descartar rascunhos.
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { choose, click, renderPage, type as typeInto, until, type RenderedPage } from "@/test/pageHarness";
import { confirmAction } from "@/lib/confirm";
import type { Role } from "@/types";
import { EditableTable, type EditableColumn } from "./EditableTable";

vi.mock("@/lib/confirm", () => ({ confirmAction: vi.fn(async () => false) }));

interface Row {
  id: string;
  name: string | null;
  email: string | null;
  credit_limit: number | null;
  since: string | null;
  status: string;
  active: number;
}

const ROWS: Row[] = [
  { id: "c-1", name: "Alfa Ltda", email: "contato@alfa.com", credit_limit: 1000, since: "2025-01-10", status: "active", active: 1 },
  { id: "c-2", name: "Beta ME", email: null, credit_limit: null, since: null, status: "lead", active: 1 },
  { id: "c-3", name: "Gama SA", email: "gama@gama.com", credit_limit: 250.5, since: "2024-06-01", status: "inactive", active: 0 },
];

const COLUMNS: EditableColumn<Row>[] = [
  { key: "name", header: "Nome", kind: "text", required: true },
  { key: "email", header: "E-mail", kind: "email" },
  { key: "credit_limit", header: "Limite", kind: "money" },
  { key: "since", header: "Cliente desde", kind: "date" },
  {
    key: "status",
    header: "Situação",
    kind: "select",
    options: [
      { value: "lead", label: "Lead" },
      { value: "active", label: "Ativo" },
      { value: "inactive", label: "Inativo" },
    ],
  },
  { key: "active", header: "Ativo", kind: "bool" },
];

let page: RenderedPage | null = null;
const onSave = vi.fn(async (_changes: { updated: (Partial<Row> & { id: string })[]; created: Partial<Row>[] }) => {});
const onRefresh = vi.fn(async () => {});

beforeEach(() => {
  onSave.mockClear();
  onRefresh.mockClear();
  vi.mocked(confirmAction).mockReset().mockResolvedValue(false);
});

afterEach(() => {
  page?.unmount();
  page = null;
});

async function open(role: Role, extra: { newRow?: () => Partial<Row> } = {}) {
  page = await renderPage(
    <EditableTable<Row> resource="customers" label="Clientes" rows={ROWS} columns={COLUMNS} onSave={onSave} onRefresh={onRefresh} newRow={extra.newRow} />,
    { companyId: "empresa-1", role },
  );
  return page;
}

/** Tela com busca que filtra as linhas passadas à tabela (como as listas da Fase B). */
function FilteredTable() {
  const [search, setSearch] = useState("");
  const rows = ROWS.filter((row) => (row.name ?? "").toLowerCase().includes(search.toLowerCase()));
  return (
    <>
      <input aria-label="Buscar" value={search} onChange={(event) => setSearch(event.target.value)} />
      <EditableTable<Row> resource="customers" label="Clientes" rows={rows} columns={COLUMNS} onSave={onSave} onRefresh={onRefresh} />
    </>
  );
}

async function openFiltered() {
  page = await renderPage(<FilteredTable />, { companyId: "empresa-1", role: "ceo" });
  return page;
}

const cell = (rowKey: string, column: string) => document.querySelector<HTMLElement>(`tr[data-row-key='${rowKey}'] [data-column='${column}']`);
const field = (rowKey: string, column: string) => cell(rowKey, column)?.querySelector<HTMLInputElement>("input, select") ?? null;
const newRow = () => document.querySelector<HTMLTableRowElement>("tr[data-new='true']");
const order = () => [...document.querySelectorAll("tbody tr[data-row-key]")].map((row) => row.getAttribute("data-row-key"));
const filterInput = (label: string) => document.querySelector<HTMLInputElement>(`[data-filter-bar] input[aria-label="${label}"]`);

/** Texto que aparece na tela (sem o nome sr-only dos botões só com ícone). */
function visibleText(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  clone.querySelectorAll(".sr-only").forEach((node) => node.remove());
  return clone.textContent?.trim() ?? "";
}

describe("EditableTable", () => {
  it("papel sem permissão vê Editar e Adicionar desativados, com dica; Atualizar continua livre", async () => {
    await open("atendimento");
    const edit = page!.button("Editar");
    const add = page!.button("Adicionar");
    expect(edit?.disabled).toBe(true);
    expect(add?.disabled).toBe(true);
    expect(edit?.title).toMatch(/permissão/i);
    expect(add?.title).toMatch(/permissão/i);
    expect(page!.button("Atualizar")?.disabled).toBe(false);
    await click(page!.button("Atualizar"));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("modo leitura mostra os valores formatados e nenhum campo", async () => {
    await open("ceo");
    expect(cell("c-1", "credit_limit")?.textContent).toMatch(/R\$\s1\.000,00/);
    expect(cell("c-1", "since")?.textContent).toBe("10/01/2025");
    expect(cell("c-1", "status")?.textContent).toBe("Ativo");
    expect(cell("c-3", "active")?.textContent).toBe("Não");
    expect(document.querySelector("tbody input, tbody select")).toBeNull();
  });

  it("editar duas células e Salvar chama onSave só com as linhas e os campos alterados, sem abrir diálogo", async () => {
    await open("ceo");
    await click(page!.button("Editar"));
    expect(document.querySelector("[role=dialog]")).toBeNull();
    expect(field("c-1", "since")?.value).toBe("10/01/2025");
    expect(field("c-1", "credit_limit")?.value).toBe("1.000,00");

    await typeInto(field("c-1", "name"), "Alfa Tecnologia Ltda");
    await typeInto(field("c-2", "email"), "Financeiro@Beta.com.br");
    expect(document.querySelector("tr[data-row-key='c-1']")?.getAttribute("data-changed")).toBe("true");
    expect(document.querySelector("tr[data-row-key='c-3']")?.getAttribute("data-changed")).toBeNull();

    await click(page!.button("Salvar"));
    await until(() => onSave.mock.calls.length === 1, "onSave");
    expect(onSave.mock.calls[0][0]).toEqual({
      updated: [
        { id: "c-1", name: "Alfa Tecnologia Ltda" },
        { id: "c-2", email: "financeiro@beta.com.br" },
      ],
      created: [],
    });
    await until(() => document.querySelector("tbody input") === null, "sai do modo edição");
    expect(onRefresh).toHaveBeenCalled();
  });

  it("dinheiro e data digitados no formato brasileiro viram número e data ISO", async () => {
    await open("ceo");
    await click(page!.button("Editar"));
    await typeInto(field("c-2", "credit_limit"), "1.234,56");
    await typeInto(field("c-2", "since"), "31/12/2025");
    await click(page!.button("Salvar"));
    await until(() => onSave.mock.calls.length === 1, "onSave");
    expect(onSave.mock.calls[0][0].updated).toEqual([{ id: "c-2", credit_limit: 1234.56, since: "2025-12-31" }]);
  });

  it("valor inválido aparece na célula e não salva; obrigatório vazio também", async () => {
    await open("ceo");
    await click(page!.button("Editar"));
    await typeInto(field("c-1", "credit_limit"), "mil reais");
    await typeInto(field("c-3", "name"), "   ");
    await click(page!.button("Salvar"));
    expect(onSave).not.toHaveBeenCalled();
    expect(cell("c-1", "credit_limit")?.textContent).toMatch(/Valor inválido/);
    expect(field("c-1", "credit_limit")?.getAttribute("aria-invalid")).toBe("true");
    expect(cell("c-3", "name")?.textContent).toMatch(/Obrigatório/);
    expect(document.querySelector("[role=alert]")?.textContent).toMatch(/Corrija/);
  });

  it("Atualizar com rascunho pede confirmação: Cancelar mantém o rascunho; confirmar descarta e atualiza", async () => {
    await open("ceo");
    await click(page!.button("Editar"));
    await typeInto(field("c-1", "name"), "Rascunho");

    await click(page!.button("Atualizar"));
    expect(confirmAction).toHaveBeenCalledTimes(1);
    expect(vi.mocked(confirmAction).mock.calls[0][0]).toMatch(/não salvas/);
    expect(onRefresh).not.toHaveBeenCalled();
    expect(field("c-1", "name")?.value).toBe("Rascunho");
    expect(document.querySelector("tr[data-row-key='c-1']")?.getAttribute("data-changed")).toBe("true");

    vi.mocked(confirmAction).mockResolvedValue(true);
    await click(page!.button("Atualizar"));
    await until(() => onRefresh.mock.calls.length === 1, "onRefresh");
    expect(field("c-1", "name")).toBeNull();
    expect(cell("c-1", "name")?.textContent).toBe("Alfa Ltda");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("Adicionar cria a linha no topo com newRow(), já em edição; Salvar manda em created", async () => {
    await open("ceo", { newRow: () => ({ status: "lead", active: 1, credit_limit: 0 }) });
    await click(page!.button("Adicionar"));
    expect(document.querySelector("[role=dialog]")).toBeNull();
    const added = newRow();
    expect(added).not.toBeNull();
    expect(document.querySelector("tbody tr")).toBe(added);
    const key = added!.getAttribute("data-row-key")!;
    expect(field(key, "status")?.value).toBe("lead");
    expect(field(key, "credit_limit")?.value).toBe("0,00");

    await typeInto(field(key, "name"), "Delta Serviços");
    await click(page!.button("Salvar"));
    await until(() => onSave.mock.calls.length === 1, "onSave");
    expect(onSave.mock.calls[0][0]).toEqual({ updated: [], created: [{ status: "lead", active: 1, credit_limit: 0, name: "Delta Serviços" }] });
  });

  it("Cancelar descarta rascunhos e linhas novas sem chamar onSave", async () => {
    await open("ceo");
    await click(page!.button("Adicionar"));
    await typeInto(field("c-1", "name"), "Outro nome");
    await click(page!.button("Cancelar"));
    expect(newRow()).toBeNull();
    expect(cell("c-1", "name")?.textContent).toBe("Alfa Ltda");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("linha alterada que a busca da tela escondeu não some: o Atualizar avisa e o Salvar grava junto", async () => {
    await openFiltered();
    await click(page!.button("Editar"));
    await typeInto(field("c-1", "name"), "Alfa Tecnologia");
    await typeInto(document.querySelector("input[aria-label=Buscar]"), "gama");
    expect(cell("c-1", "name")).toBeNull();
    expect(document.querySelector("[data-hidden-drafts]")?.textContent).toMatch(/1 linha alterada/);

    await click(page!.button("Atualizar"));
    expect(confirmAction).toHaveBeenCalledTimes(1);
    expect(onRefresh).not.toHaveBeenCalled();

    await typeInto(field("c-3", "email"), "financeiro@gama.com");
    await click(page!.button("Salvar"));
    await until(() => onSave.mock.calls.length === 1, "onSave");
    expect(onSave.mock.calls[0][0]).toEqual({
      updated: [
        { id: "c-3", email: "financeiro@gama.com" },
        { id: "c-1", name: "Alfa Tecnologia" },
      ],
      created: [],
    });
  });

  it("erro numa linha escondida pela busca não salva nada e avisa que a linha está fora da lista", async () => {
    await openFiltered();
    await click(page!.button("Editar"));
    await typeInto(field("c-1", "credit_limit"), "mil reais");
    await typeInto(document.querySelector("input[aria-label=Buscar]"), "gama");
    await click(page!.button("Salvar"));
    expect(onSave).not.toHaveBeenCalled();
    expect(document.querySelector("[role=alert]")?.textContent).toMatch(/fora da lista/);
  });

  it("seleção com valor gravado fora das opções (status antigo) mostra o valor gravado e permite voltar a ele", async () => {
    const legacy: Row = { id: "c-9", name: "Ômega", email: null, credit_limit: null, since: null, status: "qualificado", active: 1 };
    page = await renderPage(
      <EditableTable<Row> resource="customers" label="Clientes" rows={[legacy]} columns={COLUMNS} onSave={onSave} onRefresh={onRefresh} />,
      { companyId: "empresa-1", role: "ceo" },
    );
    await click(page.button("Editar"));
    const select = field("c-9", "status") as unknown as HTMLSelectElement;
    expect(select.value).toBe("qualificado");
    await choose(select, "active");
    expect(document.querySelector("tr[data-row-key='c-9']")?.getAttribute("data-changed")).toBe("true");
    await choose(select, "qualificado");
    expect(document.querySelector("tr[data-row-key='c-9']")?.getAttribute("data-changed")).toBeNull();
    await click(page.button("Salvar"));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("barra só com ícones: Filtrar ao lado de Editar, Adicionar e Atualizar, com nome acessível e dica; Editar é o lápis no quadrado", async () => {
    await open("ceo");
    const buttons = ["Filtrar", "Editar", "Adicionar", "Atualizar"].map((label) => page!.button(label)!);
    for (const [index, button] of buttons.entries()) {
      expect(visibleText(button)).toBe("");
      expect(button.getAttribute("aria-label")).toBe(["Filtrar", "Editar", "Adicionar", "Atualizar"][index]);
      expect(button.title).toBe(button.getAttribute("aria-label"));
      expect(button.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    }
    expect(buttons[0].nextElementSibling).toBe(buttons[1]);
    expect(page!.button("Editar")!.querySelector("svg.lucide-square-pen")).not.toBeNull();
    expect(page!.button("Filtrar")!.querySelector("svg.lucide-list-filter")).not.toBeNull();

    await click(page!.button("Editar"));
    for (const label of ["Salvar", "Cancelar"]) {
      const button = page!.button(label)!;
      expect(visibleText(button)).toBe("");
      expect(button.title).toBe(label);
    }
  });

  it("clique no cabeçalho ordena pelo tipo da coluna (vazio no fim) e o terceiro clique volta à ordem da tela", async () => {
    await open("ceo");
    const th = (label: string) => [...document.querySelectorAll("thead th")].find((item) => item.textContent === label)!;
    const sortBy = (label: string) => click(th(label).querySelector("[role=button]"));

    await sortBy("Limite");
    expect(order()).toEqual(["c-3", "c-1", "c-2"]);
    expect(th("Limite").getAttribute("aria-sort")).toBe("ascending");
    await sortBy("Limite");
    expect(order()).toEqual(["c-1", "c-3", "c-2"]);
    expect(th("Limite").getAttribute("aria-sort")).toBe("descending");
    await sortBy("Limite");
    expect(order()).toEqual(["c-1", "c-2", "c-3"]);
    expect(th("Limite").getAttribute("aria-sort")).toBeNull();

    await sortBy("Cliente desde");
    expect(order()).toEqual(["c-3", "c-1", "c-2"]);
    await sortBy("Situação");
    expect(order()).toEqual(["c-1", "c-3", "c-2"]);
    expect(th("Cliente desde").getAttribute("aria-sort")).toBeNull();
  });

  it("texto ordena e filtra sem diferenciar acento: Álvaro antes de Bruno; 'comercio' acha Álvaro Comércio", async () => {
    const people: Row[] = [
      { id: "p-1", name: "Bruno Silva", email: null, credit_limit: null, since: null, status: "lead", active: 1 },
      { id: "p-2", name: "Álvaro Comércio", email: null, credit_limit: null, since: null, status: "lead", active: 1 },
      { id: "p-3", name: "Carla", email: null, credit_limit: null, since: null, status: "lead", active: 1 },
    ];
    page = await renderPage(<EditableTable<Row> resource="customers" label="Clientes" rows={people} columns={COLUMNS} onSave={onSave} onRefresh={onRefresh} />, { companyId: "empresa-1", role: "ceo" });
    await click([...document.querySelectorAll("thead th")].find((item) => item.textContent === "Nome")!.querySelector("[role=button]"));
    expect(order()).toEqual(["p-2", "p-1", "p-3"]);

    await click(page.button("Filtrar"));
    await typeInto(filterInput("Nome: contém"), "comercio");
    expect(order()).toEqual(["p-2"]);
  });

  it("filtro de faixa de dinheiro, contador no botão, mensagem quando nada sobra e Limpar filtros", async () => {
    await open("ceo");
    const filter = page!.button("Filtrar")!;
    expect(filter.getAttribute("aria-expanded")).toBe("false");
    await click(filter);
    expect(filter.getAttribute("aria-expanded")).toBe("true");

    await typeInto(filterInput("Limite: mínimo"), "200");
    await typeInto(filterInput("Limite: máximo"), "1.000,00");
    expect(order()).toEqual(["c-1", "c-3"]);
    expect(filter.querySelector("[data-filter-count]")?.textContent).toBe("1");

    await typeInto(filterInput("Limite: mínimo"), "5.000");
    expect(order()).toEqual([]);
    expect(page!.text()).toMatch(/Nenhum registro com esses filtros/);

    await click(page!.button("Limpar filtros"));
    expect(order()).toEqual(["c-1", "c-2", "c-3"]);
    expect(filter.querySelector("[data-filter-count]")).toBeNull();
  });

  it("ordenar e filtrar durante a edição não perde o rascunho; linha alterada escondida pelo filtro avisa e vai no Salvar", async () => {
    await open("ceo", { newRow: () => ({ status: "lead", active: 1 }) });
    await click(page!.button("Editar"));
    await typeInto(field("c-1", "name"), "Zeta Ltda");
    await typeInto(field("c-3", "email"), "financeiro@gama.com");

    // Ordena pelo valor gravado: a linha não pula enquanto a pessoa digita.
    await click([...document.querySelectorAll("thead th")].find((item) => item.textContent?.startsWith("Nome"))!.querySelector("[role=button]"));
    expect(order()).toEqual(["c-1", "c-2", "c-3"]);
    await click([...document.querySelectorAll("thead th")].find((item) => item.textContent === "Limite")!.querySelector("[role=button]"));
    expect(order()).toEqual(["c-3", "c-1", "c-2"]);
    expect(field("c-1", "name")?.value).toBe("Zeta Ltda");

    await click(page!.button("Filtrar"));
    await typeInto(filterInput("Limite: mínimo"), "500");
    expect(order()).toEqual(["c-1"]);
    expect(document.querySelector("[data-hidden-drafts]")?.textContent).toMatch(/1 linha alterada/);

    // Linha nova fica no topo mesmo com filtro e ordenação.
    await click(page!.button("Adicionar"));
    expect(document.querySelector("tbody tr")?.getAttribute("data-new")).toBe("true");
    await click(newRow()!.querySelector("button"));

    await click(page!.button("Salvar"));
    await until(() => onSave.mock.calls.length === 1, "onSave");
    expect(onSave.mock.calls[0][0]).toEqual({
      updated: [
        { id: "c-1", name: "Zeta Ltda" },
        { id: "c-3", email: "financeiro@gama.com" },
      ],
      created: [],
    });
  });

  it("erro do onSave aparece e mantém o rascunho", async () => {
    onSave.mockRejectedValueOnce(new Error("Sem permissão para editar clientes."));
    await open("ceo");
    await click(page!.button("Editar"));
    await typeInto(field("c-1", "name"), "Novo nome");
    await click(page!.button("Salvar"));
    await until(() => document.querySelector("[role=alert]") !== null, "mensagem de erro");
    expect(document.querySelector("[role=alert]")?.textContent).toMatch(/Sem permissão/);
    expect(field("c-1", "name")?.value).toBe("Novo nome");
  });
});
