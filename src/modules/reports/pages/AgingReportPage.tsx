import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatCard } from "@/components/shared/StatCard";
import { TabList, TabPanel } from "@/components/shared/Tabs";
import { sharePercent } from "@/lib/reports/common";
import { agingTable, buildAgingReport, loadAgingData, type AgingSide, type AgingView } from "@/lib/reports/aging";
import { formatCurrency, todayIso } from "@/lib/utils";
import { FIELD, LABEL, MoneyValue, ReportState, StatGrid, useReportData } from "../components/ReportControls";
import { ExportButtons } from "../components/ExportButtons";
import { ReportDataTable } from "../components/ReportDataTable";

const SIDES = [
  { id: "receber", label: "A receber" },
  { id: "pagar", label: "A pagar" },
] as const satisfies readonly { id: AgingSide; label: string }[];

const AXIS = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };
const compact = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
/** A vencer em cinza, atraso do amarelo ao vermelho, sem vencimento neutro. */
const BUCKET_COLORS = ["hsl(var(--muted-foreground) / 0.5)", "hsl(45 93% 47%)", "hsl(32 95% 44%)", "hsl(14 90% 50%)", "hsl(0 72% 45%)", "hsl(var(--muted-foreground) / 0.3)"];

/** Aging: saldo em aberto de contas a receber e a pagar por faixa de atraso, por cliente/fornecedor e por título. */
export default function AgingReportPage() {
  const [side, setSide] = useState<AgingSide>("receber");
  const [view, setView] = useState<AgingView>("faixas");
  const [asOf, setAsOf] = useState(() => todayIso());
  const data = useReportData("aging", loadAgingData);

  const report = useMemo(() => (data.data ? buildAgingReport(data.data, side, asOf) : null), [data.data, side, asOf]);
  const table = useMemo(() => (report ? agingTable(report, view) : null), [report, view]);
  const views = useMemo(
    () =>
      [
        { id: "faixas", label: "Faixas de atraso" },
        { id: "parceiros", label: side === "receber" ? "Por cliente" : "Por fornecedor" },
        { id: "titulos", label: "Títulos" },
      ] as const satisfies readonly { id: AgingView; label: string }[],
    [side],
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Contas a receber e a pagar" description="Saldo em aberto (valor menos o já recebido ou pago) por faixa de atraso na data-base." actions={<ExportButtons table={table} />} />

      <div className="flex flex-wrap items-end justify-between gap-3 border-b">
        <TabList tabs={SIDES} value={side} onChange={setSide} label="Contas a receber ou a pagar" idPrefix="aging-lado" />
        <label className={`${LABEL} pb-2`} htmlFor="aging-data-base">
          Data-base
          <input id="aging-data-base" type="date" className={FIELD} value={asOf} onChange={(event) => event.target.value && setAsOf(event.target.value)} />
        </label>
      </div>

      <ReportState query={data}>
        {report && table && (
          <TabPanel idPrefix="aging-lado" id={side}>
            <StatGrid>
              <StatCard title="Em aberto" value={<MoneyValue value={report.total} />} hint={`${report.count} ${report.count === 1 ? "título" : "títulos"}`} />
              <StatCard title="Vencido" value={<MoneyValue value={report.overdue} />} hint={`${sharePercent(report.overdue, report.total).toLocaleString("pt-BR")}% do saldo em aberto`} />
              <StatCard title="A vencer" value={<MoneyValue value={report.buckets[0].total} />} />
              <StatCard title="Mais de 90 dias" value={<MoneyValue value={report.buckets[4].total} />} hint="Maior risco de atraso longo" />
            </StatGrid>

            {report.count > 0 && (
              <div className="h-56 rounded-xl border bg-card p-4" aria-hidden>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={report.buckets} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: "hsl(var(--border))" }} />
                    <YAxis tick={AXIS} tickLine={false} axisLine={false} width={48} tickFormatter={(value: number) => compact.format(value)} />
                    <Tooltip
                      formatter={(value: number) => formatCurrency(value)}
                      cursor={{ fill: "hsl(var(--muted) / 0.4)" }}
                      contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                      labelStyle={{ color: "hsl(var(--popover-foreground))" }}
                    />
                    <Bar dataKey="total" name="Em aberto" radius={[4, 4, 0, 0]}>
                      {report.buckets.map((bucket, index) => (
                        <Cell key={bucket.key} fill={BUCKET_COLORS[index]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            <div className="border-b">
              <TabList tabs={views} value={view} onChange={setView} label="Visão do aging" idPrefix="aging-visao" />
            </div>
            <TabPanel idPrefix="aging-visao" id={view}>
              <ReportDataTable table={table} empty={side === "receber" ? "Nenhuma conta a receber em aberto." : "Nenhuma conta a pagar em aberto."} />
            </TabPanel>
          </TabPanel>
        )}
      </ReportState>
    </div>
  );
}
