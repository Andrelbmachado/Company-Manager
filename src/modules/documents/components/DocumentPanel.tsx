import { useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Eye, Pencil, Save, Trash2, UploadCloud, X } from "lucide-react";
import { FilePreviewDialog } from "@/components/shared/FilePreviewDialog";
import { FileTypeIcon } from "@/components/shared/FileTypeIcon";
import { FileUploadFeedback } from "@/components/shared/FileUploadFeedback";
import { FileVersionList } from "@/components/shared/FileVersionList";
import { useFileUploads } from "@/hooks/useFileUploads";
import { useRequiredSession } from "@/hooks/useSession";
import { getDb } from "@/lib/db/client";
import { formatBytes, formatTimestamp, previewKind } from "@/lib/files/format";
import { deleteFile, describeFileError, documentFolder, downloadFile } from "@/lib/files/store";
import type { DocumentRow, Role } from "@/types";
import { saveDocumentMetadata } from "../metadata";

interface DocumentPanelProps {
  doc: DocumentRow;
  onClose: () => void;
  /** Depois de nova versão, restauração ou edição: a versão atual (null = o documento saiu). */
  onChanged: (current: DocumentRow | null) => void;
  /** Enviar nova versão. */
  canUpload: boolean;
  /** Editar nome/observação e restaurar versão. */
  canEdit: boolean;
  /** Excluir o documento ou uma versão. */
  canDelete: boolean;
  /** Linha extra nos dados (ex.: registro dono do anexo). */
  extra?: { label: string; value: ReactNode };
}

const BUTTON = "flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50";
const INPUT = "w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";

function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-sm">{value ?? "—"}</dd>
    </div>
  );
}

/**
 * Ficha de um documento no próprio lugar, abaixo da lista (nada de painel lateral ou janela por cima para editar):
 * ações (ver, baixar, nova versão, excluir), nome e observação editáveis ali mesmo, dados do arquivo e versões.
 */
export function DocumentPanel({ doc, onClose, onChanged, canUpload, canEdit, canDelete, extra }: DocumentPanelProps) {
  const session = useRequiredSession();
  const companyId = session.company.id;
  const qc = useQueryClient();
  const uploads = useFileUploads({ companyId, userId: session.user.id });
  const versionInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(doc.title);
  const [description, setDescription] = useState(doc.description ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Anexo de registro se edita na ficha do registro.
  const editable = canEdit && !doc.entity_type;

  const { data: uploader } = useQuery({
    queryKey: ["users", "name", doc.uploaded_by],
    queryFn: async () => {
      const rows = await (await getDb()).select<{ id: string; name: string }[]>("SELECT id, name FROM users WHERE id=?", [doc.uploaded_by]);
      return rows[0]?.name ?? null;
    },
    enabled: Boolean(doc.uploaded_by),
    staleTime: 5 * 60_000,
  });

  const saveData = useMutation({
    mutationFn: async () => {
      const fields: { id: string; title?: string; description?: string | null } = { id: doc.id };
      if (title.trim() !== doc.title) fields.title = title;
      if (description.trim() !== (doc.description ?? "")) fields.description = description;
      await saveDocumentMetadata(companyId, { role: session.membership.role as Role, userId: session.user.id }, documentFolder(doc), { created: [], updated: [fields] });
      const [current] = await (await getDb()).select<DocumentRow[]>("SELECT * FROM documents WHERE company_id=? AND id=?", [companyId, doc.id]);
      return current ?? null;
    },
    onMutate: () => setError(null),
    onSuccess: (current) => {
      setEditing(false);
      if (current) onChanged(current);
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

  function startEditing() {
    setTitle(doc.title);
    setDescription(doc.description ?? "");
    setError(null);
    setEditing(true);
  }

  const viewable = Boolean(doc.storage_key && previewKind(doc));
  const folder = documentFolder(doc);

  return (
    <section data-document-panel aria-label={`Detalhes de ${doc.title}`} className="space-y-5 rounded-xl border bg-card p-5">
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <FileTypeIcon name={doc.title} fileType={doc.type} size={28} className="shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold" title={doc.title}>{doc.title}</h3>
            <p className="text-xs text-muted-foreground">{doc.type ?? "Arquivo"} · v{doc.version}</p>
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Fechar detalhes" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
          <X size={16} />
        </button>
      </header>

      <div className="flex flex-wrap gap-2">
        {viewable && <button type="button" onClick={() => setPreview(true)} className={BUTTON}><Eye size={14} aria-hidden="true" /> Visualizar</button>}
        <button type="button" onClick={download} disabled={!doc.storage_key} className={BUTTON}><Download size={14} aria-hidden="true" /> Baixar</button>
        {canUpload && (
          <>
            <input ref={versionInput} type="file" className="hidden" aria-label="Escolher arquivo da nova versão" onChange={(event) => { void sendVersion(event.target.files); event.target.value = ""; }} />
            <button type="button" onClick={() => versionInput.current?.click()} disabled={uploads.busy} className={BUTTON}><UploadCloud size={14} aria-hidden="true" /> {uploads.busy ? "Enviando…" : "Nova versão"}</button>
          </>
        )}
        {editable && !editing && <button type="button" onClick={startEditing} className={BUTTON}><Pencil size={14} aria-hidden="true" /> Editar dados</button>}
        {canDelete && (confirmDelete ? (
          <span className="flex items-center gap-1">
            <button type="button" onClick={() => remove.mutate()} disabled={remove.isPending} className="rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground disabled:opacity-50">Excluir todas as versões</button>
            <button type="button" onClick={() => setConfirmDelete(false)} className="rounded-md px-3 py-1.5 text-sm hover:bg-muted">Cancelar</button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirmDelete(true)} className={`${BUTTON} text-destructive hover:bg-destructive/10`}><Trash2 size={14} aria-hidden="true" /> Excluir</button>
        ))}
      </div>

      {!doc.storage_key && (
        <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
          Registro antigo, só com os dados: ainda não há arquivo salvo.{canUpload ? " Use Nova versão para enviar o arquivo." : ""}
        </p>
      )}
      <FileUploadFeedback summary={uploads.summary} onDismiss={uploads.clear} />
      {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      {editing && (
        <form
          aria-label="Dados do documento"
          onSubmit={(event) => { event.preventDefault(); saveData.mutate(); }}
          className="space-y-3 rounded-lg border bg-muted/20 p-4"
        >
          <label className="block space-y-1 text-xs font-medium">
            Nome do arquivo
            <input value={title} onChange={(event) => setTitle(event.target.value)} aria-label="Nome do arquivo" required className={INPUT} />
          </label>
          <label className="block space-y-1 text-xs font-medium">
            Observação
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} aria-label="Observação" rows={3} className={INPUT} />
          </label>
          <p className="text-xs text-muted-foreground">O nome vale para todas as versões. Barras e caracteres proibidos em nomes de arquivo são trocados.</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setEditing(false)} className={BUTTON}>Cancelar</button>
            <button type="submit" disabled={saveData.isPending} className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              <Save size={14} aria-hidden="true" /> Salvar
            </button>
          </div>
        </form>
      )}

      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Info label="Tipo" value={doc.type} />
        <Info label="Versão" value={`v${doc.version}`} />
        <Info label="Tamanho" value={doc.size_bytes ? formatBytes(doc.size_bytes) : "—"} />
        <Info label="Enviado em" value={formatTimestamp(doc.created_at)} />
        <Info label="Enviado por" value={uploader ?? "—"} />
        {doc.entity_type ? extra && <Info label={extra.label} value={extra.value} /> : <Info label="Pasta" value={folder ? `/${folder}` : "/"} />}
        {doc.original_name && doc.original_name !== doc.title && <Info label="Nome original" value={doc.original_name} />}
        {!editing && doc.description && <Info label="Observação" value={doc.description} />}
        {doc.sha256 && <Info label="SHA-256" value={<span className="break-all font-mono text-xs" title={doc.sha256}>{doc.sha256}</span>} />}
      </dl>

      <FileVersionList doc={doc} canRestore={canEdit} canDeleteVersion={canDelete} onChanged={onChanged} />
      {preview && <FilePreviewDialog doc={doc} onClose={() => setPreview(false)} />}
    </section>
  );
}
