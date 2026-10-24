import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeftRight, Building2, Mail, Package, Pencil, Phone, Plus, Star, Trash2 } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "@/lib/db/client";
import { useRequiredSession } from "@/hooks/useSession";
import { usePermission } from "@/hooks/usePermission";
import { emit } from "@/lib/events/bus";
import { isAtReorderPoint, loadStockSnapshot, type StockItemRow } from "@/lib/inventory/queries";
import { activeLocation, formatQty, recordStockMovement, StockError } from "@/lib/inventory/stock";
import { lineTotal, sumMoney } from "@/lib/money";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { ImportExportButtons } from "@/components/shared/ImportExportButtons";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageToolbar } from "@/components/shared/PageToolbar";
import { CrudDialog } from "@/components/shared/CrudDialog";
import { DetailDrawer } from "@/components/shared/DetailDrawer";
import { EmptyState } from "@/components/shared/EmptyState";
import { StatCard } from "@/components/shared/StatCard";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { StockMovementDialog, type ManualMovementKind } from "../components/StockMovementDialog";
import { BUTTON_OUTLINE, BUTTON_PRIMARY, ErrorBanner, errorText, inventoryKeys, normalizeSearch, readItemNumbers, TableSkeleton, useInvalidateInventory } from "../components/inventoryUi";

interface ItemCustody {
  id: string;
  item_id?: string | null;
  holder_name?: string | null;
  quantity: number;
  status: string;
  checked_out_at: string;
  due_back_at?: string | null;
}
interface SupplierOption {
  id: string;
  name: string;
}

const EMPTY_FORM = { name: "", sku: "", category: "", supplier_id: "", unit: "un", min_stock: "0", max_stock: "", cost: "0", initial_qty: "", initial_location_id: "" };
type ItemForm = typeof EMPTY_FORM;

export default function InventoryPage() {
  const session = useRequiredSession();
  const companyId = session.company.id;
  const navigate = useNavigate();
  const invalidate = useInvalidateInventory(companyId);
  const canCreateItem = usePermission("create", "inventory");
  const canEditItem = usePermission("edit", "inventory");
  const canDeleteItem = usePermission("delete", "inventory");
  const canTransfer = usePermission("transfer", "inventory");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [locationFilter, setLocationFilter] = useState("all");
  const [reorderOnly, setReorderOnly] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [listEditing, setListEditing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<ItemForm>(EMPTY_FORM);
  const [movement, setMovement] = useState<{ kind: ManualMovementKind; itemId?: string; locationId?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Erros do formulário de novo item e do diálogo de edição aparecem dentro deles (o aviso da página fica atrás do diálogo).
  const [createError, setCreateError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const { data: snapshot, isLoading } = useQuery({
    queryKey: inventoryKeys.snapshot(companyId),
    queryFn: async () => loadStockSnapshot(await getDb(), companyId),
  });
  const items = snapshot?.items ?? [];
  const locations = snapshot?.locations ?? [];
  const selectedItem = items.find((item) => item.id === selectedId) ?? null;

  const { data: suppliers = [] } = useQuery({
    queryKey: ["supplier-options", companyId],
    queryFn: async () => (await getDb()).select<SupplierOption[]>("SELECT * FROM suppliers WHERE company_id=? AND deleted_at IS NULL ORDER BY name", [companyId]),
  });

  const { data: custodies = [] } = useQuery({
    queryKey: inventoryKeys.custodies(companyId),
    queryFn: async () => {
      const db = await getDb();
      return db.select<ItemCustody[]>(
        `SELECT c.*, u.name as holder_name
         FROM custodies c
         LEFT JOIN users u ON u.id = c.holder_id
         WHERE c.company_id=? AND c.deleted_at IS NULL
         ORDER BY c.checked_out_at DESC`,
        [companyId]
      );
    },
  });

  const createMutation = useMutation({
    mutationFn: async (): Promise<{ warning: string | null }> => {
      // Tudo validado antes de gravar: se algo falhar aqui, nada foi gravado e salvar de novo não duplica o item.
      const numbers = readItemNumbers(form);
      const name = form.name.trim();
      const locationId = numbers.initialQty > 0 ? form.initial_location_id || locations[0]?.id || "" : "";
      if (numbers.initialQty > 0 && !locationId) {
        throw new StockError("local_invalido", "Cadastre um local em Estoque › Locais para lançar o saldo inicial, ou deixe o saldo inicial em branco.");
      }
      const db = await getDb();
      if (locationId) await activeLocation(db, companyId, locationId);
      const id = uuidv4();
      await db.execute(
        "INSERT INTO inventory_items (id, company_id, name, sku, category, supplier_id, unit, min_stock, max_stock, cost) VALUES (?,?,?,?,?,?,?,?,?,?)",
        [
          id, companyId, name,
          form.sku.trim() || null, form.category.trim() || null, form.supplier_id || null, form.unit.trim() || "un",
          numbers.minStock, numbers.maxStock, numbers.cost,
        ]
      );
      // O item já está gravado: daqui em diante um erro não pode deixar o formulário aberto (salvar de novo duplicaria).
      let warning: string | null = null;
      if (numbers.initialQty > 0) {
        // Saldo inicial vira uma entrada no local escolhido (fica no histórico de movimentações).
        try {
          await recordStockMovement(db, {
            companyId,
            itemId: id,
            type: "entrada",
            quantity: numbers.initialQty,
            toLocationId: locationId,
            refType: "manual",
            userId: session.user.id,
            note: "Saldo inicial",
          });
        } catch (caught) {
          warning = `"${name}" foi cadastrado, mas o saldo inicial não foi lançado (${errorText(caught)}). Abra o item e use "Entrada" para lançar o saldo.`;
        }
      }
      try {
        await emit({
          type: "stock.item_created",
          companyId,
          actorId: session.user.id,
          entityType: "inventory_item",
          entityId: id,
          title: `Item criado: ${name}`,
          module: "inventory",
          newValue: form,
        });
      } catch (caught) {
        console.error("[estoque] evento stock.item_created falhou", caught);
      }
      return { warning };
    },
    onSuccess: ({ warning }) => {
      invalidate();
      setShowForm(false);
      setForm(EMPTY_FORM);
      setCreateError(null);
      if (warning) setError(warning);
    },
    onError: (caught) => setCreateError(errorText(caught)),
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!selectedItem) return;
      const numbers = readItemNumbers({ min_stock: form.min_stock, max_stock: form.max_stock, cost: form.cost });
      await (await getDb()).execute(
        "UPDATE inventory_items SET name=?, sku=?, category=?, supplier_id=?, unit=?, min_stock=?, max_stock=?, cost=?, updated_at=datetime('now') WHERE id=? AND company_id=?",
        [
          form.name.trim(), form.sku.trim() || null, form.category.trim() || null, form.supplier_id || null, form.unit.trim() || "un",
          numbers.minStock, numbers.maxStock, numbers.cost, selectedItem.id, companyId,
        ]
      );
    },
    onSuccess: () => {
      invalidate();
      setEditing(false);
      setEditError(null);
    },
    onError: (caught) => setEditError(errorText(caught)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await (await getDb()).execute("UPDATE inventory_items SET deleted_at=datetime('now'), updated_at=datetime('now') WHERE id=? AND company_id=?", [id, companyId]);
    },
    onSuccess: () => {
      invalidate();
      setSelectedId(null);
    },
    onError: (caught) => setError(errorText(caught)),
  });

  const quantityOf = (item: StockItemRow) => (locationFilter === "all" ? item.total : item.byLocation[locationFilter] ?? 0);
  const categories = useMemo(() => [...new Set(items.map((item) => item.category).filter(Boolean))].sort() as string[], [items]);
  const filteredItems = items.filter((item) => {
    const query = normalizeSearch(search);
    const matchesSearch = !query || [item.name, item.sku, item.category, item.supplier?.name].some((value) => normalizeSearch(value ?? "").includes(query));
    const matchesLocation = locationFilter === "all" || locationFilter in item.byLocation;
    const matchesReorder = !reorderOnly || isAtReorderPoint(item.total, item.min_stock);
    return matchesSearch && matchesLocation && matchesReorder && (categoryFilter === "all" || item.category === categoryFilter);
  });

  const stockValue = sumMoney(items.map((item) => lineTotal(item.total, item.cost)));
  const atReorderPoint = items.filter((item) => isAtReorderPoint(item.total, item.min_stock)).length;
  const filtersActive = categoryFilter !== "all" || locationFilter !== "all" || reorderOnly;

  function removeItem(item: StockItemRow) {
    const warning = item.total > 0 ? ` Ele ainda tem ${formatQty(item.total, item.unit)} em estoque.` : "";
    if (window.confirm(`Remover "${item.name}" do estoque?${warning}`)) deleteMutation.mutate(item.id);
  }

  function openMovement(kind: ManualMovementKind, itemId?: string, locationId?: string) {
    setSelectedId(null);
    setMovement({ kind, itemId, locationId });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Estoque"
        description="Itens, saldos por local e movimentações"
        actions={<ImportExportButtons entity="inventory" onImported={() => invalidate()} />}
      />

      <ErrorBanner message={error} onClose={() => setError(null)} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Itens ativos" value={items.length} hint={`${locations.length} ${locations.length === 1 ? "local" : "locais"} de estoque`} />
        <StatCard title="Valor em estoque" value={formatCurrency(stockValue)} kind="text" hint="Saldo × custo unitário" />
        <StatCard title="No ponto de reposição" value={atReorderPoint} hint="Saldo igual ou abaixo do mínimo" />
        <StatCard title="Unidades em estoque" value={formatQty(items.reduce((sum, item) => sum + item.total, 0))} kind="text" hint="Soma de todos os locais" />
      </div>
      {atReorderPoint > 0 && (
        <p className="text-sm">
          <AlertTriangle size={14} className="mr-1 inline text-status-danger" aria-hidden="true" />
          {atReorderPoint} {atReorderPoint === 1 ? "item está" : "itens estão"} no ponto de reposição.{" "}
          <Link to="/inventory/reposicao" className="font-medium text-primary-text underline-offset-4 hover:underline">Ver sugestão de compra</Link>
        </p>
      )}

      <PageToolbar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Buscar no estoque..."
        onFilterClick={() => setShowFilters((visible) => !visible)}
        filterActive={filtersActive}
      >
        {canEditItem && (
          <button type="button" onClick={() => setListEditing((active) => !active)} className={BUTTON_OUTLINE}>
            <Pencil size={14} />
            {listEditing ? "Concluir" : "Editar"}
          </button>
        )}
        {canCreateItem && locations.length > 0 && (
          <button type="button" onClick={() => openMovement("entrada")} className={BUTTON_OUTLINE}>
            <ArrowLeftRight size={14} />
            Movimentar
          </button>
        )}
        {canCreateItem && (
          <button
            type="button"
            onClick={() => {
              setForm({ ...EMPTY_FORM, initial_location_id: locations[0]?.id ?? "" });
              setCreateError(null);
              setShowForm(true);
            }}
            className={BUTTON_PRIMARY}
          >
            <Plus size={14} />
            Adicionar
          </button>
        )}
      </PageToolbar>

      {showFilters && (
        <div className="flex flex-wrap items-center gap-4 rounded-lg border bg-muted/20 px-4 py-3">
          <label className="flex items-center gap-2 text-sm font-medium" htmlFor="inventory-category-filter">
            Categoria
            <select id="inventory-category-filter" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className="h-8 rounded-md border bg-background px-2 text-sm font-normal outline-none focus:ring-2 focus:ring-ring">
              <option value="all">Todas</option>
              {categories.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm font-medium" htmlFor="inventory-location-filter">
            Local
            <select id="inventory-location-filter" value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)} className="h-8 rounded-md border bg-background px-2 text-sm font-normal outline-none focus:ring-2 focus:ring-ring">
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

      {showForm && (
        <div className="space-y-4 rounded-xl border bg-card p-5">
          <h3 className="font-semibold">Novo item</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            {[
              { key: "name", label: "Nome *", placeholder: "Cabo de rede Cat6" },
              { key: "sku", label: "SKU", placeholder: "CAB-CAT6-01" },
              { key: "category", label: "Categoria", placeholder: "Cabos" },
              { key: "unit", label: "Unidade", placeholder: "un" },
              { key: "min_stock", label: "Estoque mínimo (ponto de reposição)", placeholder: "5" },
              { key: "max_stock", label: "Estoque máximo (repor até)", placeholder: "20" },
              { key: "cost", label: "Custo (R$)", placeholder: "0,00" },
              { key: "initial_qty", label: "Saldo inicial", placeholder: "0" },
            ].map(({ key, label, placeholder }) => (
              <div key={key} className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor={`new-item-${key}`}>{label}</label>
                <input
                  id={`new-item-${key}`}
                  value={form[key as keyof ItemForm]}
                  onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
                  className="flex h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                  placeholder={placeholder}
                  inputMode={["min_stock", "max_stock", "cost", "initial_qty"].includes(key) ? "decimal" : undefined}
                />
              </div>
            ))}
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="new-item-supplier">Fornecedor</label>
              <select id="new-item-supplier" value={form.supplier_id} onChange={(event) => setForm((current) => ({ ...current, supplier_id: event.target.value }))} className="flex h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring">
                <option value="">Não informado</option>
                {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="new-item-location">Local do saldo inicial</label>
              <select id="new-item-location" value={form.initial_location_id} onChange={(event) => setForm((current) => ({ ...current, initial_location_id: event.target.value }))} disabled={locations.length === 0} className="flex h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50">
                {locations.length === 0 && <option value="">Cadastre um local em Estoque › Locais</option>}
                {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
              </select>
            </div>
          </div>
          <ErrorBanner message={createError} onClose={() => setCreateError(null)} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="rounded-md border px-4 py-1.5 text-sm transition-colors hover:bg-muted">
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => createMutation.mutate()}
              disabled={!form.name.trim() || createMutation.isPending}
              className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              Salvar
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <TableSkeleton />
      ) : filteredItems.length === 0 ? (
        <EmptyState icon={Package} title={items.length === 0 ? "Nenhum item no estoque" : "Nenhum item encontrado"} />
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="whitespace-nowrap bg-muted/30">
              <tr>
                <th className="min-w-[12rem] px-4 py-3 text-left font-medium text-muted-foreground">Item</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">SKU</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Categoria</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Fornecedor</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">{locationFilter === "all" ? "Saldo total" : "Saldo no local"}</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Mínimo</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Máximo</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Custo unit.</th>
                {listEditing && canDeleteItem && <th className="w-16 px-4 py-3 text-right font-medium text-muted-foreground">Ação</th>}
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredItems.map((item) => {
                const reorder = isAtReorderPoint(item.total, item.min_stock);
                return (
                  <tr key={item.id} onClick={() => setSelectedId(item.id)} className="cursor-pointer transition-colors hover:bg-muted/20">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {reorder && <AlertTriangle size={14} className="shrink-0 text-status-danger" aria-label="No ponto de reposição" />}
                        <span className="font-medium">{item.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{item.sku ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{item.category ?? "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{item.supplier?.name ?? "—"}</td>
                    <td className={`px-4 py-3 text-right font-medium tabular-nums ${reorder ? "text-status-danger" : ""}`}>{formatQty(quantityOf(item), item.unit)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{formatQty(item.min_stock, item.unit)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{item.max_stock == null ? "—" : formatQty(item.max_stock, item.unit)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{formatCurrency(item.cost)}</td>
                    {listEditing && canDeleteItem && (
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            removeItem(item);
                          }}
                          aria-label={`Remover ${item.name}`}
                          title={`Remover ${item.name}`}
                          className="rounded-md p-1.5 text-destructive transition-colors hover:bg-destructive/10"
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selectedItem && (
        <DetailDrawer
          title={selectedItem.name}
          subtitle={[selectedItem.sku, selectedItem.category, selectedItem.unit].filter(Boolean).join(" · ")}
          onClose={() => setSelectedId(null)}
          onEdit={
            canEditItem
              ? () => {
                  setForm({
                    ...EMPTY_FORM,
                    name: selectedItem.name,
                    sku: selectedItem.sku ?? "",
                    category: selectedItem.category ?? "",
                    supplier_id: selectedItem.supplier_id ?? "",
                    unit: selectedItem.unit,
                    min_stock: String(selectedItem.min_stock).replace(".", ","),
                    max_stock: selectedItem.max_stock == null ? "" : String(selectedItem.max_stock).replace(".", ","),
                    cost: String(selectedItem.cost).replace(".", ","),
                  });
                  setEditError(null);
                  setEditing(true);
                }
              : undefined
          }
        >
          <div className="grid grid-cols-3 gap-4 border-b pb-5">
            <Metric label="Saldo total" value={formatQty(selectedItem.total, selectedItem.unit)} alert={isAtReorderPoint(selectedItem.total, selectedItem.min_stock)} />
            <Metric label="Mínimo / máximo" value={`${formatQty(selectedItem.min_stock)} / ${selectedItem.max_stock == null ? "—" : formatQty(selectedItem.max_stock)}`} />
            <Metric label="Custo unitário" value={formatCurrency(selectedItem.cost)} />
          </div>

          <section className="border-b py-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Saldo por local</h3>
              <div className="flex flex-wrap gap-2">
                {canCreateItem && locations.length > 0 && (
                  <>
                    <button type="button" onClick={() => openMovement("entrada", selectedItem.id)} className={BUTTON_OUTLINE}>Entrada</button>
                    <button type="button" onClick={() => openMovement("saida", selectedItem.id)} className={BUTTON_OUTLINE}>Saída</button>
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
              <p className="mt-3 text-sm text-muted-foreground">Nenhum local cadastrado. <Link to="/inventory/locais" className="text-primary-text hover:underline">Cadastrar local</Link></p>
            ) : (
              <ul className="mt-3 divide-y rounded-lg border">
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
            <p className="mt-3 text-xs">
              <Link to={`/inventory/movimentacoes?item=${encodeURIComponent(selectedItem.id)}`} className="text-primary-text hover:underline">Ver movimentações do item</Link>
            </p>
          </section>

          <section className="border-b py-5">
            <h3 className="text-sm font-semibold">Fornecedor</h3>
            <div className="mt-4 space-y-3">
              <Detail icon={Building2} value={selectedItem.supplier?.name ?? "Não informado"} />
              <Detail icon={Building2} value={selectedItem.supplier?.document ?? "Documento não informado"} />
              <Detail icon={Mail} value={selectedItem.supplier?.email ?? "E-mail não informado"} />
              <Detail icon={Phone} value={selectedItem.supplier?.phone ?? "Telefone não informado"} />
              <Detail icon={Star} value={`${selectedItem.supplier?.rating ?? "—"}/5 · ${selectedItem.supplier?.terms ?? "Condição comercial não informada"}`} />
            </div>
          </section>

          <section className="py-5">
            <h3 className="text-sm font-semibold">Histórico de custódia de peça</h3>
            <div className="mt-4 space-y-3">
              {custodies.filter((custody) => custody.item_id === selectedItem.id).length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma movimentação de custódia para esta peça.</p>
              ) : custodies.filter((custody) => custody.item_id === selectedItem.id).map((custody) => (
                <div key={custody.id} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium">{custody.holder_name ?? "Responsável não informado"}</p>
                    <StatusBadge status={custody.status} />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {formatQty(custody.quantity, selectedItem.unit)} · retirada em {formatDateTime(custody.checked_out_at)}
                  </p>
                  {custody.due_back_at && <p className="mt-1 text-xs text-muted-foreground">Devolução prevista: {formatDateTime(custody.due_back_at)}</p>}
                </div>
              ))}
            </div>
          </section>
        </DetailDrawer>
      )}

      {editing && selectedItem && (
        <CrudDialog
          title="Editar item"
          fields={[
            { key: "name", label: "Nome", required: true },
            { key: "sku", label: "SKU" },
            { key: "category", label: "Categoria" },
            { key: "supplier_id", label: "Fornecedor", type: "select", options: [{ value: "", label: "Não informado" }, ...suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name }))] },
            { key: "unit", label: "Unidade" },
            { key: "min_stock", label: "Estoque mínimo (ponto de reposição)" },
            { key: "max_stock", label: "Estoque máximo (repor até)" },
            { key: "cost", label: "Custo unitário (R$)" },
          ]}
          values={form}
          onChange={(key, value) => setForm((current) => ({ ...current, [key]: value }))}
          onClose={() => setEditing(false)}
          onSubmit={() => updateMutation.mutate()}
          busy={updateMutation.isPending}
        >
          <p className="mt-4 text-xs text-muted-foreground">O saldo muda só por movimentação (entrada, saída, transferência ou inventário), não por aqui.</p>
          {editError && (
            <div className="mt-4">
              <ErrorBanner message={editError} onClose={() => setEditError(null)} />
            </div>
          )}
        </CrudDialog>
      )}

      {movement && (
        <StockMovementDialog
          companyId={companyId}
          userId={session.user.id}
          items={items}
          locations={locations}
          initial={movement}
          onClose={() => setMovement(null)}
          onSaved={() => {
            invalidate();
            setMovement(null);
          }}
        />
      )}
    </div>
  );
}

function Metric({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-sm font-semibold ${alert ? "text-status-danger" : ""}`}>{value}</p>
    </div>
  );
}

function Detail({ icon: Icon, value }: { icon: React.ElementType; value: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <Icon size={14} className="shrink-0 text-muted-foreground" />
      <span>{value}</span>
    </div>
  );
}
