// DRE comparativa por mês (regime de competência). Os números vêm da DRE do Financeiro (src/lib/erp/dre.ts, a única
// regra de DRE do app): contas a receber somam e a pagar subtraem na competência (competência → emissão → vencimento →
// criação), agrupadas pelo dre_group do plano de contas; juros, multas e descontos das baixas entram no resultado
// financeiro no mês da baixa; extrato conciliado direto numa categoria entra no mês do lançamento. Cancelada e
// excluída ficam fora. Aqui só se montam as colunas (um mês cada) e a análise vertical.
import type { DatabaseLike } from "@/lib/db/demo";
import { dreFromSource, loadDreSource, type DreResult, type DreSource } from "@/lib/erp/dre";
import { sumMoney } from "@/lib/money";
import type { DreGroup } from "@/types";
import { addMonths, monthLabel, monthsBetween, sharePercent, type ReportTable, type RowStyle } from "./common";

/** Lançamentos já lidos e classificados (servem para qualquer período sem ler o banco de novo). */
export type DreData = DreSource;

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

const GROUP_LABELS: Record<DreGroup, string> = {
  receita: "Receita bruta",
  deducao: "(−) Deduções da receita",
  custo: "(−) Custos",
  despesa: "(−) Despesas operacionais",
  financeiro: "Resultado financeiro",
  outros: "Outras receitas e despesas",
};

/** Efeito de cada grupo no resultado do mês (receita positiva, custo/despesa negativos). */
const GROUP_VALUE: Record<DreGroup, (month: DreResult) => number> = {
  receita: (month) => month.receita,
  deducao: (month) => -month.deducoes || 0,
  custo: (month) => -month.custos || 0,
  despesa: (month) => -month.despesas || 0,
  financeiro: (month) => month.financeiro,
  outros: (month) => month.outros,
};

export function loadDreData(db: DatabaseLike, companyId: string): Promise<DreData> {
  return loadDreSource(db, companyId);
}

export function buildDreReport(data: DreData, options: { endMonth: string; months: number }): DreReport {
  const months = monthsBetween(addMonths(options.endMonth, -(Math.max(1, options.months) - 1)), options.endMonth);
  const results = months.map((month) => dreFromSource(data, month));

  // Detalhe por categoria (ou linha sem categoria: juros, descontos, "Sem categoria"), somado mês a mês.
  const details = new Map<string, { group: DreGroup; label: string; code: string | null; name: string; values: number[] }>();
  results.forEach((result, index) => {
    for (const item of result.linhas) {
      const id = item.categoryId ?? (item.name === "Sem categoria" ? "none" : item.name);
      const key = `${item.group}:${id}`;
      const detail = details.get(key) ?? { group: item.group, label: item.code ? `${item.code} ${item.name}` : item.name, code: item.code, name: item.name, values: months.map(() => 0) };
      detail.values[index] = sumMoney([detail.values[index], item.value]);
      details.set(key, detail);
    }
  });

  const lines: DreLine[] = [];
  const line = (key: string, label: string, kind: DreLineKind, values: number[], group?: DreGroup): DreLine => ({ key, label, kind, group, values, total: sumMoney(values), share: 0 });
  const pushGroup = (group: DreGroup) => {
    lines.push(line(group, GROUP_LABELS[group], "group", results.map(GROUP_VALUE[group]), group));
    const rows = [...details.entries()]
      .filter(([, detail]) => detail.group === group)
      .sort(([, a], [, b]) => (a.code ?? "\uffff").localeCompare(b.code ?? "\uffff", "pt-BR", { numeric: true }) || a.name.localeCompare(b.name, "pt-BR"));
    for (const [key, detail] of rows) lines.push(line(key, detail.label, "category", detail.values, group));
  };

  pushGroup("receita");
  pushGroup("deducao");
  lines.push(line("receita_liquida", "Receita líquida", "subtotal", results.map((month) => month.receitaLiquida)));
  pushGroup("custo");
  lines.push(line("lucro_bruto", "Lucro bruto", "subtotal", results.map((month) => month.lucroBruto)));
  pushGroup("despesa");
  lines.push(line("resultado_operacional", "Resultado operacional", "subtotal", results.map((month) => month.resultadoOperacional)));
  pushGroup("financeiro");
  pushGroup("outros");
  lines.push(line("resultado", "Resultado líquido", "subtotal", results.map((month) => month.resultado)));

  const grossRevenue = sumMoney(results.map((month) => month.receita));
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
