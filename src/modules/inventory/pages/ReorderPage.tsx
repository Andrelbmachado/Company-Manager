import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, PackagePlus, ShoppingCart } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { formatSequence } from "@/lib/db/sequence";
import { useRequiredSession } from "@/hooks/useSession";
import { usePermission } from "@/hooks/usePermission";
import { emit } from "@/lib/events/bus";
import { isAtReorderPoint, loadStockSnapshot } from "@/lib/inventory/queries";
import { createReorderPurchaseOrders, onOrderByItem, reorderSuggestions, type CreatedPurchaseOrder, type ReorderSuggestion } from "@/lib/inventory/reorder";
import { formatQty } from "@/lib/inventory/stock";
import { lineTotal, sumMoney } from "@/lib/money";
import { formatCurrency } from "@/lib/utils";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatCard } from "@/components/shared/StatCard";
import { BUTTON_PRIMARY, ErrorBanner, errorText, Field, INPUT, inventoryKeys, parseDecimal, TableSkeleton, useInvalidateInventory } from "../components/inventoryUi";

const NO_SUPPLIER = "Sem fornecedor cadastrado";

export default function ReorderPage() {
  const session = useRequiredSession();
  const companyId = session.company.id;
  const invalidate = useInvalidateInventory(companyId);
  const canBuy = usePermission("create", "purchase_orders");
  // Itens desmarcados pelo usuário; tudo o que está na lista começa marcado.
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  // null = ainda não escolhido (começa no primeiro local); "" = "Definir no pedido".
  const [locationId, setLocationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedPurchaseOrder[]>([]);

  const { data: suggestions = [], isLoading } = useQuery({
    queryKey: inventoryKeys.reorder(companyId),
    queryFn: async () => reorderSuggestions(await getDb(), companyId),
  });
  const { data: snapshot } = useQuery({
    queryKey: inventoryKeys.snapshot(companyId),
    queryFn: async () => loadStockSnapshot(await getDb(), companyId),
  });
  const { data: onOrder } = useQuery({
    queryKey: [...inventoryKeys.reorder(companyId), "on-order"],
    queryFn: async () => onOrderByItem(await getDb(), companyId),
  });
  const locations = snapshot?.locations ?? [];
  // Abaixo do mínimo, mas o que já está em pedido de compra aberto cobre a reposição: não entra na sugestão.
  const suggested = new Set(suggestions.map((row) => row.item_id));
  const covered = (snapshot?.items ?? [])
    .filter((item) => isAtReorderPoint(item.total, item.min_stock) && !suggested.has(item.id))
    .map((item) => ({ ...item, on_order: onOrder?.get(item.id) ?? 0 }));

  useEffect(() => {
    if (locationId === null && locations[0]) setLocationId(locations[0].id);
  }, [locations, locationId]);

  const qtyOf = (row: ReorderSuggestion) => {
    const draft = quantities[row.item_id];
    return draft === undefined ? row.suggested_qty : parseDecimal(draft);
  };
  const groups = useMemo(() => {
    const map = new Map<string, ReorderSuggestion[]>();
    for (const row of suggestions) {
      const key = row.supplier_name ?? NO_SUPPLIER;
      map.set(key, [...(map.get(key) ?? []), row]);
    }
    return [...map.entries()];
  }, [suggestions]);

  const isSelected = (itemId: string) => !excluded.has(itemId);
  const chosen = suggestions.filter((row) => isSelected(row.item_id));
  const invalid = chosen.filter((row) => !(qtyOf(row) > 0));
  const chosenCost = sumMoney(chosen.map((row) => (qtyOf(row) > 0 ? lineTotal(qtyOf(row), row.cost) : 0)));
  const supplierCount = new Set(chosen.map((row) => row.supplier_id ?? "")).size;

  const generate = useMutation({
    mutationFn: async () => {
      const orders = await createReorderPurchaseOrders(await getDb(), {
        companyId,
        userId: session.user.id,
        locationId: locationId || null,
        lines: chosen.map((row) => ({ itemId: row.item_id, qty: qtyOf(row) })),
      });
      for (const order of orders) {
        await emit({
          type: "purchase.order_created",
          companyId,
          actorId: session.user.id,
          entityType: "purchase_order",
          entityId: order.id,
          title: `Pedido de compra ${formatSequence("purchase_orders", order.number)} (rascunho) gerado pela reposição${order.supplier_name ? ` · ${order.supplier_name}` : ""}`,
          module: "purchasing",
          newValue: { total: order.total, items: order.item_count },
        });
      }
      return orders;
    },
    onSuccess: (orders) => {
      setCreated(orders);
      setQuantities({});
      setExcluded(new Set());
      invalidate({ purchases: true });
    },
    onError: (caught) => {
      setError(errorText(caught));
      // Parte dos pedidos pode ter sido gravada: recarrega a sugestão (o que já está em pedido sai dela) antes de tentar de novo.
      invalidate({ purchases: true });
    },
  });

  function toggle(itemId: string) {
    setExcluded((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }
  function toggleGroup(rows: ReorderSuggestion[], checked: boolean) {
    setExcluded((current) => {
      const next = new Set(current);
      for (const row of rows) {
        if (checked) next.delete(row.item_id);
        else next.add(row.item_id);
      }
      return next;
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reposição"
        description="Itens cujo saldo (todos os locais) somado ao que já está em pedido de compra ficou igual ou abaixo do estoque mínimo. A sugestão repõe até o estoque máximo (sem máximo, até o dobro do mínimo)."
      />

      {created.length > 0 && (
        <div role="status" className="space-y-2 rounded-lg border border-status-success/40 bg-status-success/10 px-4 py-3 text-sm">
          <p className="flex items-center gap-2 font-medium">
            <CheckCircle2 size={16} className="text-status-success" aria-hidden="true" />
            {created.length === 1 ? "Pedido de compra gerado em rascunho" : `${created.length} pedidos de compra gerados em rascunho`}. Revise, aprove e envie em Compras.
          </p>
          <ul className="space-y-1 pl-6">
            {created.map((order) => (
              <li key={order.id}>
                <Link to={`/purchasing/pedidos/${order.id}`} className="font-medium text-primary-text hover:underline">{formatSequence("purchase_orders", order.number)}</Link>
                {" · "}{order.supplier_name ?? NO_SUPPLIER}{" · "}{order.item_count} {order.item_count === 1 ? "item" : "itens"}{" · "}{formatCurrency(order.total)}
              </li>
            ))}
          </ul>
        </div>
      )}
      <ErrorBanner message={error} onClose={() => setError(null)} />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard title="Itens para repor" value={suggestions.length} />
        <StatCard title="Fornecedores" value={new Set(suggestions.map((row) => row.supplier_id ?? "")).size} hint="Um pedido de compra por fornecedor" />
        <StatCard title="Custo estimado (selecionados)" value={formatCurrency(chosenCost)} kind="text" hint="Quantidade × custo do item" />
      </div>

      {isLoading ? (
        <TableSkeleton />
      ) : suggestions.length === 0 ? (
        <EmptyState
          icon={PackagePlus}
          title="Nada para repor"
          description={covered.length > 0 ? "Os itens abaixo do mínimo já têm pedido de compra em aberto que cobre a reposição." : "Nenhum item está no ponto de reposição. Defina o estoque mínimo dos itens para receber sugestões."}
        />
      ) : (
        <>
          {groups.map(([supplier, rows]) => {
            const allChecked = rows.every((row) => isSelected(row.item_id));
            return (
              <section key={supplier} className="overflow-x-auto rounded-xl border" aria-label={`Fornecedor ${supplier}`}>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/20 px-4 py-2.5">
                  <label className="flex items-center gap-2 text-sm font-semibold">
                    <input type="checkbox" checked={allChecked} onChange={(event) => toggleGroup(rows, event.target.checked)} className="h-4 w-4 accent-primary" />
                    {supplier}
                  </label>
                  <span className="text-sm text-muted-foreground">
                    {formatCurrency(sumMoney(rows.filter((row) => isSelected(row.item_id) && qtyOf(row) > 0).map((row) => lineTotal(qtyOf(row), row.cost))))}
                  </span>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="whitespace-nowrap text-muted-foreground">
                      <th className="w-10 px-4 py-2" />
                      <th className="min-w-[12rem] px-4 py-2 text-left font-medium">Item</th>
                      <th className="px-4 py-2 text-right font-medium">Saldo</th>
                      <th className="px-4 py-2 text-right font-medium">Em pedido</th>
                      <th className="px-4 py-2 text-right font-medium">Mínimo</th>
                      <th className="px-4 py-2 text-right font-medium">Máximo</th>
                      <th className="w-32 px-4 py-2 text-left font-medium">Comprar</th>
                      <th className="px-4 py-2 text-right font-medium">Custo unit.</th>
                      <th className="px-4 py-2 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {rows.map((row) => {
                      const qty = qtyOf(row);
                      return (
                        <tr key={row.item_id}>
                          <td className="px-4 py-2">
                            <input type="checkbox" checked={isSelected(row.item_id)} onChange={() => toggle(row.item_id)} aria-label={`Comprar ${row.name}`} className="h-4 w-4 accent-primary" />
                          </td>
                          <td className="px-4 py-2">
                            <p className="font-medium">{row.name}</p>
                            {row.sku && <p className="text-xs text-muted-foreground">{row.sku}</p>}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-status-danger dark:text-red-400">{formatQty(row.on_hand, row.unit)}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{row.on_order > 0 ? formatQty(row.on_order, row.unit) : "—"}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{formatQty(row.min_stock)}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{row.max_stock == null ? "—" : formatQty(row.max_stock)}</td>
                          <td className="px-4 py-2">
                            <label className="sr-only" htmlFor={`reorder-qty-${row.item_id}`}>Quantidade a comprar de {row.name}</label>
                            <input
                              id={`reorder-qty-${row.item_id}`}
                              value={quantities[row.item_id] ?? String(row.suggested_qty)}
                              onChange={(event) => setQuantities((current) => ({ ...current, [row.item_id]: event.target.value }))}
                              inputMode="decimal"
                              aria-invalid={!(qty > 0)}
                              className={`${INPUT} text-right tabular-nums ${qty > 0 ? "" : "border-destructive"}`}
                            />
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{formatCurrency(row.cost)}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{qty > 0 ? formatCurrency(lineTotal(qty, row.cost)) : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </section>
            );
          })}

          {canBuy ? (
            <div className="flex flex-wrap items-end justify-end gap-3 rounded-xl border bg-card p-4">
              <div className="w-64">
                <Field label="Entregar em" htmlFor="reorder-location">
                  <select id="reorder-location" value={locationId ?? ""} onChange={(event) => setLocationId(event.target.value)} className={INPUT}>
                    <option value="">Definir no pedido</option>
                    {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
                  </select>
                </Field>
              </div>
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setCreated([]);
                  generate.mutate();
                }}
                disabled={chosen.length === 0 || invalid.length > 0 || generate.isPending}
                title={invalid.length > 0 ? "Corrija as quantidades marcadas em vermelho" : undefined}
                className={BUTTON_PRIMARY}
              >
                <ShoppingCart size={14} />
                {chosen.length === 0
                  ? "Selecione itens para comprar"
                  : `Gerar ${supplierCount} ${supplierCount === 1 ? "pedido" : "pedidos"} de compra (rascunho)`}
              </button>
            </div>
          ) : (
            <p className="rounded-lg border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
              Seu acesso não cria pedidos de compra. Envie esta lista para quem compra (Estoque ou Administração).
            </p>
          )}
        </>
      )}

      {!isLoading && covered.length > 0 && (
        <section className="overflow-x-auto rounded-xl border" aria-labelledby="reorder-covered-title">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/20 px-4 py-2.5">
            <h2 id="reorder-covered-title" className="text-sm font-semibold">Abaixo do mínimo, já cobertos por pedido de compra</h2>
            <Link to="/purchasing" className="text-sm text-primary-text hover:underline">Ver pedidos de compra</Link>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="whitespace-nowrap text-muted-foreground">
                <th className="min-w-[12rem] px-4 py-2 text-left font-medium">Item</th>
                <th className="px-4 py-2 text-right font-medium">Saldo</th>
                <th className="px-4 py-2 text-right font-medium">Mínimo</th>
                <th className="px-4 py-2 text-right font-medium">Em pedido</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {covered.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-2">
                    <p className="font-medium">{item.name}</p>
                    {item.sku && <p className="text-xs text-muted-foreground">{item.sku}</p>}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-status-danger dark:text-red-400">{formatQty(item.total, item.unit)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{formatQty(item.min_stock ?? 0)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatQty(item.on_order, item.unit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
