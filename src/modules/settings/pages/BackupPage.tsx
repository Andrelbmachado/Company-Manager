import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArchiveRestore, CheckCircle2, DatabaseBackup, FolderOpen, Loader2, Save, Trash2, TriangleAlert } from "lucide-react";
import { appDataDir, join } from "@tauri-apps/api/path";
import { ask, open, save } from "@tauri-apps/plugin-dialog";
import { remove } from "@tauri-apps/plugin-fs";
import { EmptyState } from "@/components/shared/EmptyState";
import { KpiCard } from "@/components/shared/KpiCard";
import { PageHeader } from "@/components/shared/PageHeader";
import { NoFilterMatchRow, SortableHeader, TableFilterBar, TableFilterToolbar, useSortFilter, type SortFilterColumn } from "@/components/shared/table";
import { useRequiredSession } from "@/hooks/useSession";
import {
  BACKUP_EXTENSION,
  BACKUP_KIND_LABELS,
  backupAvailable,
  backupToFile,
  describeBackupError,
  DESKTOP_ONLY_MESSAGE,
  formatBytes,
  KEEP_AUTOMATIC_BACKUPS,
  listBackups,
  suggestedBackupFileName,
  type BackupEntry,
} from "@/lib/backup/backup";
import { restartApp, restoreFromFile } from "@/lib/backup/restore";
import { emit } from "@/lib/events/bus";
import { can } from "@/lib/permissions/rbac";
import { cn, formatDateTime } from "@/lib/utils";
import type { Role } from "@/types";

const FILTERS = [{ name: "Backup do Company Manager", extensions: [BACKUP_EXTENSION] }];
const TH = "px-4 py-3 text-sm";
const COLUMNS: SortFilterColumn<BackupEntry>[] = [
  { key: "created_at", header: "Data", kind: "datetime" },
  { key: "kind", header: "Tipo", kind: "select", options: Object.entries(BACKUP_KIND_LABELS).map(([value, label]) => ({ value, label })) },
  { key: "size_bytes", header: "Tamanho", kind: "number", filterable: false },
  { key: "files_count", header: "Anexos", kind: "integer" },
  { key: "schema_version", header: "Versão do banco", kind: "integer" },
];
const BUTTON = "flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50";
const PRIMARY = "flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50";

type Busy = null | "backup" | "save" | "restore" | "delete";
interface Notice {
  tone: "success" | "error";
  text: string;
}

function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

/** Backup e restauração (só CEO e admin: recurso `backups`). Os comandos ficam em src-tauri/src/backup.rs. */
export default function BackupPage() {
  const session = useRequiredSession();
  const role = session.membership.role as Role;
  const canCreate = can(role, "create", "backups");
  const canRestore = can(role, "edit", "backups");
  const canDelete = can(role, "delete", "backups");
  const desktop = backupAvailable();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<Busy>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const backups = useQuery({ queryKey: ["backups"], queryFn: listBackups, enabled: desktop });
  const list = useMemo(() => backups.data ?? [], [backups.data]);
  const view = useSortFilter(list, COLUMNS);
  const folder = useQuery({ queryKey: ["backups", "folder"], queryFn: async () => join(await appDataDir(), "backups"), enabled: desktop, staleTime: Infinity });

  async function track(type: string, title: string, metadata: Record<string, unknown>) {
    // Histórico de atividades (auditoria). Falhar aqui não desfaz o backup.
    await emit({ type, companyId: session.company.id, actorId: session.user.id, entityType: "backup", entityId: String(metadata.file ?? "backup"), title, module: "settings", metadata }).catch(() => undefined);
  }

  async function run(kind: Exclude<Busy, null>, job: () => Promise<Notice | null>) {
    setBusy(kind);
    setNotice(null);
    try {
      const result = await job();
      if (result) setNotice(result);
    } catch (error) {
      setNotice({ tone: "error", text: describeBackupError(error) });
    } finally {
      setBusy(null);
      void qc.invalidateQueries({ queryKey: ["backups"] });
    }
  }

  const backupNow = () =>
    run("backup", async () => {
      const info = await backupToFile();
      await track("backup.created", "Backup feito", { file: info.file_name, size_bytes: info.size_bytes });
      return { tone: "success", text: `Backup feito (${formatBytes(info.size_bytes)}, ${info.files_count} anexo${info.files_count === 1 ? "" : "s"}).` };
    });

  const saveCopy = () =>
    run("save", async () => {
      const path = await save({ title: "Salvar uma cópia do backup", defaultPath: suggestedBackupFileName(), filters: FILTERS });
      if (!path) return null;
      const info = await backupToFile(path);
      await track("backup.exported", "Cópia de backup salva", { file: info.file_name, size_bytes: info.size_bytes });
      return { tone: "success", text: `Cópia salva em ${info.path}. Guarde-a também fora deste computador (pendrive ou nuvem).` };
    });

  const restore = (path: string, label: string) =>
    run("restore", async () => {
      const confirmed = await ask(
        `Restaurar o backup ${label}?\n\nTodos os dados atuais do app (de todos os módulos) serão substituídos pelos do backup. Antes disso o app guarda uma cópia do estado atual ("Antes de restaurar") e, no fim, reinicia.`,
        { title: "Restaurar backup", kind: "warning", okLabel: "Restaurar e reiniciar", cancelLabel: "Cancelar" },
      );
      if (!confirmed) return null;
      const info = await restoreFromFile(path, { restart: false });
      // O banco agora é o do backup: o registro vai para ele (se a empresa da sessão existir lá).
      await track("backup.restored", "Backup restaurado", { file: fileNameOf(path), schema_version: info.schema_version, safety_backup: info.safety_backup?.file_name ?? null });
      setNotice({ tone: "success", text: "Backup restaurado. Reiniciando o app..." });
      await restartApp();
      return null;
    });

  async function restoreFromPicker() {
    setNotice(null);
    try {
      const picked = await open({ title: "Escolher um backup para restaurar", multiple: false, directory: false, filters: FILTERS });
      if (typeof picked === "string") await restore(picked, `do arquivo ${fileNameOf(picked)}`);
    } catch (error) {
      setNotice({ tone: "error", text: describeBackupError(error) });
    }
  }

  const deleteBackup = (entry: BackupEntry) =>
    run("delete", async () => {
      const confirmed = await ask(`Excluir o backup de ${formatDateTime(entry.created_at)} (${entry.file_name})? Esta cópia não poderá ser recuperada.`, {
        title: "Excluir backup",
        kind: "warning",
        okLabel: "Excluir",
        cancelLabel: "Cancelar",
      });
      if (!confirmed) return null;
      await remove(entry.path);
      await track("backup.deleted", "Backup excluído", { file: entry.file_name });
      return { tone: "success", text: "Backup excluído." };
    });

  if (!desktop) {
    return (
      <div className="space-y-5">
        <PageHeader title="Backup e restauração" description="Cópias do banco de dados e dos anexos." />
        <EmptyState icon={DatabaseBackup} title="Disponível no app desktop" description={DESKTOP_ONLY_MESSAGE} />
      </div>
    );
  }

  const latest = list[0];
  const lastAutomatic = list.find((entry) => entry.kind === "automatico");
  const spinner = <Loader2 size={14} className="animate-spin" aria-hidden="true" />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Backup e restauração"
        description="Cópias de todo o banco de dados (todos os módulos, inclusive a folha) e dos arquivos anexados."
        actions={
          <>
            {canCreate && (
              <button type="button" onClick={backupNow} disabled={busy !== null} className={PRIMARY}>
                {busy === "backup" ? spinner : <DatabaseBackup size={14} aria-hidden="true" />} Fazer backup agora
              </button>
            )}
            {canCreate && (
              <button type="button" onClick={saveCopy} disabled={busy !== null} className={BUTTON}>
                {busy === "save" ? spinner : <Save size={14} aria-hidden="true" />} Salvar cópia em...
              </button>
            )}
            {canRestore && (
              <button type="button" onClick={restoreFromPicker} disabled={busy !== null} className={BUTTON}>
                <FolderOpen size={14} aria-hidden="true" /> Restaurar de um arquivo...
              </button>
            )}
          </>
        }
      />

      {notice && (
        <p
          role={notice.tone === "error" ? "alert" : "status"}
          className={cn(
            "flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
            notice.tone === "error" ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
          )}
        >
          {notice.tone === "error" ? <TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" /> : <CheckCircle2 size={16} className="mt-0.5 shrink-0" aria-hidden="true" />}
          <span className="break-words">{notice.text}</span>
        </p>
      )}
      {busy === "restore" && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          {spinner} Conferindo e restaurando o backup. Não feche o app.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <KpiCard title="Backups guardados" value={list.length} />
        <KpiCard title="Último backup" value={latest ? formatDateTime(latest.created_at) : "Nenhum"} />
        <KpiCard title="Último automático" value={lastAutomatic ? formatDateTime(lastAutomatic.created_at) : "Nenhum"} />
      </div>

      <section aria-labelledby="backups-title" className="space-y-3">
        <h2 id="backups-title" className="text-sm font-semibold">
          Backups guardados {list.length > 0 && <span className="font-normal text-muted-foreground">({list.length})</span>}
        </h2>
        {backups.isLoading ? (
          <div className="h-32 animate-pulse rounded-xl border bg-card" />
        ) : backups.isError ? (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Não foi possível listar os backups: {describeBackupError(backups.error)}
          </p>
        ) : list.length === 0 ? (
          <EmptyState icon={DatabaseBackup} title="Nenhum backup guardado" description="O automático do dia é feito sozinho ao abrir o app; você também pode fazer um agora." />
        ) : (
          <div className="rounded-xl border">
            <TableFilterToolbar view={view} />
            <TableFilterBar view={view} />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Backups guardados na pasta do app, do mais novo para o mais antigo</caption>
                <thead className="bg-muted/30 text-left">
                  <tr>
                    {COLUMNS.map((column) => (
                      <SortableHeader key={column.key} label={column.header} sortKey={column.key} sort={view.sort} onSort={view.toggleSort} align={column.kind === "text" || column.kind === "select" || column.kind === "datetime" ? "left" : "right"} className={TH} />
                    ))}
                    <th scope="col" className="px-4 py-3 text-right"><span className="sr-only">Ações</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {view.rows.map((entry) => (
                    <tr key={entry.path} className="hover:bg-muted/20">
                      <td className="px-4 py-3">
                        <span className="font-medium">{formatDateTime(entry.created_at)}</span>
                        <span className="block font-mono text-xs text-muted-foreground">{entry.file_name}</span>
                      </td>
                      <td className="px-4 py-3">{BACKUP_KIND_LABELS[entry.kind]}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatBytes(entry.size_bytes)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{entry.files_count}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{entry.schema_version ?? "—"}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          {canRestore && (
                            <button type="button" onClick={() => restore(entry.path, `de ${formatDateTime(entry.created_at)}`)} disabled={busy !== null} className={BUTTON} aria-label={`Restaurar o backup de ${formatDateTime(entry.created_at)}`}>
                              <ArchiveRestore size={14} aria-hidden="true" /> Restaurar
                            </button>
                          )}
                          {canDelete && (
                            <button type="button" onClick={() => deleteBackup(entry)} disabled={busy !== null} className={cn(BUTTON, "text-destructive")} aria-label={`Excluir o backup de ${formatDateTime(entry.created_at)}`} title="Excluir">
                              <Trash2 size={14} aria-hidden="true" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!view.rows.length && <NoFilterMatchRow colSpan={COLUMNS.length + 1} />}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Backup automático: um por dia, feito pelo app ao abrir (e a cada hora, se ficar aberto). Guarda os {KEEP_AUTOMATIC_BACKUPS} mais recentes; os manuais ficam até você excluir.
          {latest && ` O último foi ${BACKUP_KIND_LABELS[latest.kind].toLowerCase()}, ${formatBytes(latest.size_bytes)}.`}
        </p>
        <p className="text-xs text-muted-foreground">
          Onde ficam: <span className="break-all font-mono">{folder.data ?? "pasta de dados do app"}</span>. Faça também cópias fora deste computador com Salvar cópia em...
        </p>
        <p className="text-xs text-muted-foreground">
          Restaurar substitui todos os dados do app pelos do backup e reinicia o app; antes disso fica guardada uma cópia do estado atual. Um backup corrompido ou feito por uma versão mais nova do app é recusado sem mexer nos dados atuais.
        </p>
      </section>
    </div>
  );
}
