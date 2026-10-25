import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, History, Plus } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { useRequiredSession } from "@/hooks/useSession";
import { usePermission } from "@/hooks/usePermission";
import { listStockMovements, loadStockSnapshot, movementOriginLabel, movementOriginPath, MOVEMENT_TYPE_LABELS, type MovementRow } from "@/lib/inventory/queries";
import { formatQty } from "@/lib/inventory/stock";
import { lineTotal } from "@/lib/money";
import { formatCurrency, formatDateTime, todayIso } from "@/lib/utils";
import { EmptyState } from "@/components/shared/EmptyState";
import { ImportExportButtons } from "@/components/shared/ImportExportButtons";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageToolbar } from "@/components/shared/PageToolbar";
import type { StockMovementType } from "@/types";
import { StockMovementDialog } from "../components/StockMovementDialog";
import { BUTTON_OUTLINE, BUTTON_PRIMARY, inventoryKeys, MovementTypeBadge, normalizeSearch, TableSkeleton, useInvalidateInventory } from "../components/inventoryUi";

const PAGE_SIZE = 200;
const SELECT = "h-8 rounded-md border bg-background px-2 text-sm font-normal outline-none focus:ring-2 focus:ring-ring";

/** Dia local (YYYY-MM-DD) de um timestamp, para filtrar por período. */
function localDay(timestamp: string): string {
  const text = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(timestamp) && !/(?:Z|[+-]\d{2}:?\d{2})$/.test(timestamp) ? `${timestamp.replace(" ", "T")}Z` : timestamp;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? timestamp.slice(0, 10) : todayIso(date);
}

function Locations({ row }: { row: MovementRow }) {
  if (row.from_name && row.to_name) {
    return (
      <span className="inline-flex items-center gap-1">
        {row.from_name} <ArrowRight size={12} aria-label="para" /> {row.to_name}
      </span>
    );
  }
  return <span>{row.to_name ?? row.from_name ?? "—"}</span>;
}

export default function StockMovementsPage() {
  const session = useRequiredSession();
  const companyId = session.company.id;
  const invalidate = useInvalidateInventory(companyId);
  const canCreate = usePermission("create", "inventory");
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(Boolean(params.get("item")));
  const [typeFilter, setTypeFilter] = useState<"all" | StockMovementType>("all");
  const [locationFilter, setLocationFilter] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [showDialog, setShowDialog] = useState(false);
  const itemFilter = params.get("item") ?? "all";

  const { data: movements = [], isLoading } = useQuery({
    queryKey: inventoryKeys.movements(companyId),
    queryFn: async () => listStockMovements(await getDb(), companyId),
  });
  const { data: snapshot } = useQuery({
    queryKey: inventoryKeys.snapshot(companyId),
    queryFn: async () => loadStockSnapshot(await getDb(), companyId),
  });
  const items = snapshot?.items ?? [];
  const locations = snapshot?.locations ?? [];

  const query = normalizeSearch(search);
  const filtered = movements.filter((row) => {
    if (typeFilter !== "all" && row.type !== typeFilter) return false;
    if (itemFilter !== "all" && row.item_id !== itemFilter) return false;
    if (locationFilter !== "all" && row.from_location_id !== locationFilter && row.to_location_id !== locationFilter) return false;
    if (from || to) {
      const day = localDay(row.created_at);
      if (from && day < from) return false;
      if (to && day > to) return false;
    }
    if (!query) return true;
    return [row.item_name, row.sku, row.note, row.user_name, row.from_name, row.to_name].some((value) => normalizeSearch(value ?? "").includes(query));
  });
  const filtersActive = typeFilter !== "all" || itemFilter !== "all" || locationFilter !== "all" || Boolean(from || to);

  function setItemFilter(value: string) {
    const next = new URLSearchParams(params);
    if (value === "all") next.delete("item");
    else next.set("item", value);
    setParams(next, { replace: true });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Movimentações"
        description="Entradas, saídas, transferências e ajustes de inventário, com a origem de cada lançamento."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {/* Planilha de itens e saldos: a importação de quantidades vira ajustes nesta lista (motor de estoque). */}
            <ImportExportButtons entity="inventory" onImported={() => invalidate()} />
            {canCreate && locations.length > 0 && (
              <button type="button" onClick={() => setShowDialog(true)} className={BUTTON_PRIMARY}>
                <Plus size={14} /> Nova movimentação
              </button>
            )}
          </div>
        }
      />

      <PageToolbar search={search} onSearchChange={setSearch} searchPlaceholder="Buscar por item, observação ou pessoa..." onFilterClick={() => setShowFilters((value) => !value)} filterActive={filtersActive}>
        <span className="text-sm text-muted-foreground">{filtered.length} {filtered.length === 1 ? "movimentação" : "movimentações"}</span>
      </PageToolbar>

      {showFilters && (
        <div className="flex flex-wrap items-center gap-4 rounded-lg border bg-muted/20 px-4 py-3">
          <label className="flex items-center gap-2 text-sm font-medium">
            Tipo
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as typeof typeFilter)} className={SELECT}>
              <option value="all">Todos</option>
              {(Object.keys(MOVEMENT_TYPE_LABELS) as StockMovementType[]).map((type) => <option key={type} value={type}>{MOVEMENT_TYPE_LABELS[type]}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm font-medium">
            Item
            <select value={itemFilter} onChange={(event) => setItemFilter(event.target.value)} className={`${SELECT} max-w-56`}>
              <option value="all">Todos</option>
              {items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm font-medium">
            Local
            <select value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)} className={SELECT}>
              <option value="all">Todos</option>
              {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm font-medium">
            De
            <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className={SELECT} />
          </label>
          <label className="flex items-center gap-2 text-sm font-medium">
            Até
            <input type="date" value={to} onChange={(event) => setTo(event.target.value)} className={SELECT} />
          </label>
          {filtersActive && (
            <button
              type="button"
              onClick={() => {
                setTypeFilter("all");
                setItemFilter("all");
                setLocationFilter("all");
                setFrom("");
                setTo("");
              }}
              className={BUTTON_OUTLINE}
            >
              Limpar filtros
            </button>
          )}
        </div>
      )}

      {isLoading ? (
        <TableSkeleton />
      ) : filtered.length === 0 ? (
        <EmptyState icon={History} title={movements.length === 0 ? "Nenhuma movimentação ainda" : "Nenhuma movimentação encontrada"} description={movements.length === 0 ? "Entradas de compra, saídas de venda, transferências e ajustes de inventário aparecem aqui." : undefined} />
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="whitespace-nowrap bg-muted/30">
              <tr>
                <th className="whitespace-nowrap px-4 py-3 text-left font-medium text-muted-foreground">Data</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Tipo</th>
                <th className="min-w-[12rem] px-4 py-3 text-left font-medium text-muted-foreground">Item</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Quantidade</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Local</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Origem</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Valor</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Responsável</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.slice(0, visible).map((row) => {
                const path = movementOriginPath(row.ref_type, row.ref_id);
                const leaves = Boolean(row.from_location_id && !row.to_location_id);
                return (
                  <tr key={row.id} className="align-top">
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDateTime(row.created_at)}</td>
                    <td className="px-4 py-3"><MovementTypeBadge type={row.type} /></td>
                    <td className="px-4 py-3">
                      <p className="font-medium">{row.item_name}</p>
                      {row.sku && <p className="text-xs text-muted-foreground">{row.sku}</p>}
                      {row.note && <p className="mt-1 max-w-xs text-xs text-muted-foreground">{row.note}</p>}
                    </td>
                    <td className={`whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums ${leaves ? "text-status-danger dark:text-red-400" : ""}`}>
                      {row.type === "transferencia" ? "" : leaves ? "−" : "+"}
                      {formatQty(row.quantity, row.item_unit)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground"><Locations row={row} /></td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {path ? <Link to={path} className="text-primary-text hover:underline">{movementOriginLabel(row.ref_type)}</Link> : movementOriginLabel(row.ref_type)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-muted-foreground">{row.unit_cost == null ? "—" : formatCurrency(lineTotal(row.quantity, Number(row.unit_cost)))}</td>
                    <td className="px-4 py-3 text-muted-foreground">{row.user_name ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length > visible && (
            <div className="border-t p-3 text-center">
              <button type="button" onClick={() => setVisible((value) => value + PAGE_SIZE)} className={BUTTON_OUTLINE}>
                Mostrar mais ({filtered.length - visible} restantes)
              </button>
            </div>
          )}
        </div>
      )}

      {showDialog && (
        <StockMovementDialog
          companyId={companyId}
          userId={session.user.id}
          items={items}
          locations={locations}
          initial={{ itemId: itemFilter !== "all" ? itemFilter : undefined, locationId: locationFilter !== "all" ? locationFilter : undefined }}
          onClose={() => setShowDialog(false)}
          onSaved={() => {
            invalidate();
            setShowDialog(false);
          }}
        />
      )}
    </div>
  );
}
