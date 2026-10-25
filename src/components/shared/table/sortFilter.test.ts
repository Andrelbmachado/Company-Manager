// Ordenação e filtros das tabelas: comparação pelo tipo da coluna (texto pt-BR sem acento/caixa, número, dinheiro,
// data, booleano, seleção pelo rótulo), vazios sempre no fim e filtros por tipo (contém, faixa, período, escolha).
import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  applySortFilter,
  choiceOptions,
  filterRows,
  foldText,
  nextSort,
  sortRows,
  type SortFilterColumn,
} from "./sortFilter";

interface Row {
  id: string;
  name?: string | null;
  amount?: number | string | null;
  day?: string | null;
  status?: string | null;
  active?: number | boolean | null;
}

const NAME: SortFilterColumn<Row> = { key: "name", header: "Nome", kind: "text" };
const AMOUNT: SortFilterColumn<Row> = { key: "amount", header: "Valor", kind: "money" };
const COUNT: SortFilterColumn<Row> = { key: "amount", header: "Quantidade", kind: "number" };
const DAY: SortFilterColumn<Row> = { key: "day", header: "Data", kind: "date" };
const STATUS: SortFilterColumn<Row> = {
  key: "status",
  header: "Situação",
  kind: "select",
  options: [
    { value: "lead", label: "Lead" },
    { value: "active", label: "Ativo" },
    { value: "inactive", label: "Inativo" },
  ],
};
const ACTIVE: SortFilterColumn<Row> = { key: "active", header: "Ativo", kind: "bool" };
const COLUMNS = [NAME, AMOUNT, DAY, STATUS, ACTIVE];

const rows = (values: Partial<Row>[]): Row[] => values.map((value, index) => ({ id: `r-${index + 1}`, ...value }));
const ids = (list: Row[]) => list.map((row) => row.id);
const names = (list: Row[]) => list.map((row) => row.name ?? null);

describe("sortRows", () => {
  it("texto: ordem alfabética pt-BR ignorando acento e caixa (Álvaro antes de Bruno), e o contrário", () => {
    const list = rows([{ name: "Bruno" }, { name: "carla" }, { name: "Álvaro" }, { name: "Ana" }]);
    expect(names(sortRows(list, COLUMNS, { key: "name", direction: "asc" }))).toEqual(["Álvaro", "Ana", "Bruno", "carla"]);
    expect(names(sortRows(list, COLUMNS, { key: "name", direction: "desc" }))).toEqual(["carla", "Bruno", "Ana", "Álvaro"]);
  });

  it("texto com número dentro segue a ordem natural (Item 9 antes de Item 10)", () => {
    const list = rows([{ name: "Item 10" }, { name: "Item 9" }, { name: "item 1" }]);
    expect(names(sortRows(list, COLUMNS, { key: "name", direction: "asc" }))).toEqual(["item 1", "Item 9", "Item 10"]);
  });

  it("número e dinheiro comparam o valor (10 depois de 9), inclusive quando vêm como texto", () => {
    const list = rows([{ amount: 10 }, { amount: 9 }, { amount: "100" }, { amount: 2.5 }, { amount: -3 }]);
    expect(sortRows(list, [COUNT], { key: "amount", direction: "asc" }).map((row) => row.amount)).toEqual([-3, 2.5, 9, 10, "100"]);
    expect(sortRows(list, [AMOUNT], { key: "amount", direction: "desc" }).map((row) => row.amount)).toEqual(["100", 10, 9, 2.5, -3]);
  });

  it("data: cronológica mesmo com dd/mm/aaaa, ISO e data com hora misturados (10/01 antes de 02/03)", () => {
    const list = rows([{ day: "02/03/2025" }, { day: "2025-01-10T15:30:00Z" }, { day: "10/01/2025" }, { day: "2024-12-31" }, { day: "2025-02-01" }]);
    expect(sortRows(list, COLUMNS, { key: "day", direction: "asc" }).map((row) => row.day)).toEqual([
      "2024-12-31",
      "10/01/2025",
      "2025-01-10T15:30:00Z",
      "2025-02-01",
      "02/03/2025",
    ]);
    expect(sortRows(list, COLUMNS, { key: "day", direction: "desc" }).map((row) => row.day)[0]).toBe("02/03/2025");
  });

  it("vazios (null, '', espaços, número inválido) ficam sempre no fim, nas duas direções, na ordem original", () => {
    const list = rows([{ name: null }, { name: "Beta" }, { name: "" }, { name: "Alfa" }, { name: "   " }]);
    expect(ids(sortRows(list, COLUMNS, { key: "name", direction: "asc" }))).toEqual(["r-4", "r-2", "r-1", "r-3", "r-5"]);
    expect(ids(sortRows(list, COLUMNS, { key: "name", direction: "desc" }))).toEqual(["r-2", "r-4", "r-1", "r-3", "r-5"]);

    const amounts = rows([{ amount: null }, { amount: 5 }, { amount: "abc" }, { amount: 1 }]);
    expect(ids(sortRows(amounts, [AMOUNT], { key: "amount", direction: "desc" }))).toEqual(["r-2", "r-4", "r-1", "r-3"]);
    const days = rows([{ day: null }, { day: "2025-01-02" }, { day: "data ruim" }, { day: "2025-01-01" }]);
    expect(ids(sortRows(days, [DAY], { key: "day", direction: "asc" }))).toEqual(["r-4", "r-2", "r-1", "r-3"]);
  });

  it("seleção ordena pelo rótulo mostrado; booleano põe Não antes de Sim", () => {
    const list = rows([{ status: "lead" }, { status: "active" }, { status: "inactive" }]);
    expect(sortRows(list, COLUMNS, { key: "status", direction: "asc" }).map((row) => row.status)).toEqual(["active", "inactive", "lead"]);
    const flags = rows([{ active: 1 }, { active: 0 }, { active: true }, { active: null }]);
    expect(ids(sortRows(flags, COLUMNS, { key: "active", direction: "asc" }))).toEqual(["r-2", "r-4", "r-1", "r-3"]);
    expect(ids(sortRows(flags, COLUMNS, { key: "active", direction: "desc" }))).toEqual(["r-1", "r-3", "r-2", "r-4"]);
  });

  it("sortValue da coluna troca o valor comparado; sem ordenação (ou coluna desconhecida) mantém a ordem", () => {
    const list = rows([{ name: "x", amount: 3 }, { name: "y", amount: 1 }, { name: "z", amount: 2 }]);
    const byAmount: SortFilterColumn<Row> = { key: "name", header: "Nome", kind: "number", sortValue: (row) => row.amount };
    expect(names(sortRows(list, [byAmount], { key: "name", direction: "asc" }))).toEqual(["y", "z", "x"]);
    expect(sortRows(list, COLUMNS, null)).toEqual(list);
    expect(sortRows(list, COLUMNS, { key: "nada", direction: "asc" })).toEqual(list);
  });

  it("não altera o array recebido", () => {
    const list = rows([{ name: "b" }, { name: "a" }]);
    sortRows(list, COLUMNS, { key: "name", direction: "asc" });
    expect(names(list)).toEqual(["b", "a"]);
  });
});

describe("nextSort", () => {
  it("clique na mesma coluna: crescente → decrescente → sem ordenação; outra coluna começa crescente", () => {
    const asc = nextSort(null, "name");
    expect(asc).toEqual({ key: "name", direction: "asc" });
    const desc = nextSort(asc, "name");
    expect(desc).toEqual({ key: "name", direction: "desc" });
    expect(nextSort(desc, "name")).toBeNull();
    expect(nextSort(desc, "amount")).toEqual({ key: "amount", direction: "asc" });
  });
});

describe("filterRows", () => {
  it("texto 'contém' ignora acento e caixa (alvaro acha Álvaro; SÃO acha Sao)", () => {
    const list = rows([{ name: "Álvaro Souza" }, { name: "Sao Paulo Ltda" }, { name: "Bruno" }, { name: null }]);
    expect(names(filterRows(list, COLUMNS, { name: { type: "text", contains: "alvaro" } }))).toEqual(["Álvaro Souza"]);
    expect(names(filterRows(list, COLUMNS, { name: { type: "text", contains: "SÃO" } }))).toEqual(["Sao Paulo Ltda"]);
    expect(filterRows(list, COLUMNS, { name: { type: "text", contains: "  " } })).toHaveLength(4);
    expect(foldText("  Ação É ")).toBe("acao e");
  });

  it("dinheiro: faixa mín–máx inclusiva com valores digitados no formato brasileiro; vazio sai quando há faixa", () => {
    const list = rows([{ amount: 999.99 }, { amount: 1000 }, { amount: 2000.5 }, { amount: 2000.51 }, { amount: null }]);
    const filtered = filterRows(list, COLUMNS, { amount: { type: "range", min: "1.000", max: "R$ 2.000,50" } });
    expect(filtered.map((row) => row.amount)).toEqual([1000, 2000.5]);
    expect(filterRows(list, COLUMNS, { amount: { type: "range", min: "2000,51", max: "" } }).map((row) => row.amount)).toEqual([2000.51]);
    expect(filterRows(list, COLUMNS, { amount: { type: "range", min: "", max: "999,99" } }).map((row) => row.amount)).toEqual([999.99]);
    // Limite que não é número não filtra (a pessoa ainda está digitando).
    expect(filterRows(list, COLUMNS, { amount: { type: "range", min: "abc", max: "" } })).toHaveLength(5);
  });

  it("data: de–até inclusivo, aceita ISO (campo de data) e dd/mm/aaaa, compara o dia mesmo com hora", () => {
    const list = rows([{ day: "2024-12-31" }, { day: "2025-01-01" }, { day: "15/01/2025" }, { day: "2025-01-31 12:00:00" }, { day: "2025-02-01" }, { day: null }]);
    const filtered = filterRows(list, COLUMNS, { day: { type: "dates", from: "2025-01-01", to: "31/01/2025" } });
    expect(filtered.map((row) => row.day)).toEqual(["2025-01-01", "15/01/2025", "2025-01-31 12:00:00"]);
    expect(filterRows(list, COLUMNS, { day: { type: "dates", from: "2025-02-01", to: "" } }).map((row) => row.day)).toEqual(["2025-02-01"]);
  });

  it("seleção e booleano: múltipla escolha pelos valores; nenhuma marcada não filtra; dá para escolher os vazios", () => {
    const list = rows([{ status: "lead", active: 1 }, { status: "active", active: 0 }, { status: "inactive", active: true }, { status: null, active: null }]);
    expect(ids(filterRows(list, COLUMNS, { status: { type: "choice", values: ["lead", "inactive"] } }))).toEqual(["r-1", "r-3"]);
    expect(ids(filterRows(list, COLUMNS, { status: { type: "choice", values: [""] } }))).toEqual(["r-4"]);
    expect(ids(filterRows(list, COLUMNS, { active: { type: "choice", values: ["true"] } }))).toEqual(["r-1", "r-3"]);
    expect(ids(filterRows(list, COLUMNS, { active: { type: "choice", values: ["false"] } }))).toEqual(["r-2", "r-4"]);
    expect(filterRows(list, COLUMNS, { status: { type: "choice", values: [] } })).toHaveLength(4);
  });

  it("vários filtros somam (E); filtro de coluna que não existe é ignorado", () => {
    const list = rows([{ name: "Alfa", amount: 10 }, { name: "Alfa B", amount: 50 }, { name: "Beta", amount: 50 }]);
    const filtered = filterRows(list, COLUMNS, { name: { type: "text", contains: "alfa" }, amount: { type: "range", min: "20", max: "" }, nada: { type: "text", contains: "x" } });
    expect(names(filtered)).toEqual(["Alfa B"]);
  });
});

describe("choiceOptions e activeFilterCount", () => {
  it("seleção: opções da coluna, valores gravados fora delas e '(vazio)' quando há linha sem valor; booleano: Sim/Não", () => {
    const list = rows([{ status: "lead" }, { status: "qualificado" }, { status: null }]);
    expect(choiceOptions(list, STATUS)).toEqual([
      { value: "lead", label: "Lead" },
      { value: "active", label: "Ativo" },
      { value: "inactive", label: "Inativo" },
      { value: "qualificado", label: "qualificado" },
      { value: "", label: "(vazio)" },
    ]);
    expect(choiceOptions(list, ACTIVE)).toEqual([
      { value: "true", label: "Sim" },
      { value: "false", label: "Não" },
    ]);
    const free: SortFilterColumn<Row> = { key: "name", header: "Nome", kind: "select" };
    expect(choiceOptions(rows([{ name: "b" }, { name: "a" }, { name: "b" }]), free)).toEqual([
      { value: "a", label: "a" },
      { value: "b", label: "b" },
    ]);
  });

  it("conta só filtros que filtram de fato", () => {
    expect(
      activeFilterCount({
        name: { type: "text", contains: " " },
        amount: { type: "range", min: "", max: "10" },
        day: { type: "dates", from: "", to: "" },
        status: { type: "choice", values: ["lead"] },
        active: { type: "choice", values: [] },
      }),
    ).toBe(2);
  });

  it("applySortFilter filtra e depois ordena", () => {
    const list = rows([{ name: "Carla", amount: 30 }, { name: "Ana", amount: 5 }, { name: "Bruno", amount: 20 }]);
    const result = applySortFilter(list, COLUMNS, { key: "name", direction: "desc" }, { amount: { type: "range", min: "10", max: "" } });
    expect(names(result)).toEqual(["Carla", "Bruno"]);
  });
});
