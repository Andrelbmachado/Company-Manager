// TEMPORÁRIO (dados de exemplo): CRM — tags, contato principal de cada cliente, atividades (atrasadas, futuras e
// feitas), numeração das propostas antigas, propostas novas com itens do catálogo e visões salvas.
// Precisa de clientes; sem eles não grava nada (nem a flag) e tenta de novo no próximo login.
import { getDb } from "@/lib/db/client";
import { nextSequenceNumber } from "@/lib/db/sequence";
import { lineTotal, orderTotals } from "@/lib/money";
import { day, hasSeedFlag, insertRows, memberFor, membersByRole, selectRows, setSeedFlag, ts, type SeedRow } from "../seedUtils";

const AREA = "crm";

interface CustomerRow {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
}
interface ContactRow {
  id: string;
  customer_id?: string | null;
  is_primary?: number | boolean | string | null;
}
interface OpportunityRow {
  id: string;
  customer_id?: string | null;
  title: string;
  status?: string | null;
}
interface ProposalRow {
  id: string;
  opportunity_id?: string | null;
  number?: number | null;
  created_at?: string | null;
}
interface ProductRow {
  id: string;
  sku?: string | null;
  name: string;
  unit?: string | null;
  price: number;
}

const TAGS: [name: string, color: string][] = [
  ["Cliente-chave", "success"],
  ["Contrato ativo", "info"],
  ["Inadimplente", "danger"],
  ["Prospect quente", "warning"],
  ["Indicação", "violet"],
];

const PRIMARY_CONTACTS = ["Renata Campos", "Diego Martins", "Patrícia Nunes", "Gustavo Ferreira", "Aline Rocha", "Tiago Barros"];

/** Propostas novas: [título, índice do cliente, status, validade em dias, [SKU, qtd, desconto em R$][]]. */
const NEW_PROPOSALS: [string, number, "rascunho" | "enviada" | "aceita", number, [string, number, number][]][] = [
  ["Rede e Wi-Fi da nova filial", 0, "enviada", 12, [["SW-GER-24", 2, 0], ["AP-WIFI6", 6, 300], ["SRV-PONTO", 24, 0]]],
  ["Renovação de nobreaks e monitores", 3, "rascunho", 20, [["NOB-1200", 4, 0], ["MON-24FHD", 8, 400], ["SRV-VISITA", 1, 0]]],
  ["Firewall e suporte mensal", 1, "aceita", 5, [["SRV-FIREWALL", 1, 0], ["SRV-SUP-MENSAL", 12, 1800]]],
];

export async function seed(companyId: string): Promise<void> {
  if (await hasSeedFlag(AREA, companyId)) return;

  const customers = await selectRows<CustomerRow>("customers", companyId);
  if (customers.length === 0) return;

  const db = await getDb();
  const members = await membersByRole(companyId);
  const seller = memberFor(members, "comercial", "gerente", "ceo", "admin");
  const service = memberFor(members, "atendimento", "comercial", "ceo", "admin");
  const at = (index: number) => customers[index % customers.length];

  // ---- Tags ----------------------------------------------------------------
  await insertRows("tags", companyId, TAGS.map(([name, color], index) => ({ id: `dev-crm-tag-${index + 1}`, name, color, entity_type: "customer" })));
  const tagged: [tag: number, customer: number][] = [[1, 0], [2, 0], [1, 1], [2, 2], [3, 4], [4, 6], [5, 7]];
  const tagRows = new Map<string, SeedRow>();
  for (const [tag, customer] of tagged) {
    const customerId = at(customer).id;
    tagRows.set(`dev-crm-etag-${tag}-${customerId}`, { id: `dev-crm-etag-${tag}-${customerId}`, tag_id: `dev-crm-tag-${tag}`, entity_type: "customer", entity_id: customerId, created_by: seller });
  }
  await insertRows("entity_tags", companyId, [...tagRows.values()]);

  // ---- Contato principal: marca o primeiro contato de cada cliente e cria um para quem não tem ---------------
  const contacts = await selectRows<ContactRow>("contacts", companyId);
  const firstContact = new Map<string, string>();
  for (const contact of contacts) if (contact.customer_id && !firstContact.has(contact.customer_id)) firstContact.set(contact.customer_id, contact.id);
  for (const contactId of firstContact.values()) {
    await db.execute("UPDATE contacts SET is_primary=? WHERE company_id=? AND id=? AND is_primary=?", [1, companyId, contactId, 0]);
  }
  const newContacts: SeedRow[] = customers
    .filter((customer) => !firstContact.has(customer.id))
    .map((customer, index) => {
      const name = PRIMARY_CONTACTS[index % PRIMARY_CONTACTS.length];
      return {
        id: `dev-crm-contact-${customer.id}`,
        customer_id: customer.id,
        name,
        email: customer.email ?? null,
        phone: customer.phone ?? null,
        whatsapp: customer.phone ?? null,
        role: "Responsável",
        is_primary: 1,
      };
    });
  await insertRows("contacts", companyId, newContacts);
  for (const contact of newContacts) firstContact.set(String(contact.customer_id), String(contact.id));
  const contactOf = (customerId: string) => firstContact.get(customerId) ?? null;

  // ---- Atividades: atrasadas, para os próximos dias e já feitas ---------------------------------------------
  const opportunities = await selectRows<OpportunityRow>("opportunities", companyId);
  const openOpps = opportunities.filter((opp) => opp.customer_id && (opp.status ?? "open") === "open");
  type ActivitySeed = [kind: string, subject: string, body: string, due: number | null, done: number | null, outcome: string | null, owner: string | null];
  const activities: ActivitySeed[] = [
    ["ligacao", "Retornar sobre a proposta", "Cliente pediu para ligar depois da reunião de diretoria.", -2, null, null, seller],
    ["reuniao", "Visita para levantamento da rede", "Levar o checklist de infraestrutura e medir os pontos.", 2, null, null, seller],
    ["email", "Enviar catálogo de Wi-Fi 6", "Mandar o comparativo dos access points com preço de tabela.", 0, null, null, seller],
    ["tarefa", "Cadastrar o contato do financeiro", "Pedir nome e e-mail de quem aprova as compras.", 5, null, null, service],
    ["ligacao", "Pesquisa de satisfação", "Ligar depois do atendimento da semana passada.", -6, -5, "Cliente satisfeito; pediu orçamento de câmeras.", service],
    ["reuniao", "Apresentação da empresa", "Primeira reunião com a diretoria.", -15, -15, "Interesse em contrato de suporte mensal.", seller],
    ["nota", "Preferência de contato", "Prefere WhatsApp e reuniões às terças.", null, -20, null, seller],
    ["email", "Proposta enviada", "Proposta enviada por e-mail com validade de 15 dias.", -9, -9, "Recebida; aguardando aprovação.", seller],
    ["tarefa", "Atualizar dados cadastrais", "Conferir CNPJ e endereço de entrega.", -1, null, null, service],
    ["ligacao", "Negociar condição de pagamento", "Cliente quer parcelar em 3 vezes.", 1, null, null, seller],
  ];
  await insertRows("crm_activities", companyId, activities.map(([kind, subject, body, due, done, outcome, owner], index) => {
    const opp = index % 3 === 1 && openOpps.length > 0 ? openOpps[index % openOpps.length] : null;
    const customerId = opp?.customer_id ?? at(index).id;
    return {
      id: `dev-crm-activity-${index + 1}`,
      entity_type: opp ? "opportunity" : "customer",
      entity_id: opp ? opp.id : customerId,
      customer_id: customerId,
      contact_id: contactOf(customerId),
      kind,
      subject,
      body,
      due_at: due == null ? null : ts(due, 10 + (index % 6)),
      done_at: done == null ? null : ts(done, 11 + (index % 5)),
      outcome,
      user_id: owner,
      created_by: owner,
      created_at: ts(Math.min(due ?? 0, done ?? 0, 0) - 3),
    };
  }));

  // ---- Propostas: as antigas ganham número, título e cliente; depois as novas, com itens -------------------
  const proposals = await selectRows<ProposalRow>("proposals", companyId);
  const oppById = new Map(opportunities.map((opp) => [opp.id, opp]));
  const unnumbered = proposals.filter((proposal) => proposal.number == null).sort((a, b) => String(a.created_at ?? a.id).localeCompare(String(b.created_at ?? b.id)));
  for (const proposal of unnumbered) {
    const opp = proposal.opportunity_id ? oppById.get(proposal.opportunity_id) : undefined;
    const number = await nextSequenceNumber(db, "proposals", companyId);
    await db.execute("UPDATE proposals SET number=?, title=?, customer_id=? WHERE company_id=? AND id=? AND number IS NULL", [
      number,
      opp?.title ?? "Proposta comercial",
      opp?.customer_id ?? null,
      companyId,
      proposal.id,
    ]);
  }

  const products = await selectRows<ProductRow>("products", companyId);
  const bySku = new Map(products.filter((product) => product.sku).map((product) => [String(product.sku).toUpperCase(), product]));
  for (const [index, [title, customerIndex, status, validDays, lines]] of NEW_PROPOSALS.entries()) {
    const id = `dev-crm-proposal-${index + 1}`;
    if (proposals.some((proposal) => proposal.id === id)) continue;
    const items = lines.flatMap(([sku, qty, discount]) => {
      const product = bySku.get(sku);
      return product ? [{ product, qty, discount }] : [];
    });
    if (items.length === 0) continue;
    const customer = at(customerIndex);
    const opp = openOpps.find((item) => item.customer_id === customer.id) ?? null;
    const totals = orderTotals(items.map(({ product, qty, discount }) => ({ qty, unit_price: product.price, discount })));
    const sentDay = -(validDays % 7) - 2;
    await insertRows("proposals", companyId, [{
      id,
      number: await nextSequenceNumber(db, "proposals", companyId),
      title,
      customer_id: customer.id,
      contact_id: contactOf(customer.id),
      opportunity_id: opp?.id ?? null,
      value: totals.total,
      subtotal: totals.subtotal,
      discount: totals.discount,
      items_json: "[]",
      version: 1,
      status,
      valid_until: day(validDays),
      payment_terms: status === "aceita" ? "Mensal, boleto em 10 dias" : "30/60/90 dias no boleto",
      notes: "Valores válidos até a data de validade. Instalação inclusa onde indicado.",
      sent_at: status === "rascunho" ? null : ts(sentDay),
      decided_at: status === "aceita" ? ts(sentDay + 1) : null,
      created_by: seller,
      created_at: ts(sentDay - 1),
    }]);
    await insertRows("proposal_items", companyId, items.map(({ product, qty, discount }, position) => ({
      id: `${id}-item-${position + 1}`,
      proposal_id: id,
      product_id: product.id,
      description: product.name,
      unit: product.unit ?? "un",
      qty,
      unit_price: product.price,
      discount,
      tax_rate: 0,
      total: lineTotal(qty, product.price, discount),
      position: position + 1,
    })));
  }

  // ---- Visões salvas ------------------------------------------------------------------------------------------
  await insertRows("saved_views", companyId, [
    { id: "dev-crm-view-1", user_id: seller, entity_type: "customer", name: "Clientes de saúde", filters_json: JSON.stringify({ segment: "Saúde" }), is_default: 0 },
    { id: "dev-crm-view-2", user_id: seller, entity_type: "opportunity", name: "Minhas oportunidades abertas", filters_json: JSON.stringify({ status: "open", owner: "me" }), is_default: 1 },
  ]);

  await setSeedFlag(AREA, companyId);
}
