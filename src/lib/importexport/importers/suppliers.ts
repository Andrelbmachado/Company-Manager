// Fornecedores: identifica por CNPJ/CPF, depois e-mail, depois nome.
import { z } from "zod";
import type { FieldDef } from "../registry";
import { integer, optionalText, requiredText } from "../schema";
import { ADDRESS_FIELDS, addressColumn, addressExport, defineTableEntity } from "../tableEntity";

const fields: FieldDef[] = [
  { key: "name", label: "Nome / razão social", kind: "text", required: true, aliases: ["nome", "fornecedor", "razão social", "razao social", "empresa"], example: "Distribuidora Central Ltda" },
  { key: "trade_name", label: "Nome fantasia", kind: "text", aliases: ["fantasia"], example: "Central Distribuidora" },
  { key: "document", label: "CNPJ/CPF", kind: "document", aliases: ["cnpj", "cpf", "documento", "cpf/cnpj"], example: "11.444.777/0001-61" },
  { key: "state_registration", label: "Inscrição estadual", kind: "text", aliases: ["ie", "insc estadual"], example: "" },
  { key: "email", label: "E-mail", kind: "email", aliases: ["email"], example: "vendas@central.com.br" },
  { key: "phone", label: "Telefone", kind: "phone", aliases: ["fone", "tel", "celular"], example: "(11) 4004-1234" },
  { key: "contact_name", label: "Contato", kind: "text", aliases: ["nome do contato", "vendedor", "representante"], example: "Carlos" },
  { key: "category", label: "Categoria", kind: "text", aliases: ["segmento", "ramo", "tipo de fornecimento"], example: "Móveis" },
  { key: "terms", label: "Condição de pagamento", kind: "text", aliases: ["prazo", "prazo de pagamento", "condições"], example: "28 dias" },
  { key: "rating", label: "Avaliação (1 a 5)", kind: "int", aliases: ["avaliação", "nota"], example: "4" },
  { key: "website", label: "Site", kind: "text", aliases: ["website", "url"], example: "https://central.com.br" },
  ...ADDRESS_FIELDS,
  { key: "notes", label: "Observações", kind: "text", aliases: ["observacoes", "obs", "notas"], example: "Entrega em 5 dias úteis" },
];

const schema = z.object({
  name: requiredText(200),
  trade_name: optionalText(200),
  document: optionalText(40),
  state_registration: optionalText(40),
  email: optionalText(200),
  phone: optionalText(40),
  contact_name: optionalText(120),
  category: optionalText(120),
  terms: optionalText(200),
  rating: integer(1, 5).optional(),
  website: optionalText(300),
  endereco_cep: optionalText(20),
  endereco_logradouro: optionalText(200),
  endereco_numero: optionalText(20),
  endereco_complemento: optionalText(120),
  endereco_bairro: optionalText(120),
  endereco_cidade: optionalText(120),
  endereco_uf: optionalText(2),
  notes: optionalText(4000),
});

export type SupplierImportRow = z.infer<typeof schema>;

export const entity = defineTableEntity<SupplierImportRow>({
  key: "suppliers",
  label: "Fornecedores",
  description: "Cadastro de fornecedores de compras e estoque.",
  resource: "suppliers",
  table: "suppliers",
  fields,
  schema,
  keys: [
    { name: "CNPJ/CPF", fromRow: (row) => row.document, fromDb: (row) => row.document },
    { name: "e-mail", fromRow: (row) => row.email, fromDb: (row) => row.email },
    { name: "nome", fromRow: (row) => row.name, fromDb: (row) => row.name },
  ],
  toColumns: (row, { existing }) => ({
    name: row.name,
    trade_name: row.trade_name,
    document: row.document,
    state_registration: row.state_registration,
    email: row.email,
    phone: row.phone,
    contact_name: row.contact_name,
    category: row.category,
    terms: row.terms,
    rating: row.rating,
    website: row.website,
    address_json: addressColumn(row, existing),
    notes: row.notes,
  }),
  exportExtra: addressExport,
});
