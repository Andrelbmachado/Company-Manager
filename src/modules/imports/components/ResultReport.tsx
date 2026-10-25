// Resultado da importação (ou da simulação): quantos entraram, quantos atualizaram e o que deu errado em cada linha.
import { AlertTriangle, CheckCircle2, Download, FlaskConical, XCircle } from "lucide-react";
import { StatusBadge } from "@/components/shared/StatusBadge";
import type { ImportRowError } from "@/lib/importexport/errors";
import type { ImportEntity } from "@/lib/importexport/registry";
import type { ImportBatchStatus } from "@/types";

/** Quantos erros a tela lista (o relatório baixado traz todos). */
const SHOWN_ERRORS = 100;

export interface ResultSummary {
  status: ImportBatchStatus;
  dryRun: boolean;
  mode: "all-or-nothing" | "skip-errors";
  total: number;
  ok: number;
  inserted: number;
  updated: number;
  rowsWithErrors: number;
  errors: ImportRowError[];
}

interface ResultReportProps {
  entity: ImportEntity<unknown>;
  result: ResultSummary;
  onDownloadErrors?: () => void;
  /** Total de erros guardados quando a lista veio do histórico (que guarda até 1.000). */
  storedErrorsNote?: string;
}

function headline(result: ResultSummary): { icon: typeof CheckCircle2; tone: string; text: string } {
  const plural = (count: number, one: string, many: string) => `${count.toLocaleString("pt-BR")} ${count === 1 ? one : many}`;
  if (result.dryRun) {
    const errors = result.rowsWithErrors ? `, ${plural(result.rowsWithErrors, "linha com erro", "linhas com erro")}` : "";
    return { icon: FlaskConical, tone: "text-status-violet", text: `Simulação: ${plural(result.inserted, "novo", "novos")} e ${plural(result.updated, "atualizado", "atualizados")}${errors}. Nada foi gravado.` };
  }
  if (result.status === "falhou") {
    return {
      icon: XCircle,
      tone: "text-status-danger dark:text-red-400",
      text: result.mode === "all-or-nothing" && result.rowsWithErrors > 0 ? "Nada foi gravado: há linhas com erro e a importação era tudo ou nada." : "Nada foi gravado. Veja os problemas abaixo.",
    };
  }
  const base = `${plural(result.inserted, "novo", "novos")} e ${plural(result.updated, "atualizado", "atualizados")}`;
  if (result.status === "com_erros") return { icon: AlertTriangle, tone: "text-status-orange", text: `${base}. ${plural(result.rowsWithErrors, "linha ficou", "linhas ficaram")} de fora por erro.` };
  return { icon: CheckCircle2, tone: "text-status-success dark:text-green-400", text: `Importação concluída: ${base}.` };
}

export function ResultReport({ entity, result, onDownloadErrors, storedErrorsNote }: ResultReportProps) {
  const { icon: Icon, tone, text } = headline(result);
  const labelOf = (field: string) => entity.fields.find((candidate) => candidate.key === field)?.label ?? field;
  const shown = result.errors.slice(0, SHOWN_ERRORS);
  const stats = [
    { label: "Linhas no arquivo", value: result.total },
    { label: result.dryRun ? "Seriam criados" : "Criados", value: result.inserted },
    { label: result.dryRun ? "Seriam atualizados" : "Atualizados", value: result.updated },
    { label: "Linhas com erro", value: result.rowsWithErrors },
  ];

  return (
    <section aria-labelledby="resultado-titulo" className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <Icon size={22} className={tone} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id="resultado-titulo" className="font-semibold">{entity.label}</h3>
            <StatusBadge status={result.status} />
          </div>
          <p className="mt-1 text-sm" role="status">{text}</p>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-lg border p-3">
            <dt className="text-xs text-muted-foreground">{stat.label}</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">{stat.value.toLocaleString("pt-BR")}</dd>
          </div>
        ))}
      </dl>

      {result.errors.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold">Problemas encontrados</h4>
            {onDownloadErrors && (
              <button type="button" onClick={onDownloadErrors} className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted">
                <Download size={14} aria-hidden="true" /> Baixar relatório de erros (CSV)
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">Linha</th>
                  <th scope="col" className="px-3 py-2 font-medium">Coluna</th>
                  <th scope="col" className="px-3 py-2 font-medium">Valor</th>
                  <th scope="col" className="px-3 py-2 font-medium">Problema</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((error, index) => (
                  <tr key={`${error.row}-${error.field}-${index}`} className="border-t align-top">
                    <td className="px-3 py-1.5 tabular-nums">{error.row || "—"}</td>
                    <td className="px-3 py-1.5">{error.field ? labelOf(error.field) : "—"}</td>
                    <td className="max-w-[12rem] truncate px-3 py-1.5 text-muted-foreground" title={error.value}>{error.value || "—"}</td>
                    <td className="px-3 py-1.5">{error.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(result.errors.length > SHOWN_ERRORS || storedErrorsNote) && (
            <p className="text-xs text-muted-foreground">
              {result.errors.length > SHOWN_ERRORS ? `Mostrando ${SHOWN_ERRORS} de ${result.errors.length.toLocaleString("pt-BR")} problemas; o relatório traz todos. ` : ""}
              {storedErrorsNote}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

export default ResultReport;
