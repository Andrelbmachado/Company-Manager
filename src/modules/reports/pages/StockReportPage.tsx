import { useMemo, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatCard } from "@/components/shared/StatCard";
import { buildStockReport, loadStockData, stockTable } from "@/lib/reports/stock";
import { DateRangeFilter, initialRange, MoneyValue, ReportState, StatGrid, useReportData, type DateRange } from "../components/ReportControls";
import { ExportButtons } from "../components/ExportButtons";
import { ReportDataTable } from "../components/ReportDataTable";

/** Giro de estoque: saídas, saldo médio, cobertura e itens parados no período. */
export default function StockReportPage() {
  const [range, setRange] = useState<DateRange>(() => initialRange("ultimos_90"));
  const [onlyIdle, setOnlyIdle] = useState(false);
  const data = useReportData("stock", loadStockData);
  const valid = range.from <= range.to;

  const report = useMemo(() => (data.data && valid ? buildStockReport(data.data, range) : null), [data.data, range, valid]);
  const table = useMemo(() => (report ? stockTable(report, { onlyIdle }) : null), [report, onlyIdle]);

  return (
    <div className="space-y-6">
      <PageHeader title="Giro de estoque" description="Giro = saídas ÷ saldo médio do período. Cobertura = quantos dias o saldo final dura no ritmo de saída." actions={<ExportButtons table={table} />} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <DateRangeFilter idPrefix="estoque" value={range} onChange={setRange} />
        <label htmlFor="estoque-parados" className="flex items-center gap-2 pb-2 text-sm">
          <input id="estoque-parados" type="checkbox" className="h-4 w-4 rounded border" checked={onlyIdle} onChange={(event) => setOnlyIdle(event.target.checked)} />
          Só itens parados (com saldo e sem saída no período)
        </label>
      </div>

      <ReportState query={data}>
        {report && table && (
          <>
            <StatGrid>
              <StatCard title="Itens" value={report.totals.items} />
              <StatCard title="Valor em estoque" value={<MoneyValue value={report.totals.value} />} hint="Saldo final × custo do item" />
              <StatCard title="Itens parados" value={report.totals.idleItems} />
              <StatCard title="Valor parado" value={<MoneyValue value={report.totals.idleValue} />} hint="Capital em itens sem saída no período" />
            </StatGrid>
            <ReportDataTable table={table} empty={onlyIdle ? "Nenhum item parado no período." : "Nenhum item cadastrado no estoque."} />
            <p className="text-xs text-muted-foreground">
              Saídas não incluem transferências entre locais nem ajustes de inventário. O saldo de cada data é reconstruído a partir do saldo atual e das movimentações.
            </p>
          </>
        )}
      </ReportState>
    </div>
  );
}
