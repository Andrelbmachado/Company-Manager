import { Download, Upload } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ImportExportButtonsProps {
  /** Chave da entidade no registro de importação (src/lib/importexport/registry.ts), ex.: "customers", "products". */
  entity: string;
  /** Chamado depois de uma importação gravar linhas (para invalidar as consultas da lista). */
  onImported?: () => void;
  className?: string;
}

const BUTTON = "flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent";

/**
 * Botões "Importar" e "Exportar" das listas (use no `actions` do PageHeader ou ao lado do PageToolbar).
 * Contrato estável: as telas já podem usar; por enquanto os botões ficam desativados ("Em breve") até o motor de
 * importação/exportação (CSV/XLSX) ser ligado aqui, sem mudar quem usa.
 */
export function ImportExportButtons(props: ImportExportButtonsProps) {
  return (
    <div className={cn("flex items-center gap-2", props.className)} data-entity={props.entity}>
      <button type="button" className={BUTTON} disabled title="Em breve" aria-label="Importar planilha (em breve)">
        <Upload size={14} aria-hidden="true" /> Importar
      </button>
      <button type="button" className={BUTTON} disabled title="Em breve" aria-label="Exportar (em breve)">
        <Download size={14} aria-hidden="true" /> Exportar
      </button>
    </div>
  );
}

export default ImportExportButtons;
