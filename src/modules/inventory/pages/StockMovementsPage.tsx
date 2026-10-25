// Movimentações na tabela editável. Adicionar lança entrada, saída ou ajuste pelo motor de estoque (o saldo é conferido
// antes de gravar); Editar muda só a observação (lançamento gravado não muda: corrige-se com um ajuste ou o movimento
// contrário). Transferência entre locais é lançada em Estoque › Transferências.
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import { EditableTable, type EditableColumn, type EditableTableChanges } from "@/components/shared/EditableTable";
import { ImportExportButtons } from "@/components/shared/ImportExportButtons";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageToolbar } from "@/components/shared/PageToolbar";
import { useRequiredSession } from "@/hooks/useSession";
import { getDb } from "@/lib/db/client";
import { leavesLocation, MANUAL_MOVEMENT_KINDS, saveMovementRows, toMovementTableRows, type ManualMovementKind, type MovementInput, type MovementTableRow } from "@/lib/inventory/movementRows";
import { listStockMovements, loadStockSnapshot, movementOriginLabel, movementOriginPath, MOVEMENT_TYPE_LABELS } from "@/lib/inventory/queries";
import { formatQty } from "@/lib/inventory/stock";
import { lineTotal } from "@/lib/money";
import { formatCurrency, formatDateTime, todayIso } from "@/lib/utils";
import type { StockMovementType } from "@/types";
import { BUTTON_OUTLINE, emitSafely, inventoryKeys, MovementTypeBadge, normalizeSearch, useActor, useInvalidateInventory } from "../components/inventoryUi";

const PAGE_SIZE = 200;
const SELECT = "h-8 rounded-md border bg-background px-2 text-sm font-normal outline-none focus:ring-2 focus:ring-ring";
const KIND_OPTIONS = [...MANUAL_MOVEMENT_KINDS.map((option) => ({ value: option.value as string, label: option.label })), { value: "transferencia", label: "Transferência" }];

/** Dia local (YYYY-MM-DD) de um timestamp, para filtrar por período. */
function localDay(timestamp: string): string {
  const text = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(timestamp) && !/(?:Z|[+-]\d{2}:?\d{2})$/.test(timestamp) ? `${timestamp.replace(" ", "T")}Z` : timestamp;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? timestamp.slice(0, 10) : todayIso(date);
}

function Locations({ row }: { row: MovementTableRow }) {
  if (row.from_name && row.to_name) {
    return (
      <span className="inline-flex items-center gap-1">
        {row.from_name} <ArrowRight size={12} aria-label="para" /> {row.to_name}
      </span>
    );
  }
  return <span>{row.to_name ?? row.from_name ?? "—"}</span>;
}

const isManualKind = (value: string | null): value is ManualMovementKind => MANUAL_MOVEMENT_KINDS.some((option) => option.value === value);

export default function StockMovementsPage() {
  const session = useRequiredSession();
  const companyId = session.company.id;
  const actor = useActor();
  const invalidate = useInvalidateInventory(companyId);
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(Boolean(params.get("item")));
  const [typeFilter, setTypeFilter] = useState<"all" | StockMovementType>("all");
  const [locationFilter, setLocationFilter] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [visible, setVisible] = useState(PAGE_SIZE);
  const itemFilter = params.get("item") ?? "all";
  const presetKind = params.get("tipo");

  const movementsQuery = useQuery({
    queryKey: inventoryKeys.movements(companyId),
    queryFn: async () => listStockMovements(await getDb(), companyId),
  });
  const { data: snapshot } = useQuery({
    queryKey: inventoryKeys.snapshot(companyId),
    queryFn: async () => loadStockSnapshot(await getDb(), companyId),
  });
  const items = snapshot?.items ?? [];
  const locations = snapshot?.locations ?? [];
  const movements = toMovementTableRows(movementsQuery.data ?? []);

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
  const presetItem = items.find((item) => item.id === itemFilter);

  function setItemFilter(value: string) {
    const next = new URLSearchParams(params);
    if (value === "all") next.delete("item");
    else next.set("item", value);
    next.delete("tipo");
    setParams(next, { replace: true });
  }

  const columns: EditableColumn<MovementTableRow>[] = [
    { key: "created_at", header: "Data", kind: "text", readOnly: true, render: (row) => <span className="whitespace-nowrap text-muted-foreground">{formatDateTime(row.created_at)}</span> },
    { key: "kind", header: "Tipo", kind: "select", required: true, options: KIND_OPTIONS, render: (row) => <MovementTypeBadge type={row.type} /> },
    {
      key: "item_id",
      header: "Item",
      kind: "select",
      required: true,
      options: items.map((item) => ({ value: item.id, label: item.sku ? `${item.name} (${item.sku})` : item.name })),
      render: (row) => (
        <span>
          <span className="block font-medium">{row.item_name}</span>
          {row.sku && <span className="block text-xs text-muted-foreground">{row.sku}</span>}
        </span>
      ),
    },
    {
      key: "quantity",
      header: "Quantidade",
      kind: "number",
      required: true,
      render: (row) => {
        const leaves = leavesLocation(row.kind);
        return (
          <span className={`whitespace-nowrap font-medium ${leaves ? "text-status-danger dark:text-red-400" : ""}`}>
            {row.type === "transferencia" ? "" : leaves ? "−" : "+"}
            {formatQty(row.quantity, row.item_unit)}
          </span>
        );
      },
    },
    { key: "location_id", header: "Local", kind: "select", required: true, options: locations.map((location) => ({ value: location.id, label: location.name })), render: (row) => <Locations row={row} /> },
    {
      key: "unit_cost",
      header: "Custo unit. (entrada)",
      kind: "money",
      placeholder: "custo do item",
      render: (row) => (row.unit_cost == null ? "—" : <span title={`Total: ${formatCurrency(lineTotal(row.quantity, row.unit_cost))}`}>{formatCurrency(row.unit_cost)}</span>),
    },
    { key: "note", header: "Observação", kind: "text", placeholder: "Motivo ou origem" },
    {
      key: "ref_type",
      header: "Origem",
      kind: "text",
      readOnly: true,
      render: (row) => {
        const path = movementOriginPath(row.ref_type, row.ref_id);
        return path ? <Link to={path} className="text-primary-text hover:underline">{movementOriginLabel(row.ref_type)}</Link> : <span className="text-muted-foreground">{movementOriginLabel(row.ref_type)}</span>;
      },
    },
    { key: "user_name", header: "Responsável", kind: "text", readOnly: true },
  ];

  async function save(changes: EditableTableChanges<MovementTableRow>) {
    const pick = (row: Partial<MovementTableRow>) => {
      const picked: Record<string, unknown> = {};
      for (const key of ["kind", "item_id", "location_id", "quantity", "unit_cost", "note"] as const) if (key in row) picked[key] = row[key] ?? null;
      return picked as Partial<MovementInput>;
    };
    const result = await saveMovementRows(await getDb(), companyId, actor, {
      updated: changes.updated.map((row) => ({ ...pick(row), id: row.id })),
      created: changes.created.map((row) => ({ ...pick(row), id: row.id })),
    });
    invalidate();
    const itemsById = new Map(items.map((item) => [item.id, item]));
    const locationsById = new Map(locations.map((location) => [location.id, location]));
    await emitSafely(
      result.created.map((id) => {
        const row = changes.created.find((candidate) => candidate.id === id);
        const item = itemsById.get(String(row?.item_id ?? ""));
        const kindLabel = KIND_OPTIONS.find((option) => option.value === row?.kind)?.label ?? "Movimentação";
        return {
          type: "stock.movement_created",
          companyId,
          actorId: actor.userId,
          entityType: "stock_movement",
          entityId: id,
          title: `${kindLabel}: ${formatQty(Number(row?.quantity ?? 0), item?.unit)} de ${item?.name ?? "item"} (${locationsById.get(String(row?.location_id ?? ""))?.name ?? "local"})`,
          module: "inventory",
          newValue: row,
        };
      }),
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Movimentações"
        description="Entradas, saídas, transferências e ajustes de inventário, com a origem de cada lançamento."
        actions={<ImportExportButtons entity="inventory" onImported={() => invalidate()} />}
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

      {presetItem && isManualKind(presetKind) && (
        <p className="text-sm text-muted-foreground">
          Use Adicionar para lançar {presetKind === "saida" ? "a saída" : "a entrada"} de <strong className="text-foreground">{presetItem.name}</strong>: a linha nova já vem com o item e o tipo.
        </p>
      )}
      {locations.length === 0 && !movementsQuery.isLoading && <p className="text-sm text-muted-foreground">Cadastre um local de estoque antes de movimentar (Estoque › Locais).</p>}

      <EditableTable
        resource="inventory"
        label="Movimentações de estoque"
        title="Lançamentos"
        rows={filtered.slice(0, visible)}
        columns={columns}
        loading={movementsQuery.isLoading}
        onSave={save}
        onRefresh={() => movementsQuery.refetch()}
        newRow={() => ({
          id: uuidv4(),
          kind: isManualKind(presetKind) ? presetKind : "entrada",
          item_id: itemFilter !== "all" ? itemFilter : "",
          location_id: locationFilter !== "all" ? locationFilter : locations[0]?.id ?? "",
        })}
        emptyMessage={movements.length === 0 ? "Nenhuma movimentação ainda. Entradas de compra, saídas de venda, transferências e ajustes de inventário aparecem aqui." : "Nenhuma movimentação encontrada."}
      />
      {filtered.length > visible && (
        <div className="text-center">
          <button type="button" onClick={() => setVisible((value) => value + PAGE_SIZE)} className={BUTTON_OUTLINE}>
            Mostrar mais ({filtered.length - visible} restantes)
          </button>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Lançamento gravado não muda (o saldo já foi acertado): em Editar só a observação é gravada. Para corrigir, lance um ajuste ou o movimento contrário.</p>
    </div>
  );
}
