import { describe, expect, it } from "vitest";
import { fromCents, lineTotal, orderTotals, percentOf, roundMoney, splitInstallments, sumMoney, toCents } from "./money";

describe("dinheiro em centavos", () => {
  it("arredonda para 2 casas sem erro de ponto flutuante (meio para longe do zero)", () => {
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(2.675)).toBe(2.68);
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
    expect(roundMoney(-1.005)).toBe(-1.01);
    expect(roundMoney(10)).toBe(10);
    expect(Object.is(roundMoney(-0.001), -0)).toBe(false);
  });

  it("converte para centavos e volta", () => {
    expect(toCents(1234.56)).toBe(123456);
    expect(toCents(0.07)).toBe(7);
    expect(fromCents(123456)).toBe(1234.56);
    expect(() => toCents(Number.NaN)).toThrow(/valor/i);
  });

  it("soma em centavos", () => {
    expect(sumMoney([0.1, 0.2, 0.3])).toBe(0.6);
    expect(sumMoney([333.33, 333.33, 333.34])).toBe(1000);
    expect(sumMoney([])).toBe(0);
  });

  it("total do item = quantidade × preço − desconto (em R$), arredondado", () => {
    expect(lineTotal(3, 19.99)).toBe(59.97);
    expect(lineTotal(2, 2180, 100)).toBe(4260);
    expect(lineTotal(1.5, 10.333)).toBe(15.5);
    expect(lineTotal(1, 50, 80)).toBe(0);
  });

  it("totais do pedido: subtotal dos itens − desconto + frete + impostos", () => {
    const totals = orderTotals([{ qty: 2, unit_price: 2180 }, { qty: 2, unit_price: 150, discount: 10 }], { discount: 100, shipping: 25.5 });
    expect(totals).toEqual({ subtotal: 4650, discount: 100, shipping: 25.5, tax_total: 0, total: 4575.5 });
  });

  it("percentual de um valor", () => {
    expect(percentOf(1000, 10)).toBe(100);
    expect(percentOf(99.99, 5)).toBe(5);
  });

  it("parcelas somam exatamente o total e a última absorve a diferença", () => {
    expect(splitInstallments(1000, 3)).toEqual([333.33, 333.33, 333.34]);
    expect(splitInstallments(100, 1)).toEqual([100]);
    expect(splitInstallments(0.05, 3)).toEqual([0.01, 0.01, 0.03]);
    expect(splitInstallments(1234.56, 4)).toEqual([308.64, 308.64, 308.64, 308.64]);
    const parts = splitInstallments(9999.99, 7);
    expect(sumMoney(parts)).toBe(9999.99);
    expect(() => splitInstallments(100, 0)).toThrow(/parcela/i);
    expect(() => splitInstallments(100, 1.5)).toThrow(/parcela/i);
  });
});
