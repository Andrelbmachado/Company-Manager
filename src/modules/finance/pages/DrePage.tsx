// DRE gerencial por competência: receita, deduções, custos, despesas, resultado financeiro e outros, com o detalhe
// por categoria do plano de contas e comparativo de meses. O cálculo fica em lib/erp/dre.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Calculator, Receipt, Scale, TrendingUp } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { dreMonths, type DreResult } from "@/lib/erp/dre";
import { addMonths, isIsoMonth, monthLabel } from "@/lib/erp/financeCommon";
import { roundMoney } from "@/lib/money";
import { cn, formatCurrency, todayIso } from "@/lib/utils";
import { useRequiredSession } from "@/hooks/useSession";
import { EmptyState } from "@/components/shared/EmptyState";
import { KpiCard } from "@/components/shared/KpiCard";
import { PageHeader } from "@/components/shared/PageHeader";
import type { DreGroup } from "@/types";
import { ErrorNote, Field, errorMessage, inputClass, th } from "../components/financeShared";

interface Section {
  group: DreGroup;
  label: string;
  /** Valor da seção no resultado (com sinal). */
  value: (result: DreResult) => number;
  /** Subtotal mostrado depois da seção. */
  total?: { label: string; value: (result: DreResult) => number };
}

const SECTIONS: Section[] = [
  { group: "receita", label: "Receita bruta", value: (r) => r.receita },
  { group: "deducao", label: "(−) Deduções da receita", value: (r) => -r.deducoes, total: { label: "= Receita líquida", value: (r) => r.receitaLiquida } },
  { group: "custo", label: "(−) Custos", value: (r) => -r.custos, total: { label: "= Lucro bruto", value: (r) => r.lucroBruto } },
  { group: "despesa", label: "(−) Despesas operacionais", value: (r) => -r.despesas, total: { label: "= Resultado operacional", value: (r) => r.resultadoOperacional } },
  { group: "financeiro", label: "(±) Resultado financeiro", value: (r) => r.financeiro },
  { group: "outros", label: "(±) Outros resultados", value: (r) => r.outros, total: { label: "= Resultado do período", value: (r) => r.resultado } },
];
const SPANS = [
  { value: 1, label: "Só o mês" },
  { value: 3, label: "Últimos 3 meses" },
  { value: 6, label: "Últimos 6 meses" },
  { value: 12, label: "Últimos 12 meses" },
];

interface DetailRow {
  key: string;
  label: string;
  values: number[];
}

/** Linhas de categoria de uma seção em todos os meses (mesma categoria na mesma linha). */
function detailRows(results: DreResult[], group: DreGroup): DetailRow[] {
  const rows = new Map<string, DetailRow>();
  results.forEach((result, index) => {
    for (const line of result.linhas.filter((item) => item.group === group)) {
      const key = line.categoryId ?? `label:${line.name}`;
      const row = rows.get(key) ?? { key, label: line.code ? `${line.code} · ${line.name}` : line.name, values: results.map(() => 0) };
      row.values[index] = roundMoney(row.values[index] + line.value);
      rows.set(key, row);
    }
  });
  return [...rows.values()].sort((a, b) => a.label.localeCompare(b.label, "pt-BR", { numeric: true }));
}

const percent = (value: number, base: number) => (base > 0 ? `${((value / base) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%` : "—");

function Value({ value, strong }: { value: number; strong?: boolean }) {
  return <span className={cn("tabular-nums", strong && "font-semibold", value < 0 && "text-red-700 dark:text-red-400")}>{formatCurrency(value)}</span>;
}

export default function DrePage() {
  const session = useRequiredSession();
  const companyId = session.company.id;
  const [month, setMonth] = useState(() => todayIso().slice(0, 7));
  const [span, setSpan] = useState(1);
  const [details, setDetails] = useState(true);
  const valid = isIsoMonth(month);
  // Sempre lê o mês anterior também, para a variação nos indicadores.
  const months = valid ? Array.from({ length: Math.max(span, 2) }, (_, index) => addMonths(month, index - Math.max(span, 2) + 1)) : [];

  const { data = [], error, isLoading } = useQuery({
    queryKey: ["finance", companyId, "dre", months.join(",")],
    enabled: valid,
    queryFn: async () => dreMonths(await getDb(), companyId, months),
  });
  const shown = data.slice(-span);
  const current = data[data.length - 1];
  const previous = data.length > 1 ? data[data.length - 2] : undefined;
  const variation = (value: (r: DreResult) => number) => {
    if (!current || !previous || value(previous) === 0) return undefined;
    return { value: Math.round(((value(current) - value(previous)) / Math.abs(value(previous))) * 1000) / 10, label: "vs mês anterior" };
  };
  const empty = shown.every((result) => result.linhas.length === 0);
  const costs = (r: DreResult) => roundMoney(r.deducoes + r.custos + r.despesas);

  return (
    <div className="space-y-6">
      <PageHeader title="DRE" description="Demonstração do resultado por competência: contas pela competência (ou emissão/vencimento), juros e descontos pelas baixas e tarifas do extrato conciliado." />

      <div className="flex flex-wrap items-end gap-3 border-b pb-4">
        <Field label="Mês">
          <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className={inputClass} />
        </Field>
        <Field label="Comparar">
          <select value={span} onChange={(event) => setSpan(Number(event.target.value))} className={inputClass}>
            {SPANS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </Field>
        <label className="flex h-9 items-center gap-2 text-sm">
          <input type="checkbox" checked={details} onChange={(event) => setDetails(event.target.checked)} className="h-4 w-4" />
          Detalhar por categoria
        </label>
      </div>

      {!valid && <ErrorNote message="Escolha um mês." />}
      <ErrorNote message={error ? errorMessage(error) : null} />

      {current && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard title="Receita bruta" value={formatCurrency(current.receita)} subtitle={monthLabel(current.month)} icon={TrendingUp} trend={variation((r) => r.receita)} iconClassName="bg-emerald-600/10 text-emerald-700 dark:text-emerald-400" />
          <KpiCard title="Receita líquida" value={formatCurrency(current.receitaLiquida)} subtitle={`Deduções: ${formatCurrency(current.deducoes)}`} icon={Receipt} />
          <KpiCard title="Custos e despesas" value={formatCurrency(costs(current))} subtitle={`${percent(costs(current), current.receita)} da receita`} icon={Scale} iconClassName="bg-red-600/10 text-red-700 dark:text-red-400" />
          <KpiCard title="Resultado" value={formatCurrency(current.resultado)} subtitle={`Margem: ${percent(current.resultado, current.receita)}`} icon={Calculator} trend={variation((r) => r.resultado)} />
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Calculando…</p>
      ) : valid && !error && empty ? (
        <EmptyState icon={Calculator} title="Nada lançado nessa competência" description="Contas a pagar e a receber com competência (ou vencimento) no período aparecem aqui." />
      ) : (
        shown.length > 0 && (
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead className="bg-muted/30">
                <tr>
                  <th className={th}>Demonstração</th>
                  {shown.map((result) => <th key={result.month} className={cn(th, "text-right")}>{monthLabel(result.month)}</th>)}
                  <th className={cn(th, "text-right")}>% receita</th>
                </tr>
              </thead>
              <tbody>
                {SECTIONS.flatMap((section) => {
                  const last = shown[shown.length - 1];
                  const rows = [
                    <tr key={section.group} className="border-t font-medium">
                      <td className="px-4 py-2.5">{section.label}</td>
                      {shown.map((result) => <td key={result.month} className="px-4 py-2.5 text-right"><Value value={section.value(result)} /></td>)}
                      <td className="px-4 py-2.5 text-right text-muted-foreground tabular-nums">{percent(Math.abs(section.value(last)), last.receita)}</td>
                    </tr>,
                  ];
                  if (details) {
                    for (const row of detailRows(shown, section.group)) {
                      rows.push(
                        <tr key={`${section.group}-${row.key}`} className="text-muted-foreground">
                          <td className="py-1.5 pl-8 pr-4">{row.label}</td>
                          {row.values.map((value, index) => <td key={shown[index].month} className="px-4 py-1.5 text-right tabular-nums">{formatCurrency(value)}</td>)}
                          <td className="px-4 py-1.5 text-right tabular-nums">{percent(Math.abs(row.values[row.values.length - 1]), last.receita)}</td>
                        </tr>,
                      );
                    }
                  }
                  if (section.total) {
                    const total = section.total;
                    rows.push(
                      <tr key={`${section.group}-total`} className="border-t bg-muted/20">
                        <td className="px-4 py-2.5 font-semibold">{total.label}</td>
                        {shown.map((result) => <td key={result.month} className="px-4 py-2.5 text-right"><Value value={total.value(result)} strong /></td>)}
                        <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{percent(total.value(last), last.receita)}</td>
                      </tr>,
                    );
                  }
                  return rows;
                })}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}
