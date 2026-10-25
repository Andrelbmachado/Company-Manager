// Normalização dos valores da planilha (formatos brasileiros): nunca NaN, nunca data invertida.
import { describe, expect, it } from "vitest";
import type { FieldDef } from "./registry";
import { isValidCnpj, isValidCpf, normalizeField, normalizeKey, normalizeValue, parseDecimal } from "./normalize";

const ok = (value: unknown) => ({ ok: true, value });
const fail = expect.objectContaining({ ok: false, reason: expect.any(String) });

describe("normalizeValue: dinheiro", () => {
  it("formatos brasileiros e internacionais", () => {
    expect(normalizeValue("money", "1.234,56")).toEqual(ok(1234.56));
    expect(normalizeValue("money", "R$ 10,00")).toEqual(ok(10));
    expect(normalizeValue("money", "R$ 1.234.567,89")).toEqual(ok(1234567.89));
    expect(normalizeValue("money", "1234.56")).toEqual(ok(1234.56));
    expect(normalizeValue("money", "1,234.56")).toEqual(ok(1234.56));
    expect(normalizeValue("money", "1.234")).toEqual(ok(1234));
    expect(normalizeValue("money", "0,5")).toEqual(ok(0.5));
    expect(normalizeValue("money", "-10,50")).toEqual(ok(-10.5));
    expect(normalizeValue("money", "(1.234,56)")).toEqual(ok(-1234.56));
    expect(normalizeValue("money", "10,005")).toEqual(ok(10.01));
    expect(normalizeValue("money", "1234")).toEqual(ok(1234));
  });

  it("vazio é nulo e lixo é erro com o valor na mensagem", () => {
    expect(normalizeValue("money", "")).toEqual(ok(null));
    expect(normalizeValue("money", "   ")).toEqual(ok(null));
    expect(normalizeValue("money", "R$ 1.2O0,00")).toEqual(fail);
    expect(normalizeValue("money", "abc")).toEqual(fail);
    expect(normalizeValue("money", "1.23.4,00")).toEqual(fail);
    expect((normalizeValue("money", "abc") as { reason: string }).reason).toContain("abc");
  });

  it("parseDecimal não arredonda e nunca devolve NaN", () => {
    expect(parseDecimal("2,5")).toBe(2.5);
    expect(parseDecimal("0,125")).toBe(0.125);
    expect(parseDecimal("x")).toBeNull();
    expect(parseDecimal("")).toBeNull();
  });
});

describe("normalizeValue: data", () => {
  it("dd/mm/aaaa vira YYYY-MM-DD sem inverter dia e mês", () => {
    expect(normalizeValue("date", "31/12/2025")).toEqual(ok("2025-12-31"));
    expect(normalizeValue("date", "01/02/2025")).toEqual(ok("2025-02-01"));
    expect(normalizeValue("date", "1/2/2025")).toEqual(ok("2025-02-01"));
    expect(normalizeValue("date", "05-03-2024")).toEqual(ok("2024-03-05"));
    expect(normalizeValue("date", "05.03.2024")).toEqual(ok("2024-03-05"));
    expect(normalizeValue("date", "31/12/25")).toEqual(ok("2025-12-31"));
    expect(normalizeValue("date", "10/10/2025 14:30")).toEqual(ok("2025-10-10"));
  });

  it("ISO e número de série do Excel", () => {
    expect(normalizeValue("date", "2025-12-31")).toEqual(ok("2025-12-31"));
    expect(normalizeValue("date", "2025-12-31T10:00:00Z")).toEqual(ok("2025-12-31"));
    expect(normalizeValue("date", "2025/1/5")).toEqual(ok("2025-01-05"));
    expect(normalizeValue("date", "20251231")).toEqual(ok("2025-12-31"));
    expect(normalizeValue("date", "45657")).toEqual(ok("2024-12-31"));
  });

  it("data impossível é erro", () => {
    expect(normalizeValue("date", "31/02/2025")).toEqual(fail);
    expect(normalizeValue("date", "29/02/2025")).toEqual(fail);
    expect(normalizeValue("date", "29/02/2024")).toEqual(ok("2024-02-29"));
    expect(normalizeValue("date", "13/13/2025")).toEqual(fail);
    expect(normalizeValue("date", "amanhã")).toEqual(fail);
    expect(normalizeValue("date", "2025-02-30")).toEqual(fail);
  });
});

describe("normalizeValue: inteiro, booleano e telefone", () => {
  it("int", () => {
    expect(normalizeValue("int", "42")).toEqual(ok(42));
    expect(normalizeValue("int", "1.500")).toEqual(ok(1500));
    expect(normalizeValue("int", "3,0")).toEqual(ok(3));
    expect(normalizeValue("int", "2,5")).toEqual(fail);
    expect(normalizeValue("int", "dez")).toEqual(fail);
  });

  it("bool aceita sim/não, verdadeiro/falso, 1/0 e x", () => {
    for (const raw of ["Sim", "S", "sim", "TRUE", "Verdadeiro", "1", "x", "Ativo"]) expect(normalizeValue("bool", raw), raw).toEqual(ok(true));
    for (const raw of ["Não", "nao", "N", "false", "Falso", "0", "Inativo"]) expect(normalizeValue("bool", raw), raw).toEqual(ok(false));
    expect(normalizeValue("bool", "talvez")).toEqual(fail);
  });

  it("phone formata no padrão brasileiro", () => {
    expect(normalizeValue("phone", "11999998888")).toEqual(ok("(11) 99999-8888"));
    expect(normalizeValue("phone", "(11) 3020-1188")).toEqual(ok("(11) 3020-1188"));
    expect(normalizeValue("phone", "+55 11 99999-8888")).toEqual(ok("(11) 99999-8888"));
    expect(normalizeValue("phone", "011 3020 1188")).toEqual(ok("(11) 3020-1188"));
    expect(normalizeValue("phone", "0800 123 4567")).toEqual(ok("0800 123 4567"));
    expect(normalizeValue("phone", "+1 415 555 0100")).toEqual(ok("+14155550100"));
    expect(normalizeValue("phone", "123")).toEqual(fail);
  });
});

describe("normalizeValue: documentos e e-mail", () => {
  it("cnpj válido é formatado; inválido é erro", () => {
    expect(normalizeValue("cnpj", "11222333000181")).toEqual(ok("11.222.333/0001-81"));
    expect(normalizeValue("cnpj", "11.222.333/0001-81")).toEqual(ok("11.222.333/0001-81"));
    expect(normalizeValue("cnpj", "11.222.333/0001-82")).toEqual(fail);
    expect(normalizeValue("cnpj", "11111111111111")).toEqual(fail);
    expect(normalizeValue("cnpj", "123")).toEqual(fail);
  });

  it("cnpj alfanumérico (2026) e cnpj do Excel sem o zero à esquerda", () => {
    expect(isValidCnpj("12ABC34501DE35")).toBe(true);
    expect(normalizeValue("cnpj", "12.abc.345/01de-35")).toEqual(ok("12.ABC.345/01DE-35"));
    // 01.234.567/0001-95 salvo como número no Excel perde o zero.
    expect(normalizeValue("cnpj", "1234567000195")).toEqual(ok("01.234.567/0001-95"));
  });

  it("cpf", () => {
    expect(isValidCpf("52998224725")).toBe(true);
    expect(normalizeValue("cpf", "529.982.247-25")).toEqual(ok("529.982.247-25"));
    expect(normalizeValue("cpf", "52998224726")).toEqual(fail);
    expect(normalizeValue("cpf", "00000000000")).toEqual(fail);
    expect(normalizeValue("cpf", "8980207000")).toEqual(ok("089.802.070-00"));
  });

  it("email em minúsculas; inválido é erro", () => {
    expect(normalizeValue("email", " Contato@Empresa.COM.br ")).toEqual(ok("contato@empresa.com.br"));
    expect(normalizeValue("email", "mailto:a@b.co")).toEqual(ok("a@b.co"));
    expect(normalizeValue("email", "sem-arroba.com")).toEqual(fail);
    expect(normalizeValue("email", "a@b")).toEqual(fail);
  });
});

describe("normalizeField", () => {
  const field = (kind: FieldDef["kind"], extra: Partial<FieldDef> = {}): FieldDef => ({ key: "x", label: "X", kind, ...extra });

  it("texto: apara e desfaz a proteção contra fórmula da exportação", () => {
    expect(normalizeField(field("text"), "  Olá  ")).toEqual(ok("Olá"));
    expect(normalizeField(field("text"), "'=SOMA(A1)")).toEqual(ok("=SOMA(A1)"));
    expect(normalizeField(field("text"), "")).toEqual(ok(null));
    expect(normalizeField(field("text"), undefined)).toEqual(ok(null));
  });

  it("enum aceita o valor ou o rótulo, sem acento nem maiúscula", () => {
    const status = field("enum", { options: [{ value: "active", label: "Ativo" }, { value: "inactive", label: "Inativo" }] });
    expect(normalizeField(status, "ATIVO")).toEqual(ok("active"));
    expect(normalizeField(status, "inactive")).toEqual(ok("inactive"));
    const result = normalizeField(status, "talvez");
    expect(result).toEqual(fail);
    expect((result as { reason: string }).reason).toContain("Ativo");
    const priority = field("enum", { options: [{ value: "media", label: "Média" }] });
    expect(normalizeField(priority, "media")).toEqual(ok("media"));
    expect(normalizeField(priority, "Média")).toEqual(ok("media"));
  });

  it("documento decide entre CPF e CNPJ", () => {
    expect(normalizeField(field("document"), "52998224725")).toEqual(ok("529.982.247-25"));
    expect(normalizeField(field("document"), "11222333000181")).toEqual(ok("11.222.333/0001-81"));
    expect(normalizeField(field("document"), "123")).toEqual(fail);
  });

  it("número e competência", () => {
    expect(normalizeField(field("number"), "1.234,5")).toEqual(ok(1234.5));
    expect(normalizeField(field("month"), "10/2026")).toEqual(ok("2026-10"));
    expect(normalizeField(field("month"), "2026-10")).toEqual(ok("2026-10"));
    expect(normalizeField(field("month"), "out/2026")).toEqual(ok("2026-10"));
    expect(normalizeField(field("month"), "15/10/2026")).toEqual(ok("2026-10"));
    expect(normalizeField(field("month"), "13/2026")).toEqual(fail);
  });
});

describe("normalizeKey", () => {
  it("compara sem acento, caixa, pontuação ou espaços extras", () => {
    expect(normalizeKey("  Razão   Social* ")).toBe("razao social");
    expect(normalizeKey("E-mail")).toBe("e mail");
    expect(normalizeKey("CNPJ/CPF")).toBe("cnpj cpf");
  });
});
