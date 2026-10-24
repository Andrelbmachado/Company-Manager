// Projetos: identifica pelo nome. Projeto novo fica com quem importou como responsável.
import { z } from "zod";
import { customerField, customerRef } from "../refs";
import type { FieldDef } from "../registry";
import { isoDate, money, oneOf, optionalText, requiredText } from "../schema";
import { defineTableEntity } from "../tableEntity";

const STATUS = [
  { value: "planejado", label: "Planejado" },
  { value: "andamento", label: "Em andamento" },
  { value: "pausado", label: "Pausado" },
  { value: "concluido", label: "Concluído" },
  { value: "cancelado", label: "Cancelado" },
] as const;

const fields: FieldDef[] = [
  { key: "name", label: "Projeto", kind: "text", required: true, aliases: ["nome", "nome do projeto", "título"], example: "Implantação do ERP" },
  customerField(),
  { key: "status", label: "Situação", kind: "enum", options: [...STATUS], aliases: ["status", "fase"], example: "Em andamento" },
  { key: "budget", label: "Orçamento", kind: "money", aliases: ["valor", "verba", "orçamento previsto"], example: "25.000,00" },
  { key: "start_date", label: "Início", kind: "date", aliases: ["data de início", "inicio"], example: "01/11/2026" },
  { key: "end_date", label: "Término", kind: "date", aliases: ["data de término", "fim", "prazo", "entrega"], example: "31/03/2027" },
];

const schema = z
  .object({
    name: requiredText(200),
    customer: optionalText(200),
    status: oneOf(["planejado", "andamento", "pausado", "concluido", "cancelado"]).optional(),
    budget: money({ min: 0 }).optional(),
    start_date: isoDate().optional(),
    end_date: isoDate().optional(),
  })
  .superRefine((row, context) => {
    if (row.start_date && row.end_date && row.end_date < row.start_date) {
      context.addIssue({ code: "custom", path: ["end_date"], message: "O término é antes do início" });
    }
  });

export type ProjectImportRow = z.infer<typeof schema>;

export const entity = defineTableEntity<ProjectImportRow>({
  key: "projects",
  label: "Projetos",
  description: "Projetos com cliente, orçamento e datas.",
  resource: "projects",
  table: "projects",
  fields,
  schema,
  refs: [customerRef()],
  keys: [{ name: "nome", fromRow: (row) => row.name, fromDb: (row) => row.name }],
  toColumns: (row, { refs }) => ({
    name: row.name,
    customer_id: refs.customer,
    status: row.status,
    budget: row.budget,
    start_date: row.start_date,
    end_date: row.end_date,
  }),
  insertDefaults: (_row, { userId }) => ({ owner_id: userId }),
});
