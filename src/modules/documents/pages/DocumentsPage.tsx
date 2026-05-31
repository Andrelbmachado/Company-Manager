import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "@/lib/db/client";
import { usePermission } from "@/hooks/usePermission";
import { useRequiredSession } from "@/hooks/useSession";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageToolbar } from "@/components/shared/PageToolbar";
import { CrudDialog } from "@/components/shared/CrudDialog";
import { DetailDrawer, DetailGrid, DetailItem } from "@/components/shared/DetailDrawer";
import { formatDateTime } from "@/lib/utils";
import {
  FileArchive,
  FileSpreadsheet,
  FileText,
  Folder,
  Upload,
} from "lucide-react";
import type { Role } from "@/types";

interface Doc {
  id: string;
  title: string;
  type?: string | null;
  version: number;
  file_path: string;
  created_at: string;
}

const ROOT_ACCESS: Record<Role, string[] | "*"> = {
  admin: "*",
  gerente: "*",
  auditor: "*",
  tecnico: ["TI e Operacoes", "Compartilhados"],
  estoquista: ["Estoque", "Compartilhados"],
  financeiro: ["Financeiro", "Compartilhados"],
  comercial: ["Comercial", "Compartilhados"],
  atendimento: ["Atendimento", "Compartilhados"],
};

export default function DocumentsPage() {
  const session = useRequiredSession();
  const role = session.membership.role as Role;
  const qc = useQueryClient();
  const canUpload = usePermission("attach", "documents");
  const canEdit = usePermission("edit", "documents");
  const uploadRef = useRef<HTMLInputElement>(null);
  const [path, setPath] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Doc | null>(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Record<string, string>>({ title: "", type: "PDF" });

  const { data: docs = [], isLoading } = useQuery({
    queryKey: ["documents", session.company.id],
    queryFn: async () => {
      const db = await getDb();
      return db.select<Doc[]>(
        "SELECT * FROM documents WHERE company_id=? AND deleted_at IS NULL ORDER BY created_at DESC",
        [session.company.id]
      );
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async (files: File[]) => {
      const db = await getDb();
      const root = path.length > 0 ? path : [defaultRoot(role)];
      for (const file of files) {
        const type = file.name.split(".").pop()?.toUpperCase() || "ARQUIVO";
        await db.execute("INSERT INTO documents (id, company_id, title, type, file_path, version, uploaded_by) VALUES (?,?,?,?,?,?,?)", [uuidv4(), session.company.id, file.name, type, `/${[...root, file.name].join("/")}`, 1, session.user.id]);
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["documents", session.company.id] }),
  });
  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!selected) return;
      const segments = parts(selected.file_path);
      segments[segments.length - 1] = editForm.title;
      await (await getDb()).execute("UPDATE documents SET title=?, type=?, file_path=?, updated_at=datetime('now') WHERE id=?", [editForm.title, editForm.type, `/${segments.join("/")}`, selected.id]);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["documents", session.company.id] });
      setSelected((doc) => doc ? { ...doc, title: editForm.title, type: editForm.type, file_path: `/${[...parts(doc.file_path).slice(0, -1), editForm.title].join("/")}` } : null);
      setEditing(false);
    },
  });

  const visibleDocs = useMemo(() => docs.filter((doc) => {
    const root = parts(doc.file_path)[0];
    const allowedRoots = ROOT_ACCESS[role];
    return allowedRoots === "*" || allowedRoots.includes(root);
  }), [docs, role]);

  const folders = useMemo(() => {
    const names = new Set<string>();
    for (const doc of visibleDocs) {
      const docParts = parts(doc.file_path);
      if (!startsWith(docParts, path) || docParts.length <= path.length + 1) continue;
      names.add(docParts[path.length]);
    }
    return [...names].filter((name) => name.toLowerCase().includes(search.toLowerCase())).sort();
  }, [visibleDocs, path, search]);

  const files = useMemo(() => visibleDocs
    .filter((doc) => {
      const docParts = parts(doc.file_path);
      return startsWith(docParts, path) && docParts.length === path.length + 1;
    })
    .filter((doc) => doc.title.toLowerCase().includes(search.toLowerCase())), [visibleDocs, path, search]);

  return (
    <div className="space-y-5">
      <PageHeader title="Documentos" description="Pastas e arquivos compartilhados com sua area" actions={canUpload ? <><input ref={uploadRef} type="file" multiple className="hidden" onChange={(event) => uploadMutation.mutate(Array.from(event.target.files ?? []))} /><button onClick={() => uploadRef.current?.click()} className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"><Upload size={14} /> Upload de arquivos</button></> : undefined} />

      <PageToolbar search={search} onSearchChange={setSearch} searchPlaceholder="Buscar nesta pasta..." />

      <div className="flex items-center gap-1 text-sm">
        <button onClick={() => setPath([])} className="rounded px-1 py-1 font-medium text-foreground hover:bg-muted">
          Documentos /
        </button>
        {path.map((segment, index) => (
          <button key={`${segment}-${index}`} onClick={() => setPath(path.slice(0, index + 1))} className="rounded px-1 py-1 text-muted-foreground hover:bg-muted hover:text-foreground">
            {segment} /
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 8 }).map((_, index) => <div key={index} className="h-32 animate-pulse rounded-lg bg-muted/40" />)}
        </div>
      ) : folders.length === 0 && files.length === 0 ? (
        <div className="flex min-h-60 flex-col items-center justify-center text-center">
          <Folder size={32} className="text-muted-foreground/60" />
          <p className="mt-3 text-sm font-medium">Esta pasta esta vazia</p>
          <p className="mt-1 text-xs text-muted-foreground">Nenhum arquivo encontrado neste diretorio.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
          {folders.map((folder) => (
            <button
              key={folder}
              onClick={() => setPath([...path, folder])}
              className="group aspect-square rounded-xl border border-transparent p-3 text-center transition-all hover:border-border hover:bg-blue-50/50 focus:border-blue-300 focus:bg-blue-50/70 focus:outline-none"
            >
              <span className="flex h-full flex-col items-center justify-center">
                <AppleFolderIcon />
                <span className="mt-3 w-full truncate text-sm font-medium">{folder}</span>
              </span>
            </button>
          ))}
          {files.map((file) => {
            const Icon = fileIcon(file.type);
            return (
              <button key={file.id} onClick={() => setSelected(file)} className="group aspect-square rounded-xl border border-transparent p-3 text-center transition-all hover:border-border hover:bg-muted/40 focus:border-blue-300 focus:bg-blue-50/70 focus:outline-none">
                <span className="flex h-full flex-col items-center justify-center">
                  <Icon size={38} className="text-muted-foreground transition-transform group-hover:-translate-y-0.5" />
                  <span className="mt-3 line-clamp-2 text-sm font-medium leading-snug">{file.title}</span>
                  <span className="mt-1 text-[10px] text-muted-foreground">{file.type} · v{file.version}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
      {selected && <DetailDrawer title={selected.title} subtitle={selected.type ?? "Arquivo"} onClose={() => setSelected(null)} onEdit={canEdit ? () => { setEditForm({ title: selected.title, type: selected.type ?? "ARQUIVO" }); setEditing(true); } : undefined}><DetailGrid><DetailItem label="Tipo" value={selected.type} /><DetailItem label="Versao" value={`v${selected.version}`} /><DetailItem label="Local" value={selected.file_path} /><DetailItem label="Enviado em" value={formatDateTime(selected.created_at)} /></DetailGrid></DetailDrawer>}
      {editing && <CrudDialog title="Editar arquivo" fields={[{ key: "title", label: "Nome do arquivo", required: true }, { key: "type", label: "Tipo" }]} values={editForm} onChange={(key, value) => setEditForm((current) => ({ ...current, [key]: value }))} onClose={() => setEditing(false)} onSubmit={() => updateMutation.mutate()} busy={updateMutation.isPending} />}
    </div>
  );
}

function parts(filePath: string): string[] {
  return filePath.split("/").filter(Boolean);
}

function startsWith(values: string[], prefix: string[]): boolean {
  return prefix.every((value, index) => values[index] === value);
}

function fileIcon(type?: string | null) {
  if (type === "XLSX") return FileSpreadsheet;
  if (type === "ZIP") return FileArchive;
  return FileText;
}

function defaultRoot(role: Role): string {
  const roots = ROOT_ACCESS[role];
  return roots === "*" ? "Compartilhados" : roots[0];
}

function AppleFolderIcon() {
  return (
    <span className="relative block h-12 w-16 transition-transform group-hover:-translate-y-0.5">
      <span className="absolute left-1 top-1 h-4 w-7 rounded-t-md bg-blue-400" />
      <span className="absolute inset-x-0 bottom-0 h-10 rounded-md bg-gradient-to-b from-blue-300 to-blue-500 shadow-sm" />
      <span className="absolute inset-x-1 bottom-1 h-8 rounded bg-gradient-to-b from-blue-200/80 to-blue-400/30" />
    </span>
  );
}
