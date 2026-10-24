import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, History, RotateCcw, Trash2 } from "lucide-react";
import { useRequiredSession } from "@/hooks/useSession";
import { formatBytes, formatTimestamp } from "@/lib/files/format";
import { deleteFile, describeFileError, downloadFile, listVersions, restoreVersion } from "@/lib/files/store";
import type { DocumentRow } from "@/types";

interface FileVersionListProps {
  doc: DocumentRow;
  /** Restaurar uma versão antiga como a atual. */
  canRestore?: boolean;
  /** Excluir uma versão sozinha (não a única). */
  canDeleteVersion?: boolean;
  /** Depois de restaurar ou excluir: a nova versão atual (ou null se o documento sumiu). */
  onChanged?: (current: DocumentRow | null) => void;
}

/** Histórico de versões de um documento, da atual para a primeira, com baixar, restaurar e excluir versão. */
export function FileVersionList({ doc, canRestore = false, canDeleteVersion = false, onChanged }: FileVersionListProps) {
  const session = useRequiredSession();
  const companyId = session.company.id;
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const { data: versions = [], isLoading } = useQuery({
    queryKey: ["documents", companyId, "versions", doc.id, doc.version, doc.updated_at],
    queryFn: () => listVersions(doc),
  });

  const restore = useMutation({
    mutationFn: (version: DocumentRow) => restoreVersion(version, session.user.id),
    onMutate: () => setError(null),
    onSuccess: (current) => onChanged?.(current),
    onError: (reason) => setError(describeFileError(reason)),
    onSettled: () => qc.invalidateQueries({ queryKey: ["documents", companyId] }),
  });

  const remove = useMutation({
    mutationFn: async (version: DocumentRow) => {
      await deleteFile(version, { userId: session.user.id, onlyThisVersion: true });
      const rest = versions.filter((item) => item.id !== version.id);
      return version.id === versions[0]?.id ? (rest[0] ?? null) : versions[0] ?? null;
    },
    onMutate: () => setError(null),
    onSuccess: (current) => {
      setConfirming(null);
      onChanged?.(current);
    },
    onError: (reason) => setError(describeFileError(reason)),
    onSettled: () => qc.invalidateQueries({ queryKey: ["documents", companyId] }),
  });

  async function download(version: DocumentRow) {
    setError(null);
    try {
      await downloadFile(version);
    } catch (reason) {
      setError(describeFileError(reason));
    }
  }

  const busy = restore.isPending || remove.isPending;

  return (
    <section aria-label="Histórico de versões" className="space-y-2">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold"><History size={15} aria-hidden="true" /> Versões</h3>
      {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
      {isLoading ? (
        <p className="text-xs text-muted-foreground">Carregando versões…</p>
      ) : (
        <ol className="divide-y rounded-md border">
          {versions.map((version, index) => (
            <li key={version.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
              <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-semibold">v{version.version}</span>
              {index === 0 && <span className="text-xs font-medium text-primary-text">Atual</span>}
              <span className="text-xs text-muted-foreground">{formatTimestamp(version.created_at)}</span>
              <span className="text-xs text-muted-foreground">{version.size_bytes ? formatBytes(version.size_bytes) : "sem arquivo"}</span>
              {version.description && <span className="w-full text-xs text-muted-foreground">{version.description}</span>}
              <span className="ml-auto flex items-center gap-1">
                <button type="button" onClick={() => download(version)} disabled={!version.storage_key} aria-label={`Baixar a versão v${version.version}`} title="Baixar" className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40">
                  <Download size={14} />
                </button>
                {canRestore && index > 0 && version.storage_key && (
                  <button type="button" onClick={() => restore.mutate(version)} disabled={busy} aria-label={`Restaurar a versão v${version.version}`} title="Restaurar como versão atual" className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40">
                    <RotateCcw size={14} />
                  </button>
                )}
                {canDeleteVersion && versions.length > 1 && (confirming === version.id ? (
                  <>
                    <button type="button" onClick={() => remove.mutate(version)} disabled={busy} className="rounded bg-destructive px-2 py-1 text-xs font-medium text-destructive-foreground disabled:opacity-50">Excluir v{version.version}</button>
                    <button type="button" onClick={() => setConfirming(null)} className="rounded px-2 py-1 text-xs hover:bg-muted">Cancelar</button>
                  </>
                ) : (
                  <button type="button" onClick={() => setConfirming(version.id)} disabled={busy} aria-label={`Excluir a versão v${version.version}`} title="Excluir esta versão" className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-40">
                    <Trash2 size={14} />
                  </button>
                ))}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
