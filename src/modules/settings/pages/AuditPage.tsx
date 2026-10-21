import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { SearchInput, matchesSearch } from "@/components/shared/SearchInput";
import { Toolbar } from "@/components/shared/Toolbar";
import { ImportExportActions } from "@/components/shared/ImportExportActions";
import { useEntityList } from "@/hooks/useEntity";
import type { Row } from "@/lib/data/repository";
import { formatDateTime } from "@/lib/utils";

const COLUMNS: Column<Row>[] = [
  { key: "action", header: "Ação", cell: (l) => <span className="font-mono text-xs">{String(l.action)}</span> },
  { key: "entity_type", header: "Entidade", cell: (l) => <span className="text-muted-foreground">{String(l.entity_type)}</span> },
  { key: "entity_id", header: "ID", cell: (l) => <span className="font-mono text-xs text-muted-foreground">{String(l.entity_id ?? "—")}</span> },
  { key: "created_at", header: "Data/hora", align: "right", cell: (l) => <span className="tabular-nums text-muted-foreground">{formatDateTime(l.created_at as string)}</span> },
];

export default function AuditPage() {
  const [search, setSearch] = useState("");
  const { data: logs = [], isLoading } = useEntityList("audit_logs");
  const filtered = logs.filter((l) => matchesSearch(search, [l.action, l.entity_type, l.entity_id]));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Auditoria"
        description="Trilha imutável de ações sensíveis (somente exportação)"
        actions={<ImportExportActions entities={["audit_logs"]} />}
      />
      <Toolbar count={filtered.length}>
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar por ação ou entidade..." />
      </Toolbar>
      <DataTable
        testId="audit-table"
        columns={COLUMNS}
        rows={filtered}
        getRowId={(r) => String(r.id)}
        isLoading={isLoading}
        empty={<EmptyState icon={ShieldCheck} title="Nenhum log de auditoria" description="Ações financeiras, exportações e acessos sensíveis aparecem aqui." />}
      />
    </div>
  );
}
