// Contas a receber: identifica pelo nº do documento do cliente; sem documento, por descrição + vencimento + valor.
import { z } from "zod";
import { roundMoney } from "@/lib/money";
import { categoryRef, costCenterRef, customerField, customerRef } from "../refs";
import type { FieldDef } from "../registry";
import { isoDate, isoMonth, money, oneOf, optionalText, requiredText } from "../schema";
import { codeKey, defineTableEntity, type KeySpec } from "../tableEntity";
import type { Row } from "../write";

const STATUS = [
  { value: "aberta", label: "Aberta" },
  { value: "recebida_parcial", label: "Recebida em parte" },
  { value: "recebida", label: "Recebida" },
  { value: "vencida", label: "Vencida" },
  { value: "cancelada", label: "Cancelada" },
] as const;

/** Descrição como a tela Financeiro mostra: a coluna nova; contas antigas guardavam o texto em ref_id. */
const descriptionOf = (row: Row) => row.description ?? row.ref_id ?? "Recebimento manual";

/** Chaves das contas: documento do cliente/fornecedor; senão descrição + vencimento + valor. */
export function financeKeys<T extends { document_number?: string; description: string; due_date?: string; amount: number }>(
  refField: string,
  refColumn: string,
): KeySpec<T>[] {
  const money = (value: unknown) => (typeof value === "number" ? roundMoney(value).toFixed(2) : String(value ?? ""));
  return [
    {
      name: "nº do documento",
      compare: codeKey,
      fromRow: (row, refs) => (row.document_number ? `${refs[refField] ?? ""}|${row.document_number}` : null),
      fromDb: (row) => (row.document_number ? `${String(row[refColumn] ?? "")}|${String(row.document_number)}` : null),
    },
    {
      name: "descrição, vencimento e valor",
      fromRow: (row) => `${row.description}|${row.due_date ?? ""}|${money(row.amount)}`,
      // Só a data: contas antigas guardam o vencimento com hora ("2026-10-21T12:00:00.000Z").
      fromDb: (row) => `${String(descriptionOf(row) ?? "")}|${String(row.due_date ?? "").slice(0, 10)}|${money(row.amount)}`,
    },
  ];
}

/** Situação e valor baixado coerentes: "paga"/"recebida" sem valor = valor total; valor parcial = baixa parcial. */
export function settlementStatus(amount: number, settled: number | undefined, status: string | undefined, done: "paga" | "recebida") {
  const partial = done === "paga" ? "paga_parcial" : "recebida_parcial";
  if (status === done && settled === undefined) return { status, paid: amount };
  if (status || settled === undefined) return { status, paid: settled };
  if (roundMoney(settled) >= roundMoney(amount)) return { status: done, paid: settled };
  return { status: settled > 0 ? partial : undefined, paid: settled };
}

const fields: FieldDef[] = [
  { key: "description", label: "Descrição", kind: "text", required: true, aliases: ["histórico", "historico", "conta", "receita"], example: "Mensalidade de suporte" },
  { key: "amount", label: "Valor", kind: "money", required: true, aliases: ["valor da conta", "valor total", "total"], example: "1.200,00" },
  { key: "due_date", label: "Vencimento", kind: "date", aliases: ["data de vencimento", "vence em"], example: "15/11/2026" },
  customerField(),
  { key: "category", label: "Categoria", kind: "text", aliases: ["plano de contas", "categoria de receita", "conta contábil"], example: "Serviços", hint: "Código ou nome de uma categoria de receita" },
  { key: "cost_center", label: "Centro de custo", kind: "text", aliases: ["centro de custos", "cc"], example: "Comercial" },
  { key: "document_number", label: "Nº do documento", kind: "text", aliases: ["documento", "nota fiscal", "nf", "fatura", "boleto"], example: "FAT-0042" },
  { key: "issue_date", label: "Emissão", kind: "date", aliases: ["data de emissão"], example: "01/11/2026" },
  { key: "competence", label: "Competência", kind: "month", aliases: ["mês de competência", "referência"], example: "11/2026" },
  { key: "payment_method", label: "Forma de pagamento", kind: "text", aliases: ["forma", "meio de pagamento", "recebimento"], example: "PIX" },
  { key: "status", label: "Situação", kind: "enum", options: [...STATUS], aliases: ["status"], example: "Aberta" },
  { key: "received_at", label: "Data do recebimento", kind: "date", aliases: ["recebido em", "data de recebimento"], example: "" },
  { key: "received_amount", label: "Valor recebido", kind: "money", aliases: ["recebido"], example: "" },
  { key: "notes", label: "Observações", kind: "text", aliases: ["observacoes", "obs", "notas"], example: "" },
];

const schema = z
  .object({
    description: requiredText(300),
    amount: money({ positive: true }),
    due_date: isoDate().optional(),
    customer: optionalText(200),
    category: optionalText(200),
    cost_center: optionalText(200),
    document_number: optionalText(60),
    issue_date: isoDate().optional(),
    competence: isoMonth().optional(),
    payment_method: optionalText(60),
    status: oneOf(["aberta", "recebida_parcial", "recebida", "vencida", "cancelada"]).optional(),
    received_at: isoDate().optional(),
    received_amount: money({ min: 0 }).optional(),
    notes: optionalText(4000),
  })
  .superRefine((row, context) => {
    if (row.received_amount !== undefined && roundMoney(row.received_amount) > roundMoney(row.amount)) {
      context.addIssue({ code: "custom", path: ["received_amount"], message: "O valor recebido é maior que o valor da conta" });
    }
  });

export type ReceivableImportRow = z.infer<typeof schema>;

export const entity = defineTableEntity<ReceivableImportRow>({
  key: "receivables",
  label: "Contas a receber",
  description: "Valores a receber de clientes, com categoria e vencimento.",
  resource: "receivables",
  table: "receivables",
  fields,
  schema,
  refs: [customerRef(), categoryRef("receita"), costCenterRef()],
  keys: financeKeys("customer", "customer_id"),
  toColumns: (row, { refs }) => {
    const settled = settlementStatus(row.amount, row.received_amount, row.status, "recebida");
    return {
      description: row.description,
      amount: row.amount,
      due_date: row.due_date,
      customer_id: refs.customer,
      category_id: refs.category,
      cost_center_id: refs.cost_center,
      document_number: row.document_number,
      issue_date: row.issue_date,
      competence: row.competence ?? row.due_date?.slice(0, 7),
      payment_method: row.payment_method,
      status: settled.status,
      received_at: row.received_at,
      received_amount: settled.paid,
      notes: row.notes,
    };
  },
  exportExtra: (row) => ({ description: descriptionOf(row) }),
});
