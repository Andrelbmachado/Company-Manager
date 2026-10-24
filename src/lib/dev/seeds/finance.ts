// TEMPORÁRIO (dados de exemplo): plano de contas (com subcategorias e linha da DRE) e contas bancárias.
// Bancos e números de conta são fictícios.
import { hasSeedFlag, insertRows, setSeedFlag, type SeedRow } from "../seedUtils";

const AREA = "finance";

type CategorySeed = [code: string, name: string, kind: "receita" | "despesa", dreGroup: string];

/** Pais antes dos filhos (parent_id tem chave estrangeira); o pai de "1.2" é "1". */
const CATEGORIES: CategorySeed[] = [
  ["1", "Receitas", "receita", "receita"],
  ["1.1", "Venda de produtos", "receita", "receita"],
  ["1.2", "Prestação de serviços", "receita", "receita"],
  ["1.3", "Contratos de suporte", "receita", "receita"],
  ["2", "Deduções da receita", "despesa", "deducao"],
  ["2.1", "Impostos sobre vendas", "despesa", "deducao"],
  ["3", "Custos", "despesa", "custo"],
  ["3.1", "Custo das mercadorias vendidas", "despesa", "custo"],
  ["3.2", "Serviços de terceiros", "despesa", "custo"],
  ["4", "Despesas operacionais", "despesa", "despesa"],
  ["4.1", "Aluguel e condomínio", "despesa", "despesa"],
  ["4.2", "Salários e encargos", "despesa", "despesa"],
  ["4.3", "Software e licenças", "despesa", "despesa"],
  ["4.4", "Marketing e publicidade", "despesa", "despesa"],
  ["4.5", "Energia, água e internet", "despesa", "despesa"],
  ["5", "Resultado financeiro", "despesa", "financeiro"],
  ["5.1", "Tarifas bancárias", "despesa", "financeiro"],
  ["5.2", "Rendimentos de aplicações", "receita", "financeiro"],
];

const categoryId = (code: string) => `dev-finance-cat-${code.replace(/\./g, "-")}`;

export async function seed(companyId: string): Promise<void> {
  if (await hasSeedFlag(AREA, companyId)) return;

  const categories: SeedRow[] = CATEGORIES.map(([code, name, kind, dreGroup], index) => {
    const parent = code.includes(".") ? code.slice(0, code.lastIndexOf(".")) : null;
    return { id: categoryId(code), parent_id: parent ? categoryId(parent) : null, code, name, kind, dre_group: dreGroup, position: index + 1, active: 1 };
  });
  await insertRows("finance_categories", companyId, categories);

  await insertRows("bank_accounts", companyId, [
    {
      id: "dev-finance-bank-1",
      name: "Conta corrente principal",
      kind: "corrente",
      bank_code: "001",
      bank_name: "Banco do Brasil",
      agency: "1234-5",
      account_number: "98765-0",
      pix_key: null,
      opening_balance: 25000,
      opening_date: "2026-01-01",
      is_default: 1,
      active: 1,
    },
    {
      id: "dev-finance-bank-2",
      name: "Conta de recebimentos",
      kind: "corrente",
      bank_code: "341",
      bank_name: "Itaú",
      agency: "0456",
      account_number: "12345-6",
      pix_key: null,
      opening_balance: 8000,
      opening_date: "2026-01-01",
      is_default: 0,
      active: 1,
    },
    { id: "dev-finance-bank-3", name: "Caixa da empresa", kind: "caixa", opening_balance: 500, opening_date: "2026-01-01", is_default: 0, active: 1 },
  ]);

  await setSeedFlag(AREA, companyId);
}
