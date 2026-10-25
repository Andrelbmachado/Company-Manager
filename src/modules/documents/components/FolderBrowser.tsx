import { Fragment, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderPlus, Upload } from "lucide-react";
import { EditableTable, type EditableColumn, type EditableTableChanges } from "@/components/shared/EditableTable";
import { FileTypeIcon } from "@/components/shared/FileTypeIcon";
import { FileUploadFeedback } from "@/components/shared/FileUploadFeedback";
import { PageToolbar } from "@/components/shared/PageToolbar";
import { useFileDrop } from "@/components/shared/useFileDrop";
import { useFileUploads } from "@/hooks/useFileUploads";
import { formatBytes, formatTimestamp } from "@/lib/files/format";
import { documentFolder, getFileBackend, listFolderDocuments, sanitizeFileName } from "@/lib/files/store";
import { cn } from "@/lib/utils";
import type { DocumentRow, Role } from "@/types";
import { canSeeFolder, defaultRoot, foldName, visibleRoots } from "../access";
import { saveDocumentMetadata } from "../metadata";
import { DocumentPanel } from "./DocumentPanel";
import { FolderIcon } from "./FolderIcon";

interface FolderBrowserProps {
  role: Role;
  companyId: string;
  userId: string;
  /** attach em documents: enviar arquivos, nova versão, criar pasta. */
  canUpload: boolean;
  /** edit em documents: nome/observação, restaurar versão. */
  canEdit: boolean;
  /** delete em documents: excluir documento ou versão. */
  canDelete: boolean;
  /** Só na raiz: botões a mais na barra (ex.: Conectar nuvem). */
  rootActions?: ReactNode;
  /** Só na raiz: painel logo abaixo da barra (ex.: Conectar nuvem aberto). */
  rootPanel?: ReactNode;
  /** Só na raiz: itens a mais na grade, depois das pastas internas (ex.: pastas de nuvem conectadas); a busca filtra por `name`. */
  rootTiles?: { key: string; name: string; element: ReactNode }[];
}

const split = (folder: string) => folder.split("/").filter(Boolean);
const startsWith = (values: string[], prefix: string[]) => prefix.every((value, index) => values[index] === value);

/**
 * Pastas (navegação) e os arquivos da pasta aberta numa EditableTable: nome e observação editáveis na própria linha,
 * Adicionar registra um documento só com os dados (o arquivo vem por Nova versão). Envio por botão ou arrastando.
 * Na raiz, a tela pode pôr botões, um painel e itens a mais na grade (pastas de nuvem conectadas).
 */
export function FolderBrowser({ role, companyId, userId, canUpload, canEdit, canDelete, rootActions, rootPanel, rootTiles = [] }: FolderBrowserProps) {
  const qc = useQueryClient();
  const uploadInput = useRef<HTMLInputElement>(null);
  const [path, setPath] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<DocumentRow | null>(null);
  const [createdFolders, setCreatedFolders] = useState<string[]>([]);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [folderName, setFolderName] = useState("");
  const uploads = useFileUploads({ companyId, userId });

  const queryKey = ["documents", companyId, "folders"];
  const { data: docs = [], isLoading, error, refetch } = useQuery({ queryKey, queryFn: () => listFolderDocuments(companyId) });

  const visibleDocs = useMemo(() => docs.filter((doc) => canSeeFolder(role, documentFolder(doc))), [docs, role]);
  // A linha relida da lista (nome novo depois de salvar) ou, logo após nova versão, a que o painel devolveu.
  const selected = picked ? visibleDocs.find((doc) => doc.id === picked.id) ?? picked : null;
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

  const drop = useFileDrop((files) => uploads.upload(files, { folder: uploadFolder }), { disabled: !canUpload || uploads.busy || creatingFolder });

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

  const tiles = path.length === 0 ? rootTiles.filter((tile) => foldName(tile.name).includes(needle)) : [];

  const roots = visibleRoots(role);
  const canCreateFolder = canUpload && (path.length > 0 || roots === "*");

  function openFolder(next: string[]) {
    setPath(next);
    setSearch("");
    setPicked(null);
  }

  function createFolder(event: FormEvent) {
    event.preventDefault();
    const name = sanitizeFileName(folderName, "");
    if (!name) return;
    setCreatedFolders((current) => [...current, [...path, name].join("/")]);
    openFolder([...path, name]);
    setCreatingFolder(false);
    setFolderName("");
  }

  async function save(changes: EditableTableChanges<DocumentRow>) {
    await saveDocumentMetadata(companyId, { role, userId }, uploadFolder, changes);
  }

  const columns: EditableColumn<DocumentRow>[] = [
    {
      key: "title",
      header: "Nome",
      kind: "text",
      required: true,
      render: (file) => (
        <button type="button" onClick={() => setPicked(file)} aria-expanded={selected?.id === file.id} className="flex items-center gap-2 text-left font-medium hover:underline">
          <FileTypeIcon name={file.title} fileType={file.type} size={16} className="shrink-0 text-muted-foreground" />
          {file.title}
        </button>
      ),
    },
    { key: "description", header: "Observação", kind: "text" },
    ...(needle ? [{ key: "folder", header: "Pasta", kind: "text", readOnly: true, render: (file: DocumentRow) => split(documentFolder(file)).slice(path.length).join("/") || "—" } as EditableColumn<DocumentRow>] : []),
    { key: "type", header: "Tipo", kind: "text", readOnly: true },
    { key: "version", header: "Versão", kind: "number", readOnly: true, render: (file) => `v${file.version}` },
    { key: "size_bytes", header: "Tamanho", kind: "number", readOnly: true, render: (file) => (file.size_bytes ? formatBytes(file.size_bytes) : "sem arquivo") },
    { key: "created_at", header: "Enviado em", kind: "date", readOnly: true, render: (file) => formatTimestamp(file.created_at) },
  ];

  return (
    <div {...drop.bind} className={cn("relative space-y-4 rounded-lg", drop.isDragging && "ring-2 ring-primary/40")}>
      <PageToolbar search={search} onSearchChange={setSearch} searchPlaceholder="Buscar nesta pasta e nas subpastas...">
        {path.length === 0 && rootActions}
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

      {creatingFolder && (
        <form onSubmit={createFolder} aria-label="Nova pasta" className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/20 p-3">
          <label className="min-w-0 flex-1 space-y-1 text-xs font-medium sm:min-w-[14rem]">
            Nome da pasta
            <input value={folderName} onChange={(event) => setFolderName(event.target.value)} aria-label="Nome da pasta" placeholder="Ex.: Contratos 2026" required autoFocus className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
          </label>
          <button type="button" onClick={() => { setCreatingFolder(false); setFolderName(""); }} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted">Cancelar</button>
          <button type="submit" className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">Criar e abrir</button>
        </form>
      )}

      {path.length === 0 && rootPanel}

      <nav aria-label="Caminho da pasta" className="flex flex-wrap items-center gap-1 text-sm">
        <button type="button" onClick={() => openFolder([])} className="rounded px-1 py-1 font-medium text-foreground hover:bg-muted">Documentos /</button>
        {path.map((segment, index) => (
          <button key={`${segment}-${index}`} type="button" onClick={() => openFolder(path.slice(0, index + 1))} aria-current={index === path.length - 1 ? "location" : undefined} className="rounded px-1 py-1 text-muted-foreground hover:bg-muted hover:text-foreground">
            {segment} /
          </button>
        ))}
      </nav>

      {!getFileBackend().persistent && canUpload && (
        <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">Este navegador não guarda arquivos.</p>
      )}
      <FileUploadFeedback summary={uploads.summary} onDismiss={uploads.clear} />

      {error ? (
        <p role="alert" className="text-sm text-destructive">Não foi possível carregar os documentos.</p>
      ) : (
        <>
          {(folders.length > 0 || tiles.length > 0) && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-3">
              {folders.map((folder) => (
                <button key={folder} type="button" onClick={() => openFolder([...path, folder])} className="group min-h-[8rem] rounded-xl border border-transparent p-3 text-center transition-all hover:border-border hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="flex h-full flex-col items-center justify-center">
                    <FolderIcon />
                    <span className="mt-3 w-full truncate text-sm font-medium">{folder}</span>
                  </span>
                </button>
              ))}
              {tiles.map((tile) => <Fragment key={tile.key}>{tile.element}</Fragment>)}
            </div>
          )}

          <EditableTable<DocumentRow>
            resource="documents"
            label={`Arquivos em /${path.join("/")}`}
            title={path.length ? `Arquivos em /${path.join("/")}` : "Arquivos na raiz"}
            rows={files}
            columns={columns}
            loading={isLoading}
            onSave={save}
            onRefresh={() => qc.invalidateQueries({ queryKey: ["documents", companyId] }).then(() => refetch())}
            emptyMessage={search ? "Nada encontrado" : canUpload ? "Nenhum arquivo nesta pasta" : "Nenhum arquivo nesta pasta"}
          />
        </>
      )}

      {selected && (
        <DocumentPanel
          key={selected.id}
          doc={selected}
          onClose={() => setPicked(null)}
          onChanged={setPicked}
          canUpload={canUpload}
          canEdit={canEdit}
          canDelete={canDelete}
        />
      )}

      {drop.isDragging && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg bg-primary/10 text-sm font-medium text-primary-text">
          Solte para enviar para /{uploadFolder}
        </div>
      )}
    </div>
  );
}
