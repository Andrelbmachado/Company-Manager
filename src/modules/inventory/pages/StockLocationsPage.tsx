import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Archive, Pencil, Plus, Warehouse } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { formatSequence } from "@/lib/db/sequence";
import { useRequiredSession } from "@/hooks/useSession";
import { usePermission } from "@/hooks/usePermission";
import { emit } from "@/lib/events/bus";
import { archiveStockLocation, LOCATION_TYPES, listLocationSummaries, locationTypeLabel, saveStockLocation, type LocationSummary } from "@/lib/inventory/locations";
import { formatQty } from "@/lib/inventory/stock";
import { sumMoney } from "@/lib/money";
import { formatCurrency } from "@/lib/utils";
import { CrudDialog } from "@/components/shared/CrudDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatCard } from "@/components/shared/StatCard";
import { BUTTON_PRIMARY, ErrorBanner, errorText, inventoryKeys, TableSkeleton, useInvalidateInventory } from "../components/inventoryUi";
import { confirmAction } from "@/lib/confirm";

const EMPTY = { name: "", type: "deposito", address: "" };

export default function StockLocationsPage() {
  const session = useRequiredSession();
  const companyId = session.company.id;
  const invalidate = useInvalidateInventory(companyId);
  const canCreate = usePermission("create", "inventory");
  const canEdit = usePermission("edit", "inventory");
  const canDelete = usePermission("delete", "inventory");
  const [editing, setEditing] = useState<LocationSummary | "new" | null>(null);
  const [form, setForm] = useState<Record<string, string>>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const { data: locations = [], isLoading } = useQuery({
    queryKey: inventoryKeys.locations(companyId),
    queryFn: async () => listLocationSummaries(await getDb(), companyId),
  });

  const save = useMutation({
    mutationFn: async () => {
      const id = await saveStockLocation(await getDb(), {
        companyId,
        id: editing && editing !== "new" ? editing.id : null,
        name: form.name,
        type: form.type,
        address: form.address,
      });
      await emit({
        type: editing === "new" ? "stock.location_created" : "stock.location_updated",
        companyId,
        actorId: session.user.id,
        entityType: "stock_location",
        entityId: id,
        title: `${editing === "new" ? "Local de estoque criado" : "Local de estoque editado"}: ${form.name.trim()}`,
        module: "inventory",
        newValue: form,
      });
    },
    onSuccess: () => {
      invalidate();
      setEditing(null);
    },
    onError: (caught) => setFormError(errorText(caught)),
  });

  const archive = useMutation({
    mutationFn: async (location: LocationSummary) => {
      await archiveStockLocation(await getDb(), { companyId, locationId: location.id });
      await emit({ type: "stock.location_archived", companyId, actorId: session.user.id, entityType: "stock_location", entityId: location.id, title: `Local de estoque arquivado: ${location.name}`, module: "inventory" });
    },
    onSuccess: () => invalidate(),
    onError: (caught) => setError(errorText(caught)),
  });

  function openForm(location: LocationSummary | "new") {
    setFormError(null);
    setForm(location === "new" ? EMPTY : { name: location.name, type: location.type ?? "deposito", address: location.address ?? "" });
    setEditing(location);
  }

  const typeOptions: { value: string; label: string }[] = LOCATION_TYPES.map((option) => ({ value: option.value, label: option.label }));
  if (form.type && !typeOptions.some((option) => option.value === form.type)) typeOptions.push({ value: form.type, label: form.type });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Locais de estoque"
        description="Depósitos, almoxarifados, lojas e veículos onde ficam os itens. Cada local tem o próprio saldo."
        actions={
          canCreate ? (
            <button type="button" onClick={() => openForm("new")} className={BUTTON_PRIMARY}>
              <Plus size={14} /> Novo local
            </button>
          ) : undefined
        }
      />
      <ErrorBanner message={error} onClose={() => setError(null)} />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard title="Locais ativos" value={locations.length} />
        <StatCard title="Unidades em estoque" value={formatQty(locations.reduce((sum, row) => sum + row.total_qty, 0))} />
        <StatCard title="Valor em estoque" value={formatCurrency(sumMoney(locations.map((row) => row.stock_value)))} />
      </div>

      {isLoading ? (
        <TableSkeleton />
      ) : locations.length === 0 ? (
        <EmptyState icon={Warehouse} title="Nenhum local cadastrado" description="Cadastre pelo menos um local para dar entrada, transferir e contar o estoque." />
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="whitespace-nowrap bg-muted/30">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Local</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Tipo</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Itens</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Unidades</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Valor</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Contagem</th>
                {(canEdit || canDelete) && <th className="w-24 px-4 py-3 text-right font-medium text-muted-foreground">Ações</th>}
              </tr>
            </thead>
            <tbody className="divide-y">
              {locations.map((location) => (
                <tr key={location.id}>
                  <td className="px-4 py-3">
                    <p className="font-medium">{location.name}</p>
                    {location.address && <p className="text-xs text-muted-foreground">{location.address}</p>}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{locationTypeLabel(location.type)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{location.item_count}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatQty(location.total_qty)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(location.stock_value)}</td>
                  <td className="px-4 py-3">
                    {location.open_count_id ? (
                      <Link to={`/inventory/inventarios/${location.open_count_id}`} className="text-primary-text hover:underline">
                        {formatSequence("inventory_counts", location.open_count_number)} aberta
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  {(canEdit || canDelete) && (
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        {canEdit && (
                          <button type="button" onClick={() => openForm(location)} aria-label={`Editar ${location.name}`} title="Editar" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted">
                            <Pencil size={15} />
                          </button>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            onClick={async () => {
                              setError(null);
                              if (await confirmAction(`Arquivar o local "${location.name}"? Ele some das listas; o histórico de movimentações continua.`, { title: "Arquivar local", okLabel: "Arquivar" })) archive.mutate(location);
                            }}
                            disabled={archive.isPending}
                            aria-label={`Arquivar ${location.name}`}
                            title={location.item_count > 0 ? "Só dá para arquivar um local vazio" : "Arquivar"}
                            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-50"
                          >
                            <Archive size={15} />
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <CrudDialog
          title={editing === "new" ? "Novo local de estoque" : `Editar ${editing.name}`}
          fields={[
            { key: "name", label: "Nome", required: true, placeholder: "Depósito central" },
            { key: "type", label: "Tipo", type: "select", options: typeOptions },
            { key: "address", label: "Endereço ou referência", type: "textarea", placeholder: "Rua, sala, prateleira ou placa do veículo" },
          ]}
          values={form}
          onChange={(key, value) => {
            setFormError(null);
            setForm((current) => ({ ...current, [key]: value }));
          }}
          onClose={() => setEditing(null)}
          onSubmit={() => save.mutate()}
          busy={save.isPending}
        >
          <div className="mt-4">
            <ErrorBanner message={formError} />
          </div>
        </CrudDialog>
      )}
    </div>
  );
}
