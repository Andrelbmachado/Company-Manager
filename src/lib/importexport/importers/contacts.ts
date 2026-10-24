// Contatos dos clientes (CRM): identifica pelo e-mail, depois pelo nome dentro do mesmo cliente.
import { z } from "zod";
import { customerField, customerRef } from "../refs";
import type { FieldDef } from "../registry";
import { bool, optionalText, requiredText } from "../schema";
import { defineTableEntity, emailKey } from "../tableEntity";

const fields: FieldDef[] = [
  { key: "name", label: "Nome", kind: "text", required: true, aliases: ["nome do contato", "contato", "nome completo"], example: "Maria Oliveira" },
  customerField(),
  { key: "role", label: "Cargo", kind: "text", aliases: ["função", "funcao", "cargo/função"], example: "Compras" },
  { key: "email", label: "E-mail", kind: "email", aliases: ["email"], example: "maria@paoquente.com.br" },
  { key: "phone", label: "Telefone", kind: "phone", aliases: ["fone", "tel", "telefone fixo"], example: "(11) 3020-1188" },
  { key: "whatsapp", label: "WhatsApp", kind: "phone", aliases: ["celular", "zap", "whats"], example: "(11) 99999-8888" },
  { key: "is_primary", label: "Contato principal", kind: "bool", aliases: ["principal"], example: "Sim" },
  { key: "notes", label: "Observações", kind: "text", aliases: ["observacoes", "obs", "notas"], example: "Prefere WhatsApp" },
];

const schema = z.object({
  name: requiredText(200),
  customer: optionalText(200),
  role: optionalText(120),
  email: optionalText(200),
  phone: optionalText(40),
  whatsapp: optionalText(40),
  is_primary: bool().optional(),
  notes: optionalText(4000),
});

export type ContactImportRow = z.infer<typeof schema>;

export const entity = defineTableEntity<ContactImportRow>({
  key: "contacts",
  label: "Contatos",
  description: "Pessoas de contato dos clientes (cargo, e-mail, telefone).",
  resource: "customers",
  table: "contacts",
  fields,
  schema,
  refs: [customerRef()],
  keys: [
    { name: "e-mail", fromRow: (row) => row.email, fromDb: (row) => row.email, compare: emailKey },
    { name: "nome no cliente", fromRow: (row, refs) => `${refs.customer ?? ""}|${row.name}`, fromDb: (row) => `${row.customer_id ?? ""}|${String(row.name ?? "")}` },
  ],
  toColumns: (row, { refs }) => ({
    name: row.name,
    customer_id: refs.customer,
    role: row.role,
    email: row.email,
    phone: row.phone,
    whatsapp: row.whatsapp,
    is_primary: row.is_primary === undefined ? undefined : row.is_primary ? 1 : 0,
    notes: row.notes,
  }),
});
