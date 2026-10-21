import { useState } from "react";
import { Archive } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { SearchInput, matchesSearch } from "@/components/shared/SearchInput";
import { Toolbar } from "@/components/shared/Toolbar";
import { NewButton } from "@/components/shared/NewButton";
import { ImportExportActions } from "@/components/shared/ImportExportActions";
import { EntityFormDialog } from "@/components/shared/EntityFormDialog";
import { useEntityList } from "@/hooks/useEntity";
import { refLabel, type Row } from "@/lib/data/repository";
import { formatDateTime } from "@/lib/utils";

const COLUMNS: Column<Row>[] = [
  { key: "item", header: "Item", cell: (c) => <span className="font-medium">{refLabel(c, "item_id") || "—"}</span> },
  { key: "holder", header: "Responsável", cell: (c) => <span className="text-muted-foreground">{refLabel(c, "holder_id") || "—"}</span> },
  { key: "quantity", header: "Qtd.", align: "right", cell: (c) => <span className="tabular-nums">{Number(c.quantity ?? 0)}</span> },
  { key: "status", header: "Status", cell: (c) => <StatusBadge status={String(c.status)} /> },
  { key: "checked_out_at", header: "Retirada", cell: (c) => <span className="tabular-nums text-muted-foreground">{formatDateTime(c.checked_out_at as string)}</span> },
  { key: "due_back_at", header: "Devolução prev.", cell: (c) => <span className="tabular-nums text-muted-foreground">{formatDateTime(c.due_back_at as string)}</span> },
];

export default function CustodyPage() {
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const { data: custodies = [], isLoading } = useEntityList("custodies");

  const filtered = custodies.filter((c) => matchesSearch(search, [refLabel(c, "item_id"), refLabel(c, "holder_id")]));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Custódia"
        description="Peças e ativos em posse de técnicos"
        actions={
          <>
            <ImportExportActions entities={["custodies"]} />
            <NewButton entity="custodies" onClick={() => setShowForm(true)} />
          </>
        }
      />
      <Toolbar count={filtered.length}>
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar por item ou responsável..." />
      </Toolbar>
      <DataTable
        testId="custodies-table"
        columns={COLUMNS}
        rows={filtered}
        getRowId={(r) => String(r.id)}
        isLoading={isLoading}
        empty={<EmptyState icon={Archive} title="Nenhuma custódia ativa" description="Custódias são criadas ao retirar itens do estoque em uma OS." />}
      />
      <EntityFormDialog entity="custodies" open={showForm} onClose={() => setShowForm(false)} />
    </div>
  );
}
