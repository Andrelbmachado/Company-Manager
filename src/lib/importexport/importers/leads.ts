// Leads (prospecção): identifica por e-mail, telefone, WhatsApp e, por último, nome.
import { z } from "zod";
import type { FieldDef } from "../registry";
import { decimal, integer, oneOf, optionalText, requiredText } from "../schema";
import { defineTableEntity } from "../tableEntity";

const STATUS = [
  { value: "novo", label: "Novo" },
  { value: "abordado", label: "Abordado" },
  { value: "interessado", label: "Interessado" },
  { value: "fechado", label: "Fechado" },
  { value: "qualificado", label: "Qualificado" },
  { value: "descartado", label: "Descartado" },
  { value: "convertido", label: "Convertido" },
] as const;

const fields: FieldDef[] = [
  { key: "name", label: "Nome", kind: "text", required: true, aliases: ["empresa", "estabelecimento", "nome do lead", "razão social"], example: "Clínica Veterinária Bicho Feliz" },
  { key: "email", label: "E-mail", kind: "email", aliases: ["email"], example: "contato@bichofeliz.com.br" },
  { key: "phone", label: "Telefone", kind: "phone", aliases: ["fone", "tel"], example: "(15) 3232-4545" },
  { key: "whatsapp", label: "WhatsApp", kind: "phone", aliases: ["celular", "zap", "whats"], example: "(15) 99876-5432" },
  { key: "category", label: "Categoria", kind: "text", aliases: ["segmento", "ramo"], example: "Veterinária" },
  { key: "business_type", label: "Tipo de negócio", kind: "text", aliases: ["tipo", "tipo de negocio"], example: "Clínica" },
  { key: "source", label: "Origem", kind: "text", aliases: ["fonte", "canal"], example: "Google Maps" },
  { key: "status", label: "Status", kind: "enum", options: [...STATUS], aliases: ["situação", "etapa"], example: "Novo" },
  { key: "score", label: "Pontuação", kind: "int", aliases: ["score", "nota interna"], example: "70", hint: "0 a 100" },
  { key: "google_rating", label: "Nota no Google", kind: "number", aliases: ["nota google", "avaliação google", "rating"], example: "4,7" },
  { key: "google_reviews", label: "Avaliações no Google", kind: "int", aliases: ["avaliações", "reviews", "número de avaliações"], example: "128" },
  { key: "address", label: "Endereço", kind: "text", aliases: ["endereco", "localização"], example: "Rua das Flores, 100 - Sorocaba/SP" },
  { key: "source_url", label: "Link", kind: "text", aliases: ["url", "site", "link do google"], example: "https://maps.google.com/?cid=123" },
  { key: "notes", label: "Observações", kind: "text", aliases: ["observacoes", "obs", "notas"], example: "Sem site próprio" },
];

const schema = z.object({
  name: requiredText(200),
  email: optionalText(200),
  phone: optionalText(40),
  whatsapp: optionalText(40),
  category: optionalText(120),
  business_type: optionalText(120),
  source: optionalText(120),
  status: oneOf(["novo", "abordado", "interessado", "fechado", "qualificado", "descartado", "convertido"]).optional(),
  score: integer(0, 100).optional(),
  google_rating: decimal(0, 5).optional(),
  google_reviews: integer(0).optional(),
  address: optionalText(300),
  source_url: optionalText(500),
  notes: optionalText(4000),
});

export type LeadImportRow = z.infer<typeof schema>;

export const entity = defineTableEntity<LeadImportRow>({
  key: "leads",
  label: "Leads",
  description: "Contatos em prospecção (antes de virar cliente).",
  resource: "leads",
  table: "leads",
  fields,
  schema,
  keys: [
    { name: "e-mail", fromRow: (row) => row.email, fromDb: (row) => row.email },
    { name: "telefone", fromRow: (row) => row.phone, fromDb: (row) => row.phone },
    { name: "WhatsApp", fromRow: (row) => row.whatsapp, fromDb: (row) => row.whatsapp },
    { name: "nome", fromRow: (row) => row.name, fromDb: (row) => row.name },
  ],
  toColumns: (row) => ({
    name: row.name,
    email: row.email,
    phone: row.phone,
    whatsapp: row.whatsapp,
    category: row.category,
    business_type: row.business_type,
    source: row.source,
    status: row.status,
    score: row.score,
    google_rating: row.google_rating,
    google_reviews: row.google_reviews,
    address: row.address,
    source_url: row.source_url,
    notes: row.notes,
  }),
});
