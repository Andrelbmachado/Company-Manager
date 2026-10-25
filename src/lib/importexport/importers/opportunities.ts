// Oportunidades (funil): identifica pelo título dentro do mesmo cliente. A situação (aberta/ganha/perdida) vem da etapa.
import { z } from "zod";
import { customerField, customerRef } from "../refs";
import type { FieldDef } from "../registry";
import { integer, isoDate, money, oneOf, optionalText, requiredText } from "../schema";
import { defineTableEntity } from "../tableEntity";
import { sqliteNow } from "../write";

const STAGES = [
  { value: "novo", label: "Novo" },
  { value: "qualificacao", label: "Qualificação" },
  { value: "proposta", label: "Proposta" },
  { value: "negociacao", label: "Negociação" },
  { value: "ganho", label: "Ganho" },
  { value: "perdido", label: "Perdido" },
] as const;

const fields: FieldDef[] = [
  { key: "title", label: "Título", kind: "text", required: true, aliases: ["oportunidade", "negócio", "negocio", "nome", "descrição"], example: "Site institucional" },
  customerField(),
  { key: "value", label: "Valor", kind: "money", aliases: ["valor estimado", "valor do negócio", "montante"], example: "4.800,00" },
  { key: "stage", label: "Etapa", kind: "enum", options: [...STAGES], aliases: ["fase", "estágio", "status"], example: "Proposta" },
  { key: "probability", label: "Probabilidade (%)", kind: "int", aliases: ["probabilidade", "chance", "%"], example: "60", hint: "0 a 100" },
  { key: "expected_close_date", label: "Previsão de fechamento", kind: "date", aliases: ["previsão", "data prevista", "fechamento"], example: "30/11/2026" },
  { key: "source", label: "Origem", kind: "text", aliases: ["fonte", "canal"], example: "Indicação" },
  { key: "lost_reason", label: "Motivo da perda", kind: "text", aliases: ["motivo"], example: "" },
  { key: "notes", label: "Observações", kind: "text", aliases: ["observacoes", "obs", "notas"], example: "Retornar na segunda" },
];

const schema = z.object({
  title: requiredText(200),
  customer: optionalText(200),
  value: money({ min: 0 }).optional(),
  stage: oneOf(["novo", "qualificacao", "proposta", "negociacao", "ganho", "perdido"]).optional(),
  probability: integer(0, 100).optional(),
  expected_close_date: isoDate().optional(),
  source: optionalText(120),
  lost_reason: optionalText(300),
  notes: optionalText(4000),
});

export type OpportunityImportRow = z.infer<typeof schema>;

const statusOf = (stage: string | undefined) => (stage === "ganho" ? "won" : stage === "perdido" ? "lost" : stage ? "open" : undefined);

export const entity = defineTableEntity<OpportunityImportRow>({
  key: "opportunities",
  label: "Oportunidades",
  description: "Negócios em andamento no funil de vendas.",
  resource: "opportunities",
  table: "opportunities",
  fields,
  schema,
  refs: [customerRef()],
  keys: [{ name: "título no cliente", fromRow: (row, refs) => `${refs.customer ?? ""}|${row.title}`, fromDb: (row) => `${row.customer_id ?? ""}|${String(row.title ?? "")}` }],
  toColumns: (row, { refs, existing }) => {
    const status = statusOf(row.stage);
    // Data de fechamento só quando esta importação fecha a oportunidade (nova, ou que muda para ganha/perdida):
    // reimportar uma oportunidade já ganha não inventa a data de hoje (a planilha não traz essa data).
    const closing = (status === "won" || status === "lost") && existing?.status !== status;
    return {
      title: row.title,
      customer_id: refs.customer,
      value: row.value,
      stage: row.stage,
      status,
      probability: row.probability ?? (row.stage === "ganho" ? 100 : row.stage === "perdido" ? 0 : undefined),
      expected_close_date: row.expected_close_date,
      source: row.source,
      lost_reason: row.lost_reason,
      notes: row.notes,
      closed_at: closing ? sqliteNow() : undefined,
    };
  },
  insertDefaults: (_row, { userId }) => ({ owner_id: userId }),
});
