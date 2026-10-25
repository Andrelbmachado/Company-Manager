// Ida e volta do texto da célula: o que o campo mostra ao editar tem de voltar ao mesmo valor ao salvar.
import { describe, expect, it } from "vitest";
import { cellText, parseCell, sameCellValue, type EditableColumn } from "./cellEditors";

type Row = Record<string, unknown> & { id: string };
const column = (kind: EditableColumn<Row>["kind"], extra: Partial<EditableColumn<Row>> = {}): EditableColumn<Row> => ({ key: "campo", header: "Campo", kind, ...extra });

describe("células da EditableTable", () => {
  it("dinheiro e número: texto em pt-BR que volta ao mesmo valor (sem confundir milhar)", () => {
    expect(cellText(column("money"), 1234.5)).toBe("1.234,50");
    expect(parseCell(column("money"), "1.234,50")).toEqual({ ok: true, value: 1234.5 });
    expect(parseCell(column("money"), "R$ 10,00")).toEqual({ ok: true, value: 10 });
    expect(cellText(column("number"), 1234.5)).toBe("1234,5");
    expect(parseCell(column("number"), "1234,5")).toEqual({ ok: true, value: 1234.5 });
    expect(parseCell(column("number"), "abc").ok).toBe(false);
  });

  it("data: mostra dd/mm/aaaa e aceita dd/mm/aaaa ou ISO; data impossível é erro", () => {
    expect(cellText(column("date"), "2025-12-31")).toBe("31/12/2025");
    expect(parseCell(column("date"), "31/12/2025")).toEqual({ ok: true, value: "2025-12-31" });
    expect(parseCell(column("date"), "2025-12-31")).toEqual({ ok: true, value: "2025-12-31" });
    expect(parseCell(column("date"), "31/02/2025").ok).toBe(false);
    expect(cellText(column("date"), null)).toBe("");
  });

  it("vazio vira null, ou Obrigatório na coluna obrigatória", () => {
    expect(parseCell(column("text"), "  ")).toEqual({ ok: true, value: null });
    expect(parseCell(column("text", { required: true }), "")).toEqual({ ok: false, reason: "Obrigatório" });
  });

  it("sim/não respeita o tipo da coluna (1/0 do SQLite ou booleano)", () => {
    expect(cellText(column("bool"), 1)).toBe("true");
    expect(parseCell(column("bool"), "false", 1)).toEqual({ ok: true, value: 0 });
    expect(parseCell(column("bool"), "true", false)).toEqual({ ok: true, value: true });
  });

  it("seleção só aceita as opções; telefone e e-mail saem normalizados", () => {
    const select = column("select", { options: [{ value: "lead", label: "Lead" }] });
    expect(parseCell(select, "lead")).toEqual({ ok: true, value: "lead" });
    expect(parseCell(select, "outro").ok).toBe(false);
    expect(parseCell(column("phone"), "15999990000")).toEqual({ ok: true, value: "(15) 99999-0000" });
    expect(parseCell(column("email"), "Ana@Empresa.com.br")).toEqual({ ok: true, value: "ana@empresa.com.br" });
  });

  it("mudou? null = vazio, 1234.5 = '1234.50', true = 1", () => {
    expect(sameCellValue(column("text"), null, "")).toBe(true);
    expect(sameCellValue(column("money"), 1234.5, "1234.50")).toBe(true);
    expect(sameCellValue(column("bool"), true, 1)).toBe(true);
    expect(sameCellValue(column("text"), "a", "b")).toBe(false);
  });
});
