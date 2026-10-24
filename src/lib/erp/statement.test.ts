// Leitura de extrato: OFX 1.x (SGML, sem tags de fechamento), OFX 2 (XML), CSV de banco brasileiro e codificação.
import { describe, expect, it } from "vitest";
import { decodeStatementBytes, parseOfx, parseOfxStatement, parseStatementCsv, parseStatementFile } from "./statement";

const OFX_SGML = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><DTSERVER>20261024120000[-3:BRT]<LANGUAGE>POR</SONRS></SIGNONMSGSRSV1>
<BANKMSGSRSV1><STMTTRNRS><TRNUID>1<STATUS><CODE>0<SEVERITY>INFO</STATUS>
<STMTRS><CURDEF>BRL<BANKACCTFROM><BANKID>001<ACCTID>98765-0<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20261001<DTEND>20261024
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261003120000[-3:BRT]
<TRNAMT>-89.90
<FITID>2026100301
<CHECKNUM>000001
<MEMO>Tarifa Pacote Serviços
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20261005
<TRNAMT>1500.00
<FITID>2026100502
<NAME>PIX RECEBIDO JOAO &amp; CIA
<MEMO>Pagamento NF 123
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261007
<TRNAMT>250,50
<FITID>2026100703
<MEMO>PAGTO BOLETO
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>12345.67<DTASOF>20261024</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>
`;

const OFX_XML = `<?xml version="1.0" encoding="UTF-8"?>
<?OFX OFXHEADER="200" VERSION="220" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>XFER</TRNTYPE><DTPOSTED>20261009100000</DTPOSTED><TRNAMT>-1200.00</TRNAMT><FITID>X-1</FITID><NAME>TED ENVIADA</NAME><MEMO>Fornecedor &lt;ABC&gt;</MEMO></STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>-50.00</BALAMT><DTASOF>20261009</DTASOF></LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

describe("parseOfx", () => {
  it("OFX SGML: datas, sinal (débito com valor positivo vira saída), vírgula decimal, nome e memorando", () => {
    expect(parseOfx(OFX_SGML)).toEqual([
      { fitid: "2026100301", postedAt: "2026-10-03", amount: -89.9, description: "Tarifa Pacote Serviços", memo: null, checkNumber: "000001", type: "DEBIT" },
      { fitid: "2026100502", postedAt: "2026-10-05", amount: 1500, description: "PIX RECEBIDO JOAO & CIA", memo: "Pagamento NF 123", checkNumber: null, type: "CREDIT" },
      { fitid: "2026100703", postedAt: "2026-10-07", amount: -250.5, description: "PAGTO BOLETO", memo: null, checkNumber: null, type: "DEBIT" },
    ]);
  });

  it("OFX 2 (XML) com tags de fechamento e entidades", () => {
    expect(parseOfx(OFX_XML)).toEqual([{ fitid: "X-1", postedAt: "2026-10-09", amount: -1200, description: "TED ENVIADA", memo: "Fornecedor <ABC>", checkNumber: null, type: "XFER" }]);
  });

  it("saldo e conta do extrato", () => {
    expect(parseOfxStatement(OFX_SGML)).toMatchObject({ bankId: "001", accountId: "98765-0", balance: 12345.67, balanceDate: "2026-10-24" });
    expect(parseOfxStatement(OFX_XML)).toMatchObject({ balance: -50, balanceDate: "2026-10-09" });
  });

  it("arquivo que não é OFX é erro legível; OFX sem lançamentos é lista vazia", () => {
    expect(() => parseOfx("Data;Valor\n01/10/2026;10,00")).toThrow(/OFX/);
    expect(parseOfx("<OFX><BANKTRANLIST></BANKTRANLIST></OFX>")).toEqual([]);
  });

  it("lançamento com data ou valor inválido é ignorado", () => {
    const broken = "<OFX><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>2026<TRNAMT>-1<FITID>a</STMTTRN><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261001<TRNAMT>abc<FITID>b</STMTTRN></OFX>";
    expect(parseOfx(broken)).toEqual([]);
  });
});

describe("decodeStatementBytes", () => {
  const latin1 = (text: string) => Uint8Array.from([...text].map((char) => char.charCodeAt(0)));

  it("CHARSET:1252 no cabeçalho decodifica acentos do Windows-1252", () => {
    const bytes = latin1("OFXHEADER:100\nCHARSET:1252\n\n<OFX><MEMO>Serviços</OFX>");
    expect(decodeStatementBytes(bytes)).toContain("Serviços");
  });

  it("UTF-8 (com ou sem BOM) e Latin-1 sem cabeçalho", () => {
    const utf8 = new TextEncoder().encode("﻿Data;Histórico\n");
    expect(decodeStatementBytes(utf8)).toBe("Data;Histórico\n");
    expect(decodeStatementBytes(latin1("Data;Histórico\n"))).toBe("Data;Histórico\n");
  });
});

describe("parseStatementCsv", () => {
  const CSV = [
    "Extrato de conta corrente",
    "Agência: 1234-5;Conta: 98765-0",
    "",
    "Data;Histórico;Documento;Valor;Saldo",
    "01/10/2026;Saldo Anterior;;;10.000,00",
    "03/10/2026;TARIFA PACOTE;0001;-89,90;9.910,10",
    "05/10/2026;PIX RECEBIDO JOÃO;;1.500,00;11.410,10",
    "05/10/2026;PIX RECEBIDO JOÃO;;1.500,00;12.910,10",
    "07/10/2026;PAGTO BOLETO;;250,50 D;12.659,60",
    "08/10/2026;S A L D O;;;12.659,60",
  ].join("\n");

  it("acha o cabeçalho depois do preâmbulo, lê datas e valores brasileiros e pula linhas de saldo", () => {
    const txs = parseStatementCsv(CSV);
    expect(txs.map((tx) => [tx.postedAt, tx.amount, tx.description, tx.checkNumber])).toEqual([
      ["2026-10-03", -89.9, "TARIFA PACOTE", "0001"],
      ["2026-10-05", 1500, "PIX RECEBIDO JOÃO", null],
      ["2026-10-05", 1500, "PIX RECEBIDO JOÃO", null],
      ["2026-10-07", -250.5, "PAGTO BOLETO", null],
    ]);
    expect(txs[3].balanceAfter).toBe(12659.6);
  });

  it("linhas iguais ganham fitid diferente, e o mesmo arquivo gera os mesmos fitids (reimportar não duplica)", () => {
    const first = parseStatementCsv(CSV).map((tx) => tx.fitid);
    expect(new Set(first).size).toBe(4);
    expect(parseStatementCsv(CSV).map((tx) => tx.fitid)).toEqual(first);
    expect(first.every((fitid) => fitid?.startsWith("CSV-"))).toBe(true);
  });

  it("colunas de crédito e débito separadas, vírgula como separador e data ISO", () => {
    const csv = 'Data,Descrição,Crédito,Débito\n2026-10-05,"Depósito, agência",100.50,\n2026-10-06,Saque,,40.00\n';
    expect(parseStatementCsv(csv).map((tx) => [tx.postedAt, tx.amount, tx.description])).toEqual([
      ["2026-10-05", 100.5, "Depósito, agência"],
      ["2026-10-06", -40, "Saque"],
    ]);
  });

  it("sem colunas de data e valor é erro legível", () => {
    expect(() => parseStatementCsv("Nome;Cidade\nJoão;Sorocaba")).toThrow(/data e valor/);
    expect(() => parseStatementCsv("")).toThrow(/vazio/);
  });
});

describe("parseStatementFile", () => {
  it("escolhe OFX ou CSV pelo conteúdo", () => {
    expect(parseStatementFile(OFX_SGML)).toMatchObject({ source: "ofx" });
    expect(parseStatementFile("Data;Histórico;Valor\n01/10/2026;Teste;10,00")).toMatchObject({ source: "csv", transactions: [expect.objectContaining({ amount: 10 })] });
  });
});
