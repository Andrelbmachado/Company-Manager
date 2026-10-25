import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatCard } from "@/components/shared/StatCard";
import { TabList, TabPanel } from "@/components/shared/Tabs";
import { buildSalesReport, defaultGranularity, loadSalesData, salesTable, type SalesGranularity, type SalesView } from "@/lib/reports/sales";
import { formatCurrency } from "@/lib/utils";
import { DateRangeFilter, FIELD, initialRange, LABEL, ReportState, StatGrid, useReportData, type DateRange } from "../components/ReportControls";
import { ExportButtons } from "../components/ExportButtons";
import { ReportDataTable } from "../components/ReportDataTable";

const VIEWS = [
  { id: "periodo", label: "Por período" },
  { id: "cliente", label: "Por cliente" },
  { id: "vendedor", label: "Por vendedor" },
  { id: "produto", label: "Por produto" },
] as const satisfies readonly { id: SalesView; label: string }[];

const AXIS = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };
const compact = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });

/** Vendas por período, cliente, vendedor e produto (pedidos confirmados, faturados e entregues). */
export default function SalesReportPage() {
  const [range, setRange] = useState<DateRange>(() => initialRange("este_mes"));
  const [granularity, setGranularity] = useState<SalesGranularity | "auto">("auto");
  const [view, setView] = useState<SalesView>("periodo");
  const data = useReportData("sales", loadSalesData);
  const valid = range.from <= range.to;

  const report = useMemo(
    () => (data.data && valid ? buildSalesReport(data.data, { ...range, granularity: granularity === "auto" ? defaultGranularity(range.from, range.to) : granularity }) : null),
    [data.data, range, granularity, valid],
  );
  const table = useMemo(() => (report ? salesTable(report, view) : null), [report, view]);
  const customers = report ? report.byCustomer.filter((row) => row.key !== "none").length : 0;

  return (
    <div className="space-y-6">
      <PageHeader title="Relatório de vendas" description="Pedidos confirmados, faturados e entregues no período, pela data do pedido." actions={<ExportButtons table={table} />} />

      <div className="flex flex-wrap items-end gap-3">
        <DateRangeFilter idPrefix="vendas" value={range} onChange={setRange} />
        <label className={LABEL} htmlFor="vendas-granularidade">
          Agrupar
          <select id="vendas-granularidade" className={FIELD} value={granularity} onChange={(event) => setGranularity(event.target.value as SalesGranularity | "auto")}>
            <option value="auto">Automático</option>
            <option value="dia">Por dia</option>
            <option value="mes">Por mês</option>
          </select>
        </label>
      </div>

      <ReportState query={data}>
        {report && table && (
          <>
            <StatGrid>
              <StatCard title="Faturamento" value={formatCurrency(report.total)} />
              <StatCard title="Pedidos" value={report.orders} />
              <StatCard title="Ticket médio" value={formatCurrency(report.averageTicket)} />
              <StatCard title="Clientes atendidos" value={customers} />
            </StatGrid>

            <div>
              <TabList tabs={VIEWS} value={view} onChange={setView} label="Visão do relatório de vendas" idPrefix="vendas" />
            </div>
            <TabPanel idPrefix="vendas" id={view}>
              {view === "periodo" && report.orders > 0 && (
                <div className="h-64 rounded-xl border bg-card p-4" aria-hidden>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={report.byPeriod} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: "hsl(var(--border))" }} minTickGap={12} />
                      <YAxis tick={AXIS} tickLine={false} axisLine={false} width={48} tickFormatter={(value: number) => compact.format(value)} />
                      <Tooltip
                        formatter={(value: number) => formatCurrency(value)}
                        cursor={{ fill: "hsl(var(--muted) / 0.4)" }}
                        contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                        labelStyle={{ color: "hsl(var(--popover-foreground))" }}
                      />
                      <Bar dataKey="total" name="Vendas" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              <ReportDataTable table={table} empty="Nenhuma venda no período." />
            </TabPanel>
          </>
        )}
      </ReportState>
    </div>
  );
}
