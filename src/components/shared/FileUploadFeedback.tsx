import { AlertCircle, CheckCircle2, X } from "lucide-react";
import type { UploadSummary } from "@/hooks/useFileUploads";
import { cn } from "@/lib/utils";

/** Resultado do último envio: quantos entraram (status) e cada recusado com o motivo (alerta). */
export function FileUploadFeedback({ summary, onDismiss, className }: { summary: UploadSummary | null; onDismiss: () => void; className?: string }) {
  if (!summary || (summary.saved.length === 0 && summary.failed.length === 0)) return null;
  const versions = summary.saved.filter((doc) => doc.version > 1).length;
  return (
    <div className={cn("space-y-2 text-sm", className)}>
      {summary.saved.length > 0 && (
        <p role="status" className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 size={15} aria-hidden="true" />
          <span className="flex-1">
            {summary.saved.length === 1 ? "1 arquivo enviado" : `${summary.saved.length} arquivos enviados`}
            {versions > 0 && ` (${versions === 1 ? "1 como nova versão" : `${versions} como novas versões`})`}.
          </span>
          {summary.failed.length === 0 && (
            <button type="button" onClick={onDismiss} aria-label="Fechar aviso" className="rounded p-0.5 hover:bg-emerald-500/20"><X size={14} /></button>
          )}
        </p>
      )}
      {summary.failed.length > 0 && (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive">
          <div className="flex items-center gap-2 font-medium">
            <AlertCircle size={15} aria-hidden="true" />
            <span className="flex-1">{summary.failed.length === 1 ? "1 arquivo não foi enviado" : `${summary.failed.length} arquivos não foram enviados`}</span>
            <button type="button" onClick={onDismiss} aria-label="Fechar aviso" className="rounded p-0.5 hover:bg-destructive/20"><X size={14} /></button>
          </div>
          <ul className="mt-1 space-y-0.5 pl-6 text-xs">
            {summary.failed.map((failure, index) => <li key={`${failure.name}-${index}`}>{failure.message}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
