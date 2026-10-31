// TEMPORÁRIO (dados de exemplo): completa as colunas que os outros seeds deixaram vazias, para nenhuma tabela do modo
// demonstração ter "—" sobrando: fornecedores (nome fantasia, contato, categoria, avaliação, cidade, UF), contas a pagar e
// a receber (categoria, centro de custo, documento, forma de pagamento, conta prevista, competência, emissão, parcelas,
// observações) e observações da folha. Roda por último (ordem alfabética do nome do arquivo) e sem flag: só preenche
// coluna vazia de registro de exemplo, então rodar de novo não muda nada nem desfaz o que a pessoa editou.
import { getDb } from "@/lib/db/client";
import { exampleRows, type SeedRow } from "../seedUtils";

type Row = Record<string, unknown> & { id: string };

const empty = (value: unknown) => value === null || value === undefined || String(value).trim() === "";

/** [nome fantasia, contato, categoria, cidade, UF, observação] por posição do fornecedor. */
const SUPPLIER_DETAILS: [string, string, string, string, string, string][] = [
  ["NetPrime", "Rafael Moreira", "Redes e conectividade", "São Paulo", "SP", "Entrega em 48 h na capital."],
  ["InfraSafe", "Patrícia Lemos", "Equipamentos de segurança", "Barueri", "SP", "Garantia estendida de 24 meses."],
  ["ByteCenter", "Diego Fontana", "Informática", "Campinas", "SP", "Frete grátis acima de R$ 5 mil."],
  ["Cabos & Cia", "Sílvia Prado", "Cabos e acessórios", "Sorocaba", "SP", "Retirada no balcão disponível."],
  ["EnergiaPlus", "Marcos Teixeira", "Energia e nobreaks", "Guarulhos", "SP", "Assistência técnica própria."],
  ["Papelaria Central", "Juliana Reis", "Material de escritório", "Curitiba", "PR", "Pedido mínimo de R$ 300."],
  ["TecFrota", "André Lopes", "Manutenção de veículos", "Belo Horizonte", "MG", "Atende a frota em até 24 h."],
  ["Nuvem Sul", "Carla Dutra", "Software e licenças", "Porto Alegre", "RS", "Faturamento mensal por usuário."],
];
const SUPPLIER_TERMS = ["Pagamento em 28 dias", "Pagamento em 21 dias", "Pagamento em 35 dias", "À vista com 5% de desconto", "Pagamento em 30 dias"];

const PAYMENT_METHODS = ["boleto", "pix", "transferencia"];
const PAYABLE_NOTES = ["Conferido com a nota fiscal.", "Aprovado na reunião de compras.", "Pagar pela conta principal.", "Valor negociado com desconto.", "Recorrente todo mês."];
const RECEIVABLE_NOTES = ["Cliente pediu boleto por e-mail.", "Confirmar recebimento com o financeiro do cliente.", "Parcela do contrato anual.", "Enviar recibo após a baixa.", "Cliente pontual."];
const PAYROLL_NOTES = [
  "Reajuste de 6% em março.",
  "Adicional de periculosidade incluído.",
  "Promovido no último ciclo de avaliação.",
  "Bônus por meta no fim do semestre.",
  "Plano de saúde com dependentes.",
  "Ajuste de cargo previsto para janeiro.",
  "Vale-transporte substituído por auxílio combustível.",
];

function addDays(date: string, days: number): string {
  const value = new Date(`${date.slice(0, 10)}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** Só as colunas vazias de `row` que `values` preenche (as já preenchidas ficam como estão). */
function missing(row: Row, values: SeedRow): SeedRow {
  return Object.fromEntries(Object.entries(values).filter(([key, value]) => empty(row[key]) && !empty(value)));
}

async function update(table: string, companyId: string, id: string, values: SeedRow): Promise<void> {
  const fields = Object.keys(values);
  if (fields.length === 0) return;
  await (await getDb()).execute(`UPDATE ${table} SET ${fields.map((field) => `${field}=?`).join(", ")} WHERE company_id=? AND id=?`, [
    ...fields.map((field) => values[field]),
    companyId,
    id,
  ]);
}

async function completeSuppliers(companyId: string): Promise<void> {
  const suppliers = await exampleRows<Row>("suppliers", companyId);
  for (const [index, supplier] of suppliers.entries()) {
    const [tradeName, contact, category, city, uf, notes] = SUPPLIER_DETAILS[index % SUPPLIER_DETAILS.length];
    const slug = String(supplier.name).toLowerCase().normalize("NFD").replace(/[^a-z]/g, "").slice(0, 14) || `fornecedor${index + 1}`;
    let address: Record<string, unknown> = {};
    try {
      address = JSON.parse(String(supplier.address_json ?? "{}")) ?? {};
    } catch {
      address = {};
    }
    const values = missing(supplier, {
      trade_name: tradeName,
      contact_name: contact,
      category,
      rating: 3 + (index % 3),
      email: `contato@${slug}.com.br`,
      phone: `(11) 3${String(100 + index * 37).padStart(3, "0")}-${String(4000 + index * 211).slice(0, 4)}`,
      terms: SUPPLIER_TERMS[index % SUPPLIER_TERMS.length],
      notes,
    });
    if (empty(address.cidade) || empty(address.uf)) values.address_json = JSON.stringify({ ...address, cidade: address.cidade || city, uf: address.uf || uf });
    await update("suppliers", companyId, supplier.id, values);
  }
}

async function completeEntries(companyId: string, table: "payables" | "receivables"): Promise<void> {
  const payable = table === "payables";
  const [rows, categories, costCenters, banks] = await Promise.all([
    exampleRows<Row>(table, companyId),
    exampleRows<Row>("finance_categories", companyId),
    exampleRows<Row>("cost_centers", companyId),
    exampleRows<Row>("bank_accounts", companyId),
  ]);
  // Categorias-folha (sem filhas) do tipo certo: é o que o select da tela oferece.
  const parents = new Set(categories.map((category) => category.parent_id).filter(Boolean));
  const leaves = categories.filter((category) => category.kind === (payable ? "despesa" : "receita") && !parents.has(category.id));
  const notes = payable ? PAYABLE_NOTES : RECEIVABLE_NOTES;
  for (const [index, row] of rows.entries()) {
    const due = String(row.due_date ?? "").slice(0, 10);
    await update(table, companyId, row.id, missing(row, {
      category_id: leaves.length ? leaves[index % leaves.length].id : null,
      cost_center_id: costCenters.length ? costCenters[index % costCenters.length].id : null,
      document_number: `${payable ? "NF" : "FAT"}-${String(2400 + index * 7).padStart(6, "0")}`,
      payment_method: PAYMENT_METHODS[index % PAYMENT_METHODS.length],
      bank_account_id: banks.length ? banks[index % banks.length].id : null,
      competence: due ? due.slice(0, 7) : null,
      issue_date: due ? addDays(due, -10) : null,
      installment_number: 1,
      installment_count: 1,
      notes: notes[index % notes.length],
    }));
  }
}

async function completePayroll(companyId: string): Promise<void> {
  const rows = await exampleRows<Row>("employee_compensation", companyId);
  for (const [index, row] of rows.entries()) {
    if (index % 3 === 2) continue; // nem todo mundo tem observação
    await update("employee_compensation", companyId, row.id, missing(row, { notes: PAYROLL_NOTES[index % PAYROLL_NOTES.length] }));
  }
}

export async function seed(companyId: string): Promise<void> {
  await completeSuppliers(companyId);
  await completeEntries(companyId, "payables");
  await completeEntries(companyId, "receivables");
  await completePayroll(companyId);
}
