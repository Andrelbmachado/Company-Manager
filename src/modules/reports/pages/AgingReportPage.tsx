import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatCard } from "@/components/shared/StatCard";
import { TabList, TabPanel } from "@/components/shared/Tabs";
import { agingTable, buildAgingReport, loadAgingData, type AgingSide, type AgingView } from "@/lib/reports/aging";
import { formatCurrency, todayIso } from "@/lib/utils";
import { FIELD, LABEL, ReportState, StatGrid, useReportData } from "../components/ReportControls";
import { ExportButtons } from "../components/ExportButtons";
import { ReportDataTable } from "../components/ReportDataTable";

const SIDES = [
  { id: "receber", label: "A receber" },
  { id: "pagar", label: "A pagar" },
] as const satisfies readonly { id: AgingSide; label: string }[];

const AXIS = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };
const compact = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
/** A vencer em cinza, atraso no vermelho do tema cada vez mais forte, sem vencimento neutro (só tokens: claro e escuro). */
const BUCKET_COLORS = [
  "hsl(var(--muted-foreground) / 0.5)",
  "hsl(var(--destructive) / 0.35)",
  "hsl(var(--destructive) / 0.55)",
  "hsl(var(--destructive) / 0.75)",
  "hsl(var(--destructive))",
  "hsl(var(--muted-foreground) / 0.3)",
];

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

      <div className="flex flex-wrap items-end justify-between gap-3">
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
              <StatCard title="Em aberto" value={formatCurrency(report.total)} />
              <StatCard title="Vencido" value={formatCurrency(report.overdue)} />
              <StatCard title="A vencer" value={formatCurrency(report.buckets[0].total)} />
              <StatCard title="Mais de 90 dias" value={formatCurrency(report.buckets[4].total)} />
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

            <div>
              <TabList tabs={views} value={view} onChange={setView} label="Visão do aging" idPrefix="aging-visao" />
            </div>
            <TabPanel idPrefix="aging-visao" id={view}>
              <ReportDataTable table={table} empty={side === "receber" ? "Nenhuma conta a receber em aberto." : "Nenhuma conta a pagar em aberto."} />
            </TabPanel>
            <p className="text-xs text-muted-foreground">
              Data-base passada: vale o saldo daquele dia (baixas feitas depois são desfeitas e contas emitidas depois ficam fora). Hoje ou adiante: saldo atual, só os dias de atraso mudam.
            </p>
          </TabPanel>
        )}
      </ReportState>
    </div>
  );
}
