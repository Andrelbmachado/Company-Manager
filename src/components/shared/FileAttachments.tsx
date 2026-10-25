import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Eye, History, Paperclip, Trash2, Upload, UploadCloud } from "lucide-react";
import { useFileUploads } from "@/hooks/useFileUploads";
import { useRequiredSession } from "@/hooks/useSession";
import { formatBytes, formatTimestamp, previewKind } from "@/lib/files/format";
import { deleteFile, describeFileError, downloadFile, getFileBackend, getMaxFileBytes, listAttachments } from "@/lib/files/store";
import { cn } from "@/lib/utils";
import type { DocumentRow } from "@/types";
import { EmptyState } from "./EmptyState";
import { FilePreviewDialog } from "./FilePreviewDialog";
import { FileTypeIcon } from "./FileTypeIcon";
import { FileUploadFeedback } from "./FileUploadFeedback";
import { FileVersionList } from "./FileVersionList";
import { useFileDrop } from "./useFileDrop";

export interface FileAttachmentsProps {
  /** Tipo da entidade dona dos anexos (documents.entity_type), ex.: "customer", "ticket", "invoice" (ver lib/files/entities.ts). */
  entityType: string;
  entityId: string;
  /** Pode enviar, mandar nova versão, restaurar e remover anexos (a tela decide pelo RBAC do recurso). */
  canEdit?: boolean;
  className?: string;
  /** Título da seção (padrão "Anexos"). */
  title?: string;
}

/**
 * Anexos de um registro (documents com entity_type/entity_id): enviar (botão ou arrastar), pré-visualizar, baixar,
 * nova versão, histórico de versões e remover. Precisa de sessão e QueryClient (como qualquer tela do app).
 */
export function FileAttachments({ entityType, entityId, canEdit = false, className, title = "Anexos" }: FileAttachmentsProps) {
  const session = useRequiredSession();
  const companyId = session.company.id;
  const qc = useQueryClient();
  const uploads = useFileUploads({ companyId, userId: session.user.id });
  const addInput = useRef<HTMLInputElement>(null);
  const versionInput = useRef<HTMLInputElement>(null);
  const versionTarget = useRef<DocumentRow | null>(null);
  const [preview, setPreview] = useState<DocumentRow | null>(null);
  const [openVersions, setOpenVersions] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: docs = [], isLoading, error } = useQuery({
    queryKey: ["documents", companyId, "attachments", entityType, entityId],
    queryFn: () => listAttachments(companyId, entityType, entityId),
    enabled: Boolean(entityId),
  });
  const { data: maxBytes } = useQuery({
    queryKey: ["documents", companyId, "max-file-bytes"],
    queryFn: () => getMaxFileBytes(companyId),
    enabled: canEdit,
    staleTime: 5 * 60_000,
  });

  const drop = useFileDrop((files) => uploads.upload(files, { entityType, entityId }), { disabled: !canEdit || uploads.busy || Boolean(preview) });

  const remove = useMutation({
    mutationFn: (doc: DocumentRow) => deleteFile(doc, { userId: session.user.id }),
    onMutate: () => setActionError(null),
    onSuccess: () => setConfirming(null),
    onError: (reason) => setActionError(describeFileError(reason)),
    onSettled: () => qc.invalidateQueries({ queryKey: ["documents", companyId] }),
  });

  async function download(doc: DocumentRow) {
    setActionError(null);
    try {
      await downloadFile(doc);
    } catch (reason) {
      setActionError(describeFileError(reason));
    }
  }

  const volatile = !getFileBackend().persistent;

  return (
    <section
      aria-label={title}
      className={cn("relative rounded-lg border", drop.isDragging && "border-primary ring-2 ring-primary/30", className)}
      data-entity-type={entityType}
      data-entity-id={entityId}
      {...drop.bind}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold"><Paperclip size={15} aria-hidden="true" /> {title}</h3>
          <p className="text-xs text-muted-foreground">
            {docs.length === 1 ? "1 arquivo" : `${docs.length} arquivos`}
            {canEdit && maxBytes ? ` · até ${formatBytes(maxBytes)} cada` : ""}
          </p>
        </div>
        {canEdit && (
          <>
            <input
              ref={addInput}
              type="file"
              multiple
              className="hidden"
              aria-label="Escolher arquivos para anexar"
              onChange={(event) => {
                uploads.upload(event.target.files ?? [], { entityType, entityId });
                event.target.value = "";
              }}
            />
            <input
              ref={versionInput}
              type="file"
              className="hidden"
              aria-label="Escolher arquivo da nova versão"
              onChange={(event) => {
                if (versionTarget.current) uploads.upload(event.target.files ?? [], { versionOf: versionTarget.current });
                versionTarget.current = null;
                event.target.value = "";
              }}
            />
            <button type="button" onClick={() => addInput.current?.click()} disabled={uploads.busy} className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
              <Upload size={14} aria-hidden="true" /> {uploads.busy ? "Enviando…" : "Enviar arquivos"}
            </button>
          </>
        )}
      </header>

      <div className="space-y-3 p-4">
        {volatile && canEdit && (
          <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">Este navegador não guarda arquivos.</p>
        )}
        <FileUploadFeedback summary={uploads.summary} onDismiss={uploads.clear} />
        {actionError && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{actionError}</p>}

        {isLoading ? (
          <div className="space-y-2" aria-label="Carregando anexos">
            {[0, 1].map((index) => <div key={index} className="h-12 animate-pulse rounded-md bg-muted/40" />)}
          </div>
        ) : error ? (
          <p role="alert" className="text-sm text-destructive">Não foi possível carregar os anexos. {describeFileError(error)}</p>
        ) : docs.length === 0 ? (
          <EmptyState
            icon={Paperclip}
            title="Nenhum anexo"
            className="py-6"
          />
        ) : (
          <ul className="divide-y rounded-md border">
            {docs.map((doc) => {
              const viewable = Boolean(doc.storage_key && previewKind(doc));
              return (
                <li key={doc.id} className="px-3 py-2">
                  <div className="flex flex-wrap items-center gap-3">
                    <FileTypeIcon name={doc.title} fileType={doc.type} size={20} className="shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      {viewable ? (
                        <button type="button" onClick={() => setPreview(doc)} className="block max-w-full truncate text-left text-sm font-medium hover:underline">{doc.title}</button>
                      ) : (
                        <p className="truncate text-sm font-medium">{doc.title}</p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        v{doc.version} · {doc.size_bytes ? formatBytes(doc.size_bytes) : "sem arquivo"} · {formatTimestamp(doc.created_at)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      {viewable && (
                        <button type="button" onClick={() => setPreview(doc)} aria-label={`Visualizar ${doc.title}`} title="Visualizar" className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><Eye size={15} /></button>
                      )}
                      <button type="button" onClick={() => download(doc)} disabled={!doc.storage_key} aria-label={`Baixar ${doc.title}`} title="Baixar" className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"><Download size={15} /></button>
                      <button
                        type="button"
                        onClick={() => setOpenVersions(openVersions === doc.id ? null : doc.id)}
                        aria-expanded={openVersions === doc.id}
                        aria-label={`Versões de ${doc.title}`}
                        title="Versões"
                        className={cn("rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground", openVersions === doc.id && "bg-muted text-foreground")}
                      >
                        <History size={15} />
                      </button>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => {
                            versionTarget.current = doc;
                            versionInput.current?.click();
                          }}
                          disabled={uploads.busy}
                          aria-label={`Enviar nova versão de ${doc.title}`}
                          title="Enviar nova versão"
                          className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                        >
                          <UploadCloud size={15} />
                        </button>
                      )}
                      {canEdit && (confirming === doc.id ? (
                        <>
                          <button type="button" onClick={() => remove.mutate(doc)} disabled={remove.isPending} className="rounded bg-destructive px-2 py-1 text-xs font-medium text-destructive-foreground disabled:opacity-50">Remover</button>
                          <button type="button" onClick={() => setConfirming(null)} className="rounded px-2 py-1 text-xs hover:bg-muted">Cancelar</button>
                        </>
                      ) : (
                        <button type="button" onClick={() => setConfirming(doc.id)} aria-label={`Remover ${doc.title}`} title="Remover (todas as versões)" className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 size={15} /></button>
                      ))}
                    </div>
                  </div>
                  {openVersions === doc.id && (
                    <div className="mt-3 pl-8">
                      <FileVersionList doc={doc} canRestore={canEdit} canDeleteVersion={canEdit} onChanged={(current) => setOpenVersions(current?.id ?? null)} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {drop.isDragging && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg bg-primary/10 text-sm font-medium text-primary-text">
          Solte os arquivos para anexar
        </div>
      )}
      {preview && <FilePreviewDialog doc={preview} onClose={() => setPreview(null)} />}
    </section>
  );
}

export default FileAttachments;
