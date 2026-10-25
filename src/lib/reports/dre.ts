// DRE comparativa por mês (regime de competência): contas a receber somam, contas a pagar subtraem, agrupadas pelo
// dre_group do plano de contas. Mês = competência; sem ela, emissão; sem ela, vencimento. Cancelada e excluída ficam fora.
// TODO(integração): a Tarefa 8 cria a DRE do Financeiro (lib/erp/dre.ts); quando as duas estiverem na main, este
// relatório pode reaproveitar aquela classificação para os números da tela de DRE e do relatório serem sempre iguais.
import type { DatabaseLike } from "@/lib/db/demo";
import { sumMoney } from "@/lib/money";
import type { DreGroup } from "@/types";
import { addMonths, localDayOf, monthLabel, monthOf, monthsBetween, num, sharePercent, text, type DbRow, type ReportTable, type RowStyle } from "./common";

export interface DreData {
  receivables: DbRow[];
  payables: DbRow[];
  categories: DbRow[];
}

export type DreLineKind = "group" | "category" | "subtotal";

export interface DreLine {
  key: string;
  label: string;
  kind: DreLineKind;
  group?: DreGroup;
  values: number[];
  total: number;
  /** % da receita bruta do período (análise vertical). */
  share: number;
}

export interface DreReport {
  months: string[];
  lines: DreLine[];
}

const GROUPS: readonly { group: DreGroup; label: string }[] = [
  { group: "receita", label: "Receita bruta" },
  { group: "deducao", label: "(−) Deduções da receita" },
  { group: "custo", label: "(−) Custos" },
  { group: "despesa", label: "(−) Despesas operacionais" },
  { group: "financeiro", label: "Resultado financeiro" },
  { group: "outros", label: "Outras receitas e despesas" },
];
const DRE_GROUPS = new Set<string>(GROUPS.map((item) => item.group));

export async function loadDreData(db: DatabaseLike, companyId: string): Promise<DreData> {
  const [receivables, payables, categories] = await Promise.all([
    db.select<DbRow[]>("SELECT * FROM receivables WHERE company_id=? AND deleted_at IS NULL", [companyId]),
    db.select<DbRow[]>("SELECT * FROM payables WHERE company_id=? AND deleted_at IS NULL", [companyId]),
    // Categoria excluída continua classificando os lançamentos antigos.
    db.select<DbRow[]>("SELECT * FROM finance_categories WHERE company_id=?", [companyId]),
  ]);
  return { receivables, payables, categories };
}

/** Mês do lançamento: competência "YYYY-MM"; sem ela, mês da emissão, do vencimento ou da criação. */
function entryMonth(row: DbRow): string | null {
  const competence = text(row.competence);
  if (competence && /^\d{4}-\d{2}/.test(competence)) return competence.slice(0, 7);
  for (const field of ["issue_date", "due_date", "created_at"]) {
    const day = localDayOf(text(row[field]));
    if (day) return monthOf(day);
  }
  return null;
}

export function buildDreReport(data: DreData, options: { endMonth: string; months: number }): DreReport {
  const months = monthsBetween(addMonths(options.endMonth, -(Math.max(1, options.months) - 1)), options.endMonth);
  const monthIndex = new Map(months.map((month, index) => [month, index]));
  const categories = new Map(data.categories.map((category) => [String(category.id), category]));

  /** dre_group da categoria; sem ele, o do pai (subindo); sem nenhum, o tipo da categoria. */
  function groupOf(categoryId: string | null, side: "receber" | "pagar"): DreGroup {
    const seen = new Set<string>();
    let current = categoryId ? categories.get(categoryId) : undefined;
    const kind = current ? String(current.kind) : null;
    while (current && !seen.has(String(current.id))) {
      seen.add(String(current.id));
      const group = text(current.dre_group);
      if (group && DRE_GROUPS.has(group)) return group as DreGroup;
      current = text(current.parent_id) ? categories.get(String(current.parent_id)) : undefined;
    }
    if (kind === "receita") return "receita";
    if (kind === "despesa") return "despesa";
    return side === "receber" ? "receita" : "despesa";
  }

  // grupo → categoria → valores por mês (centavos acumulados via sumMoney no fim)
  const buckets = new Map<DreGroup, Map<string, number[][]>>();
  const add = (row: DbRow, side: "receber" | "pagar") => {
    if (row.status === "cancelada") return;
    const month = entryMonth(row);
    const index = month === null ? undefined : monthIndex.get(month);
    if (index === undefined) return;
    const categoryId = text(row.category_id);
    const group = groupOf(categoryId, side);
    const key = categoryId && categories.has(categoryId) ? categoryId : "none";
    const byCategory = buckets.get(group) ?? new Map<string, number[][]>();
    const perMonth = byCategory.get(key) ?? months.map(() => []);
    perMonth[index].push(side === "receber" ? num(row.amount) : -num(row.amount));
    byCategory.set(key, perMonth);
    buckets.set(group, byCategory);
  };
  for (const row of data.receivables) add(row, "receber");
  for (const row of data.payables) add(row, "pagar");

  const lines: DreLine[] = [];
  const groupValues = new Map<DreGroup, number[]>();
  const line = (key: string, label: string, kind: DreLineKind, values: number[], group?: DreGroup): DreLine => ({ key, label, kind, group, values, total: sumMoney(values), share: 0 });
  const sum = (...rows: number[][]) => months.map((_, index) => sumMoney(rows.map((values) => values[index])));

  const categoryLabel = (key: string) => {
    if (key === "none") return "Sem categoria";
    const category = categories.get(key)!;
    const code = text(category.code);
    return code ? `${code} ${String(category.name)}` : String(category.name);
  };
  const categoryOrder = (key: string) => {
    if (key === "none") return [1, ""] as const;
    const category = categories.get(key)!;
    return [0, `${text(category.code) ?? ""}\u0000${String(category.name)}`] as const;
  };

  const pushGroup = (group: DreGroup, label: string) => {
    const byCategory = buckets.get(group) ?? new Map<string, number[][]>();
    const details = [...byCategory.entries()]
      .map(([key, perMonth]) => line(`${group}:${key}`, categoryLabel(key), "category", perMonth.map((values) => sumMoney(values)), group))
      .sort((a, b) => {
        const [aNone, aKey] = categoryOrder(a.key.slice(group.length + 1));
        const [bNone, bKey] = categoryOrder(b.key.slice(group.length + 1));
        return aNone - bNone || aKey.localeCompare(bKey, "pt-BR", { numeric: true });
      });
    const values = details.length ? sum(...details.map((detail) => detail.values)) : months.map(() => 0);
    groupValues.set(group, values);
    lines.push(line(group, label, "group", values, group), ...details);
  };

  const labelOf = new Map(GROUPS.map((item) => [item.group, item.label]));
  pushGroup("receita", labelOf.get("receita")!);
  pushGroup("deducao", labelOf.get("deducao")!);
  const netRevenue = sum(groupValues.get("receita")!, groupValues.get("deducao")!);
  lines.push(line("receita_liquida", "Receita líquida", "subtotal", netRevenue));
  pushGroup("custo", labelOf.get("custo")!);
  const grossProfit = sum(netRevenue, groupValues.get("custo")!);
  lines.push(line("lucro_bruto", "Lucro bruto", "subtotal", grossProfit));
  pushGroup("despesa", labelOf.get("despesa")!);
  pushGroup("financeiro", labelOf.get("financeiro")!);
  pushGroup("outros", labelOf.get("outros")!);
  lines.push(line("resultado", "Resultado líquido", "subtotal", sum(grossProfit, groupValues.get("despesa")!, groupValues.get("financeiro")!, groupValues.get("outros")!)));

  const grossRevenue = sumMoney(groupValues.get("receita")!);
  for (const item of lines) item.share = sharePercent(item.total, grossRevenue);
  return { months, lines };
}

/** Tabela da DRE (um mês por coluna, total e % da receita bruta), pronta para a tela e a exportação. */
export function dreTable(report: DreReport): ReportTable {
  const monthKey = (month: string) => `m_${month.replace("-", "_")}`;
  const first = report.months[0];
  const last = report.months[report.months.length - 1];
  const styles: RowStyle[] = report.lines.map((item) => (item.kind === "category" ? "indent" : "strong"));
  return {
    title: "DRE comparativa",
    subtitle: `${monthLabel(first)} a ${monthLabel(last)} · regime de competência`,
    fileName: `dre-${first}-a-${last}`,
    columns: [
      { key: "label", label: "Conta", kind: "text" },
      ...report.months.map((month) => ({ key: monthKey(month), label: monthLabel(month), kind: "money" as const })),
      { key: "total", label: "Total", kind: "money" },
      { key: "share", label: "% da receita", kind: "percent" },
    ],
    rows: report.lines.map((item) => ({
      label: item.label,
      ...Object.fromEntries(report.months.map((month, index) => [monthKey(month), item.values[index]])),
      total: item.total,
      share: item.share,
    })),
    styles,
  };
}
