// Clientes (CRM): identifica por CPF/CNPJ, depois e-mail, depois nome.
import { z } from "zod";
import { documentKey } from "../normalize";
import { money, oneOf, optionalText, requiredText } from "../schema";
import { ADDRESS_FIELDS, addressColumn, addressExport, defineTableEntity, emailKey } from "../tableEntity";
import type { FieldDef } from "../registry";

const fields: FieldDef[] = [
  { key: "name", label: "Nome / razão social", kind: "text", required: true, aliases: ["nome", "razão social", "razao social", "cliente", "empresa", "nome do cliente", "nome completo"], example: "Padaria Pão Quente Ltda" },
  { key: "trade_name", label: "Nome fantasia", kind: "text", aliases: ["fantasia"], example: "Pão Quente" },
  {
    key: "type",
    label: "Tipo de pessoa",
    kind: "enum",
    options: [
      { value: "PJ", label: "Pessoa jurídica" },
      { value: "PF", label: "Pessoa física" },
    ],
    aliases: ["tipo", "pessoa", "pf/pj", "tipo pessoa"],
    example: "Pessoa jurídica",
    hint: "Vazio: vem do tamanho do CPF/CNPJ",
  },
  { key: "document", label: "CPF/CNPJ", kind: "document", aliases: ["cnpj", "cpf", "documento", "cnpj/cpf", "cpf ou cnpj"], example: "11.222.333/0001-81" },
  { key: "state_registration", label: "Inscrição estadual", kind: "text", aliases: ["ie", "insc estadual"], example: "110.042.490.114" },
  { key: "email", label: "E-mail", kind: "email", aliases: ["email", "correio eletrônico"], example: "contato@paoquente.com.br" },
  { key: "phone", label: "Telefone", kind: "phone", aliases: ["fone", "celular", "tel", "whatsapp", "telefone principal"], example: "(11) 3020-1188" },
  { key: "website", label: "Site", kind: "text", aliases: ["website", "url", "página"], example: "https://paoquente.com.br" },
  { key: "segment", label: "Segmento", kind: "text", aliases: ["ramo", "setor", "ramo de atividade"], example: "Alimentação" },
  { key: "source", label: "Origem", kind: "text", aliases: ["fonte", "canal", "como conheceu"], example: "Indicação" },
  {
    key: "status",
    label: "Situação",
    kind: "enum",
    options: [
      { value: "active", label: "Ativo" },
      { value: "inactive", label: "Inativo" },
    ],
    aliases: ["status"],
    example: "Ativo",
  },
  { key: "payment_terms", label: "Condição de pagamento", kind: "text", aliases: ["prazo de pagamento", "prazo", "condições de pagamento"], example: "30/60 dias" },
  { key: "credit_limit", label: "Limite de crédito", kind: "money", aliases: ["limite", "crédito"], example: "5.000,00" },
  ...ADDRESS_FIELDS,
  { key: "notes", label: "Observações", kind: "text", aliases: ["observacoes", "obs", "notas", "anotações"], example: "Entrega pela manhã" },
];

const schema = z.object({
  name: requiredText(200),
  trade_name: optionalText(200),
  type: oneOf(["PJ", "PF"]).optional(),
  document: optionalText(40),
  state_registration: optionalText(40),
  email: optionalText(200),
  phone: optionalText(40),
  website: optionalText(300),
  segment: optionalText(120),
  source: optionalText(120),
  status: oneOf(["active", "inactive"]).optional(),
  payment_terms: optionalText(200),
  credit_limit: money({ min: 0 }).optional(),
  endereco_cep: optionalText(20),
  endereco_logradouro: optionalText(200),
  endereco_numero: optionalText(20),
  endereco_complemento: optionalText(120),
  endereco_bairro: optionalText(120),
  endereco_cidade: optionalText(120),
  endereco_uf: optionalText(2),
  notes: optionalText(4000),
});

export type CustomerImportRow = z.infer<typeof schema>;

/** CPF tem 11 dígitos; CNPJ (numérico ou alfanumérico), 14 caracteres. */
export function personType(document: string | undefined | null): "PF" | "PJ" | undefined {
  const key = documentKey(document);
  if (!key) return undefined;
  return key.length === 11 ? "PF" : "PJ";
}

export const entity = defineTableEntity<CustomerImportRow>({
  key: "customers",
  label: "Clientes",
  description: "Cadastro de clientes do CRM (pessoa física ou jurídica).",
  resource: "customers",
  table: "customers",
  fields,
  schema,
  keys: [
    { name: "CPF/CNPJ", fromRow: (row) => row.document, fromDb: (row) => row.document },
    { name: "e-mail", fromRow: (row) => row.email, fromDb: (row) => row.email, compare: emailKey },
    { name: "nome", fromRow: (row) => row.name, fromDb: (row) => row.name },
  ],
  validate: (row) => {
    const fromDocument = personType(row.document);
    if (row.type && fromDocument && row.type !== fromDocument) {
      return { field: "type", message: `O tipo de pessoa não combina com o documento (${fromDocument === "PF" ? "CPF" : "CNPJ"})` };
    }
    return null;
  },
  toColumns: (row, { existing }) => ({
    name: row.name,
    trade_name: row.trade_name,
    type: row.type ?? personType(row.document),
    document: row.document,
    state_registration: row.state_registration,
    email: row.email,
    phone: row.phone,
    website: row.website,
    segment: row.segment,
    source: row.source,
    status: row.status,
    payment_terms: row.payment_terms,
    credit_limit: row.credit_limit,
    address_json: addressColumn(row, existing),
    notes: row.notes,
  }),
  exportExtra: addressExport,
});
