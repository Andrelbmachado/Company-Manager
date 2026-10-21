import { useState } from "react";
import { Users } from "lucide-react";
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
import { formatDate } from "@/lib/utils";
import type { Row } from "@/lib/data/repository";

const COLUMNS: Column<Row>[] = [
  { key: "name", header: "Nome", cell: (c) => <span className="font-medium">{String(c.name)}</span> },
  { key: "type", header: "Tipo", cell: (c) => <span className="text-muted-foreground">{String(c.type)}</span> },
  { key: "document", header: "CNPJ/CPF", cell: (c) => <span className="text-muted-foreground tabular-nums">{String(c.document ?? "—")}</span> },
  { key: "email", header: "E-mail", cell: (c) => <span className="text-muted-foreground">{String(c.email ?? "—")}</span> },
  { key: "phone", header: "Telefone", cell: (c) => <span className="text-muted-foreground tabular-nums">{String(c.phone ?? "—")}</span> },
  { key: "status", header: "Status", cell: (c) => <StatusBadge status={String(c.status)} /> },
  { key: "created_at", header: "Cadastro", align: "right", cell: (c) => <span className="text-muted-foreground tabular-nums">{formatDate(c.created_at as string)}</span> },
];

export default function CrmPage() {
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const { data: customers = [], isLoading } = useEntityList("customers");

  const filtered = customers.filter((c) => matchesSearch(search, [c.name, c.email, c.document, c.phone]));

  return (
    <div className="space-y-6">
      <PageHeader
        title="CRM — Clientes"
        description="Gestão de clientes e contatos"
        actions={
          <>
            <ImportExportActions entities={["customers"]} />
            <NewButton entity="customers" onClick={() => setShowForm(true)} />
          </>
        }
      />

      <Toolbar count={filtered.length}>
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar por nome, e-mail, documento..." />
      </Toolbar>

      <DataTable
        testId="customers-table"
        columns={COLUMNS}
        rows={filtered}
        getRowId={(r) => String(r.id)}
        isLoading={isLoading}
        empty={
          <EmptyState
            icon={Users}
            title={search ? "Nenhum cliente encontrado" : "Nenhum cliente cadastrado"}
            description={search ? "Tente outro termo de busca." : "Cadastre um cliente ou importe uma planilha."}
          />
        }
      />

      <EntityFormDialog entity="customers" open={showForm} onClose={() => setShowForm(false)} />
    </div>
  );
}
