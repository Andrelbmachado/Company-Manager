import { useState } from "react";
import { FileText } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { SearchInput, matchesSearch } from "@/components/shared/SearchInput";
import { Toolbar } from "@/components/shared/Toolbar";
import { NewButton } from "@/components/shared/NewButton";
import { ImportExportActions } from "@/components/shared/ImportExportActions";
import { EntityFormDialog } from "@/components/shared/EntityFormDialog";
import { useEntityList } from "@/hooks/useEntity";
import type { Row } from "@/lib/data/repository";
import { formatDateTime } from "@/lib/utils";

const COLUMNS: Column<Row>[] = [
  {
    key: "title",
    header: "Título",
    cell: (d) => (
      <div className="min-w-0">
        <p className="font-medium">{String(d.title)}</p>
        <p className="truncate font-mono text-xs text-muted-foreground">{String(d.file_path ?? "")}</p>
      </div>
    ),
  },
  { key: "type", header: "Tipo", cell: (d) => <span className="text-muted-foreground">{String(d.type ?? "—")}</span> },
  { key: "entity_type", header: "Vinculado a", cell: (d) => <span className="text-muted-foreground">{String(d.entity_type ?? "—")}</span> },
  { key: "version", header: "Versão", align: "right", cell: (d) => <span className="tabular-nums text-muted-foreground">v{Number(d.version ?? 1)}</span> },
  { key: "created_at", header: "Enviado em", align: "right", cell: (d) => <span className="tabular-nums text-muted-foreground">{formatDateTime(d.created_at as string)}</span> },
];

export default function DocumentsPage() {
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const { data: docs = [], isLoading } = useEntityList("documents");

  const filtered = docs.filter((d) => matchesSearch(search, [d.title, d.type, d.file_path]));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Documentos"
        description="Arquivos e anexos"
        actions={
          <>
            <ImportExportActions entities={["documents"]} />
            <NewButton entity="documents" onClick={() => setShowForm(true)} />
          </>
        }
      />
      <Toolbar count={filtered.length}>
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar documentos..." />
      </Toolbar>
      <DataTable
        testId="documents-table"
        columns={COLUMNS}
        rows={filtered}
        getRowId={(r) => String(r.id)}
        isLoading={isLoading}
        empty={<EmptyState icon={FileText} title="Nenhum documento" description="Documentos são anexados a OS, projetos, clientes e contratos." />}
      />
      <EntityFormDialog entity="documents" open={showForm} onClose={() => setShowForm(false)} />
    </div>
  );
}
