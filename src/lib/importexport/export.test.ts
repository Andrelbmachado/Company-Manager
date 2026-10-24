// Exportação e modelos: formato brasileiro no CSV, células tipadas no XLSX, proteção contra fórmula e nomes de arquivo.
import { v4 as uuidv4 } from "uuid";
import { describe, expect, it } from "vitest";
import { createTestDb, insertTestCompany } from "@/test/sqlite";
import { escapeFormula, exportFilename, exportRows, fieldInstructions, formatCell, sheetName, templateFor } from "./export";
import { parseFile } from "./parse";
import type { FieldDef } from "./registry";

async function company() {
  const db = await createTestDb();
  const { companyId } = await insertTestCompany(db, { roles: ["ceo"] });
  return { db, companyId };
}

const field = (kind: FieldDef["kind"], extra: Partial<FieldDef> = {}): FieldDef => ({ key: "x", label: "X", kind, ...extra });

describe("formatCell", () => {
  it("valores no formato brasileiro", () => {
    expect(formatCell(field("money"), 1234.5)).toBe("1234,50");
    expect(formatCell(field("money"), -0.1)).toBe("-0,10");
    expect(formatCell(field("number"), 7.25)).toBe("7,25");
    expect(formatCell(field("number"), 1e21)).toBe("1000000000000000000000");
    expect(formatCell(field("int"), 30)).toBe("30");
    expect(formatCell(field("date"), "2026-11-05")).toBe("05/11/2026");
    expect(formatCell(field("date"), "2026-11-05 10:30:00")).toBe("05/11/2026");
    expect(formatCell(field("month"), "2026-11")).toBe("11/2026");
    expect(formatCell(field("bool"), 1)).toBe("Sim");
    expect(formatCell(field("bool"), "false")).toBe("Não");
    expect(formatCell(field("enum", { options: [{ value: "em_ferias", label: "Em férias" }] }), "em_ferias")).toBe("Em férias");
    expect(formatCell(field("enum", { options: [] }), "outro")).toBe("outro");
    expect(formatCell(field("text"), null)).toBe("");
  });

  it("texto que viraria fórmula ganha apóstrofo", () => {
    expect(escapeFormula("=HYPERLINK(\"x\")")).toBe("'=HYPERLINK(\"x\")");
    expect(escapeFormula("+55 11 99999-0000")).toBe("'+55 11 99999-0000");
    expect(escapeFormula("@soma")).toBe("'@soma");
    expect(escapeFormula("Normal")).toBe("Normal");
  });
});

describe("exportRows", () => {
  it("CSV: BOM, ;, CRLF, aspas, rótulos e proteção contra fórmula; volta igual pela leitura", async () => {
    const { db, companyId } = await company();
    await db.execute("INSERT INTO customers (id, company_id, name, document, email, credit_limit, status, notes, created_at) VALUES (?,?,?,?,?,?,?,?,?)", [
      uuidv4(), companyId, "Café; Pão & Cia", "11.222.333/0001-81", "cafe@exemplo.com", 1500.5, "inactive", "=1+1", "2026-01-01 00:00:00",
    ]);
    await db.execute("INSERT INTO customers (id, company_id, name, created_at, deleted_at) VALUES (?,?,?,?,?)", [uuidv4(), companyId, "Excluído", "2026-01-02 00:00:00", "2026-02-01"]);
    const blob = await exportRows("customers", "csv", { db, companyId });
    expect(blob.type).toMatch(/text\/csv/);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes);
    const lines = text.split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[0].split(";")[0]).toBe("Nome / razão social");
    expect(lines[1]).toContain('"Café; Pão & Cia"');
    expect(lines[1]).toContain(";1500,50;");
    expect(lines[1]).toContain(";Inativo;");
    expect(lines[1]).toContain(";'=1+1");
    expect(text).not.toContain("Excluído");

    const parsed = await parseFile(new File([blob], "clientes.csv"));
    expect(parsed.sheets[0].rows[0]).toMatchObject({ "Nome / razão social": "Café; Pão & Cia", "CPF/CNPJ": "11.222.333/0001-81" });
  });

  it("XLSX: número, data e texto tipados, legíveis pela importação", async () => {
    const { db, companyId } = await company();
    await db.execute("INSERT INTO projects (id, company_id, name, status, budget, start_date, end_date) VALUES (?,?,?,?,?,?,?)", [
      uuidv4(), companyId, "Implantação", "andamento", 25000.75, "2026-11-01", "2027-03-31",
    ]);
    const blob = await exportRows("projects", "xlsx", { db, companyId });
    expect(blob.type).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const parsed = await parseFile(new File([blob], "projetos.xlsx"));
    expect(parsed.format).toBe("xlsx");
    expect(parsed.sheets[0].name).toBe("Projetos");
    expect(parsed.sheets[0].rows).toEqual([{ Projeto: "Implantação", Cliente: "", Situação: "Em andamento", Orçamento: "25000,75", Início: "2026-11-01", Término: "2027-03-31" }]);
  });
});

describe("templateFor", () => {
  it("CSV: cabeçalho com os rótulos e uma linha de exemplo", async () => {
    const text = await (await templateFor("products", "csv")).text();
    const [headers, example] = text.replace(/^﻿/, "").split("\r\n");
    expect(headers.split(";").slice(0, 3)).toEqual(["Código (SKU)", "Nome", "Tipo"]);
    expect(example.split(";").slice(0, 3)).toEqual(["CAD-001", "Cadeira de escritório", "Produto"]);
  });

  it("XLSX: aba de dados e aba Instruções com obrigatoriedade e valores aceitos", async () => {
    const parsed = await parseFile(new File([await templateFor("employees", "xlsx")], "modelo.xlsx"));
    expect(parsed.sheets.map((sheet) => sheet.name)).toEqual(["Colaboradores", "Instruções"]);
    expect(parsed.sheets[0].rows).toHaveLength(1);
    const instructions = parsed.sheets[1].rows;
    expect(instructions.find((row) => row.Coluna === "Nome")).toMatchObject({ Obrigatória: "Sim" });
    expect(instructions.find((row) => row.Coluna === "Tipo de contrato")?.["Como preencher"]).toBe("Um destes: CLT, PJ, Estágio, Temporário");
  });

  it("cadastro desconhecido é erro", async () => {
    await expect(templateFor("nada", "csv")).rejects.toThrow(/desconhecido/);
  });
});

describe("nomes", () => {
  it("aba do Excel até 31 caracteres e sem caracteres proibidos", () => {
    expect(sheetName("Contas a pagar / receber [2026]: muito longo mesmo")).toHaveLength(31);
    expect(sheetName("A/B")).toBe("A B");
    expect(sheetName("")).toBe("Dados");
  });

  it("arquivo da exportação e do modelo", () => {
    expect(exportFilename("customers", "xlsx", "export", new Date(2026, 9, 24))).toBe("clientes-2026-10-24.xlsx");
    expect(exportFilename("products", "csv", "template")).toBe("modelo-produtos-e-servicos.csv");
  });

  it("instrução por tipo de campo", () => {
    expect(fieldInstructions(field("money"))).toMatch(/1\.234,56/);
    expect(fieldInstructions(field("text", { hint: "Sigla do estado" }))).toBe("Texto. Sigla do estado");
  });
});
