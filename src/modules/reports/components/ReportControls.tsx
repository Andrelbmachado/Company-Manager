// Peças comuns das telas de relatório: filtro de período com atalhos, carga dos dados da empresa e estados de carga/erro.
import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { getDb } from "@/lib/db/client";
import type { DatabaseLike } from "@/lib/db/demo";
import { periodPresets, type PeriodPresetKey } from "@/lib/reports/common";
import { useRequiredSession } from "@/hooks/useSession";
import { todayIso } from "@/lib/utils";

export const FIELD = "h-9 rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring";
export const LABEL = "flex flex-col gap-1 text-xs font-medium text-muted-foreground";

export interface DateRange {
  from: string;
  to: string;
}

/** Período inicial de um relatório (atalho de hoje). */
export function initialRange(preset: PeriodPresetKey, today = todayIso()): DateRange {
  const found = periodPresets(today).find((item) => item.key === preset)!;
  return { from: found.from, to: found.to };
}

/** Período com atalhos (este mês, mês passado, 30/90 dias, este ano, 12 meses) e datas livres. */
export function DateRangeFilter({ value, onChange, idPrefix }: { value: DateRange; onChange: (range: DateRange) => void; idPrefix: string }) {
  const presets = useMemo(() => periodPresets(todayIso()), []);
  const current = presets.find((preset) => preset.from === value.from && preset.to === value.to)?.key ?? "personalizado";
  const invalid = value.from > value.to;
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className={LABEL} htmlFor={`${idPrefix}-preset`}>
        Período
        <select
          id={`${idPrefix}-preset`}
          className={FIELD}
          value={current}
          onChange={(event) => {
            const preset = presets.find((item) => item.key === event.target.value);
            if (preset) onChange({ from: preset.from, to: preset.to });
          }}
        >
          {presets.map((preset) => (
            <option key={preset.key} value={preset.key}>
              {preset.label}
            </option>
          ))}
          <option value="personalizado" disabled>
            Personalizado
          </option>
        </select>
      </label>
      <label className={LABEL} htmlFor={`${idPrefix}-from`}>
        De
        <input id={`${idPrefix}-from`} type="date" className={FIELD} value={value.from} max={value.to} onChange={(event) => event.target.value && onChange({ ...value, from: event.target.value })} />
      </label>
      <label className={LABEL} htmlFor={`${idPrefix}-to`}>
        Até
        <input id={`${idPrefix}-to`} type="date" className={FIELD} value={value.to} min={value.from} onChange={(event) => event.target.value && onChange({ ...value, to: event.target.value })} />
      </label>
      {invalid && (
        <p role="alert" className="pb-2 text-xs text-destructive">
          A data inicial vem depois da final.
        </p>
      )}
    </div>
  );
}

/** Dados de um relatório da empresa da sessão (recarrega ao voltar para a tela). */
export function useReportData<T>(name: string, loader: (db: DatabaseLike, companyId: string) => Promise<T>) {
  const session = useRequiredSession();
  const companyId = session.company.id;
  return useQuery({ queryKey: ["reports", name, companyId], queryFn: async () => loader(await getDb(), companyId) });
}

/** Carregando / erro / conteúdo. */
export function ReportState({ query, children }: { query: { isLoading: boolean; isError: boolean; error: unknown }; children: ReactNode }) {
  if (query.isLoading) return <div className="h-48 animate-pulse rounded-xl border bg-card" aria-label="Carregando relatório" />;
  if (query.isError) {
    return (
      <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        Não foi possível montar o relatório: {query.error instanceof Error ? query.error.message : String(query.error)}
      </p>
    );
  }
  return <>{children}</>;
}

/** Linha de indicadores do relatório (4 colunas só em tela larga: valor em R$ é comprido). */
export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">{children}</div>;
}
