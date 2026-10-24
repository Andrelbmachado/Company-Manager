// Chamados de atendimento: identifica pelo cliente + assunto. Chamado novo fica aberto por quem importou.
import { z } from "zod";
import { customerField, customerRef } from "../refs";
import type { FieldDef } from "../registry";
import { isoDate, oneOf, optionalText, requiredText } from "../schema";
import { defineTableEntity } from "../tableEntity";

const PRIORITY = [
  { value: "baixa", label: "Baixa" },
  { value: "media", label: "Média" },
  { value: "alta", label: "Alta" },
  { value: "urgente", label: "Urgente" },
] as const;

const STATUS = [
  { value: "aberto", label: "Aberto" },
  { value: "em_atendimento", label: "Em atendimento" },
  { value: "aguardando", label: "Aguardando" },
  { value: "resolvido", label: "Resolvido" },
  { value: "fechado", label: "Fechado" },
] as const;

const fields: FieldDef[] = [
  { key: "subject", label: "Assunto", kind: "text", required: true, aliases: ["título", "titulo", "chamado", "problema"], example: "Impressora não liga" },
  { key: "description", label: "Descrição", kind: "text", aliases: ["detalhes", "relato"], example: "Equipamento parou após queda de energia" },
  customerField({ example: "Padaria Pão Quente Ltda" }),
  { key: "priority", label: "Prioridade", kind: "enum", options: [...PRIORITY], aliases: ["urgência", "urgencia"], example: "Alta" },
  { key: "status", label: "Situação", kind: "enum", options: [...STATUS], aliases: ["status"], example: "Aberto" },
  { key: "channel", label: "Canal", kind: "text", aliases: ["origem", "meio"], example: "Telefone" },
  { key: "requester_area", label: "Área solicitante", kind: "text", aliases: ["área", "area", "setor"], example: "Financeiro" },
  { key: "sla_due_at", label: "Prazo (SLA)", kind: "date", aliases: ["prazo", "sla", "vencimento"], example: "30/11/2026" },
];

const schema = z.object({
  subject: requiredText(300),
  description: optionalText(4000),
  customer: optionalText(200),
  priority: oneOf(["baixa", "media", "alta", "urgente"]).optional(),
  status: oneOf(["aberto", "em_atendimento", "aguardando", "resolvido", "fechado"]).optional(),
  channel: optionalText(60),
  requester_area: optionalText(120),
  sla_due_at: isoDate().optional(),
});

export type TicketImportRow = z.infer<typeof schema>;

export const entity = defineTableEntity<TicketImportRow>({
  key: "tickets",
  label: "Chamados",
  description: "Chamados de suporte e atendimento.",
  resource: "tickets",
  table: "tickets",
  fields,
  schema,
  refs: [customerRef()],
  keys: [
    {
      name: "cliente e assunto",
      fromRow: (row, refs) => `${refs.customer ?? ""}|${row.subject}`,
      fromDb: (row) => `${String(row.customer_id ?? "")}|${String(row.subject ?? "")}`,
    },
  ],
  toColumns: (row, { refs }) => ({
    subject: row.subject,
    description: row.description,
    customer_id: refs.customer,
    priority: row.priority,
    status: row.status,
    channel: row.channel,
    requester_area: row.requester_area,
    sla_due_at: row.sla_due_at,
  }),
  insertDefaults: (_row, { userId }) => ({ opened_by: userId, channel: "planilha" }),
});
