// PDF da proposta comercial: cabeçalho da empresa, número/versão/validade, cliente, itens, totais, condições e
// observações, com quebra de página e "Página n de m". Texto voltado ao cliente: sem menção a automações.
import type { DatabaseLike } from "@/lib/db/demo";
import { getDb } from "@/lib/db/client";
import { formatSequence } from "@/lib/db/sequence";
import { formatDay } from "@/lib/utils";
import type { Contact, Customer, Proposal, ProposalItem } from "@/types";
import { A4, PdfDocument, PdfPage, wrapText } from "./pdfWriter";

export interface ProposalDocumentItem {
  description: string;
  unit: string;
  qty: number;
  unitPrice: number;
  /** Desconto do item em R$. */
  discount: number;
  total: number;
}

export interface ProposalDocument {
  companyName: string;
  companyDocument?: string | null;
  /** "PROP-00012". */
  number: string;
  title: string | null;
  version: number;
  status: string;
  /** Envio (ou criação, no rascunho): 'YYYY-MM-DD' ou timestamp. */
  issueDate: string | null;
  /** 'YYYY-MM-DD'. */
  validUntil: string | null;
  customer: { name: string; document?: string | null; email?: string | null; phone?: string | null } | null;
  contactName: string | null;
  items: ProposalDocumentItem[];
  subtotal: number;
  discount: number;
  total: number;
  paymentTerms: string | null;
  notes: string | null;
}

/** Monta os dados da proposta (empresa, cliente, contato e itens ativos). `companyId` null = a empresa da própria proposta. */
export async function loadProposalDocument(db: DatabaseLike, companyId: string | null, proposalId: string): Promise<ProposalDocument> {
  const rows = companyId
    ? await db.select<Proposal[]>("SELECT * FROM proposals WHERE company_id=? AND id=? AND deleted_at IS NULL", [companyId, proposalId])
    : await db.select<Proposal[]>("SELECT * FROM proposals WHERE id=? AND deleted_at IS NULL", [proposalId]);
  const proposal = rows.find((row) => row.id === proposalId && !row.deleted_at);
  if (!proposal) throw new Error("Proposta não encontrada (ou excluída).");
  const company = proposal.company_id;
  const [companyRow] = (await db.select<{ id: string; name: string; document?: string | null }[]>("SELECT * FROM companies WHERE id=?", [company])).filter((row) => row.id === company);
  const customer = proposal.customer_id ? (await db.select<Customer[]>("SELECT * FROM customers WHERE company_id=? AND id=?", [company, proposal.customer_id])).find((row) => row.id === proposal.customer_id) ?? null : null;
  const contact = proposal.contact_id ? (await db.select<Contact[]>("SELECT * FROM contacts WHERE company_id=? AND id=?", [company, proposal.contact_id])).find((row) => row.id === proposal.contact_id) ?? null : null;
  const items = (await db.select<ProposalItem[]>("SELECT * FROM proposal_items WHERE company_id=? AND proposal_id=? AND deleted_at IS NULL ORDER BY position", [company, proposalId]))
    .filter((row) => !row.deleted_at)
    .sort((a, b) => Number(a.position) - Number(b.position));
  return {
    companyName: companyRow?.name ?? "",
    companyDocument: companyRow?.document ?? null,
    number: formatSequence("proposals", proposal.number),
    title: proposal.title ?? null,
    version: Number(proposal.version ?? 1),
    status: proposal.status,
    issueDate: proposal.sent_at ?? proposal.created_at ?? null,
    validUntil: proposal.valid_until ?? null,
    customer: customer ? { name: customer.name, document: customer.document, email: customer.email, phone: customer.phone } : null,
    contactName: contact?.name ?? null,
    items: items.map((item) => ({
      description: item.description,
      unit: item.unit || "un",
      qty: Number(item.qty),
      unitPrice: Number(item.unit_price),
      discount: Number(item.discount ?? 0),
      total: Number(item.total),
    })),
    subtotal: Number(proposal.subtotal ?? 0),
    discount: Number(proposal.discount ?? 0),
    total: Number(proposal.value ?? 0),
    paymentTerms: proposal.payment_terms ?? null,
    notes: proposal.notes ?? null,
  };
}

const money = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const quantity = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });
/** "R$ 1.234,56" com espaço comum (o Intl usa espaço inseparável no "R$ "). */
export const brl = (value: number) => `${value < 0 ? "-" : ""}R$ ${money.format(Math.abs(value))}`;

const MARGIN = 48;
const RIGHT = A4.width - MARGIN;
const BOTTOM = 64;
const COLS = { num: MARGIN, desc: MARGIN + 22, descWidth: 196, qty: 316, unit: 322, price: 416, discount: 478, total: RIGHT };

/** Bytes do PDF da proposta. */
export function buildProposalPdf(doc: ProposalDocument): Uint8Array<ArrayBuffer> {
  const pdf = new PdfDocument({ title: `Proposta ${doc.number}${doc.title ? ` — ${doc.title}` : ""}`, author: doc.companyName });
  let page: PdfPage = pdf.addPage();
  let y = A4.height - MARGIN;

  const newPage = () => {
    page = pdf.addPage();
    y = A4.height - MARGIN;
    page.text(MARGIN, y - 10, `${doc.companyName} · Proposta ${doc.number}`, { size: 9, gray: 0.4 });
    y -= 28;
  };
  const ensure = (height: number) => {
    if (y - height < BOTTOM) newPage();
  };
  const paragraph = (label: string, text: string | null) => {
    if (!text?.trim()) return;
    const lines = wrapText(text.trim(), RIGHT - MARGIN, 9.5);
    ensure(18 + Math.min(lines.length, 3) * 12);
    page.text(MARGIN, y, label, { size: 9, bold: true, gray: 0.35 });
    y -= 13;
    for (const line of lines) {
      ensure(12);
      page.text(MARGIN, y, line, { size: 9.5 });
      y -= 12;
    }
    y -= 8;
  };

  // ---- Cabeçalho ----
  page.text(MARGIN, y - 14, doc.companyName || "Proposta comercial", { size: 16, bold: true });
  if (doc.companyDocument) page.text(MARGIN, y - 28, `CNPJ ${doc.companyDocument}`, { size: 9, gray: 0.4 });
  page.text(RIGHT, y - 10, "PROPOSTA COMERCIAL", { size: 9, bold: true, gray: 0.4, align: "right" });
  page.text(RIGHT, y - 26, doc.number, { size: 14, bold: true, align: "right" });
  const meta = [`Versão ${doc.version}`, doc.issueDate ? `Emitida em ${formatDay(doc.issueDate)}` : null, doc.validUntil ? `Válida até ${formatDay(doc.validUntil)}` : null].filter(Boolean) as string[];
  meta.forEach((text, index) => page.text(RIGHT, y - 40 - index * 11, text, { size: 9, gray: 0.3, align: "right" }));
  y -= 40 + meta.length * 11 + 6;
  page.line(MARGIN, y, RIGHT, y, 1, 0.6);
  y -= 22;

  if (doc.title) {
    for (const line of wrapText(doc.title, RIGHT - MARGIN, 13, true)) {
      page.text(MARGIN, y, line, { size: 13, bold: true });
      y -= 16;
    }
    y -= 4;
  }

  // ---- Cliente ----
  if (doc.customer) {
    page.text(MARGIN, y, "CLIENTE", { size: 8, bold: true, gray: 0.45 });
    y -= 13;
    page.text(MARGIN, y, doc.customer.name, { size: 11, bold: true });
    y -= 13;
    const details = [doc.customer.document, doc.customer.email, doc.customer.phone].filter((value): value is string => !!value?.trim());
    if (details.length) {
      page.text(MARGIN, y, details.join("  ·  "), { size: 9, gray: 0.3 });
      y -= 12;
    }
    if (doc.contactName) {
      page.text(MARGIN, y, `A/C: ${doc.contactName}`, { size: 9, gray: 0.3 });
      y -= 12;
    }
    y -= 10;
  }

  // ---- Itens ----
  const tableHeader = () => {
    page.rect(MARGIN, y - 5, RIGHT - MARGIN, 18, 0.92);
    const header = { size: 8.5, bold: true, gray: 0.25 };
    page.text(COLS.num, y, "#", header);
    page.text(COLS.desc, y, "Descrição", header);
    page.text(COLS.qty, y, "Qtd", { ...header, align: "right" });
    page.text(COLS.unit, y, "Un", header);
    page.text(COLS.price, y, "Preço unit.", { ...header, align: "right" });
    page.text(COLS.discount, y, "Desconto", { ...header, align: "right" });
    page.text(COLS.total, y, "Total", { ...header, align: "right" });
    y -= 20;
  };
  ensure(60);
  tableHeader();
  doc.items.forEach((item, index) => {
    const lines = wrapText(item.description, COLS.descWidth, 9);
    const height = lines.length * 11 + 6;
    if (y - height < BOTTOM) {
      newPage();
      tableHeader();
    }
    page.text(COLS.num, y, String(index + 1), { size: 9, gray: 0.4 });
    lines.forEach((line, lineIndex) => page.text(COLS.desc, y - lineIndex * 11, line, { size: 9 }));
    page.text(COLS.qty, y, quantity.format(item.qty), { size: 9, align: "right" });
    const unit = item.unit.length > 5 ? item.unit.slice(0, 5) : item.unit;
    page.text(COLS.unit, y, unit, { size: 9, gray: 0.35 });
    page.text(COLS.price, y, brl(item.unitPrice), { size: 9, align: "right" });
    page.text(COLS.discount, y, item.discount ? brl(item.discount) : "—", { size: 9, align: "right", gray: item.discount ? 0 : 0.5 });
    page.text(COLS.total, y, brl(item.total), { size: 9, bold: true, align: "right" });
    y -= height;
    page.line(MARGIN, y + 8, RIGHT, y + 8, 0.4, 0.85);
  });

  // ---- Totais ----
  const taxes = Math.round((doc.total - doc.subtotal + doc.discount) * 100) / 100;
  const totals: [string, string, boolean][] = [["Subtotal", brl(doc.subtotal), false]];
  if (doc.discount) totals.push(["Desconto", `- ${brl(doc.discount)}`, false]);
  if (taxes > 0) totals.push(["Impostos", brl(taxes), false]);
  totals.push(["Total", brl(doc.total), true]);
  ensure(totals.length * 15 + 16);
  y -= 6;
  const labelX = RIGHT - 170;
  for (const [label, value, strong] of totals) {
    page.text(labelX, y, label, { size: strong ? 11 : 9.5, bold: strong, gray: strong ? 0 : 0.3 });
    page.text(RIGHT, y, value, { size: strong ? 12 : 9.5, bold: strong, align: "right" });
    y -= strong ? 18 : 14;
  }
  y -= 14;

  // ---- Condições e observações ----
  paragraph("CONDIÇÕES DE PAGAMENTO", doc.paymentTerms);
  if (doc.validUntil) paragraph("VALIDADE", `Esta proposta é válida até ${formatDay(doc.validUntil)}.`);
  paragraph("OBSERVAÇÕES", doc.notes);

  // ---- Rodapé: "Página n de m" (só agora se sabe o total) ----
  const totalPages = pdf.pages.length;
  pdf.pages.forEach((item, index) => {
    item.line(MARGIN, 44, RIGHT, 44, 0.4, 0.8);
    item.text(MARGIN, 32, doc.companyName, { size: 8, gray: 0.45 });
    item.text(RIGHT, 32, `Página ${index + 1} de ${totalPages}`, { size: 8, gray: 0.45, align: "right" });
  });
  return pdf.toBytes();
}

/** Nome de arquivo sugerido: "Proposta PROP-00012 - Cliente.pdf" (sem caracteres que o sistema recusa). */
export function proposalFileName(doc: Pick<ProposalDocument, "number" | "customer">): string {
  const customer = doc.customer?.name ? ` - ${doc.customer.name}` : "";
  return `Proposta ${doc.number}${customer}`.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) + ".pdf";
}

/** PDF da proposta como Blob (application/pdf). Sem `db`, usa o banco do app. */
export async function renderProposalPdf(proposalId: string, options: { db?: DatabaseLike; companyId?: string | null } = {}): Promise<Blob> {
  const db = options.db ?? (await getDb());
  const doc = await loadProposalDocument(db, options.companyId ?? null, proposalId);
  const bytes = buildProposalPdf(doc);
  return new Blob([bytes], { type: "application/pdf" });
}
