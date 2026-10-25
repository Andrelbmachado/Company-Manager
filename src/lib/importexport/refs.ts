// Referências usadas por vários importers: a planilha traz o documento, e-mail, código ou nome e o importer grava o id.
import type { FieldDef } from "./registry";
import type { RefSpec } from "./tableEntity";
import type { Row } from "./write";

const name = (row: Row) => String(row.name ?? "");

export const customerRef = (field = "customer"): RefSpec => ({
  field,
  column: "customer_id",
  table: "customers",
  label: "cliente",
  keys: (row) => [row.document, row.email, row.name, row.trade_name],
  display: name,
});

export const supplierRef = (field = "supplier"): RefSpec => ({
  field,
  column: "supplier_id",
  table: "suppliers",
  label: "fornecedor",
  keys: (row) => [row.document, row.email, row.name, row.trade_name],
  display: name,
});

/** Categoria do plano de contas pelo código ou nome, só do tipo certo (receita ou despesa). */
export const categoryRef = (kind: "receita" | "despesa", field = "category"): RefSpec => ({
  field,
  column: "category_id",
  table: "finance_categories",
  label: kind === "receita" ? "categoria de receita" : "categoria de despesa",
  keys: (row) => [row.code, row.name],
  display: name,
  filter: (row) => row.kind === kind,
});

export const costCenterRef = (field = "cost_center"): RefSpec => ({
  field,
  column: "cost_center_id",
  table: "cost_centers",
  label: "centro de custo",
  keys: (row) => [row.name],
  display: name,
});

export const locationRef = (field = "location"): RefSpec => ({
  field,
  column: "location_id",
  table: "stock_locations",
  label: "local de estoque",
  keys: (row) => [row.name],
  display: name,
});

export const customerField = (extra: Partial<FieldDef> = {}): FieldDef => ({
  key: "customer",
  label: "Cliente",
  kind: "text",
  aliases: ["cliente", "nome do cliente", "cnpj do cliente", "cpf/cnpj do cliente", "razão social do cliente"],
  example: "Padaria Pão Quente Ltda",
  hint: "CPF/CNPJ, e-mail ou nome de um cliente cadastrado",
  ...extra,
});

export const supplierField = (extra: Partial<FieldDef> = {}): FieldDef => ({
  key: "supplier",
  label: "Fornecedor",
  kind: "text",
  aliases: ["fornecedor", "nome do fornecedor", "cnpj do fornecedor"],
  example: "Distribuidora Central Ltda",
  hint: "CNPJ, e-mail ou nome de um fornecedor cadastrado",
  ...extra,
});
