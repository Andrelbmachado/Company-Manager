import { describe, expect, it } from "vitest";
import type { ReportTable } from "./common";
import { reportHtml, toCsv, toXlsxBlob, xlsxSheet } from "./export";

const TABLE: ReportTable = {
  title: "Vendas por cliente",
  subtitle: "01/10/2026 a 31/10/2026",
  columns: [
    { key: "label", label: "Cliente", kind: "text" },
    { key: "day", label: "Último pedido", kind: "date" },
    { key: "orders", label: "Pedidos", kind: "integer" },
    { key: "qty", label: "Quantidade", kind: "number" },
    { key: "total", label: "Total (R$)", kind: "money" },
    { key: "share", label: "Participação (%)", kind: "percent" },
  ],
  rows: [
    { label: 'Alfa; "Ltda"', day: "2026-10-02", orders: 1, qty: 2.5, total: 1000, share: 64.9 },
    { label: "=HYPERLINK(\"x\")", day: null, orders: 2, qty: 7, total: -12.5, share: 0 },
    { label: "<script>alert(1)</script>", day: "2026-10-03", orders: 0, qty: null, total: 0.1, share: null },
  ],
  totals: { label: "Total", orders: 3, total: 987.6, share: 100 },
  fileName: "relatorio-vendas-por-cliente-2026-10-01-a-2026-10-31",
};

describe("exportação dos relatórios", () => {
  it("CSV para Excel brasileiro: BOM, ponto e vírgula, vírgula decimal, CRLF, aspas e fórmula neutralizada", () => {
    expect(toCsv(TABLE)).toBe(
      "﻿" +
        [
          "Cliente;Último pedido;Pedidos;Quantidade;Total (R$);Participação (%)",
          '"Alfa; ""Ltda""";02/10/2026;1;2,5;1000,00;64,9',
          '"\'=HYPERLINK(""x"")";;2;7;-12,50;0,0',
          "<script>alert(1)</script>;03/10/2026;0;;0,10;",
          "Total;;3;;987,60;100,0",
        ].join("\r\n") +
        "\r\n",
    );
  });

  it("planilha XLSX: cabeçalho em negrito, números como número, data como data, total em negrito", async () => {
    const sheet = xlsxSheet(TABLE);
    expect(sheet[0][0]).toMatchObject({ value: "Vendas por cliente", fontWeight: "bold" });
    expect(sheet[1][0]).toMatchObject({ value: "01/10/2026 a 31/10/2026" });
    const header = sheet[3];
    expect(header.map((cell) => (cell as { value: string }).value)).toEqual(TABLE.columns.map((column) => column.label));
    expect(header[0]).toMatchObject({ fontWeight: "bold" });
    const first = sheet[4];
    expect(first[0]).toMatchObject({ type: String, value: 'Alfa; "Ltda"' });
    expect(first[1]).toMatchObject({ type: Date, format: "dd/mm/yyyy" });
    expect((first[1] as { value: Date }).value.toISOString()).toBe("2026-10-02T00:00:00.000Z");
    expect(first[4]).toMatchObject({ type: Number, value: 1000, format: "#,##0.00" });
    expect(first[5]).toMatchObject({ type: Number, value: 64.9, format: "0.0" });
    expect(sheet[5][1]).toBeNull();
    expect(sheet.at(-1)?.[0]).toMatchObject({ value: "Total", fontWeight: "bold" });

    const blob = await toXlsxBlob(TABLE);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe("PK");
    expect(blob.size).toBeGreaterThan(1000);
  });

  it("HTML para imprimir ou salvar em PDF: escapado e com valores formatados", () => {
    const html = reportHtml(TABLE, { company: "Empresa & Cia", generatedAt: new Date(2026, 9, 24, 9, 5) });
    expect(html).toContain("<h1>Vendas por cliente</h1>");
    expect(html).toContain("Empresa &amp; Cia");
    expect(html).toContain("Alfa; &quot;Ltda&quot;");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toMatch(/R\$\s1\.000,00/);
    expect(html).toContain("64,9%");
    expect(html).toContain("02/10/2026");
    expect(html).toContain("24/10/2026");
    expect(html).toContain("<tfoot>");
  });
});
