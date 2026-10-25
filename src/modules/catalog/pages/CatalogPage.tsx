// Catálogo: produtos e serviços numa tabela editável (Editar/Adicionar/Atualizar na própria linha). Detalhes de estoque
// e preços nas tabelas aparecem num painel abaixo da lista; excluir pede confirmação.
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Info, Trash2 } from "lucide-react";
import { EditableTable, type EditableColumn, type EditableTableChanges } from "@/components/shared/EditableTable";
import { ImportExportButtons } from "@/components/shared/ImportExportButtons";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageToolbar } from "@/components/shared/PageToolbar";
import { StatCard } from "@/components/shared/StatCard";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { usePermission } from "@/hooks/usePermission";
import { useRequiredSession } from "@/hooks/useSession";
import { NEW_STOCK_ITEM, saveProductRows } from "@/lib/commercial/catalogEdits";
import { confirmAction } from "@/lib/confirm";
import { getDb } from "@/lib/db/client";
import { deleteProduct } from "@/lib/erp/catalog";
import { marginPercent } from "@/lib/erp/pricing";
import { formatQty, roundQty } from "@/lib/erp/stockPosting";
import { errorMessage, isTrue } from "@/lib/erp/tradeDb";
import { emit } from "@/lib/events/bus";
import { useLabel } from "@/lib/labels/useLabel";
import { formatCurrency } from "@/lib/utils";
import { InfoGrid, InfoItem, InlinePanel, ROW_ACTION, ROW_DANGER, refreshTrade, useEditActor } from "../components/inline";
import { INPUT, byId, invalidateTrade, useInventoryItems, useLocations, usePriceListItems, usePriceLists, useProducts, useStockBalances } from "../components/tradeKit";
import type { Product, ProductKind } from "@/types";

type ProductRow = Product & { margin: number | null; stock: number | null };

function formatMargin(value: number | null): string {
  return value == null ? "—" : `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

export default function CatalogPage() {
  const session = useRequiredSession();
  const companyId = session.company.id;
  const actor = useEditActor();
  const title = useLabel("module.catalog");
  const qc = useQueryClient();
  const canDelete = usePermission("delete", "products");
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<"todos" | ProductKind>("todos");
  const [statusFilter, setStatusFilter] = useState<"ativos" | "inativos" | "todos">("ativos");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: products = [], isLoading } = useProducts(companyId);
  const { data: items = [] } = useInventoryItems(companyId);
  const { data: balances = [] } = useStockBalances(companyId);
  const { data: locations = [] } = useLocations(companyId);
  const { data: priceLists = [] } = usePriceLists(companyId);
  const { data: priceListItems = [] } = usePriceListItems(companyId);

  const itemsById = useMemo(() => byId(items), [items]);
  const locationsById = useMemo(() => byId(locations), [locations]);
  const listsById = useMemo(() => byId(priceLists), [priceLists]);
  const stockOf = useMemo(() => {
    const totals = new Map<string, number>();
    for (const balance of balances) totals.set(balance.item_id, roundQty((totals.get(balance.item_id) ?? 0) + Number(balance.quantity)));
    return totals;
  }, [balances]);

  const rows = useMemo<ProductRow[]>(() => {
    const term = search.trim().toLowerCase();
    return products
      .filter((product) => {
        if (kindFilter !== "todos" && product.kind !== kindFilter) return false;
        const active = isTrue(product.active);
        if (statusFilter === "ativos" && !active) return false;
        if (statusFilter === "inativos" && active) return false;
        return !term || [product.name, product.sku, product.category, product.barcode].some((value) => value?.toLowerCase().includes(term));
      })
      .map((product) => ({
        ...product,
        active: isTrue(product.active) ? 1 : 0,
        margin: marginPercent(Number(product.price), Number(product.cost)),
        stock: product.kind === "produto" && product.inventory_item_id ? stockOf.get(product.inventory_item_id) ?? 0 : null,
      }));
  }, [products, search, kindFilter, statusFilter, stockOf]);

  const activeProducts = products.filter((product) => isTrue(product.active));
  const margins = activeProducts.map((product) => marginPercent(Number(product.price), Number(product.cost))).filter((value): value is number => value != null);
  const averageMargin = margins.length ? Math.round((margins.reduce((sum, value) => sum + value, 0) / margins.length) * 10) / 10 : null;
  const outOfStock = activeProducts.filter((product) => product.kind === "produto" && product.inventory_item_id && (stockOf.get(product.inventory_item_id) ?? 0) <= 0).length;

  const linked = useMemo(() => new Map(products.filter((product) => product.inventory_item_id).map((product) => [product.inventory_item_id!, product.name])), [products]);
  const columns: EditableColumn<ProductRow>[] = [
    { key: "name", header: "Nome", kind: "text", required: true, width: 220, render: (row) => <span className="font-medium">{row.name}</span> },
    { key: "sku", header: "SKU", kind: "text", width: 110 },
    { key: "kind", header: "Tipo", kind: "select", required: true, options: [{ value: "produto", label: "Produto" }, { value: "servico", label: "Serviço" }], render: (row) => <StatusBadge status={row.kind} /> },
    { key: "category", header: "Categoria", kind: "text" },
    { key: "unit", header: "Unidade", kind: "text", width: 80 },
    { key: "price", header: "Preço", kind: "money", required: true },
    { key: "cost", header: "Custo", kind: "money" },
    { key: "tax_rate", header: "Imposto (%)", kind: "number", width: 90 },
    { key: "margin", header: "Margem", kind: "number", readOnly: true, render: (row) => <span className="tabular-nums">{formatMargin(row.margin)}</span> },
    {
      key: "stock",
      header: "Estoque",
      kind: "number",
      readOnly: true,
      render: (row) => <span className={`tabular-nums ${row.stock != null && row.stock <= 0 ? "text-destructive" : ""}`}>{row.stock == null ? "—" : `${formatQty(row.stock)} ${row.unit}`}</span>,
    },
    {
      key: "inventory_item_id",
      header: "Item de estoque",
      kind: "select",
      options: [
        { value: NEW_STOCK_ITEM, label: "Criar item de estoque com este produto" },
        ...items.map((item) => ({ value: item.id, label: `${item.name}${item.sku ? ` (${item.sku})` : ""}${linked.has(item.id) ? ` · ligado a ${linked.get(item.id)}` : ""}` })),
      ],
      render: (row) => (row.inventory_item_id ? itemsById.get(row.inventory_item_id)?.name ?? "—" : <span className="text-muted-foreground">Sem estoque</span>),
    },
    { key: "active", header: "Ativo", kind: "bool", render: (row) => <StatusBadge status={isTrue(row.active) ? "active" : "inactive"} /> },
  ];

  async function save(changes: EditableTableChanges<ProductRow>) {
    const result = await saveProductRows(await getDb(), companyId, actor, changes);
    const names = new Map(products.map((product) => [product.id, product.name]));
    for (const id of result.updated) await emit({ type: "product.updated", companyId, actorId: session.user.id, entityType: "product", entityId: id, title: `Produto atualizado: ${names.get(id) ?? ""}`.trim(), module: "catalog" });
    for (const [index, id] of result.created.entries()) await emit({ type: "product.created", companyId, actorId: session.user.id, entityType: "product", entityId: id, title: `Produto cadastrado: ${String(changes.created[index]?.name ?? "").trim()}`, module: "catalog" });
    invalidateTrade(qc);
  }

  async function remove(product: Product) {
    setActionError(null);
    const ok = await confirmAction(`"${product.name}" e os preços dele nas tabelas saem do catálogo. Pedidos e faturas antigos continuam com a descrição. Para só parar de vender, desmarque Ativo.`, { title: "Excluir do catálogo?", okLabel: "Excluir" });
    if (!ok) return;
    try {
      await deleteProduct(await getDb(), companyId, product.id);
      await emit({ type: "product.deleted", companyId, actorId: session.user.id, entityType: "product", entityId: product.id, title: `Produto excluído: ${product.name}`, module: "catalog" });
      if (selectedId === product.id) setSelectedId(null);
      invalidateTrade(qc);
    } catch (error) {
      setActionError(errorMessage(error));
    }
  }

  const selected = products.find((product) => product.id === selectedId) ?? null;
  const linkedItem = selected?.inventory_item_id ? itemsById.get(selected.inventory_item_id) : undefined;
  const selectedPrices = selected
    ? priceListItems
        .filter((item) => item.product_id === selected.id && listsById.has(item.price_list_id))
        .sort((a, b) => (listsById.get(a.price_list_id)?.name ?? "").localeCompare(listsById.get(b.price_list_id)?.name ?? "", "pt-BR") || Number(a.min_qty) - Number(b.min_qty))
    : [];

  return (
    <div className="space-y-5">
      <PageHeader title={title} description="Produtos e serviços com preço, custo e imposto, usados em vendas, compras e estoque." actions={<ImportExportButtons entity="products" onImported={() => invalidateTrade(qc)} />} />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard title="Itens ativos" value={activeProducts.length} />
        <StatCard title="Margem média" value={formatMargin(averageMargin)} />
        <StatCard title="Produtos sem estoque" value={outOfStock} />
      </div>

      <PageToolbar search={search} onSearchChange={setSearch} searchPlaceholder="Buscar por nome, SKU, categoria...">
        <select aria-label="Filtrar por tipo" value={kindFilter} onChange={(event) => setKindFilter(event.target.value as typeof kindFilter)} className={`${INPUT} w-36`}>
          <option value="todos">Todos os tipos</option>
          <option value="produto">Produtos</option>
          <option value="servico">Serviços</option>
        </select>
        <select aria-label="Filtrar por situação" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} className={`${INPUT} w-32`}>
          <option value="ativos">Ativos</option>
          <option value="inativos">Inativos</option>
          <option value="todos">Todos</option>
        </select>
      </PageToolbar>

      <EditableTable<ProductRow>
        resource="products"
        title="Produtos e serviços"
        label="Catálogo de produtos e serviços"
        rows={rows}
        columns={columns}
        loading={isLoading}
        onSave={save}
        onRefresh={() => refreshTrade(qc)}
        newRow={() => ({ kind: "produto", unit: "un", cost: 0, tax_rate: 0, active: 1 })}
        emptyMessage={products.length ? "Nenhum item encontrado: mude a busca ou os filtros." : "Catálogo vazio: use Adicionar para cadastrar produtos e serviços."}
        rowActions={(row) => (
          <>
            <button type="button" className={ROW_ACTION} aria-label={`Detalhes de ${row.name}`} aria-pressed={selectedId === row.id} onClick={() => setSelectedId(selectedId === row.id ? null : row.id)}>
              <Info size={13} /> Detalhes
            </button>
            {canDelete && (
              <button type="button" className={ROW_DANGER} aria-label={`Excluir ${row.name}`} onClick={() => void remove(row)}>
                <Trash2 size={13} /> Excluir
              </button>
            )}
          </>
        )}
      />
      {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}

      {selected && (
        <InlinePanel title={selected.name} subtitle={selected.kind === "servico" ? "Serviço" : "Produto"} onClose={() => setSelectedId(null)}>
          <InfoGrid>
            <InfoItem label="SKU" value={selected.sku} />
            <InfoItem label="Situação" value={<StatusBadge status={isTrue(selected.active) ? "active" : "inactive"} />} />
            <InfoItem label="Categoria" value={selected.category} />
            <InfoItem label="Unidade" value={selected.unit} />
            <InfoItem label="Preço de venda" value={formatCurrency(Number(selected.price))} />
            <InfoItem label="Custo" value={formatCurrency(Number(selected.cost))} />
            <InfoItem label="Margem" value={formatMargin(marginPercent(Number(selected.price), Number(selected.cost)))} />
            <InfoItem label="Imposto" value={`${Number(selected.tax_rate || 0).toLocaleString("pt-BR")}%`} />
            {selected.kind === "produto" ? (
              <>
                <InfoItem label="NCM" value={selected.ncm} />
                <InfoItem label="Código de barras" value={selected.barcode} />
              </>
            ) : (
              <InfoItem label="Código do serviço" value={selected.service_code} />
            )}
          </InfoGrid>
          {selected.description && <InfoItem label="Descrição" value={<p className="whitespace-pre-wrap">{selected.description}</p>} />}

          <div className="grid gap-5 lg:grid-cols-2">
            {selected.kind === "produto" && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Estoque</h3>
                {!linkedItem ? (
                  <p className="text-sm text-muted-foreground">Sem item de estoque: vendas não dão baixa e compras não dão entrada.</p>
                ) : (
                  <>
                    <p className="text-sm">
                      Item <span className="font-medium">{linkedItem.name}</span> · {formatQty(stockOf.get(linkedItem.id) ?? 0)} {linkedItem.unit} no total
                    </p>
                    <ul className="divide-y rounded-lg border text-sm">
                      {balances
                        .filter((balance) => balance.item_id === linkedItem.id && Number(balance.quantity) !== 0)
                        .map((balance) => (
                          <li key={balance.id} className="flex justify-between px-3 py-2">
                            <span>{locationsById.get(balance.location_id)?.name ?? "Local removido"}</span>
                            <span className="tabular-nums">{formatQty(Number(balance.quantity))} {linkedItem.unit}</span>
                          </li>
                        ))}
                    </ul>
                  </>
                )}
              </div>
            )}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Preços nas tabelas</h3>
              {selectedPrices.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma tabela tem preço especial para este item; vale o preço do catálogo.</p>
              ) : (
                <ul className="divide-y rounded-lg border text-sm">
                  {selectedPrices.map((item) => (
                    <li key={item.id} className="flex justify-between gap-3 px-3 py-2">
                      <span>
                        {listsById.get(item.price_list_id)?.name}
                        {Number(item.min_qty) > 1 && <span className="text-muted-foreground"> · a partir de {formatQty(Number(item.min_qty))}</span>}
                      </span>
                      <span className="tabular-nums">{formatCurrency(Number(item.price))}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </InlinePanel>
      )}
    </div>
  );
}
