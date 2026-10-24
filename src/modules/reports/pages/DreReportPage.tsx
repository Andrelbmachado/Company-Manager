import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatCard } from "@/components/shared/StatCard";
import { monthLabel, monthOf } from "@/lib/reports/common";
import { buildDreReport, dreTable, loadDreData } from "@/lib/reports/dre";
import { formatCurrency, todayIso } from "@/lib/utils";
import { FIELD, LABEL, MoneyValue, ReportState, StatGrid, useReportData } from "../components/ReportControls";
import { ExportButtons } from "../components/ExportButtons";
import { ReportDataTable } from "../components/ReportDataTable";

const AXIS = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };
const compact = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
const MONTH_COUNTS = [3, 6, 12] as const;

/** DRE comparativa mês a mês (regime de competência), pelo plano de contas. */
export default function DreReportPage() {
  const [endMonth, setEndMonth] = useState(() => monthOf(todayIso()));
  const [months, setMonths] = useState<number>(6);
  const data = useReportData("dre", loadDreData);

  const report = useMemo(() => (data.data ? buildDreReport(data.data, { endMonth, months }) : null), [data.data, endMonth, months]);
  const table = useMemo(() => (report ? dreTable(report) : null), [report]);
  const line = (key: string) => report?.lines.find((item) => item.key === key);
  const chart = report ? report.months.map((month, index) => ({ month: monthLabel(month), receita: line("receita_liquida")!.values[index], resultado: line("resultado")!.values[index] })) : [];

  return (
    <div className="space-y-6">
      <PageHeader title="DRE" description="Resultado por mês pelo regime de competência: receitas, deduções, custos e despesas pelo plano de contas." actions={<ExportButtons table={table} />} />

      <div className="flex flex-wrap items-end gap-3">
        <label className={LABEL} htmlFor="dre-ate">
          Até o mês
          <input id="dre-ate" type="month" className={FIELD} value={endMonth} onChange={(event) => /^\d{4}-\d{2}$/.test(event.target.value) && setEndMonth(event.target.value)} />
        </label>
        <label className={LABEL} htmlFor="dre-meses">
          Comparar
          <select id="dre-meses" className={FIELD} value={months} onChange={(event) => setMonths(Number(event.target.value))}>
            {MONTH_COUNTS.map((count) => (
              <option key={count} value={count}>
                {count} meses
              </option>
            ))}
          </select>
        </label>
      </div>

      <ReportState query={data}>
        {report && table && (
          <>
            <StatGrid>
              <StatCard title="Receita bruta" value={<MoneyValue value={line("receita")!.total} />} />
              <StatCard title="Receita líquida" value={<MoneyValue value={line("receita_liquida")!.total} />} />
              <StatCard title="Lucro bruto" value={<MoneyValue value={line("lucro_bruto")!.total} />} />
              <StatCard title="Resultado líquido" value={<MoneyValue value={line("resultado")!.total} />} hint={`${line("resultado")!.share.toLocaleString("pt-BR")}% da receita bruta`} />
            </StatGrid>

            <div className="h-64 rounded-xl border bg-card p-4" aria-hidden>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="month" tick={AXIS} tickLine={false} axisLine={{ stroke: "hsl(var(--border))" }} />
                  <YAxis tick={AXIS} tickLine={false} axisLine={false} width={48} tickFormatter={(value: number) => compact.format(value)} />
                  <Tooltip
                    formatter={(value: number) => formatCurrency(value)}
                    cursor={{ fill: "hsl(var(--muted) / 0.4)" }}
                    contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: "hsl(var(--popover-foreground))" }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="receita" name="Receita líquida" fill="hsl(var(--primary) / 0.45)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="resultado" name="Resultado líquido" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <ReportDataTable table={table} />
            <p className="text-xs text-muted-foreground">
              Mês de cada lançamento: competência; sem ela, data de emissão; sem ela, vencimento. Contas canceladas ficam fora. Categoria sem grupo da DRE herda o do pai; sem nenhum, vale o tipo (receita ou despesa).
            </p>
          </>
        )}
      </ReportState>
    </div>
  );
}
