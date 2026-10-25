import { useState } from "react";
import { FileDown, FileSpreadsheet, Loader2, Printer } from "lucide-react";
import { useRequiredSession } from "@/hooks/useSession";
import { can } from "@/lib/permissions/rbac";
import type { ReportTable } from "@/lib/reports/common";
import { exportReport, type ExportFormat } from "@/lib/reports/export";
import type { Role } from "@/types";

const BUTTON = "flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50";
const ICONS = { csv: FileDown, xlsx: FileSpreadsheet, pdf: Printer } as const;
const LABELS: Record<ExportFormat, string> = { csv: "CSV", xlsx: "Excel", pdf: "PDF / imprimir" };
const TITLES: Record<ExportFormat, string> = {
  csv: "Baixar em CSV (abre no Excel, Numbers e Google Planilhas)",
  xlsx: "Baixar planilha do Excel (.xlsx)",
  pdf: "Abrir a impressão; para PDF, escolha “Salvar como PDF”",
};

/**
 * Exportar a tabela em tela (CSV, Excel e PDF pela impressão). Só aparece para quem tem `export` em relatórios.
 * TODO(integração): quando a Tarefa 5 (ImportExportButtons) estiver na main, avaliar usar o mesmo componente aqui.
 */
export function ExportButtons({ table, disabled }: { table: ReportTable | null; disabled?: boolean }) {
  const session = useRequiredSession();
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  if (!can(session.membership.role as Role, "export", "reports")) return null;

  async function run(format: ExportFormat) {
    if (!table) return;
    setBusy(format);
    setNotice(null);
    try {
      const saved = await exportReport(table, format, { company: session.company.name });
      if (saved) setNotice({ tone: "success", text: `Arquivo salvo: ${saved.split(/[\\/]/).pop()}` });
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Exportar relatório">
        {(Object.keys(LABELS) as ExportFormat[]).map((format) => {
          const Icon = busy === format ? Loader2 : ICONS[format];
          return (
            <button key={format} type="button" className={BUTTON} title={TITLES[format]} disabled={disabled || !table || busy !== null} onClick={() => void run(format)}>
              <Icon size={14} className={busy === format ? "animate-spin" : undefined} aria-hidden />
              {LABELS[format]}
            </button>
          );
        })}
      </div>
      {notice && (
        <p role={notice.tone === "error" ? "alert" : "status"} className={notice.tone === "error" ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
          {notice.text}
        </p>
      )}
    </div>
  );
}
