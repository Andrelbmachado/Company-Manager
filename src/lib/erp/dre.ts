// DRE (demonstração do resultado) por competência, mês a mês.
// Regras:
// - Contas a receber somam e contas a pagar subtraem, na competência (competence → emissão → vencimento → criação).
//   Canceladas e excluídas ficam fora. A linha vem do plano de contas: dre_group da categoria, herdado do pai quando
//   vazio; sem dre_group em toda a cadeia, receita → "receita" e despesa → "despesa". Sem categoria: receber vai para
//   receita e pagar para despesa ("Sem categoria").
// - Juros e multas das baixas e descontos (obtidos ou concedidos) vão para o resultado financeiro, no mês da baixa.
// - Lançamento do extrato conciliado direto numa categoria (tarifa, rendimento) entra no mês do lançamento, com o
//   sinal do extrato. Conciliado sem categoria e sem conta: "outros".
// - Categoria excluída continua classificando os lançamentos antigos.
// Totais: receita líquida = receita − deduções; lucro bruto = receita líquida − custos;
// resultado operacional = lucro bruto − despesas; resultado = operacional + financeiro + outros.
// É a única DRE do app: a tela do Financeiro (/finance/dre) e o relatório comparativo (/reports/dre, que monta as
// colunas com `loadDreSource` + `dreFromSource`) usam esta mesma conta.
import { fromCents, toCents } from "@/lib/money";
import type { DreGroup, FinanceCategory } from "@/types";
import { isIsoMonth, loadBankTransactions, loadEntries, loadSettlements, type FinanceDb } from "./financeCommon";

export const DRE_GROUPS: readonly DreGroup[] = ["receita", "deducao", "custo", "despesa", "financeiro", "outros"];

export const DRE_GROUP_LABELS: Record<DreGroup, string> = {
  receita: "Receita bruta",
  deducao: "Deduções da receita",
  custo: "Custos",
  despesa: "Despesas operacionais",
  financeiro: "Resultado financeiro",
  outros: "Outros resultados",
};

export interface DreLine {
  group: DreGroup;
  categoryId: string | null;
  code: string | null;
  name: string;
  /** Efeito no resultado (receita positiva, despesa negativa). */
  value: number;
}

export interface DreResult {
  month: string;
  receita: number;
  /** Valores a subtrair (positivos quando reduzem o resultado). */
  deducoes: number;
  receitaLiquida: number;
  custos: number;
  lucroBruto: number;
  despesas: number;
  resultadoOperacional: number;
  /** Com sinal (negativo = despesa financeira líquida). */
  financeiro: number;
  outros: number;
  resultado: number;
  linhas: DreLine[];
}

export interface Contribution {
  month: string;
  group: DreGroup;
  categoryId: string | null;
  /** Nome da linha quando não é uma categoria (juros, descontos, sem categoria). */
  label?: string;
  cents: number;
}

/** Lançamentos da empresa já classificados por mês e linha da DRE (lido uma vez, serve para qualquer mês). */
export interface DreSource {
  contributions: Contribution[];
  categories: Map<string, FinanceCategory>;
}

/** Linha da DRE de uma categoria: a dela, a do pai mais próximo que tiver, ou pelo tipo (receita/despesa). */
export function categoryGroup(categories: Map<string, FinanceCategory>, categoryId: string): DreGroup | null {
  const seen = new Set<string>();
  let current = categories.get(categoryId);
  const kind = current?.kind;
  while (current && !seen.has(current.id)) {
    if (current.dre_group && DRE_GROUPS.includes(current.dre_group)) return current.dre_group;
    seen.add(current.id);
    current = current.parent_id ? categories.get(current.parent_id) : undefined;
  }
  if (!kind) return null;
  return kind === "receita" ? "receita" : "despesa";
}

export async function loadDreSource(db: FinanceDb, companyId: string): Promise<DreSource> {
  // Com as excluídas: categoria excluída continua classificando os lançamentos antigos.
  const categoryRows = await db.select<FinanceCategory[]>("SELECT * FROM finance_categories WHERE company_id=?", [companyId]);
  const categories = new Map(categoryRows.map((category) => [category.id, category]));
  const entries = await loadEntries(db, companyId);
  const settlements = await loadSettlements(db, companyId);
  const transactions = await loadBankTransactions(db, companyId);
  const contributions: Contribution[] = [];

  for (const entry of entries) {
    if (entry.status === "cancelada" || !entry.competenceMonth) continue;
    const sign = entry.kind === "receivable" ? 1 : -1;
    const fallback: DreGroup = entry.kind === "receivable" ? "receita" : "despesa";
    const group = entry.categoryId ? (categoryGroup(categories, entry.categoryId) ?? fallback) : fallback;
    contributions.push({
      month: entry.competenceMonth,
      group,
      categoryId: entry.categoryId && categories.has(entry.categoryId) ? entry.categoryId : null,
      cents: sign * toCents(entry.amount),
    });
  }

  for (const settlement of settlements) {
    const month = settlement.paid_at.slice(0, 7);
    const payable = Boolean(settlement.payable_id);
    const charges = toCents(Number(settlement.interest) || 0) + toCents(Number(settlement.fine) || 0);
    const discount = toCents(Number(settlement.discount) || 0);
    if (charges) contributions.push({ month, group: "financeiro", categoryId: null, label: payable ? "Juros e multas pagos" : "Juros e multas recebidos", cents: payable ? -charges : charges });
    if (discount) contributions.push({ month, group: "financeiro", categoryId: null, label: payable ? "Descontos obtidos" : "Descontos concedidos", cents: payable ? discount : -discount });
  }

  const linked = new Set(settlements.map((settlement) => settlement.bank_transaction_id).filter(Boolean));
  for (const transaction of transactions) {
    if (transaction.status !== "conciliada" || transaction.payable_id || transaction.receivable_id || linked.has(transaction.id)) continue;
    const categoryId = transaction.category_id && categories.has(transaction.category_id) ? transaction.category_id : null;
    contributions.push({
      month: transaction.posted_at.slice(0, 7),
      group: categoryId ? (categoryGroup(categories, categoryId) ?? "outros") : "outros",
      categoryId,
      label: categoryId ? undefined : "Extrato sem categoria",
      cents: toCents(Number(transaction.amount) || 0),
    });
  }
  return { contributions, categories };
}

/** DRE de um mês a partir dos lançamentos já lidos (`loadDreSource`). */
export function dreFromSource(data: DreSource, month: string): DreResult {
  const totals: Record<DreGroup, number> = { receita: 0, deducao: 0, custo: 0, despesa: 0, financeiro: 0, outros: 0 };
  const lines = new Map<string, { group: DreGroup; categoryId: string | null; name: string; code: string | null; cents: number }>();

  for (const item of data.contributions) {
    if (item.month !== month) continue;
    totals[item.group] += item.cents;
    const category = item.categoryId ? data.categories.get(item.categoryId) : undefined;
    const name = category?.name ?? item.label ?? "Sem categoria";
    const key = `${item.group}|${item.categoryId ?? `label:${name}`}`;
    const line = lines.get(key) ?? { group: item.group, categoryId: item.categoryId, name, code: category?.code ?? null, cents: 0 };
    line.cents += item.cents;
    lines.set(key, line);
  }

  const receita = totals.receita;
  const deducoes = -totals.deducao;
  const receitaLiquida = receita - deducoes;
  const custos = -totals.custo;
  const lucroBruto = receitaLiquida - custos;
  const despesas = -totals.despesa;
  const resultadoOperacional = lucroBruto - despesas;
  const resultado = resultadoOperacional + totals.financeiro + totals.outros;

  const groupOrder = (group: DreGroup) => DRE_GROUPS.indexOf(group);
  const linhas = [...lines.values()]
    .filter((line) => line.cents !== 0)
    .sort((a, b) => groupOrder(a.group) - groupOrder(b.group) || (a.code ?? "￿").localeCompare(b.code ?? "￿", "pt-BR", { numeric: true }) || a.name.localeCompare(b.name, "pt-BR"))
    .map((line) => ({ group: line.group, categoryId: line.categoryId, code: line.code, name: line.name, value: fromCents(line.cents) }));

  return {
    month,
    receita: fromCents(receita),
    deducoes: fromCents(deducoes),
    receitaLiquida: fromCents(receitaLiquida),
    custos: fromCents(custos),
    lucroBruto: fromCents(lucroBruto),
    despesas: fromCents(despesas),
    resultadoOperacional: fromCents(resultadoOperacional),
    financeiro: fromCents(totals.financeiro),
    outros: fromCents(totals.outros),
    resultado: fromCents(resultado),
    linhas,
  };
}

function assertMonth(month: string): string {
  if (!isIsoMonth(month)) throw new Error(`Mês inválido: ${month} (use AAAA-MM).`);
  return month;
}

/** DRE de um mês ('YYYY-MM') por competência. */
export async function dre(db: FinanceDb, companyId: string, month: string): Promise<DreResult> {
  assertMonth(month);
  return dreFromSource(await loadDreSource(db, companyId), month);
}

/** DRE de vários meses lendo o banco uma vez só (comparativo). */
export async function dreMonths(db: FinanceDb, companyId: string, months: readonly string[]): Promise<DreResult[]> {
  months.forEach(assertMonth);
  const data = await loadDreSource(db, companyId);
  return months.map((month) => dreFromSource(data, month));
}
