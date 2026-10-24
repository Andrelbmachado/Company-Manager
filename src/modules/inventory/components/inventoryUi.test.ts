// Números digitados nas telas de estoque (pt-BR): o que a tela mostra ("1.250" = mil duzentos e cinquenta) volta igual
// quando digitado, e texto inválido é recusado em vez de virar 0 sem aviso.
import { describe, expect, it } from "vitest";
import { formatQty, StockError } from "@/lib/inventory/stock";
import { parseDecimal, readItemNumbers } from "./inventoryUi";

describe("parseDecimal", () => {
  it("vírgula decimal, ponto de milhar como a tela mostra e ponto decimal quando não é milhar", () => {
    expect(parseDecimal("2,5")).toBe(2.5);
    expect(parseDecimal("1.234,5")).toBe(1234.5);
    expect(parseDecimal("1.250")).toBe(1250);
    expect(parseDecimal(formatQty(1250))).toBe(1250);
    expect(parseDecimal(formatQty(1234567.25))).toBe(1234567.25);
    expect(parseDecimal("2.5")).toBe(2.5);
    expect(parseDecimal("0.125")).toBe(0.125);
    expect(parseDecimal("1,234.56")).toBe(1234.56);
    expect(parseDecimal(" R$ 10,90 ")).toBe(10.9);
    expect(parseDecimal("12")).toBe(12);
    expect(parseDecimal("-3")).toBe(-3);
  });

  it("vazio ou texto que não é número → NaN", () => {
    for (const text of ["", "   ", "abc", "1O,50", "1,2,3", "2,5 kg", "1.2.3,4,5"]) expect(parseDecimal(text), text).toBeNaN();
  });
});

describe("readItemNumbers", () => {
  it("campos vazios usam o padrão (mínimo e custo 0, sem máximo, sem saldo inicial)", () => {
    expect(readItemNumbers({ min_stock: "", max_stock: "", cost: "", initial_qty: "" })).toEqual({ minStock: 0, maxStock: null, cost: 0, initialQty: 0 });
    expect(readItemNumbers({ min_stock: "5", max_stock: "1.000", cost: "2.180,50", initial_qty: "0,5" })).toEqual({ minStock: 5, maxStock: 1000, cost: 2180.5, initialQty: 0.5 });
  });

  it("recusa texto inválido ou negativo com o nome do campo, e máximo menor que o mínimo", () => {
    const cases: [Parameters<typeof readItemNumbers>[0], RegExp][] = [
      [{ min_stock: "abc", max_stock: "", cost: "0" }, /mínimo/i],
      [{ min_stock: "0", max_stock: "-1", cost: "0" }, /máximo/i],
      [{ min_stock: "0", max_stock: "", cost: "1O,50" }, /custo/i],
      [{ min_stock: "0", max_stock: "", cost: "0", initial_qty: "-2" }, /saldo inicial/i],
      [{ min_stock: "10", max_stock: "5", cost: "0" }, /máximo.*menor/i],
    ];
    for (const [form, message] of cases) {
      let error: unknown = null;
      try {
        readItemNumbers(form);
      } catch (caught) {
        error = caught;
      }
      expect(error, JSON.stringify(form)).toBeInstanceOf(StockError);
      expect((error as StockError).message).toMatch(message);
    }
  });
});
