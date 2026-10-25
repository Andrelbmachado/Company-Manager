// Catálogo de produtos e serviços: identifica pelo SKU (sem diferenciar maiúsculas), depois pelo nome.
import { z } from "zod";
import { onlyDigits } from "../normalize";
import type { FieldDef } from "../registry";
import { bool, decimal, money, oneOf, optionalText, requiredText } from "../schema";
import { codeKey, defineTableEntity } from "../tableEntity";

const fields: FieldDef[] = [
  { key: "sku", label: "Código (SKU)", kind: "text", aliases: ["sku", "código", "codigo", "cód", "referência", "ref"], example: "CAD-001" },
  { key: "name", label: "Nome", kind: "text", required: true, aliases: ["produto", "serviço", "descrição", "nome do produto"], example: "Cadeira de escritório" },
  {
    key: "kind",
    label: "Tipo",
    kind: "enum",
    options: [
      { value: "produto", label: "Produto" },
      { value: "servico", label: "Serviço" },
    ],
    aliases: ["produto ou serviço"],
    example: "Produto",
  },
  { key: "description", label: "Descrição", kind: "text", aliases: ["detalhes", "descrição completa"], example: "Cadeira giratória com apoio de braço" },
  { key: "category", label: "Categoria", kind: "text", aliases: ["grupo", "família", "linha"], example: "Móveis" },
  { key: "unit", label: "Unidade", kind: "text", aliases: ["un", "unid", "unidade de medida"], example: "un" },
  { key: "price", label: "Preço de venda", kind: "money", aliases: ["preço", "preco", "valor", "valor de venda"], example: "899,90" },
  { key: "cost", label: "Custo", kind: "money", aliases: ["preço de custo", "valor de custo"], example: "520,00" },
  { key: "tax_rate", label: "Imposto (%)", kind: "number", aliases: ["imposto", "alíquota", "aliquota"], example: "18" },
  { key: "barcode", label: "Código de barras", kind: "text", aliases: ["ean", "gtin", "código de barras"], example: "7891234567895" },
  { key: "ncm", label: "NCM", kind: "text", aliases: [], example: "9401.30.10", hint: "8 dígitos" },
  { key: "service_code", label: "Código de serviço", kind: "text", aliases: ["código do serviço", "lc 116"], example: "" },
  { key: "active", label: "Ativo", kind: "bool", aliases: ["situação", "ativo?"], example: "Sim" },
];

const schema = z.object({
  sku: optionalText(60),
  name: requiredText(200),
  kind: oneOf(["produto", "servico"]).optional(),
  description: optionalText(2000),
  category: optionalText(120),
  unit: optionalText(20),
  price: money({ min: 0 }).optional(),
  cost: money({ min: 0 }).optional(),
  tax_rate: decimal(0, 100).optional(),
  barcode: optionalText(60),
  ncm: z
    .string()
    .transform(onlyDigits)
    .refine((value) => value.length === 8, "NCM: use 8 dígitos")
    .optional(),
  service_code: optionalText(40),
  active: bool().optional(),
});

export type ProductImportRow = z.infer<typeof schema>;

export const entity = defineTableEntity<ProductImportRow>({
  key: "products",
  label: "Produtos e serviços",
  description: "Catálogo com preço, custo, unidade e impostos.",
  resource: "products",
  table: "products",
  fields,
  schema,
  keys: [
    { name: "SKU", fromRow: (row) => row.sku, fromDb: (row) => row.sku, compare: codeKey },
    { name: "nome", fromRow: (row) => row.name, fromDb: (row) => row.name },
  ],
  toColumns: (row) => ({
    sku: row.sku,
    name: row.name,
    kind: row.kind,
    description: row.description,
    category: row.category,
    unit: row.unit,
    price: row.price,
    cost: row.cost,
    tax_rate: row.tax_rate,
    barcode: row.barcode,
    ncm: row.ncm,
    service_code: row.service_code,
    active: row.active === undefined ? undefined : row.active ? 1 : 0,
  }),
});
