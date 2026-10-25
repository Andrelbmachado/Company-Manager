import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FolderPlus, Upload } from "lucide-react";
import { CrudDialog } from "@/components/shared/CrudDialog";
import { FileTypeIcon } from "@/components/shared/FileTypeIcon";
import { FileUploadFeedback } from "@/components/shared/FileUploadFeedback";
import { PageToolbar } from "@/components/shared/PageToolbar";
import { useFileDrop } from "@/components/shared/useFileDrop";
import { useFileUploads } from "@/hooks/useFileUploads";
import { formatBytes } from "@/lib/files/format";
import { documentFolder, getFileBackend, listFolderDocuments, sanitizeFileName } from "@/lib/files/store";
import { cn } from "@/lib/utils";
import type { DocumentRow, Role } from "@/types";
import { canSeeFolder, defaultRoot, foldName, visibleRoots } from "../access";
import { DocumentDrawer } from "./DocumentDrawer";

interface FolderBrowserProps {
  role: Role;
  companyId: string;
  userId: string;
  /** attach em documents: enviar arquivos, nova versão, criar pasta. */
  canUpload: boolean;
  /** edit em documents: renomear, restaurar versão. */
  canEdit: boolean;
  /** delete em documents: excluir documento ou versão. */
  canDelete: boolean;
}

const split = (folder: string) => folder.split("/").filter(Boolean);
const startsWith = (values: string[], prefix: string[]) => prefix.every((value, index) => values[index] === value);

/** Pastas e arquivos (versão atual) que o setor enxerga, com envio por botão ou arrastando para a pasta aberta. */
export function FolderBrowser({ role, companyId, userId, canUpload, canEdit, canDelete }: FolderBrowserProps) {
  const uploadInput = useRef<HTMLInputElement>(null);
  const [path, setPath] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<DocumentRow | null>(null);
  const [createdFolders, setCreatedFolders] = useState<string[]>([]);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderName, setFolderName] = useState("");
  const uploads = useFileUploads({ companyId, userId });

  const { data: docs = [], isLoading, error } = useQuery({
    queryKey: ["documents", companyId, "folders"],
    queryFn: () => listFolderDocuments(companyId),
  });

  const visibleDocs = useMemo(() => docs.filter((doc) => canSeeFolder(role, documentFolder(doc))), [docs, role]);
  const knownFolders = useMemo(
    () => [...new Set([...visibleDocs.map((doc) => documentFolder(doc)), ...createdFolders])].filter((folder) => folder && canSeeFolder(role, folder)),
    [visibleDocs, createdFolders, role],
  );

  /** Destino do envio: a pasta aberta ou, na raiz, a pasta do setor (com a grafia que já existe, se existir). */
  const uploadFolder = useMemo(() => {
    if (path.length > 0) return path.join("/");
    const wanted = foldName(defaultRoot(role));
    return knownFolders.map((folder) => split(folder)[0]).find((root) => foldName(root) === wanted) ?? defaultRoot(role);
  }, [path, role, knownFolders]);

  // Com o detalhe ou um diálogo aberto por cima, soltar arquivo não envia para a pasta de trás.
  const drop = useFileDrop((files) => uploads.upload(files, { folder: uploadFolder }), { disabled: !canUpload || uploads.busy || Boolean(selected) || creatingFolder });

  const needle = foldName(search);
  const folders = useMemo(() => {
    const names = new Set<string>();
    for (const folder of knownFolders) {
      const parts = split(folder);
      if (parts.length > path.length && startsWith(parts, path)) names.add(parts[path.length]);
    }
    return [...names].filter((name) => foldName(name).includes(needle)).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [knownFolders, path, needle]);

  // Sem busca: arquivos da pasta aberta. Com busca: também os das subpastas, com o caminho.
  const files = useMemo(
    () =>
      visibleDocs
        .filter((doc) => {
          const parts = split(documentFolder(doc));
          if (!startsWith(parts, path)) return false;
          return needle ? foldName(doc.title).includes(needle) : parts.length === path.length;
        })
        .sort((a, b) => a.title.localeCompare(b.title, "pt-BR")),
    [visibleDocs, path, needle],
  );

  const roots = visibleRoots(role);
  const canCreateFolder = canUpload && (path.length > 0 || roots === "*");

  function createFolder() {
    const name = sanitizeFileName(folderName, "");
    if (!name) return;
    setCreatedFolders((current) => [...current, [...path, name].join("/")]);
    setPath([...path, name]);
    setCreatingFolder(false);
    setFolderName("");
  }

  return (
    <div {...drop.bind} className={cn("relative space-y-4 rounded-lg", drop.isDragging && "ring-2 ring-primary/40")}>
      <PageToolbar search={search} onSearchChange={setSearch} searchPlaceholder="Buscar nesta pasta e nas subpastas...">
        {canCreateFolder && (
          <button type="button" onClick={() => setCreatingFolder(true)} className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted">
            <FolderPlus size={14} aria-hidden="true" /> Nova pasta
          </button>
        )}
        {canUpload && (
          <>
            <input
              ref={uploadInput}
              type="file"
              multiple
              className="hidden"
              aria-label="Escolher arquivos para enviar"
              onChange={(event) => {
                uploads.upload(event.target.files ?? [], { folder: uploadFolder });
                event.target.value = "";
              }}
            />
            <button type="button" onClick={() => uploadInput.current?.click()} disabled={uploads.busy} className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
              <Upload size={14} aria-hidden="true" /> {uploads.busy ? "Enviando…" : "Enviar arquivos"}
            </button>
          </>
        )}
      </PageToolbar>

      <nav aria-label="Caminho da pasta" className="flex flex-wrap items-center gap-1 text-sm">
        <button type="button" onClick={() => setPath([])} className="rounded px-1 py-1 font-medium text-foreground hover:bg-muted">Documentos /</button>
        {path.map((segment, index) => (
          <button key={`${segment}-${index}`} type="button" onClick={() => setPath(path.slice(0, index + 1))} aria-current={index === path.length - 1 ? "location" : undefined} className="rounded px-1 py-1 text-muted-foreground hover:bg-muted hover:text-foreground">
            {segment} /
          </button>
        ))}
        {canUpload && <span className="ml-auto text-xs text-muted-foreground">Envios e arquivos arrastados vão para /{uploadFolder}</span>}
      </nav>

      {!getFileBackend().persistent && canUpload && (
        <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">Este navegador não guarda arquivos (sem IndexedDB): os arquivos enviados somem ao recarregar a página.</p>
      )}
      <FileUploadFeedback summary={uploads.summary} onDismiss={uploads.clear} />

      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 8 }).map((_, index) => <div key={index} className="h-32 animate-pulse rounded-lg bg-muted/40" />)}
        </div>
      ) : error ? (
        <p role="alert" className="text-sm text-destructive">Não foi possível carregar os documentos.</p>
      ) : folders.length === 0 && files.length === 0 ? (
        <div className="flex min-h-60 flex-col items-center justify-center rounded-lg border border-dashed text-center">
          <FolderIcon />
          <p className="mt-3 text-sm font-medium">{search ? "Nada encontrado" : "Esta pasta está vazia"}</p>
          <p className="mt-1 text-xs text-muted-foreground">{canUpload ? "Arraste arquivos para cá ou use Enviar arquivos." : "Nenhum arquivo nesta pasta."}</p>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-3">
          {folders.map((folder) => (
            <button key={folder} type="button" onClick={() => { setPath([...path, folder]); setSearch(""); }} className="group min-h-[9rem] rounded-xl border border-transparent p-3 text-center transition-all hover:border-border hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className="flex h-full flex-col items-center justify-center">
                <FolderIcon />
                <span className="mt-3 w-full truncate text-sm font-medium">{folder}</span>
              </span>
            </button>
          ))}
          {files.map((file) => {
            const relative = split(documentFolder(file)).slice(path.length).join("/");
            return (
              <button key={file.id} type="button" onClick={() => setSelected(file)} className="group min-h-[9rem] rounded-xl border border-transparent p-3 text-center transition-all hover:border-border hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="flex h-full flex-col items-center justify-start pt-1">
                  <FileTypeIcon name={file.title} fileType={file.type} size={40} strokeWidth={1.5} className="shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5" />
                  <span className="mt-3 line-clamp-2 w-full break-words text-sm font-medium leading-snug" title={file.title}>{file.title}</span>
                  <span className="mt-1 text-[11px] text-muted-foreground">{file.type} · v{file.version}</span>
                  <span className="text-[11px] text-muted-foreground">{file.size_bytes ? formatBytes(file.size_bytes) : "sem arquivo"}</span>
                  {needle && relative && <span className="mt-0.5 w-full truncate text-[10px] text-muted-foreground">em {relative}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {drop.isDragging && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg bg-primary/10 text-sm font-medium text-primary-text">
          Solte para enviar para /{uploadFolder}
        </div>
      )}

      {selected && (
        <DocumentDrawer
          doc={selected}
          onClose={() => setSelected(null)}
          onChanged={setSelected}
          canUpload={canUpload}
          canEdit={canEdit}
          canDelete={canDelete}
        />
      )}
      {creatingFolder && (
        <CrudDialog
          title="Nova pasta"
          fields={[{ key: "name", label: "Nome da pasta", required: true, placeholder: "Ex.: Contratos 2026" }]}
          values={{ name: folderName }}
          onChange={(_, value) => setFolderName(value)}
          onClose={() => setCreatingFolder(false)}
          onSubmit={createFolder}
          submitLabel="Criar e abrir"
        >
          <p className="mt-3 text-xs text-muted-foreground">Dentro de /{path.join("/") || ""}. A pasta passa a existir quando o primeiro arquivo for enviado para ela.</p>
        </CrudDialog>
      )}
    </div>
  );
}

function FolderIcon() {
  return (
    <span aria-hidden="true" className="relative block h-12 w-16 transition-transform group-hover:-translate-y-0.5">
      <span className="absolute left-1 top-1 h-4 w-7 rounded-t-md bg-blue-400" />
      <span className="absolute inset-x-0 bottom-0 h-10 rounded-md bg-gradient-to-b from-blue-300 to-blue-500 shadow-sm" />
      <span className="absolute inset-x-1 bottom-1 h-8 rounded bg-gradient-to-b from-blue-200/80 to-blue-400/30" />
    </span>
  );
}
