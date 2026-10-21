import { useState } from "react";
import { ChevronDown, Download, FileJson, FileSpreadsheet, FileUp, Upload } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "@/components/ui/Menu";
import { ImportDialog } from "./ImportDialog";
import { useRequiredSession } from "@/hooks/useSession";
import { can } from "@/lib/permissions/rbac";
import { getEntity, type EntityKey } from "@/lib/data/entities";
import { listEntity } from "@/lib/data/repository";
import {
  exportFileName,
  exportRows,
  saveTextFile,
  templateCsv,
  type ExportFormat,
} from "@/lib/data/importExport";
import type { Role } from "@/types";

interface ImportExportActionsProps {
  /** Entities handled by this page; the first is the default import target. */
  entities: EntityKey[];
}

/** "Importar" + "Exportar" buttons, permission-aware. Used on every module page. */
export function ImportExportActions({ entities }: ImportExportActionsProps) {
  const session = useRequiredSession();
  const role = session.membership.role as Role;
  const [importOpen, setImportOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const importable = entities.filter((k) => {
    const def = getEntity(k);
    return def.importable !== false && can(role, "create", def.resource);
  });
  const exportable = entities.filter((k) => can(role, "export", getEntity(k).resource));

  async function handleExport(key: EntityKey, format: ExportFormat) {
    const def = getEntity(key);
    setBusy(true);
    try {
      const rows = await listEntity(key, session.company.id);
      await saveTextFile(exportFileName(def, format), exportRows(def, rows, format));
    } finally {
      setBusy(false);
    }
  }

  if (!importable.length && !exportable.length) return null;

  return (
    <>
      {importable.length > 0 && (
        <Button onClick={() => setImportOpen(true)} data-testid="import-button">
          <Upload size={14} />
          Importar
        </Button>
      )}

      {exportable.length > 0 && (
        <Menu
          testId="export-menu"
          trigger={(props) => (
            <Button {...props} disabled={busy} data-testid="export-button">
              <Download size={14} />
              Exportar
              <ChevronDown size={14} className="text-muted-foreground" />
            </Button>
          )}
        >
          {(close) => (
            <>
              {exportable.map((key, i) => {
                const def = getEntity(key);
                return (
                  <div key={key}>
                    {i > 0 && <MenuSeparator />}
                    {exportable.length > 1 && <MenuLabel>{def.labelPlural}</MenuLabel>}
                    <MenuItem
                      testId={`export-${key}-csv`}
                      icon={<FileSpreadsheet size={14} />}
                      hint=".csv"
                      onSelect={() => {
                        close();
                        handleExport(key, "csv");
                      }}
                    >
                      Planilha (Excel)
                    </MenuItem>
                    <MenuItem
                      testId={`export-${key}-json`}
                      icon={<FileJson size={14} />}
                      hint=".json"
                      onSelect={() => {
                        close();
                        handleExport(key, "json");
                      }}
                    >
                      JSON
                    </MenuItem>
                  </div>
                );
              })}
              {importable.length > 0 && (
                <>
                  <MenuSeparator />
                  {importable.map((key) => (
                    <MenuItem
                      key={key}
                      testId={`template-${key}`}
                      icon={<FileUp size={14} />}
                      onSelect={() => {
                        close();
                        saveTextFile(exportFileName(getEntity(key), "template"), templateCsv(getEntity(key)));
                      }}
                    >
                      Modelo de importação{importable.length > 1 ? ` — ${getEntity(key).labelPlural}` : ""}
                    </MenuItem>
                  ))}
                </>
              )}
            </>
          )}
        </Menu>
      )}

      {importable.length > 0 && (
        <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} entities={importable} />
      )}
    </>
  );
}
