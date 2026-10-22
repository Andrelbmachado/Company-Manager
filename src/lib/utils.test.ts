import { describe, it, expect } from "vitest";
import { formatCurrency, formatDate, formatDateTime, initials } from "./utils";

// Remove qualquer espaco em branco (ICU usa espaco nao-separavel U+00A0 em alguns runtimes).
const stripSpaces = (s: string) => s.replace(/\s/g, "");

describe("formatCurrency", () => {
  it("formata em BRL com simbolo e duas casas", () => {
    const out = stripSpaces(formatCurrency(1234.5));
    expect(out).toContain("R$");
    expect(out).toContain("1.234,50");
  });

  it("formata zero", () => {
    expect(stripSpaces(formatCurrency(0))).toContain("0,00");
  });

  it("formata valor negativo", () => {
    const out = stripSpaces(formatCurrency(-99.9));
    expect(out).toContain("99,90");
    expect(out).toContain("-");
  });
});

describe("formatDate", () => {
  it("retorna travessao para null/undefined/string vazia", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
    expect(formatDate("")).toBe("—");
  });

  it("formata uma data no padrao dd/mm/aaaa", () => {
    expect(formatDate("2026-01-15")).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });
});

describe("formatDateTime", () => {
  it("retorna travessao para null/undefined", () => {
    expect(formatDateTime(null)).toBe("—");
    expect(formatDateTime(undefined)).toBe("—");
  });

  it("inclui data e hora", () => {
    const out = formatDateTime("2026-01-15T13:45:00");
    expect(out).toMatch(/\d{2}\/\d{2}\/\d{4}/);
    expect(out).toMatch(/\d{2}:\d{2}/);
  });
});

describe("initials", () => {
  it("usa as iniciais das duas primeiras palavras, em maiusculas", () => {
    expect(initials("André Machado")).toBe("AM");
    expect(initials("maria clara souza")).toBe("MC");
  });

  it("nome unico retorna uma inicial", () => {
    expect(initials("André")).toBe("A");
  });
});
