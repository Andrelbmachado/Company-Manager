// PDF da proposta: arquivo PDF válido (cabeçalho, xref com offsets certos), texto com acentos e várias páginas.
import { afterEach, describe, expect, it } from "vitest";
import { createTestDb, insertTestCompany, type TestDb } from "@/test/sqlite";
import { buildProposalPdf, loadProposalDocument, renderProposalPdf, type ProposalDocument } from "./proposalPdf";
import { encodeWinAnsi, textWidth } from "./pdfWriter";
import { saveProposal } from "./proposals";

let db: TestDb | null = null;
afterEach(() => {
  db?.close();
  db = null;
});

const latin1 = (bytes: Uint8Array) => Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");

/** Confere a tabela xref: cada objeto começa exatamente no offset declarado. */
function checkXref(pdf: string): number {
  const startxref = Number(/startxref\s+(\d+)\s+%%EOF\s*$/.exec(pdf)?.[1]);
  expect(pdf.slice(startxref, startxref + 4)).toBe("xref");
  const header = /xref\s+0 (\d+)\s+/.exec(pdf.slice(startxref))!;
  const count = Number(header[1]);
  const entries = pdf.slice(startxref + header[0].length).split(/\r?\n/).slice(0, count);
  entries.slice(1).forEach((entry, index) => {
    const offset = Number(entry.slice(0, 10));
    expect(pdf.slice(offset, offset + `${index + 1} 0 obj`.length)).toBe(`${index + 1} 0 obj`);
  });
  return count;
}

const DOC: ProposalDocument = {
  companyName: "TechFlow Soluções",
  companyDocument: "12.345.678/0001-90",
  number: "PROP-00012",
  title: "Rede e Wi-Fi da nova filial",
  version: 2,
  status: "enviada",
  issueDate: "2026-10-24",
  validUntil: "2026-11-08",
  customer: { name: "Clínica São José", document: "98.765.432/0001-10", email: "compras@saojose.com.br", phone: "(15) 3333-4444" },
  contactName: "Ana Paula",
  items: [
    { description: "Access point Wi-Fi 6 (ação)", unit: "un", qty: 6, unitPrice: 899.9, discount: 300, total: 5099.4 },
    { description: "Ponto de rede", unit: "un", qty: 24, unitPrice: 150, discount: 0, total: 3600 },
  ],
  subtotal: 8699.4,
  discount: 99.4,
  total: 8600,
  paymentTerms: "30/60/90 dias no boleto",
  notes: "Valores válidos até a data de validade.",
};

describe("pdfWriter", () => {
  it("codifica pt-BR em WinAnsi e mede texto em Helvetica", () => {
    expect(Array.from(encodeWinAnsi("ção–€"))).toEqual([0xe7, 0xe3, 0x6f, 0x96, 0x80]);
    expect(Array.from(encodeWinAnsi("日"))).toEqual([0x3f]);
    // "Hi" em Helvetica 10 pt: (722 + 222) / 1000 × 10.
    expect(textWidth("Hi", 10)).toBeCloseTo(9.44, 5);
    expect(textWidth("Hi", 10, true)).toBeCloseTo(10, 5);
    expect(textWidth("é", 10)).toBe(textWidth("e", 10));
  });
});

describe("buildProposalPdf", () => {
  it("gera PDF válido com número, cliente, itens, totais em reais e validade", () => {
    const bytes = buildProposalPdf(DOC);
    const pdf = latin1(bytes);
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
    checkXref(pdf);
    expect(pdf).toContain("/Type /Catalog");
    expect(pdf).toContain("/BaseFont /Helvetica");
    expect(pdf).toContain("/Encoding /WinAnsiEncoding");
    for (const text of ["PROP-00012", "Rede e Wi-Fi da nova filial", "Cl\xednica S\xe3o Jos\xe9", "Ana Paula", "Ponto de rede", "R$ 8.600,00", "R$ 5.099,40", "08/11/2026", "30/60/90 dias no boleto", "Vers\xe3o 2"]) {
      expect(pdf, text).toContain(text);
    }
    // Parênteses no texto são escapados no PDF.
    expect(pdf).toContain("Wi-Fi 6 \\(a\xe7\xe3o\\)");
    expect((pdf.match(/\/Type \/Page\b/g) ?? []).length).toBe(1);
  });

  it("quebra em páginas quando há muitos itens e numera as páginas", () => {
    const items = Array.from({ length: 70 }, (_, index) => ({ description: `Item ${index + 1} com uma descrição bem comprida que precisa quebrar em mais de uma linha dentro da coluna`, unit: "un", qty: 1, unitPrice: 10, discount: 0, total: 10 }));
    const pdf = latin1(buildProposalPdf({ ...DOC, items, subtotal: 700, discount: 0, total: 700 }));
    const pages = (pdf.match(/\/Type \/Page\b/g) ?? []).length;
    expect(pages).toBeGreaterThan(2);
    expect(pdf).toContain(`P\xe1gina ${pages} de ${pages}`);
    expect(pdf).toContain("Item 70");
    checkXref(pdf);
  });
});

describe("loadProposalDocument e renderProposalPdf", () => {
  it("monta o documento a partir do banco e devolve um Blob application/pdf", async () => {
    db = await createTestDb();
    const { companyId, userIds } = await insertTestCompany(db, { roles: ["comercial"], name: "TechFlow Soluções" });
    await db.execute("INSERT INTO customers (id, company_id, name, document) VALUES (?,?,?,?)", ["cust-1", companyId, "Clínica São José", "98.765.432/0001-10"]);
    await db.execute("INSERT INTO contacts (id, company_id, customer_id, name) VALUES (?,?,?,?)", ["ct-1", companyId, "cust-1", "Ana Paula"]);
    const id = await saveProposal(db, companyId, userIds.comercial!, {
      title: "Rede",
      customer_id: "cust-1",
      contact_id: "ct-1",
      valid_until: "2026-11-08",
      items: [{ description: "Ponto de rede", qty: 24, unit_price: 150 }],
    });

    const doc = await loadProposalDocument(db, companyId, id);
    expect(doc).toMatchObject({ companyName: "TechFlow Soluções", number: "PROP-00001", title: "Rede", contactName: "Ana Paula", total: 3600, validUntil: "2026-11-08" });
    expect(doc.customer?.name).toBe("Clínica São José");
    expect(doc.items).toEqual([{ description: "Ponto de rede", unit: "un", qty: 24, unitPrice: 150, discount: 0, total: 3600 }]);

    const blob = await renderProposalPdf(id, { db, companyId });
    expect(blob.type).toBe("application/pdf");
    const text = latin1(new Uint8Array(await blob.arrayBuffer()));
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    await expect(loadProposalDocument(db, companyId, "nao-existe")).rejects.toThrow(/proposta/i);
  });
});
