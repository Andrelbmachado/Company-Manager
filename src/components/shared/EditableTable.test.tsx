// Tabela editável no próprio lugar (sem modal): Editar / Adicionar / Atualizar / Salvar / Cancelar, permissão por
// recurso, valores digitados no formato brasileiro e confirmação antes de descartar rascunhos.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { click, renderPage, type as typeInto, until, type RenderedPage } from "@/test/pageHarness";
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

const cell = (rowKey: string, column: string) => document.querySelector<HTMLElement>(`tr[data-row-key='${rowKey}'] [data-column='${column}']`);
const field = (rowKey: string, column: string) => cell(rowKey, column)?.querySelector<HTMLInputElement>("input, select") ?? null;
const newRow = () => document.querySelector<HTMLTableRowElement>("tr[data-new='true']");

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
