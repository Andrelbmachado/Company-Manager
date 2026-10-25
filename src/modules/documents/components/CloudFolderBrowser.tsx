import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Cloud, RefreshCw, Upload, X } from "lucide-react";
import { FilePreview, type FilePreviewSource } from "@/components/shared/FilePreviewDialog";
import { FileTypeIcon } from "@/components/shared/FileTypeIcon";
import { PageToolbar } from "@/components/shared/PageToolbar";
import { useFileDrop } from "@/components/shared/useFileDrop";
import { emit } from "@/lib/events/bus";
import {
  CLOUD_PROVIDERS,
  CloudFolderError,
  browseCloudFolder,
  describeCloudError,
  getCloudEnv,
  normalizeLocalPath,
  openCloudFile,
  sendToCloudFolder,
  type CloudEntry,
} from "@/lib/files/cloudFolders";
import { fileTypeLabel, formatBytes, formatTimestamp, guessMime } from "@/lib/files/format";
import { saveBlobAs } from "@/lib/files/saveAs";
import { getMaxFileBytes, readBlobBytes } from "@/lib/files/store";
import { cn } from "@/lib/utils";
import type { CloudFolder, Role } from "@/types";
import { foldName } from "../access";
import { FolderIcon } from "./FolderIcon";

interface CloudFolderBrowserProps {
  folder: CloudFolder;
  role: Role;
  companyId: string;
  userId: string;
  /** attach em documents: enviar arquivo para a pasta da nuvem. */
  canUpload: boolean;
  /** Volta para as pastas dos Documentos. */
  onExit: () => void;
}

interface CloudUploadSummary {
  saved: string[];
  failed: { name: string; message: string }[];
}

const TILE = "group min-h-[9rem] rounded-xl border border-transparent p-3 text-center transition-all hover:border-border hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const BUTTON = "flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-60";

const samePath = (a: string, b: string) => a.normalize("NFC").toLocaleLowerCase("pt-BR") === b.normalize("NFC").toLocaleLowerCase("pt-BR");
const toBlob = (bytes: Uint8Array, name: string) => new Blob([bytes.slice().buffer], { type: guessMime(name) });

/**
 * Conteúdo de uma pasta de nuvem conectada (lida direto do disco do Mac, nada vai para o banco): navegar, abrir,
 * baixar uma cópia e enviar arquivo novo (nunca sobrescreve). Links simbólicos e itens ocultos não aparecem.
 */
export function CloudFolderBrowser({ folder, role, companyId, userId, canUpload, onExit }: CloudFolderBrowserProps) {
  const qc = useQueryClient();
  const uploadInput = useRef<HTMLInputElement>(null);
  const [path, setPath] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState<CloudEntry | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<CloudUploadSummary | null>(null);
  const provider = CLOUD_PROVIDERS[folder.provider] ?? CLOUD_PROVIDERS.outro;
  const actor = useMemo(() => ({ role, userId }), [role, userId]);

  const listing = useQuery({
    queryKey: ["documents", companyId, "cloud", folder.id, folder.local_path, ...path],
    queryFn: () => browseCloudFolder(actor, folder, path),
    retry: false,
  });
  const entries = listing.data ?? [];
  const errorCode = listing.error instanceof CloudFolderError ? listing.error.code : null;

  const needle = foldName(search);
  const visible = useMemo(() => entries.filter((entry) => foldName(entry.name).includes(needle)), [entries, needle]);

  async function upload(files: File[]) {
    if (files.length === 0) return;
    setBusy(true);
    setSummary(null);
    setNotice(null);
    const result: CloudUploadSummary = { saved: [], failed: [] };
    const maxBytes = await getMaxFileBytes(companyId).catch(() => undefined);
    for (const file of files) {
      try {
        const bytes = await readBlobBytes(file);
        const saved = await sendToCloudFolder(actor, folder, path, file.name, bytes, { maxBytes });
        result.saved.push(saved);
        await emit({
          type: "documents.cloud_upload",
          companyId,
          actorId: userId,
          entityType: "cloud_folder",
          entityId: folder.id,
          title: `Arquivo enviado para ${folder.label}: ${saved}`,
          module: "documents",
          metadata: { path: [...path, saved].join("/"), size_bytes: bytes.byteLength },
        });
      } catch (error) {
        result.failed.push({ name: file.name, message: describeCloudError(error) });
      }
    }
    setSummary(result);
    setBusy(false);
    await qc.invalidateQueries({ queryKey: ["documents", companyId, "cloud", folder.id] });
  }

  const drop = useFileDrop((files) => void upload(files), { disabled: !canUpload || busy || Boolean(preview) || Boolean(listing.error) });

  /** Depois de reabrir o app, pasta fora das pastas padrão precisa ser escolhida de novo no seletor (o Tauri só libera assim). */
  async function grantAccess() {
    setNotice(null);
    const chosen = await getCloudEnv().pickFolder({ defaultPath: folder.local_path, title: `Liberar acesso: ${folder.label}` });
    if (!chosen) return;
    let normalized: string;
    try {
      normalized = normalizeLocalPath(chosen);
    } catch (error) {
      setNotice(describeCloudError(error));
      return;
    }
    if (!samePath(normalized, folder.local_path)) {
      setNotice(`Você escolheu outra pasta (${normalized}). Para trocar a pasta conectada, edite-a em Conectar nuvem.`);
      return;
    }
    await listing.refetch();
  }

  const previewSource = useMemo<FilePreviewSource | null>(() => {
    if (!preview) return null;
    const relative = [...path, preview.name];
    return {
      title: preview.name,
      subtitle: [fileTypeLabel(preview.name), formatBytes(preview.size), provider.label].filter(Boolean).join(" · "),
      mime: guessMime(preview.name),
      load: async () => toBlob(await openCloudFile(actor, folder, relative), preview.name),
      download: async () => saveBlobAs(toBlob(await openCloudFile(actor, folder, relative), preview.name), preview.name),
      describeError: describeCloudError,
    };
  }, [preview, path, folder, actor, provider.label]);

  function openEntry(entry: CloudEntry) {
    setNotice(null);
    if (entry.isDir) {
      setPath([...path, entry.name]);
      setSearch("");
      return;
    }
    if (entry.cloudOnly) {
      setNotice(`“${entry.name}” ainda não foi baixado neste Mac. Abra a pasta no Finder para baixar do iCloud e tente de novo.`);
      return;
    }
    setPreview(entry);
  }

  return (
    <div {...drop.bind} className={cn("relative space-y-4 rounded-lg", drop.isDragging && "ring-2 ring-primary/40")}>
      <PageToolbar search={search} onSearchChange={setSearch} searchPlaceholder={`Buscar em ${folder.label}...`}>
        <button type="button" onClick={() => void listing.refetch()} disabled={listing.isFetching} className={BUTTON}>
          <RefreshCw size={14} aria-hidden="true" className={cn(listing.isFetching && "animate-spin")} /> Atualizar
        </button>
        {canUpload && (
          <>
            <input
              ref={uploadInput}
              type="file"
              multiple
              className="hidden"
              aria-label="Escolher arquivos para enviar à nuvem"
              onChange={(event) => {
                void upload(Array.from(event.target.files ?? []));
                event.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => uploadInput.current?.click()}
              disabled={busy || Boolean(listing.error)}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              <Upload size={14} aria-hidden="true" /> {busy ? "Enviando…" : "Enviar arquivos"}
            </button>
          </>
        )}
      </PageToolbar>

      <nav aria-label="Caminho da pasta" className="flex flex-wrap items-center gap-1 text-sm">
        <button type="button" onClick={onExit} className="rounded px-1 py-1 font-medium text-foreground hover:bg-muted">Documentos /</button>
        <button type="button" onClick={() => { setPath([]); setSearch(""); }} aria-current={path.length === 0 ? "location" : undefined} className="flex items-center gap-1 rounded px-1 py-1 text-muted-foreground hover:bg-muted hover:text-foreground">
          <Cloud size={13} aria-hidden="true" /> {folder.label} /
        </button>
        {path.map((segment, index) => (
          <button key={`${segment}-${index}`} type="button" onClick={() => setPath(path.slice(0, index + 1))} aria-current={index === path.length - 1 ? "location" : undefined} className="rounded px-1 py-1 text-muted-foreground hover:bg-muted hover:text-foreground">
            {segment} /
          </button>
        ))}
        <span className="ml-auto truncate text-xs text-muted-foreground" title={folder.local_path}>{provider.label} · {folder.local_path}</span>
      </nav>

      {notice && (
        <p role="status" className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground">
          <span className="flex-1">{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Fechar aviso" className="rounded p-0.5 hover:bg-muted"><X size={14} /></button>
        </p>
      )}
      {summary && (summary.saved.length > 0 || summary.failed.length > 0) && (
        <div className="space-y-2 text-sm">
          {summary.saved.length > 0 && (
            <p role="status" className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 size={15} aria-hidden="true" />
              <span className="flex-1">{summary.saved.length === 1 ? "1 arquivo enviado" : `${summary.saved.length} arquivos enviados`} para {folder.label}.</span>
              <button type="button" onClick={() => setSummary(null)} aria-label="Fechar aviso" className="rounded p-0.5 hover:bg-emerald-500/20"><X size={14} /></button>
            </p>
          )}
          {summary.failed.length > 0 && (
            <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive">
              <p className="flex items-center gap-2 font-medium"><AlertCircle size={15} aria-hidden="true" /> {summary.failed.length === 1 ? "1 arquivo não foi enviado" : `${summary.failed.length} arquivos não foram enviados`}</p>
              <ul className="mt-1 space-y-0.5 pl-6 text-xs">{summary.failed.map((failure, index) => <li key={`${failure.name}-${index}`}>{failure.message}</li>)}</ul>
            </div>
          )}
        </div>
      )}

      {listing.isLoading ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-32 animate-pulse rounded-lg bg-muted/40" />)}
        </div>
      ) : listing.error ? (
        <div role="alert" className="flex flex-col items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-3 text-sm text-destructive">
          <span>{describeCloudError(listing.error)}</span>
          {errorCode === "no_access" && (
            <button type="button" onClick={() => void grantAccess()} className="rounded-md border border-destructive/40 px-3 py-1.5 text-xs font-medium hover:bg-destructive/10">
              Escolher a pasta de novo
            </button>
          )}
        </div>
      ) : visible.length === 0 ? (
        <div className="flex min-h-60 flex-col items-center justify-center rounded-lg border border-dashed text-center">
          <FolderIcon cloud />
          <p className="mt-3 text-sm font-medium">{search ? "Nada encontrado" : "Esta pasta está vazia"}</p>
          <p className="mt-1 text-xs text-muted-foreground">{canUpload ? "Arraste arquivos para cá ou use Enviar arquivos." : "Nenhum arquivo nesta pasta."}</p>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-3">
          {visible.map((entry) => (
            <button key={`${entry.isDir ? "d" : "f"}-${entry.name}`} type="button" onClick={() => openEntry(entry)} className={cn(TILE, entry.cloudOnly && "opacity-70")}>
              {entry.isDir ? (
                <span className="flex h-full flex-col items-center justify-center">
                  <FolderIcon />
                  <span className="mt-3 w-full truncate text-sm font-medium" title={entry.name}>{entry.name}</span>
                </span>
              ) : (
                <span className="flex h-full flex-col items-center justify-start pt-1">
                  <FileTypeIcon name={entry.name} size={40} strokeWidth={1.5} className="shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5" />
                  <span className="mt-3 line-clamp-2 w-full break-words text-sm font-medium leading-snug" title={entry.name}>{entry.name}</span>
                  <span className="mt-1 text-[11px] text-muted-foreground">{entry.cloudOnly ? "Só na nuvem" : formatBytes(entry.size)}</span>
                  {entry.modified && <span className="text-[11px] text-muted-foreground">{formatTimestamp(entry.modified)}</span>}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {drop.isDragging && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg bg-primary/10 text-sm font-medium text-primary-text">
          Solte para enviar para {[folder.label, ...path].join(" / ")}
        </div>
      )}

      {previewSource && <FilePreview source={previewSource} onClose={() => setPreview(null)} />}
    </div>
  );
}
