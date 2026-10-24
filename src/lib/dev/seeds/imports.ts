// TEMPORÁRIO (dados de exemplo): histórico de importações de planilha — uma concluída, uma com erros (relatório por
// linha) e uma simulação. Só o histórico: nenhuma linha é importada de verdade aqui.
import { hasSeedFlag, insertRows, memberFor, membersByRole, setSeedFlag, ts } from "../seedUtils";

const AREA = "imports";

export async function seed(companyId: string): Promise<void> {
  if (await hasSeedFlag(AREA, companyId)) return;

  const members = await membersByRole(companyId);
  const commercial = memberFor(members, "comercial", "admin", "ceo");
  const stock = memberFor(members, "estoquista", "admin", "ceo");
  const finance = memberFor(members, "financeiro", "admin", "ceo");

  await insertRows("import_batches", companyId, [
    {
      id: "dev-imports-batch-1",
      entity: "customers",
      filename: "clientes-2026.xlsx",
      sheet_name: "Clientes",
      format: "xlsx",
      mode: "skip-errors",
      dry_run: 0,
      status: "concluida",
      rows_total: 12,
      rows_ok: 12,
      rows_err: 0,
      inserted: 10,
      updated: 2,
      errors_json: "[]",
      mapping_json: JSON.stringify({ "Razão social": "name", CNPJ: "document", "E-mail": "email", Telefone: "phone", Segmento: "segment" }),
      created_by: commercial,
      created_at: ts(-40, 14),
      finished_at: ts(-40, 14),
    },
    {
      id: "dev-imports-batch-2",
      entity: "products",
      filename: "produtos-fornecedor.csv",
      sheet_name: null,
      format: "csv",
      mode: "skip-errors",
      dry_run: 0,
      status: "com_erros",
      rows_total: 20,
      rows_ok: 17,
      rows_err: 3,
      inserted: 15,
      updated: 2,
      errors_json: JSON.stringify([
        { row: 4, field: "sku", message: "SKU repetido na planilha (SW-GER-24)." },
        { row: 11, field: "price", message: "Preço inválido: \"R$ 1.2O0,00\"." },
        { row: 17, field: "name", message: "Nome é obrigatório." },
      ]),
      mapping_json: JSON.stringify({ Código: "sku", Descrição: "name", Tipo: "kind", Unidade: "unit", "Preço de venda": "price", Custo: "cost" }),
      created_by: stock,
      created_at: ts(-12, 10),
      finished_at: ts(-12, 10),
    },
    {
      id: "dev-imports-batch-3",
      entity: "suppliers",
      filename: "fornecedores.xlsx",
      sheet_name: "Planilha1",
      format: "xlsx",
      mode: "all-or-nothing",
      dry_run: 1,
      status: "simulacao",
      rows_total: 5,
      rows_ok: 5,
      rows_err: 0,
      inserted: 0,
      updated: 0,
      errors_json: "[]",
      mapping_json: JSON.stringify({ Fornecedor: "name", CNPJ: "document", "E-mail": "email", Telefone: "phone", "Condição de pagamento": "terms" }),
      created_by: finance,
      created_at: ts(-2, 16),
      finished_at: ts(-2, 16),
    },
  ]);

  await setSeedFlag(AREA, companyId);
}
