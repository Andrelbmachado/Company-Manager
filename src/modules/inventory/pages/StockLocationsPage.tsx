// Locais de estoque editados direto na tabela (nome, tipo, endereço); itens, unidades, valor e contagem aberta são só
// leitura. Arquivar fica na linha (só local vazio).
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Archive } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import { EditableTable, type EditableColumn, type EditableTableChanges } from "@/components/shared/EditableTable";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatCard } from "@/components/shared/StatCard";
import { usePermission } from "@/hooks/usePermission";
import { useRequiredSession } from "@/hooks/useSession";
import { confirmAction } from "@/lib/confirm";
import { getDb } from "@/lib/db/client";
import { formatSequence } from "@/lib/db/sequence";
import { archiveLocationRow, LOCATION_TYPES, listLocationSummaries, saveLocationRows, type LocationSummary } from "@/lib/inventory/locations";
import { formatQty } from "@/lib/inventory/stock";
import { sumMoney } from "@/lib/money";
import { formatCurrency } from "@/lib/utils";
import { emitSafely, ErrorBanner, errorText, inventoryKeys, useActor, useInvalidateInventory } from "../components/inventoryUi";

export default function StockLocationsPage() {
  const session = useRequiredSession();
  const companyId = session.company.id;
  const actor = useActor();
  const invalidate = useInvalidateInventory(companyId);
  const canDelete = usePermission("delete", "inventory");
  const [error, setError] = useState<string | null>(null);

  const locationsQuery = useQuery({
    queryKey: inventoryKeys.locations(companyId),
    queryFn: async () => listLocationSummaries(await getDb(), companyId),
  });
  const locations = locationsQuery.data ?? [];

  const columns: EditableColumn<LocationSummary>[] = [
    { key: "name", header: "Local", kind: "text", required: true, placeholder: "Depósito central", render: (row) => <span className="font-medium">{row.name}</span> },
    { key: "type", header: "Tipo", kind: "select", required: true, options: LOCATION_TYPES.map((option) => ({ value: option.value, label: option.label })) },
    { key: "address", header: "Endereço ou referência", kind: "text", placeholder: "Rua, sala, prateleira ou placa" },
    { key: "item_count", header: "Itens", kind: "number", readOnly: true },
    { key: "total_qty", header: "Unidades", kind: "number", readOnly: true, render: (row) => formatQty(row.total_qty) },
    { key: "stock_value", header: "Valor", kind: "money", readOnly: true },
    {
      key: "open_count_id",
      header: "Contagem",
      kind: "text",
      readOnly: true,
      sortValue: (row) => (row.open_count_id ? `${formatSequence("inventory_counts", row.open_count_number)} aberta` : null),
      render: (row) =>
        row.open_count_id ? (
          <Link to={`/inventory/inventarios/${row.open_count_id}`} className="text-primary-text hover:underline">
            {formatSequence("inventory_counts", row.open_count_number)} aberta
          </Link>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];

  async function save(changes: EditableTableChanges<LocationSummary>) {
    const result = await saveLocationRows(await getDb(), companyId, actor, changes);
    invalidate();
    await emitSafely([
      ...result.created.map((row) => ({ type: "stock.location_created", companyId, actorId: actor.userId, entityType: "stock_location", entityId: row.id, title: `Local de estoque criado: ${row.name}`, module: "inventory" })),
      ...result.updated.map((row) => ({ type: "stock.location_updated", companyId, actorId: actor.userId, entityType: "stock_location", entityId: row.id, title: `Local de estoque editado: ${row.name}`, module: "inventory" })),
    ]);
  }

  async function archive(location: LocationSummary) {
    setError(null);
    if (!(await confirmAction(`Arquivar o local "${location.name}"? Ele some das listas; o histórico de movimentações continua.`, { title: "Arquivar local", okLabel: "Arquivar" }))) return;
    try {
      await archiveLocationRow(await getDb(), companyId, actor, location.id);
      invalidate();
      await emitSafely([{ type: "stock.location_archived", companyId, actorId: actor.userId, entityType: "stock_location", entityId: location.id, title: `Local de estoque arquivado: ${location.name}`, module: "inventory" }]);
    } catch (caught) {
      setError(errorText(caught));
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Locais de estoque" />
      <ErrorBanner message={error} onClose={() => setError(null)} />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard title="Locais ativos" value={locations.length} />
        <StatCard title="Unidades em estoque" value={formatQty(locations.reduce((sum, row) => sum + row.total_qty, 0))} />
        <StatCard title="Valor em estoque" value={formatCurrency(sumMoney(locations.map((row) => row.stock_value)))} />
      </div>

      <EditableTable
        resource="inventory"
        label="Locais de estoque"
        title="Locais"
        rows={locations}
        columns={columns}
        loading={locationsQuery.isLoading}
        onSave={save}
        onRefresh={() => locationsQuery.refetch()}
        newRow={() => ({ id: uuidv4(), type: "deposito" })}
        emptyMessage="Nenhum local cadastrado"
        rowActions={
          canDelete
            ? (row) => (
                <button
                  type="button"
                  onClick={() => void archive(row)}
                  aria-label={`Arquivar ${row.name}`}
                  title={row.item_count > 0 ? "Só dá para arquivar um local vazio" : "Arquivar"}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
                >
                  <Archive size={15} />
                </button>
              )
            : undefined
        }
      />
    </div>
  );
}
