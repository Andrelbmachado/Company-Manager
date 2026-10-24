// Valor digitado nas telas do financeiro: formato brasileiro (ponto de milhar, vírgula decimal) e o que o app mesmo
// preenche nos formulários (String(1234.5) = "1234.5").
import { describe, expect, it } from "vitest";
import { parseMoneyInput } from "./financeCommon";

describe("parseMoneyInput", () => {
  it("formato brasileiro, com ou sem R$ e milhar", () => {
    expect(parseMoneyInput("1.234,56")).toBe(1234.56);
    expect(parseMoneyInput("R$ 1.234,56")).toBe(1234.56);
    expect(parseMoneyInput("R$ 10")).toBe(10);
    expect(parseMoneyInput("12,5")).toBe(12.5);
    expect(parseMoneyInput("1.000.000")).toBe(1000000);
  });

  it("ponto com três dígitos depois é milhar (1.500 é mil e quinhentos, não um e meio)", () => {
    expect(parseMoneyInput("1.500")).toBe(1500);
    expect(parseMoneyInput("10.000")).toBe(10000);
    expect(parseMoneyInput("250.000")).toBe(250000);
    expect(parseMoneyInput("-1.500")).toBe(-1500);
  });

  it("ponto decimal (o que o próprio formulário preenche ao editar) continua decimal", () => {
    expect(parseMoneyInput(String(1234.5))).toBe(1234.5);
    expect(parseMoneyInput("1234.56")).toBe(1234.56);
    expect(parseMoneyInput("1.50")).toBe(1.5);
    expect(parseMoneyInput("0.500")).toBe(0.5);
    expect(parseMoneyInput("1,234.56")).toBe(1234.56);
  });

  it("negativo com sinal ou parênteses; número passa direto", () => {
    expect(parseMoneyInput("-89,90")).toBe(-89.9);
    expect(parseMoneyInput("(89,90)")).toBe(-89.9);
    expect(parseMoneyInput(12.5)).toBe(12.5);
  });

  it("vazio ou texto não numérico é NaN", () => {
    for (const value of ["", "   ", "abc", "12a", "1,2,3", null, undefined]) expect(parseMoneyInput(value)).toBeNaN();
  });
});
