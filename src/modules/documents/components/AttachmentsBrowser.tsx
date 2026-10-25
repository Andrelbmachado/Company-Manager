import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Paperclip } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { FileTypeIcon } from "@/components/shared/FileTypeIcon";
import { PageToolbar } from "@/components/shared/PageToolbar";
import { NoFilterMatchRow, SortableHeader, TableFilterBar, TableFilterButton, useSortFilter, type SortFilterColumn } from "@/components/shared/table";
import { attachmentEntity, attachmentEntityLabel, attachmentEntityNames, canViewAttachmentsOf } from "@/lib/files/entities";
import { formatBytes, formatTimestamp } from "@/lib/files/format";
import { listAllAttachments } from "@/lib/files/store";
import type { DocumentRow, Role } from "@/types";
import { foldName } from "../access";
import { DocumentPanel } from "./DocumentPanel";

/**
 * Anexos enviados nas fichas (cliente, fatura, colaborador...), só dos tipos de registro que o papel pode ver. Aqui é
 * consulta (tabela só de leitura): enviar, editar, nova versão e restaurar ficam na ficha do registro
 * (FileAttachments), que conhece a permissão dele. O detalhe abre no próprio lugar, abaixo da tabela.
 */
export function AttachmentsBrowser({ role, companyId, canDelete }: { role: Role; companyId: string; canDelete: boolean }) {
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [selected, setSelected] = useState<DocumentRow | null>(null);

  const { data: rows = [], isLoading, error } = useQuery({
    queryKey: ["documents", companyId, "attachments-all"],
    queryFn: () => listAllAttachments(companyId),
  });
  const visible = useMemo(() => rows.filter((doc) => doc.entity_type && canViewAttachmentsOf(role, doc.entity_type)), [rows, role]);
  const types = useMemo(() => [...new Set(visible.map((doc) => doc.entity_type as string))].sort(), [visible]);
  const { data: names } = useQuery({
    queryKey: ["documents", companyId, "attachment-owners", types.join(",")],
    queryFn: () => attachmentEntityNames(companyId, types),
    enabled: types.length > 0,
  });

  const ownerName = (doc: DocumentRow) => names?.get(`${doc.entity_type}:${doc.entity_id}`) ?? doc.entity_id ?? "—";
  const needle = foldName(search);
  const list = visible.filter(
    (doc) => (!type || doc.entity_type === type) && (!needle || foldName(doc.title).includes(needle) || foldName(ownerName(doc)).includes(needle)),
  );
  const columns: SortFilterColumn<DocumentRow>[] = [
    { key: "title", header: "Arquivo", kind: "text" },
    { key: "owner", header: "Registro", kind: "text", sortValue: (doc) => `${attachmentEntityLabel(doc.entity_type ?? "")}: ${ownerName(doc)}` },
    { key: "version", header: "Versão", kind: "integer" },
    { key: "size_bytes", header: "Tamanho", kind: "number", filterable: false },
    { key: "created_at", header: "Enviado em", kind: "datetime" },
  ];
  const view = useSortFilter(list, columns);

  function ownerCell(doc: DocumentRow) {
    const entity = attachmentEntity(doc.entity_type);
    const name = ownerName(doc);
    return (
      <span>
        <span className="text-muted-foreground">{attachmentEntityLabel(doc.entity_type ?? "")}: </span>
        {entity?.route && doc.entity_id ? <Link to={entity.route(doc.entity_id)} className="font-medium text-primary-text hover:underline" onClick={(event) => event.stopPropagation()}>{name}</Link> : <span className="font-medium">{name}</span>}
      </span>
    );
  }

  return (
    <div className="space-y-4">
      <PageToolbar search={search} onSearchChange={setSearch} searchPlaceholder="Buscar por arquivo ou registro...">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Registro</span>
          <select value={type} onChange={(event) => setType(event.target.value)} className="h-9 rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring">
            <option value="">Todos</option>
            {types.map((entityType) => <option key={entityType} value={entityType}>{attachmentEntityLabel(entityType)}</option>)}
          </select>
        </label>
        {visible.length > 0 && <TableFilterButton view={view} />}
      </PageToolbar>

      {isLoading ? (
        <div className="space-y-2">{[0, 1, 2].map((index) => <div key={index} className="h-11 animate-pulse rounded-md bg-muted/40" />)}</div>
      ) : error ? (
        <p role="alert" className="text-sm text-destructive">Não foi possível carregar os anexos.</p>
      ) : list.length === 0 ? (
        <EmptyState
          icon={Paperclip}
          title={visible.length === 0 ? "Nenhum anexo de registro" : "Nada encontrado"}
          description={visible.length === 0 ? "Arquivos anexados nas fichas (clientes, faturas, colaboradores...) aparecem aqui." : "Mude a busca ou o filtro."}
        />
      ) : (
        <div className="rounded-lg border">
          <TableFilterBar view={view} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  {columns.map((column) => (
                    <SortableHeader key={column.key} label={column.header} sortKey={column.key} sort={view.sort} onSort={view.toggleSort} className="px-3 py-2" />
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {view.rows.map((doc) => (
                  <tr key={doc.id} className="hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <button type="button" onClick={() => setSelected(doc)} aria-expanded={selected?.id === doc.id} className="flex items-center gap-2 text-left font-medium hover:underline">
                        <FileTypeIcon name={doc.title} fileType={doc.type} size={16} className="shrink-0 text-muted-foreground" />
                        {doc.title}
                      </button>
                    </td>
                    <td className="px-3 py-2">{ownerCell(doc)}</td>
                    <td className="px-3 py-2">v{doc.version}</td>
                    <td className="px-3 py-2">{doc.size_bytes ? formatBytes(doc.size_bytes) : "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{formatTimestamp(doc.created_at)}</td>
                  </tr>
                ))}
                {!view.rows.length && <NoFilterMatchRow colSpan={columns.length} />}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selected && (
        <DocumentPanel
          key={selected.id}
          doc={selected}
          onClose={() => setSelected(null)}
          onChanged={setSelected}
          canUpload={false}
          canEdit={false}
          canDelete={canDelete}
          extra={{ label: "Registro", value: ownerCell(selected) }}
        />
      )}
    </div>
  );
}
