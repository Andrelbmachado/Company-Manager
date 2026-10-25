import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Power, Tags, Trash2 } from "lucide-react";
import { CrudDialog, type CrudField } from "@/components/shared/CrudDialog";
import { DetailDrawer, DetailGrid, DetailItem } from "@/components/shared/DetailDrawer";
import { EmptyState } from "@/components/shared/EmptyState";
import { ImportExportButtons } from "@/components/shared/ImportExportButtons";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageToolbar } from "@/components/shared/PageToolbar";
import { StatCard } from "@/components/shared/StatCard";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { usePermission } from "@/hooks/usePermission";
import { useRequiredSession } from "@/hooks/useSession";
import { getDb } from "@/lib/db/client";
import { deleteProduct, saveProduct, setProductActive } from "@/lib/erp/catalog";
import { marginPercent } from "@/lib/erp/pricing";
import { formatQty, roundQty } from "@/lib/erp/stockPosting";
import { isTrue } from "@/lib/erp/tradeDb";
import { emit } from "@/lib/events/bus";
import { formatCurrency } from "@/lib/utils";
import { BUTTON, DANGER, ErrorNote, INPUT, LoadingRows, PRIMARY, TD, TH, byId, invalidateTrade, num, useInventoryItems, useLocations, usePriceListItems, usePriceLists, useProducts, useStockBalances } from "../components/tradeKit";
import type { Product, ProductKind } from "@/types";

const NEW_STOCK_ITEM = "__novo__";

const EMPTY_FORM: Record<string, string> = {
  name: "", sku: "", kind: "produto", category: "", unit: "un", price: "", cost: "", taxRate: "", barcode: "", ncm: "", serviceCode: "", stock: "", active: "1", description: "",
};

function formFor(product: Product): Record<string, string> {
  return {
    name: product.name,
    sku: product.sku ?? "",
    kind: product.kind,
    category: product.category ?? "",
    unit: product.unit ?? "un",
    price: String(product.price ?? ""),
    cost: String(product.cost ?? ""),
    taxRate: product.tax_rate ? String(product.tax_rate) : "",
    barcode: product.barcode ?? "",
    ncm: product.ncm ?? "",
    serviceCode: product.service_code ?? "",
    stock: product.inventory_item_id ?? "",
    active: isTrue(product.active) ? "1" : "0",
    description: product.description ?? "",
  };
}

function formatMargin(value: number | null): string {
  return value == null ? "—" : `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

export default function CatalogPage() {
  const session = useRequiredSession();
  const companyId = session.company.id;
  const qc = useQueryClient();
  const canCreate = usePermission("create", "products");
  const canEdit = usePermission("edit", "products");
  const canDelete = usePermission("delete", "products");
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<"todos" | ProductKind>("todos");
  const [statusFilter, setStatusFilter] = useState<"ativos" | "inativos" | "todos">("ativos");
  const [dialog, setDialog] = useState<{ mode: "create" } | { mode: "edit"; product: Product } | null>(null);
  const [form, setForm] = useState<Record<string, string>>(EMPTY_FORM);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

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

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products.filter((product) => {
      if (kindFilter !== "todos" && product.kind !== kindFilter) return false;
      const active = isTrue(product.active);
      if (statusFilter === "ativos" && !active) return false;
      if (statusFilter === "inativos" && active) return false;
      return !term || [product.name, product.sku, product.category, product.barcode].some((value) => value?.toLowerCase().includes(term));
    });
  }, [products, search, kindFilter, statusFilter]);

  const activeProducts = products.filter((product) => isTrue(product.active));
  const margins = activeProducts.map((product) => marginPercent(Number(product.price), Number(product.cost))).filter((value): value is number => value != null);
  const averageMargin = margins.length ? Math.round((margins.reduce((sum, value) => sum + value, 0) / margins.length) * 10) / 10 : null;
  const outOfStock = activeProducts.filter((product) => product.kind === "produto" && product.inventory_item_id && (stockOf.get(product.inventory_item_id) ?? 0) <= 0).length;

  const selected = products.find((product) => product.id === selectedId) ?? null;
  const linkedItem = selected?.inventory_item_id ? itemsById.get(selected.inventory_item_id) : undefined;
  const selectedPrices = selected ? priceListItems.filter((item) => item.product_id === selected.id && listsById.has(item.price_list_id)).sort((a, b) => (listsById.get(a.price_list_id)?.name ?? "").localeCompare(listsById.get(b.price_list_id)?.name ?? "", "pt-BR") || Number(a.min_qty) - Number(b.min_qty)) : [];

  const linkedElsewhere = new Set(products.filter((product) => product.inventory_item_id && product.id !== (dialog?.mode === "edit" ? dialog.product.id : null)).map((product) => product.inventory_item_id));
  const fields: CrudField[] = [
    { key: "name", label: "Nome", required: true },
    { key: "kind", label: "Tipo", type: "select", options: [{ value: "produto", label: "Produto" }, { value: "servico", label: "Serviço" }] },
    { key: "sku", label: "SKU / código" },
    { key: "category", label: "Categoria" },
    { key: "unit", label: "Unidade", placeholder: "un, h, kg, m..." },
    { key: "price", label: "Preço de venda (R$)", type: "number", required: true },
    { key: "cost", label: "Custo (R$)", type: "number" },
    { key: "taxRate", label: "Imposto (%)", type: "number" },
    ...(form.kind === "produto"
      ? [
          {
            key: "stock",
            label: "Item de estoque",
            type: "select" as const,
            options: [
              { value: "", label: "Sem controle de estoque" },
              ...(dialog?.mode === "edit" && dialog.product.inventory_item_id ? [] : [{ value: NEW_STOCK_ITEM, label: "Criar item de estoque com este produto" }]),
              ...items.map((item) => ({ value: item.id, label: `${item.name}${item.sku ? ` (${item.sku})` : ""}${linkedElsewhere.has(item.id) ? " · já ligado a outro produto" : ""}` })),
            ],
          },
          { key: "barcode", label: "Código de barras" },
          { key: "ncm", label: "NCM" },
        ]
      : [{ key: "serviceCode", label: "Código do serviço (LC 116)" }]),
    { key: "active", label: "Situação", type: "select", options: [{ value: "1", label: "Ativo" }, { value: "0", label: "Inativo" }] },
    { key: "description", label: "Descrição", type: "textarea" },
  ];

  const save = useMutation({
    mutationFn: async () => {
      const editing = dialog?.mode === "edit" ? dialog.product : null;
      const kind = form.kind as ProductKind;
      const id = await saveProduct(await getDb(), companyId, {
        name: form.name,
        sku: form.sku,
        kind,
        category: form.category,
        unit: form.unit,
        price: num(form.price, Number.NaN),
        cost: num(form.cost, 0),
        taxRate: num(form.taxRate, 0),
        barcode: kind === "produto" ? form.barcode : null,
        ncm: kind === "produto" ? form.ncm : null,
        serviceCode: kind === "servico" ? form.serviceCode : null,
        inventoryItemId: kind === "produto" && form.stock && form.stock !== NEW_STOCK_ITEM ? form.stock : null,
        createStockItem: kind === "produto" && form.stock === NEW_STOCK_ITEM,
        revenueCategoryId: editing?.revenue_category_id ?? null,
        active: form.active !== "0",
        description: form.description,
      }, editing?.id);
      await emit({ type: editing ? "product.updated" : "product.created", companyId, actorId: session.user.id, entityType: "product", entityId: id, title: `${editing ? "Produto atualizado" : "Produto cadastrado"}: ${form.name.trim()}`, module: "catalog" });
      return id;
    },
    onSuccess: (id) => {
      invalidateTrade(qc);
      setDialog(null);
      setSelectedId(id);
    },
  });

  const toggle = useMutation({
    mutationFn: async (product: Product) => {
      const active = !isTrue(product.active);
      await setProductActive(await getDb(), companyId, product.id, active);
      await emit({ type: active ? "product.activated" : "product.deactivated", companyId, actorId: session.user.id, entityType: "product", entityId: product.id, title: `${active ? "Produto ativado" : "Produto desativado"}: ${product.name}`, module: "catalog" });
    },
    onSuccess: () => invalidateTrade(qc),
  });

  const remove = useMutation({
    mutationFn: async (product: Product) => {
      await deleteProduct(await getDb(), companyId, product.id);
      await emit({ type: "product.deleted", companyId, actorId: session.user.id, entityType: "product", entityId: product.id, title: `Produto excluído: ${product.name}`, module: "catalog" });
    },
    onSuccess: () => {
      invalidateTrade(qc);
      setConfirmDelete(false);
      setSelectedId(null);
    },
  });

  function openCreate() {
    save.reset();
    setForm(EMPTY_FORM);
    setDialog({ mode: "create" });
  }

  function openEdit(product: Product) {
    save.reset();
    setForm(formFor(product));
    setDialog({ mode: "edit", product });
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Catálogo"
        description="Produtos e serviços com preço, custo e imposto, usados em vendas, compras e estoque."
        actions={
          <>
            <ImportExportButtons entity="products" onImported={() => invalidateTrade(qc)} />
            {canCreate && <button type="button" onClick={openCreate} className={PRIMARY}><Plus size={14} /> Novo produto ou serviço</button>}
          </>
        }
      />

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

      {isLoading ? <LoadingRows /> : filtered.length === 0 ? (
        <EmptyState icon={Tags} title={products.length ? "Nenhum item encontrado" : "Catálogo vazio"} description={products.length ? "Mude a busca ou os filtros." : "Cadastre produtos e serviços para usar nos pedidos de venda e de compra."} />
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className={TH}>Item</th>
                <th className={TH}>Tipo</th>
                <th className={TH}>Categoria</th>
                <th className={`${TH} text-right`}>Preço</th>
                <th className={`${TH} text-right`}>Custo</th>
                <th className={`${TH} text-right`}>Margem</th>
                <th className={`${TH} text-right`}>Estoque</th>
                <th className={TH}>Situação</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((product) => {
                const stock = product.kind === "produto" && product.inventory_item_id ? stockOf.get(product.inventory_item_id) ?? 0 : null;
                return (
                  <tr key={product.id} className="cursor-pointer transition-colors hover:bg-muted/20" onClick={() => setSelectedId(product.id)}>
                    <td className={TD}>
                      <button type="button" className="text-left font-medium hover:underline" onClick={(event) => { event.stopPropagation(); setSelectedId(product.id); }}>{product.name}</button>
                      {product.sku && <p className="text-xs text-muted-foreground">{product.sku}</p>}
                    </td>
                    <td className={TD}><StatusBadge status={product.kind} /></td>
                    <td className={`${TD} text-muted-foreground`}>{product.category ?? "—"}</td>
                    <td className={`${TD} text-right tabular-nums`}>{formatCurrency(Number(product.price))}</td>
                    <td className={`${TD} text-right tabular-nums text-muted-foreground`}>{formatCurrency(Number(product.cost))}</td>
                    <td className={`${TD} text-right tabular-nums`}>{formatMargin(marginPercent(Number(product.price), Number(product.cost)))}</td>
                    <td className={`${TD} text-right tabular-nums ${stock != null && stock <= 0 ? "text-destructive" : ""}`}>{stock == null ? "—" : `${formatQty(stock)} ${product.unit}`}</td>
                    <td className={TD}><StatusBadge status={isTrue(product.active) ? "active" : "inactive"} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <DetailDrawer title={selected.name} subtitle={selected.kind === "servico" ? "Serviço" : "Produto"} onClose={() => setSelectedId(null)} onEdit={canEdit ? () => openEdit(selected) : undefined}>
          <div className="space-y-6">
            <DetailGrid>
              <DetailItem label="SKU" value={selected.sku} />
              <DetailItem label="Situação" value={<StatusBadge status={isTrue(selected.active) ? "active" : "inactive"} />} />
              <DetailItem label="Categoria" value={selected.category} />
              <DetailItem label="Unidade" value={selected.unit} />
              <DetailItem label="Preço de venda" value={formatCurrency(Number(selected.price))} />
              <DetailItem label="Custo" value={formatCurrency(Number(selected.cost))} />
              <DetailItem label="Margem" value={formatMargin(marginPercent(Number(selected.price), Number(selected.cost)))} />
              <DetailItem label="Imposto" value={`${Number(selected.tax_rate || 0).toLocaleString("pt-BR")}%`} />
              {selected.kind === "produto" ? (
                <>
                  <DetailItem label="NCM" value={selected.ncm} />
                  <DetailItem label="Código de barras" value={selected.barcode} />
                </>
              ) : <DetailItem label="Código do serviço" value={selected.service_code} />}
            </DetailGrid>
            {selected.description && <DetailItem label="Descrição" value={<p className="whitespace-pre-wrap">{selected.description}</p>} />}

            {selected.kind === "produto" && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Estoque</h3>
                {!linkedItem ? <p className="text-sm text-muted-foreground">Sem item de estoque: vendas não dão baixa e compras não dão entrada.</p> : (
                  <>
                    <p className="text-sm">Item <span className="font-medium">{linkedItem.name}</span> · {formatQty(stockOf.get(linkedItem.id) ?? 0)} {linkedItem.unit} no total</p>
                    <ul className="divide-y rounded-lg border text-sm">
                      {balances.filter((balance) => balance.item_id === linkedItem.id && Number(balance.quantity) !== 0).map((balance) => (
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
              {selectedPrices.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma tabela tem preço especial para este item; vale o preço do catálogo.</p> : (
                <ul className="divide-y rounded-lg border text-sm">
                  {selectedPrices.map((item) => (
                    <li key={item.id} className="flex justify-between gap-3 px-3 py-2">
                      <span>{listsById.get(item.price_list_id)?.name}{Number(item.min_qty) > 1 && <span className="text-muted-foreground"> · a partir de {formatQty(Number(item.min_qty))}</span>}</span>
                      <span className="tabular-nums">{formatCurrency(Number(item.price))}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {(canEdit || canDelete) && (
              <div className="flex flex-wrap gap-2 border-t pt-4">
                {canEdit && (
                  <button type="button" className={BUTTON} disabled={toggle.isPending} onClick={() => toggle.mutate(selected)}>
                    <Power size={14} /> {isTrue(selected.active) ? "Desativar" : "Ativar"}
                  </button>
                )}
                {canDelete && <button type="button" className={DANGER} onClick={() => { remove.reset(); setConfirmDelete(true); }}><Trash2 size={14} /> Excluir</button>}
              </div>
            )}
            <ErrorNote error={toggle.error} />
          </div>
        </DetailDrawer>
      )}

      {dialog && (
        <CrudDialog
          title={dialog.mode === "edit" ? `Editar ${dialog.product.kind === "servico" ? "serviço" : "produto"}` : "Novo produto ou serviço"}
          fields={fields}
          values={form}
          onChange={(key, value) => setForm((current) => ({ ...current, [key]: value }))}
          onClose={() => setDialog(null)}
          onSubmit={() => save.mutate()}
          busy={save.isPending}
        >
          {form.kind === "produto" && form.stock === NEW_STOCK_ITEM && <p className="mt-4 text-xs text-muted-foreground">Um item de estoque com o mesmo nome, SKU, unidade e custo será criado e ligado a este produto.</p>}
          <ErrorNote error={save.error} className="mt-4" />
        </CrudDialog>
      )}

      {confirmDelete && selected && (
        <CrudDialog title="Excluir do catálogo?" fields={[]} values={{}} onChange={() => undefined} onClose={() => setConfirmDelete(false)} onSubmit={() => remove.mutate(selected)} busy={remove.isPending} submitLabel="Excluir">
          <p className="text-sm text-muted-foreground">"{selected.name}" e os preços dele nas tabelas saem do catálogo. Pedidos e faturas antigos continuam com a descrição. Para só parar de vender, desative.</p>
          <ErrorNote error={remove.error} className="mt-3" />
        </CrudDialog>
      )}
    </div>
  );
}
