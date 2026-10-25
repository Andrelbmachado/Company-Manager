// Estoque: itens editados direto na tabela (Editar / Adicionar / Atualizar). O saldo só muda por movimentação (entrada,
// saída, transferência ou inventário), então a coluna de saldo é só leitura; a ficha do item (saldos por local,
// fornecedor e custódias) abre abaixo da tabela, sem modal nem painel lateral.
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeftRight, FileText, Trash2, X } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import { EditableTable, type EditableColumn, type EditableTableChanges } from "@/components/shared/EditableTable";
import { ImportExportButtons } from "@/components/shared/ImportExportButtons";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageToolbar } from "@/components/shared/PageToolbar";
import { StatCard } from "@/components/shared/StatCard";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { usePermission } from "@/hooks/usePermission";
import { useRequiredSession } from "@/hooks/useSession";
import { confirmAction } from "@/lib/confirm";
import { getDb } from "@/lib/db/client";
import { listCustodies } from "@/lib/inventory/custody";
import { deleteInventoryItem, saveInventoryItemRows } from "@/lib/inventory/items";
import { isAtReorderPoint, loadStockSnapshot, type StockItemRow } from "@/lib/inventory/queries";
import { formatQty } from "@/lib/inventory/stock";
import { useLabel } from "@/lib/labels/useLabel";
import { lineTotal, sumMoney } from "@/lib/money";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { BUTTON_OUTLINE, emitSafely, ErrorBanner, errorText, inventoryKeys, normalizeSearch, useActor, useInvalidateInventory, withRetiredOptions } from "../components/inventoryUi";

interface SupplierOption {
  id: string;
  name: string;
}

export interface ItemTableRow {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  supplier_id: string | null;
  unit: string;
  /** Saldo (total ou do local filtrado): só leitura. */
  quantity: number;
  min_stock: number;
  max_stock: number | null;
  cost: number;
}

const SELECT = "h-8 rounded-md border bg-background px-2 text-sm font-normal outline-none focus:ring-2 focus:ring-ring";

export default function InventoryPage() {
  const session = useRequiredSession();
  const companyId = session.company.id;
  const title = useLabel("module.inventory");
  const navigate = useNavigate();
  const actor = useActor();
  const invalidate = useInvalidateInventory(companyId);
  const canCreate = usePermission("create", "inventory");
  const canDelete = usePermission("delete", "inventory");
  const canTransfer = usePermission("transfer", "inventory");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [locationFilter, setLocationFilter] = useState("all");
  const [reorderOnly, setReorderOnly] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const snapshotQuery = useQuery({
    queryKey: inventoryKeys.snapshot(companyId),
    queryFn: async () => loadStockSnapshot(await getDb(), companyId),
  });
  const items = useMemo(() => snapshotQuery.data?.items ?? [], [snapshotQuery.data]);
  const locations = snapshotQuery.data?.locations ?? [];
  const selectedItem = items.find((item) => item.id === selectedId) ?? null;

  const suppliersQuery = useQuery({
    queryKey: ["supplier-options", companyId],
    queryFn: async () => (await getDb()).select<SupplierOption[]>("SELECT * FROM suppliers WHERE company_id=? AND deleted_at IS NULL ORDER BY name", [companyId]),
  });
  // Fornecedores ativos e, marcado "(excluído)", o já excluído que algum item ainda usa (a célula mostra o nome, não o código).
  const supplierOptions = useMemo(
    () =>
      withRetiredOptions(
        (suppliersQuery.data ?? []).map((supplier) => ({ value: supplier.id, label: supplier.name })),
        suppliersQuery.isSuccess,
        items,
        (item) => item.supplier_id,
        (item) => item.supplier?.name,
        "excluído",
      ),
    [suppliersQuery.data, suppliersQuery.isSuccess, items],
  );
  const { data: custodies = [] } = useQuery({
    queryKey: inventoryKeys.custodies(companyId),
    queryFn: async () => listCustodies(await getDb(), companyId),
    enabled: selectedId !== null,
  });

  const quantityOf = (item: StockItemRow) => (locationFilter === "all" ? item.total : item.byLocation[locationFilter] ?? 0);
  const categories = useMemo(() => [...new Set(items.map((item) => item.category).filter(Boolean))].sort() as string[], [items]);
  const query = normalizeSearch(search);
  const filteredItems = items.filter((item) => {
    const matchesSearch = !query || [item.name, item.sku, item.category, item.supplier?.name].some((value) => normalizeSearch(value ?? "").includes(query));
    const matchesLocation = locationFilter === "all" || locationFilter in item.byLocation;
    const matchesReorder = !reorderOnly || isAtReorderPoint(item.total, item.min_stock);
    return matchesSearch && matchesLocation && matchesReorder && (categoryFilter === "all" || item.category === categoryFilter);
  });
  const byId = new Map(items.map((item) => [item.id, item]));
  const rows: ItemTableRow[] = filteredItems.map((item) => ({
    id: item.id,
    name: item.name,
    sku: item.sku ?? null,
    category: item.category ?? null,
    supplier_id: item.supplier_id ?? null,
    unit: item.unit,
    quantity: quantityOf(item),
    min_stock: Number(item.min_stock ?? 0),
    max_stock: item.max_stock == null ? null : Number(item.max_stock),
    cost: Number(item.cost ?? 0),
  }));

  const stockValue = sumMoney(items.map((item) => lineTotal(item.total, item.cost)));
  const atReorderPoint = items.filter((item) => isAtReorderPoint(item.total, item.min_stock)).length;
  const filtersActive = categoryFilter !== "all" || locationFilter !== "all" || reorderOnly;

  const columns: EditableColumn<ItemTableRow>[] = [
    {
      key: "name",
      header: "Item",
      kind: "text",
      required: true,
      placeholder: "Cabo de rede Cat6",
      render: (row) => {
        const item = byId.get(row.id);
        const reorder = item ? isAtReorderPoint(item.total, item.min_stock) : false;
        return (
          <span className="flex items-center gap-2">
            {reorder && <AlertTriangle size={14} className="shrink-0 text-status-danger" aria-label="No ponto de reposição" />}
            <span className="font-medium">{row.name}</span>
          </span>
        );
      },
    },
    { key: "sku", header: "SKU", kind: "text", placeholder: "CAB-CAT6-01" },
    { key: "category", header: "Categoria", kind: "text" },
    {
      key: "supplier_id",
      header: "Fornecedor",
      kind: "select",
      options: supplierOptions,
      render: (row) =>
        row.supplier_id ? (
          supplierOptions.find((option) => option.value === row.supplier_id)?.label ?? byId.get(row.id)?.supplier?.name ?? "Fornecedor removido"
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    { key: "unit", header: "Unidade", kind: "text", placeholder: "un", width: 90 },
    {
      key: "quantity",
      header: locationFilter === "all" ? "Saldo total" : "Saldo no local",
      kind: "number",
      readOnly: true,
      render: (row) => {
        const item = byId.get(row.id);
        const reorder = item ? isAtReorderPoint(item.total, item.min_stock) : false;
        return <span className={reorder ? "font-medium text-status-danger dark:text-red-400" : "font-medium"}>{formatQty(row.quantity, row.unit)}</span>;
      },
    },
    { key: "min_stock", header: "Mínimo", kind: "number" },
    { key: "max_stock", header: "Máximo", kind: "number" },
    { key: "cost", header: "Custo unit.", kind: "money" },
  ];

  async function save(changes: EditableTableChanges<ItemTableRow>) {
    const strip = <T extends Partial<ItemTableRow>>({ quantity: _quantity, ...rest }: T) => rest;
    const result = await saveInventoryItemRows(await getDb(), companyId, actor, {
      updated: changes.updated.map((row) => ({ ...strip(row), id: row.id })),
      created: changes.created.map(strip),
    });
    invalidate();
    await emitSafely([
      ...result.created.map((item) => ({
        type: "stock.item_created",
        companyId,
        actorId: actor.userId,
        entityType: "inventory_item",
        entityId: item.id,
        title: `Item criado: ${item.name}`,
        module: "inventory",
        newValue: item.values,
      })),
      ...result.updated.map((item) => ({
        type: "stock.item_updated",
        companyId,
        actorId: actor.userId,
        entityType: "inventory_item",
        entityId: item.id,
        title: `Item alterado: ${item.name}`,
        module: "inventory",
        newValue: item.values,
      })),
    ]);
  }

  async function removeItem(row: ItemTableRow) {
    const item = byId.get(row.id);
    const warning = item && item.total > 0 ? ` Ele ainda tem ${formatQty(item.total, item.unit)} em estoque.` : "";
    if (!(await confirmAction(`Remover "${row.name}" do estoque?${warning}`, { title: "Remover item", okLabel: "Remover" }))) return;
    try {
      await deleteInventoryItem(await getDb(), companyId, actor, row.id);
      if (selectedId === row.id) setSelectedId(null);
      invalidate();
    } catch (caught) {
      setError(errorText(caught));
    }
  }

  const itemCustodies = selectedItem ? custodies.filter((custody) => custody.item_id === selectedItem.id) : [];

  return (
    <div className="space-y-6">
      <PageHeader title={title} actions={<ImportExportButtons entity="inventory" onImported={() => invalidate()} />} />

      <ErrorBanner message={error} onClose={() => setError(null)} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Itens ativos" value={items.length} />
        <StatCard title="Valor em estoque" value={formatCurrency(stockValue)} />
        <StatCard title="No ponto de reposição" value={atReorderPoint} />
        <StatCard title="Unidades em estoque" value={formatQty(items.reduce((sum, item) => sum + item.total, 0))} />
      </div>
      {atReorderPoint > 0 && (
        <p className="text-sm">
          <AlertTriangle size={14} className="mr-1 inline text-status-danger" aria-hidden="true" />
          {atReorderPoint} no ponto de reposição ·{" "}
          <Link to="/inventory/reposicao" className="font-medium text-primary-text underline-offset-4 hover:underline">Ver sugestão de compra</Link>
        </p>
      )}

      <PageToolbar search={search} onSearchChange={setSearch} searchPlaceholder="Buscar no estoque..." onFilterClick={() => setShowFilters((visible) => !visible)} filterActive={filtersActive}>
        {canCreate && locations.length > 0 && (
          <Link to="/inventory/movimentacoes" className={BUTTON_OUTLINE}>
            <ArrowLeftRight size={14} /> Movimentar
          </Link>
        )}
      </PageToolbar>

      {showFilters && (
        <div className="flex flex-wrap items-center gap-4 rounded-lg border bg-muted/20 px-4 py-3">
          <label className="flex items-center gap-2 text-sm font-medium" htmlFor="inventory-category-filter">
            Categoria
            <select id="inventory-category-filter" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className={SELECT}>
              <option value="all">Todas</option>
              {categories.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm font-medium" htmlFor="inventory-location-filter">
            Local
            <select id="inventory-location-filter" value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)} className={SELECT}>
              <option value="all">Todos (saldo somado)</option>
              {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={reorderOnly} onChange={(event) => setReorderOnly(event.target.checked)} className="h-4 w-4 accent-primary" />
            Só no ponto de reposição
          </label>
        </div>
      )}

      <EditableTable
        resource="inventory"
        label="Itens do estoque"
        title="Itens"
        rows={rows}
        columns={columns}
        loading={snapshotQuery.isLoading}
        onSave={save}
        onRefresh={() => snapshotQuery.refetch()}
        newRow={() => ({ id: uuidv4(), unit: "un", min_stock: 0, cost: 0, quantity: 0 })}
        emptyMessage={items.length === 0 ? "Nenhum item no estoque" : "Nenhum item encontrado"}
        rowActions={(row) => (
          <span className="inline-flex items-center gap-1">
            <button
              type="button"
              onClick={() => setSelectedId((current) => (current === row.id ? null : row.id))}
              aria-label={`Ficha de ${row.name}`}
              aria-expanded={selectedId === row.id}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <FileText size={13} /> Ficha
            </button>
            {canDelete && (
              <button type="button" onClick={() => void removeItem(row)} aria-label={`Remover ${row.name}`} title={`Remover ${row.name}`} className="rounded-md p-1.5 text-destructive transition-colors hover:bg-destructive/10">
                <Trash2 size={14} />
              </button>
            )}
          </span>
        )}
      />

      {selectedItem && (
        <section aria-label={`Ficha de ${selectedItem.name}`} className="space-y-5 rounded-xl border bg-card p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">{selectedItem.name}</h2>
              <p className="text-sm text-muted-foreground">{[selectedItem.sku, selectedItem.category, selectedItem.unit].filter(Boolean).join(" · ")}</p>
            </div>
            <button type="button" onClick={() => setSelectedId(null)} aria-label="Fechar ficha" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted">
              <X size={16} />
            </button>
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Saldo por local</h3>
                <div className="flex flex-wrap gap-2">
                  {canCreate && locations.length > 0 && (
                    <>
                      <button type="button" onClick={() => navigate(`/inventory/movimentacoes?item=${encodeURIComponent(selectedItem.id)}&tipo=entrada`)} className={BUTTON_OUTLINE}>Entrada</button>
                      <button type="button" onClick={() => navigate(`/inventory/movimentacoes?item=${encodeURIComponent(selectedItem.id)}&tipo=saida`)} className={BUTTON_OUTLINE}>Saída</button>
                    </>
                  )}
                  {canTransfer && selectedItem.total > 0 && (
                    <button type="button" onClick={() => navigate(`/inventory/transferencias?item=${encodeURIComponent(selectedItem.id)}`)} className={BUTTON_OUTLINE}>
                      <ArrowLeftRight size={14} /> Transferir
                    </button>
                  )}
                </div>
              </div>
              {locations.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum local cadastrado. <Link to="/inventory/locais" className="text-primary-text hover:underline">Cadastrar local</Link></p>
              ) : (
                <ul className="divide-y rounded-lg border">
                  {locations.map((location) => {
                    const quantity = selectedItem.byLocation[location.id] ?? 0;
                    return (
                      <li key={location.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                        <span>{location.name}</span>
                        <span className={`font-medium tabular-nums ${quantity === 0 ? "text-muted-foreground" : ""}`}>{formatQty(quantity, selectedItem.unit)}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="text-xs">
                <Link to={`/inventory/movimentacoes?item=${encodeURIComponent(selectedItem.id)}`} className="text-primary-text hover:underline">Ver movimentações do item</Link>
              </p>
            </div>

            <div className="space-y-2 text-sm">
              <h3 className="font-semibold">Fornecedor</h3>
              <p>{selectedItem.supplier?.name ?? "Não informado"}</p>
              <p className="text-muted-foreground">{selectedItem.supplier?.document ?? "Documento não informado"}</p>
              <p className="text-muted-foreground">{selectedItem.supplier?.email ?? "E-mail não informado"}</p>
              <p className="text-muted-foreground">{selectedItem.supplier?.phone ?? "Telefone não informado"}</p>
              <p className="text-muted-foreground">{`${selectedItem.supplier?.rating ?? "—"}/5 · ${selectedItem.supplier?.terms ?? "Condição comercial não informada"}`}</p>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Custódia de peça</h3>
              {itemCustodies.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma custódia registrada para esta peça.</p>
              ) : (
                itemCustodies.map((custody) => (
                  <div key={custody.id} className="rounded-lg border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium">{custody.holder_name ?? "Responsável não informado"}</p>
                      <StatusBadge status={custody.status} />
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {formatQty(custody.quantity, selectedItem.unit)} · retirada em {formatDateTime(custody.checked_out_at)}
                    </p>
                  </div>
                ))
              )}
              <p className="text-xs">
                <Link to="/custody" className="text-primary-text hover:underline">Abrir custódia de peça</Link>
              </p>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
