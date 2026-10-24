// Contas a pagar: identifica pelo nº do documento do fornecedor; sem documento, por descrição + vencimento + valor.
import { z } from "zod";
import { roundMoney } from "@/lib/money";
import { categoryRef, costCenterRef, supplierField, supplierRef } from "../refs";
import type { FieldDef } from "../registry";
import { isoDate, isoMonth, money, oneOf, optionalText, requiredText } from "../schema";
import { defineTableEntity } from "../tableEntity";
import { financeKeys, settlementStatus } from "./receivables";

const STATUS = [
  { value: "aberta", label: "Aberta" },
  { value: "aprovada", label: "Aprovada" },
  { value: "paga_parcial", label: "Paga em parte" },
  { value: "paga", label: "Paga" },
  { value: "vencida", label: "Vencida" },
  { value: "cancelada", label: "Cancelada" },
] as const;

const fields: FieldDef[] = [
  { key: "description", label: "Descrição", kind: "text", required: true, aliases: ["histórico", "historico", "conta", "despesa"], example: "Aluguel do escritório" },
  { key: "amount", label: "Valor", kind: "money", required: true, aliases: ["valor da conta", "valor total", "total"], example: "3.500,00" },
  { key: "due_date", label: "Vencimento", kind: "date", aliases: ["data de vencimento", "vence em"], example: "10/11/2026" },
  supplierField(),
  { key: "category", label: "Categoria", kind: "text", aliases: ["plano de contas", "categoria de despesa", "conta contábil"], example: "Aluguel", hint: "Código ou nome de uma categoria de despesa" },
  { key: "cost_center", label: "Centro de custo", kind: "text", aliases: ["centro de custos", "cc"], example: "Administrativo" },
  { key: "document_number", label: "Nº do documento", kind: "text", aliases: ["documento", "nota fiscal", "nf", "número da nota", "boleto"], example: "NF 1234" },
  { key: "issue_date", label: "Emissão", kind: "date", aliases: ["data de emissão"], example: "01/11/2026" },
  { key: "competence", label: "Competência", kind: "month", aliases: ["mês de competência", "referência"], example: "11/2026" },
  { key: "payment_method", label: "Forma de pagamento", kind: "text", aliases: ["forma", "meio de pagamento", "pagamento"], example: "Boleto" },
  { key: "status", label: "Situação", kind: "enum", options: [...STATUS], aliases: ["status"], example: "Aberta" },
  { key: "paid_at", label: "Data do pagamento", kind: "date", aliases: ["pago em", "data de pagamento"], example: "" },
  { key: "paid_amount", label: "Valor pago", kind: "money", aliases: ["pago"], example: "" },
  { key: "notes", label: "Observações", kind: "text", aliases: ["observacoes", "obs", "notas"], example: "" },
];

const schema = z
  .object({
    description: requiredText(300),
    amount: money({ positive: true }),
    due_date: isoDate().optional(),
    supplier: optionalText(200),
    category: optionalText(200),
    cost_center: optionalText(200),
    document_number: optionalText(60),
    issue_date: isoDate().optional(),
    competence: isoMonth().optional(),
    payment_method: optionalText(60),
    status: oneOf(["aberta", "aprovada", "paga_parcial", "paga", "vencida", "cancelada"]).optional(),
    paid_at: isoDate().optional(),
    paid_amount: money({ min: 0 }).optional(),
    notes: optionalText(4000),
  })
  .superRefine((row, context) => {
    if (row.paid_amount !== undefined && roundMoney(row.paid_amount) > roundMoney(row.amount)) {
      context.addIssue({ code: "custom", path: ["paid_amount"], message: "O valor pago é maior que o valor da conta" });
    }
  });

export type PayableImportRow = z.infer<typeof schema>;

export const entity = defineTableEntity<PayableImportRow>({
  key: "payables",
  label: "Contas a pagar",
  description: "Despesas e boletos a pagar, com fornecedor, categoria e vencimento.",
  resource: "payables",
  table: "payables",
  fields,
  schema,
  refs: [supplierRef(), categoryRef("despesa"), costCenterRef()],
  keys: financeKeys("supplier", "supplier_id"),
  toColumns: (row, { refs }) => {
    const settled = settlementStatus(row.amount, row.paid_amount, row.status, "paga");
    return {
      description: row.description,
      amount: row.amount,
      due_date: row.due_date,
      supplier_id: refs.supplier,
      category_id: refs.category,
      cost_center_id: refs.cost_center,
      document_number: row.document_number,
      issue_date: row.issue_date,
      competence: row.competence ?? row.due_date?.slice(0, 7),
      payment_method: row.payment_method,
      status: settled.status,
      paid_at: row.paid_at,
      paid_amount: settled.paid,
      notes: row.notes,
    };
  },
});
