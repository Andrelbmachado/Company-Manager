import { useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Eye, Trash2, UploadCloud } from "lucide-react";
import { CrudDialog } from "@/components/shared/CrudDialog";
import { DetailDrawer, DetailGrid, DetailItem } from "@/components/shared/DetailDrawer";
import { FilePreviewDialog } from "@/components/shared/FilePreviewDialog";
import { FileUploadFeedback } from "@/components/shared/FileUploadFeedback";
import { FileVersionList } from "@/components/shared/FileVersionList";
import { useFileUploads } from "@/hooks/useFileUploads";
import { useRequiredSession } from "@/hooks/useSession";
import { getDb } from "@/lib/db/client";
import { formatBytes, formatTimestamp, previewKind } from "@/lib/files/format";
import { deleteFile, describeFileError, documentFolder, downloadFile, renameDocument } from "@/lib/files/store";
import type { DocumentRow } from "@/types";

interface DocumentDrawerProps {
  doc: DocumentRow;
  onClose: () => void;
  /** Depois de nova versão, restauração ou renomear: a versão atual (null = o documento saiu). */
  onChanged: (current: DocumentRow | null) => void;
  /** Enviar nova versão. */
  canUpload: boolean;
  /** Renomear e restaurar versão. */
  canEdit: boolean;
  /** Excluir o documento ou uma versão. */
  canDelete: boolean;
  /** Linha extra nos detalhes (ex.: registro dono do anexo). */
  extra?: ReactNode;
}

/** Detalhe de um documento: ações (ver, baixar, nova versão, renomear, excluir), dados do arquivo e versões. */
export function DocumentDrawer({ doc, onClose, onChanged, canUpload, canEdit, canDelete, extra }: DocumentDrawerProps) {
  const session = useRequiredSession();
  const companyId = session.company.id;
  const qc = useQueryClient();
  const uploads = useFileUploads({ companyId, userId: session.user.id });
  const versionInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newTitle, setNewTitle] = useState(doc.title);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: uploader } = useQuery({
    queryKey: ["users", "name", doc.uploaded_by],
    queryFn: async () => {
      const rows = await (await getDb()).select<{ id: string; name: string }[]>("SELECT id, name FROM users WHERE id=?", [doc.uploaded_by]);
      return rows[0]?.name ?? null;
    },
    enabled: Boolean(doc.uploaded_by),
    staleTime: 5 * 60_000,
  });

  const rename = useMutation({
    mutationFn: () => renameDocument(doc, newTitle, session.user.id),
    onMutate: () => setError(null),
    onSuccess: (current) => {
      setRenaming(false);
      onChanged(current);
    },
    onError: (reason) => setError(describeFileError(reason)),
    onSettled: () => qc.invalidateQueries({ queryKey: ["documents", companyId] }),
  });

  const remove = useMutation({
    mutationFn: () => deleteFile(doc, { userId: session.user.id }),
    onMutate: () => setError(null),
    onSuccess: () => onChanged(null),
    onError: (reason) => setError(describeFileError(reason)),
    onSettled: () => qc.invalidateQueries({ queryKey: ["documents", companyId] }),
  });

  async function download() {
    setError(null);
    try {
      await downloadFile(doc);
    } catch (reason) {
      setError(describeFileError(reason));
    }
  }

  async function sendVersion(files: FileList | null) {
    if (!files?.length) return;
    const result = await uploads.uploadAsync(files, { versionOf: doc });
    if (result.saved[0]) onChanged(result.saved[0]);
  }

  const viewable = Boolean(doc.storage_key && previewKind(doc));
  const folder = documentFolder(doc);
  const button = "flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50";

  return (
    <>
      <DetailDrawer title={doc.title} subtitle={`${doc.type ?? "Arquivo"} · v${doc.version}`} onClose={onClose} onEdit={canEdit ? () => { setNewTitle(doc.title); setRenaming(true); } : undefined}>
        <div className="space-y-5">
          <div className="flex flex-wrap gap-2">
            {viewable && <button type="button" onClick={() => setPreview(true)} className={button}><Eye size={14} aria-hidden="true" /> Visualizar</button>}
            <button type="button" onClick={download} disabled={!doc.storage_key} className={button}><Download size={14} aria-hidden="true" /> Baixar</button>
            {canUpload && (
              <>
                <input ref={versionInput} type="file" className="hidden" aria-label="Escolher arquivo da nova versão" onChange={(event) => { void sendVersion(event.target.files); event.target.value = ""; }} />
                <button type="button" onClick={() => versionInput.current?.click()} disabled={uploads.busy} className={button}><UploadCloud size={14} aria-hidden="true" /> {uploads.busy ? "Enviando…" : "Nova versão"}</button>
              </>
            )}
            {canDelete && (confirmDelete ? (
              <span className="flex items-center gap-1">
                <button type="button" onClick={() => remove.mutate()} disabled={remove.isPending} className="rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground disabled:opacity-50">Excluir todas as versões</button>
                <button type="button" onClick={() => setConfirmDelete(false)} className="rounded-md px-3 py-1.5 text-sm hover:bg-muted">Cancelar</button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirmDelete(true)} className={`${button} text-destructive hover:bg-destructive/10`}><Trash2 size={14} aria-hidden="true" /> Excluir</button>
            ))}
          </div>

          {!doc.storage_key && (
            <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
              Registro antigo, só com os dados: ainda não há arquivo salvo.{canUpload ? " Use Nova versão para enviar o arquivo." : ""}
            </p>
          )}
          <FileUploadFeedback summary={uploads.summary} onDismiss={uploads.clear} />
          {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

          <DetailGrid>
            <DetailItem label="Tipo" value={doc.type} />
            <DetailItem label="Versão" value={`v${doc.version}`} />
            <DetailItem label="Tamanho" value={doc.size_bytes ? formatBytes(doc.size_bytes) : "—"} />
            <DetailItem label="Enviado em" value={formatTimestamp(doc.created_at)} />
            <DetailItem label="Enviado por" value={uploader ?? "—"} />
            {doc.entity_type ? extra : <DetailItem label="Pasta" value={folder ? `/${folder}` : "/"} />}
            {doc.original_name && doc.original_name !== doc.title && <DetailItem label="Nome original" value={doc.original_name} />}
            {doc.description && <DetailItem label="Observação" value={doc.description} />}
            {doc.sha256 && <DetailItem label="SHA-256" value={<span className="break-all font-mono text-xs" title={doc.sha256}>{doc.sha256}</span>} />}
          </DetailGrid>

          <FileVersionList doc={doc} canRestore={canEdit} canDeleteVersion={canDelete} onChanged={onChanged} />
        </div>
      </DetailDrawer>
      {preview && <FilePreviewDialog doc={doc} onClose={() => setPreview(false)} />}
      {renaming && (
        <CrudDialog
          title="Renomear arquivo"
          fields={[{ key: "title", label: "Nome do arquivo", required: true }]}
          values={{ title: newTitle }}
          onChange={(_, value) => setNewTitle(value)}
          onClose={() => setRenaming(false)}
          onSubmit={() => rename.mutate()}
          busy={rename.isPending}
        >
          <p className="mt-3 text-xs text-muted-foreground">Vale para todas as versões. Barras e caracteres proibidos em nomes de arquivo são trocados.</p>
          {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
        </CrudDialog>
      )}
    </>
  );
}
