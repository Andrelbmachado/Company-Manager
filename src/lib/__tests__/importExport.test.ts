import { describe, expect, it } from "vitest";
import { getEntity } from "@/lib/data/entities";
import { autoMapHeaders, exportRows, planImport, readTabular, templateCsv } from "@/lib/data/importExport";
import { parseDate, parseNumber } from "@/lib/data/values";

const leads = getEntity("leads");
const opportunities = getEntity("opportunities");

describe("value parsing", () => {
  it.each([
    ["R$ 1.234,56", 1234.56],
    ["1234.56", 1234.56],
    ["1,5", 1.5],
    ["1.234", 1234],
    ["1,234,567", 1234567],
    ["-42", -42],
    ["abc", null],
  ])("parseNumber(%s) = %s", (raw, expected) => {
    expect(parseNumber(raw)).toBe(expected);
  });

  it("parses Brazilian and ISO dates", () => {
    expect(parseDate("31/12/2026")).toBe("2026-12-31");
    expect(parseDate("2026-01-05T10:00:00Z")).toBe("2026-01-05");
    expect(parseDate("5/1/26")).toBe("2026-01-05");
    expect(parseDate("32/01/2026")).toBeNull();
  });
});

describe("autoMapHeaders", () => {
  it("maps common lead CSV headers (pt-BR and English)", () => {
    const headers = ["Nome completo", "E-mail", "Celular", "Nome da empresa", "Cargo", "Origem", "Coluna X"];
    expect(autoMapHeaders(leads, headers)).toEqual([
      "name",
      "email",
      "phone",
      "company_name",
      "position",
      "source",
      null,
    ]);
    expect(autoMapHeaders(leads, ["Full Name", "Email Address", "Phone Number", "Company", "Job Title", "Lead Source"])).toEqual([
      "name",
      "email",
      "phone",
      "company_name",
      "position",
      "source",
    ]);
  });

  it("never maps two columns to the same field", () => {
    const mapping = autoMapHeaders(leads, ["Nome", "Nome"]);
    expect(mapping).toEqual(["name", null]);
  });
});

describe("planImport", () => {
  const csv = [
    "Nome;E-mail;Telefone;Status;Pontuação",
    "Ana Lima;ANA@x.com;(11) 99999-0000;Qualificado;80",
    "Bruno;bruno@x.com;;;",
    ";sem-nome@x.com;;;",
    "Ana L.;ana@x.com;;novo;10",
    "Carlos;carlos@x.com;;novo;abc",
  ].join("\n");

  it("coerces values, reports errors and skips duplicates", () => {
    const data = readTabular(csv);
    const plan = planImport(leads, data, autoMapHeaders(leads, data.headers), { refRows: {}, existing: [] });

    expect(plan.toInsert).toEqual([
      { name: "Ana Lima", email: "ana@x.com", phone: "(11) 99999-0000", status: "qualificado", score: 80 },
      { name: "Bruno", email: "bruno@x.com", status: "novo", score: 0 },
    ]);
    expect(plan.errorCount).toBe(2);
    expect(plan.rows[2].errors[0]).toMatch(/Nome/);
    expect(plan.rows[2].line).toBe(4);
    expect(plan.duplicateCount).toBe(1);
  });

  it("detects duplicates against existing rows", () => {
    const data = readTabular("nome,email\nX,bruno@x.com");
    const plan = planImport(leads, data, autoMapHeaders(leads, data.headers), {
      refRows: {},
      existing: [{ id: "1", email: "Bruno@x.com" }],
    });
    expect(plan.toInsert).toHaveLength(0);
    expect(plan.duplicateCount).toBe(1);
  });

  it("resolves references by name and warns when missing", () => {
    const data = readTabular("Título,Cliente,Valor,Etapa\nDeal A,alfa engenharia,\"1.500,00\",Proposta\nDeal B,Inexistente,10,");
    const plan = planImport(opportunities, data, autoMapHeaders(opportunities, data.headers), {
      refRows: { customers: [{ id: "c1", name: "Alfa Engenharia" }] },
      existing: [],
    });
    expect(plan.toInsert[0]).toMatchObject({ title: "Deal A", customer_id: "c1", value: 1500, stage: "proposta" });
    expect(plan.toInsert[1]).not.toHaveProperty("customer_id");
    expect(plan.rows[1].warnings[0]).toMatch(/Inexistente/);
  });
});

describe("export", () => {
  it("exports CSV that re-imports to the same values", () => {
    const rows = [{ id: "o1", title: "Deal", customer_id: "c1", customer_id__label: "Alfa", value: 1234.5, stage: "negociacao", probability: 70 }];
    const csv = exportRows(opportunities, rows, "csv");
    const data = readTabular(csv);
    const plan = planImport(opportunities, data, autoMapHeaders(opportunities, data.headers), {
      refRows: { customers: [{ id: "c1", name: "Alfa" }] },
      existing: [],
    });
    expect(plan.toInsert[0]).toMatchObject({ title: "Deal", customer_id: "c1", value: 1234.5, stage: "negociacao", probability: 70 });
  });

  it("JSON export keeps raw values and re-imports numbers safely", () => {
    const json = exportRows(getEntity("inventory_items"), [{ id: "i1", name: "Cabo", cost: 1.234, min_stock: 5 }], "json");
    const data = readTabular(json, "x.json");
    const def = getEntity("inventory_items");
    const plan = planImport(def, data, autoMapHeaders(def, data.headers), { refRows: {}, existing: [] });
    expect(plan.toInsert[0]).toMatchObject({ name: "Cabo", cost: 1.234, min_stock: 5 });
  });

  it("template headers map back to every writable field", () => {
    const data = readTabular(templateCsv(leads));
    expect(autoMapHeaders(leads, data.headers).every(Boolean)).toBe(true);
  });
});
