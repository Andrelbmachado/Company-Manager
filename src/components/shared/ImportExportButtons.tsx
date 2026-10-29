import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { ChevronDown, Download, Loader2, Upload, X } from "lucide-react";
import { useSession } from "@/hooks/useSession";
import { getDb } from "@/lib/db/client";
import { emit } from "@/lib/events/bus";
import { canExportEntity, canImportEntity } from "@/lib/importexport/access";
import { errorMessage } from "@/lib/importexport/errors";
import type { ExportFormat } from "@/lib/importexport/export";
import { getEntity } from "@/lib/importexport/registry";
import { cn } from "@/lib/utils";
import type { Role } from "@/types";
import { useModalFocus } from "./useModalFocus";

// O assistente (leitura de CSV/XLSX, mapeamento, prévia) só carrega quando a pessoa clica em Importar.
const ImportWizard = lazy(() => import("@/modules/imports/components/ImportWizard"));

export interface ImportExportButtonsProps {
  /** Chave da entidade no registro de importação (src/lib/importexport/registry.ts), ex.: "customers", "products". */
  entity: string;
  /** Chamado depois de uma importação gravar linhas (para invalidar as consultas da lista). */
  onImported?: () => void;
  className?: string;
  /** Sem o botão Importar (a tela abre o assistente por outro lugar, com `importOpen`). */
  hideImportButton?: boolean;
  /** Assistente aberto, controlado pela tela (junto com `onImportOpenChange`). */
  importOpen?: boolean;
  onImportOpenChange?: (open: boolean) => void;
}

const BUTTON = "flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent";

const FORMATS: { format: ExportFormat; label: string }[] = [
  { format: "xlsx", label: "Excel (.xlsx)" },
  { format: "csv", label: "CSV (separado por ;)" },
];

/**
 * Botões "Importar" e "Exportar" das listas (use no `actions` do PageHeader ou ao lado do PageToolbar).
 * Importar abre o assistente com o cadastro já escolhido; Exportar baixa todos os registros em Excel ou CSV.
 * Cada botão só aparece para quem tem a permissão (importar: `create` em `imports` e `create` + `edit` no recurso;
 * exportar: `export`).
 */
export function ImportExportButtons(props: ImportExportButtonsProps) {
  const { session } = useSession();
  const entity = getEntity(props.entity);
  const role = session?.membership.role as Role | undefined;
  const [importingState, setImportingState] = useState(false);
  const importing = props.importOpen ?? importingState;
  const setImporting = (open: boolean) => {
    setImportingState(open);
    props.onImportOpenChange?.(open);
  };

  // Fora da sessão (ou cadastro sem importação): botões visíveis e desativados, com o motivo no título.
  if (!session || !role || !entity) {
    const reason = !entity ? "Este cadastro não tem importação" : "Entre no sistema para importar ou exportar";
    return (
      <div className={cn("flex flex-wrap items-center gap-2", props.className)} data-entity={props.entity}>
        <button type="button" className={BUTTON} disabled title={reason} aria-label={`Importar planilha (${reason.toLowerCase()})`}>
          <Upload size={14} aria-hidden="true" /> Importar
        </button>
        <button type="button" className={BUTTON} disabled title={reason} aria-label={`Exportar (${reason.toLowerCase()})`}>
          <Download size={14} aria-hidden="true" /> Exportar
        </button>
      </div>
    );
  }

  const canImport = canImportEntity(role, entity);
  const canExport = canExportEntity(role, entity);
  if (!canImport && !canExport) return null;

  return (
    <div className={cn("flex flex-wrap items-center gap-2", props.className)} data-entity={props.entity}>
      {canImport && !props.hideImportButton && (
        <button type="button" className={BUTTON} onClick={() => setImporting(true)} aria-label={`Importar planilha de ${entity.label.toLowerCase()}`}>
          <Upload size={14} aria-hidden="true" /> Importar
        </button>
      )}
      {canExport && <ExportMenu entityKey={entity.key} label={entity.label} companyId={session.company.id} actorId={session.user.id} />}
      {importing && canImport && (
        <ImportDialog title={`Importar ${entity.label.toLowerCase()}`} onClose={() => setImporting(false)}>
          <Suspense fallback={<p className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 size={16} className="animate-spin" aria-hidden="true" /> Carregando...</p>}>
            <ImportWizard entities={[entity]} initialEntity={entity.key} lockEntity onImported={() => props.onImported?.()} onClose={() => setImporting(false)} />
          </Suspense>
        </ImportDialog>
      )}
    </div>
  );
}

function ImportDialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const panel = useModalFocus<HTMLDivElement>(onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-8" onClick={onClose}>
      <div ref={panel} role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-5xl rounded-xl border bg-card p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between border-b pb-4">
          <h2 className="font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ExportMenu({ entityKey, label, companyId, actorId }: { entityKey: string; label: string; companyId: string; actorId: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function exportAs(format: ExportFormat) {
    setOpen(false);
    setBusy(true);
    setError(null);
    try {
      const [{ exportRows, exportFilename }, { saveBlob }] = await Promise.all([import("@/lib/importexport/export"), import("@/lib/importexport/saveFile")]);
      const blob = await exportRows(entityKey, format, { db: await getDb(), companyId });
      const saved = await saveBlob(blob, exportFilename(entityKey, format));
      if (saved) {
        await emit({ type: "data.exported", companyId, actorId, entityType: entityKey, entityId: entityKey, module: "imports", title: `Exportação de ${label}`, description: `Arquivo ${format.toUpperCase()}`, metadata: { entity: entityKey, format } });
      }
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={root} className="relative">
      <button type="button" className={BUTTON} disabled={busy} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)} aria-label={`Exportar ${label.toLowerCase()}`}>
        {busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Download size={14} aria-hidden="true" />} Exportar <ChevronDown size={13} aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" aria-label="Formato do arquivo" className="absolute right-0 z-30 mt-1 w-52 overflow-hidden rounded-md border bg-popover p-1 text-sm shadow-lg">
          {FORMATS.map((option) => (
            <button key={option.format} type="button" role="menuitem" onClick={() => void exportAs(option.format)} className="block w-full rounded px-3 py-2 text-left hover:bg-muted focus:bg-muted focus:outline-none">
              {option.label}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="absolute right-0 top-full z-30 mt-1 w-64 rounded-md border border-status-danger/40 bg-card px-3 py-2 text-xs text-status-danger dark:text-red-400 shadow">
          {error}
        </p>
      )}
    </div>
  );
}

export default ImportExportButtons;
