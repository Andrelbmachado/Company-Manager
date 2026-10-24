// Leitura de CSV (separador, BOM, UTF-8/Latin-1/UTF-16) e XLSX (várias abas) em linhas de texto.
import { describe, expect, it } from "vitest";
import writeXlsxFile from "write-excel-file/universal";
import { ImportFileError } from "./errors";
import { decodeText, parseFile } from "./parse";

const csvFile = (content: string | Uint8Array<ArrayBuffer>, name = "dados.csv") => new File([content], name, { type: "text/csv" });
const latin1 = (text: string): Uint8Array<ArrayBuffer> => Uint8Array.from([...text].map((char) => char.charCodeAt(0)));

async function parseError(file: File, options?: Parameters<typeof parseFile>[1]): Promise<ImportFileError> {
  try {
    await parseFile(file, options);
  } catch (error) {
    expect(error).toBeInstanceOf(ImportFileError);
    return error as ImportFileError;
  }
  throw new Error("parseFile deveria falhar");
}

describe("parseFile: CSV", () => {
  it("separador ; com BOM UTF-8, acento e vírgula decimal", async () => {
    const parsed = await parseFile(csvFile("﻿Nome;Descrição;Preço\nCadeira;Ação de graças;1.234,56\nMesa;Pé;10,5\n"));
    expect(parsed.format).toBe("csv");
    expect(parsed.sheets).toHaveLength(1);
    const [sheet] = parsed.sheets;
    expect(sheet.headers).toEqual(["Nome", "Descrição", "Preço"]);
    expect(sheet.rows).toEqual([
      { Nome: "Cadeira", Descrição: "Ação de graças", Preço: "1.234,56" },
      { Nome: "Mesa", Descrição: "Pé", Preço: "10,5" },
    ]);
    expect(sheet.rowNumbers).toEqual([2, 3]);
  });

  it("Latin-1 (Excel antigo) com ç e ã", async () => {
    const parsed = await parseFile(csvFile(latin1("Razão social;Endereço\r\nJoão & Cia;Praça da Sé\r\n")));
    expect(parsed.sheets[0].headers).toEqual(["Razão social", "Endereço"]);
    expect(parsed.sheets[0].rows[0]).toEqual({ "Razão social": "João & Cia", Endereço: "Praça da Sé" });
  });

  it("UTF-16 com BOM (\"texto Unicode\" do Excel, separado por tabulação)", async () => {
    const text = "﻿Nome\tCidade\nAna\tSão Paulo\n";
    const bytes = new Uint8Array(text.length * 2);
    [...text].forEach((char, index) => {
      bytes[index * 2] = char.charCodeAt(0) & 0xff;
      bytes[index * 2 + 1] = char.charCodeAt(0) >> 8;
    });
    const parsed = await parseFile(csvFile(bytes, "dados.txt"));
    expect(parsed.sheets[0].rows).toEqual([{ Nome: "Ana", Cidade: "São Paulo" }]);
  });

  it("vírgula com aspas, quebra de linha dentro da célula e linhas vazias ignoradas", async () => {
    const parsed = await parseFile(csvFile('nome,obs,valor\n"Silva, Ana","linha 1\nlinha 2",10\n\n,,\nBeto,,20\n'));
    const [sheet] = parsed.sheets;
    expect(sheet.rows).toEqual([
      { nome: "Silva, Ana", obs: "linha 1\nlinha 2", valor: "10" },
      { nome: "Beto", obs: "", valor: "20" },
    ]);
    expect(sheet.rowNumbers).toEqual([2, 5]);
  });

  it("não confunde a vírgula decimal com separador e respeita sep=", async () => {
    expect((await parseFile(csvFile("Produto;Valor\nA;1,50\nB;2,75\n"))).sheets[0].rows).toEqual([
      { Produto: "A", Valor: "1,50" },
      { Produto: "B", Valor: "2,75" },
    ]);
    expect((await parseFile(csvFile("sep=;\nA;B\n1,2;3\n"))).sheets[0].rows).toEqual([{ A: "1,2", B: "3" }]);
    expect((await parseFile(csvFile("a\tb\n1\t2\n"))).sheets[0].headers).toEqual(["a", "b"]);
  });

  it("cabeçalho vazio ou repetido ganha nome próprio", async () => {
    const parsed = await parseFile(csvFile("Email;;Email\na@x.com;meio;b@x.com\n"));
    expect(parsed.sheets[0].headers).toEqual(["Email", "Coluna 2", "Email (2)"]);
    expect(parsed.sheets[0].rows[0]).toEqual({ Email: "a@x.com", "Coluna 2": "meio", "Email (2)": "b@x.com" });
  });

  it("decodeText escolhe UTF-8 quando é válido e Windows-1252 quando não é", () => {
    expect(decodeText(new TextEncoder().encode("Ação"))).toBe("Ação");
    expect(decodeText(latin1("Ação"))).toBe("Ação");
  });
});

describe("parseFile: XLSX", () => {
  it("duas abas viram duas planilhas; números, datas e sim/não viram texto que o normalizador entende", async () => {
    const blob = await writeXlsxFile([
      {
        sheet: "Clientes",
        data: [
          ["Nome", "Limite", "Desde", "Ativo", "CNPJ"],
          ["Ana", 1234.56, { value: new Date(Date.UTC(2025, 11, 31)), format: "dd/mm/yyyy" }, true, 11222333000181],
          [null, null, null, null, null],
          ["Beto", 10, null, false, "11.222.333/0001-81"],
        ],
      },
      { sheet: "Produtos", data: [["SKU", "Nome"], ["P-1", "Cadeira"]] },
      { sheet: "Vazia", data: [[null]] },
    ]).toBlob();
    const parsed = await parseFile(new File([blob], "dados.xlsx"));
    expect(parsed.format).toBe("xlsx");
    expect(parsed.sheets.map((sheet) => sheet.name)).toEqual(["Clientes", "Produtos"]);
    const [clientes, produtos] = parsed.sheets;
    expect(clientes.headers).toEqual(["Nome", "Limite", "Desde", "Ativo", "CNPJ"]);
    expect(clientes.rows).toEqual([
      { Nome: "Ana", Limite: "1234,56", Desde: "2025-12-31", Ativo: "Sim", CNPJ: "11222333000181" },
      { Nome: "Beto", Limite: "10", Desde: "", Ativo: "Não", CNPJ: "11.222.333/0001-81" },
    ]);
    expect(clientes.rowNumbers).toEqual([2, 4]);
    expect(produtos.rows).toEqual([{ SKU: "P-1", Nome: "Cadeira" }]);
  });

  it("arquivo .xls antigo, xlsx corrompido e planilha vazia dão mensagem legível", async () => {
    expect((await parseError(new File([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 1, 2])], "velho.xls"))).message).toMatch(/\.xlsx/);
    expect((await parseError(new File([new Uint8Array([0x50, 0x4b, 3, 4, 9, 9, 9])], "quebrado.xlsx"))).message).toMatch(/Excel/);
    const empty = await writeXlsxFile([{ sheet: "Vazia", data: [[null]] }]).toBlob();
    expect((await parseError(new File([empty], "vazia.xlsx"))).message).toMatch(/vazia/i);
  });
});

describe("parseFile: limites", () => {
  it("arquivo vazio é erro legível", async () => {
    expect((await parseError(csvFile(""))).message).toMatch(/vazio/i);
    expect((await parseError(csvFile("\n\n  \n"))).message).toMatch(/vazio/i);
  });

  it("formato desconhecido e binário com nome .csv", async () => {
    expect((await parseError(new File(["x"], "planilha.ods"))).message).toMatch(/CSV|xlsx/);
    expect((await parseError(csvFile(new Uint8Array([0, 1, 2, 0, 0, 3])))).message).toMatch(/texto/i);
  });

  it("linhas demais: avisa a aba e o limite", async () => {
    const content = `a;b\n${Array.from({ length: 30 }, (_, index) => `${index};x`).join("\n")}`;
    const error = await parseError(csvFile(content), { maxRows: 20 });
    expect(error.message).toMatch(/20/);
    await expect(parseFile(csvFile(content), { maxRows: 30 })).resolves.toBeTruthy();
  });

  it("arquivo enorme (200 mil linhas) dá o aviso do limite, não erro de pilha", async () => {
    const content = `a;b\n${Array.from({ length: 200_000 }, (_, index) => `${index};x`).join("\n")}`;
    const error = await parseError(csvFile(content));
    expect(error.message).toMatch(/100\.000 linhas/);
  });
});
