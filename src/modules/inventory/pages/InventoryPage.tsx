import { useState } from "react";
import { AlertTriangle, Package } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { SearchInput, matchesSearch } from "@/components/shared/SearchInput";
import { Toolbar } from "@/components/shared/Toolbar";
import { NewButton } from "@/components/shared/NewButton";
import { ImportExportActions } from "@/components/shared/ImportExportActions";
import { EntityFormDialog } from "@/components/shared/EntityFormDialog";
import { useEntityList } from "@/hooks/useEntity";
import type { Row } from "@/lib/data/repository";
import { cn, formatCurrency } from "@/lib/utils";

const belowMin = (item: Row) => Number(item.quantity ?? 0) < Number(item.min_stock ?? 0);

const COLUMNS: Column<Row>[] = [
  {
    key: "name",
    header: "Item",
    cell: (item) => (
      <div className="flex items-center gap-2">
        {belowMin(item) && <AlertTriangle size={14} className="shrink-0 text-red-500" aria-label="Abaixo do mínimo" />}
        <span className="font-medium">{String(item.name)}</span>
      </div>
    ),
  },
  { key: "sku", header: "SKU", cell: (i) => <span className="font-mono text-xs text-muted-foreground">{String(i.sku ?? "—")}</span> },
  { key: "category", header: "Categoria", cell: (i) => <span className="text-muted-foreground">{String(i.category ?? "—")}</span> },
  {
    key: "quantity",
    header: "Saldo",
    align: "right",
    cell: (i) => (
      <span className={cn("font-medium tabular-nums", belowMin(i) && "text-red-500")}>
        {Number(i.quantity ?? 0)} {String(i.unit ?? "")}
      </span>
    ),
  },
  { key: "min_stock", header: "Mínimo", align: "right", cell: (i) => <span className="tabular-nums text-muted-foreground">{Number(i.min_stock ?? 0)} {String(i.unit ?? "")}</span> },
  { key: "cost", header: "Custo unit.", align: "right", cell: (i) => <span className="tabular-nums text-muted-foreground">{formatCurrency(Number(i.cost ?? 0))}</span> },
];

export default function InventoryPage() {
  const [search, setSearch] = useState("");
  const [onlyLow, setOnlyLow] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const { data: items = [], isLoading } = useEntityList("inventory_items");

  const filtered = items.filter(
    (i) => (!onlyLow || belowMin(i)) && matchesSearch(search, [i.name, i.sku, i.category])
  );
  const lowCount = items.filter(belowMin).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Estoque"
        description="Itens, saldos e movimentações"
        actions={
          <>
            <ImportExportActions entities={["inventory_items"]} />
            <NewButton entity="inventory_items" label="Novo item" onClick={() => setShowForm(true)} />
          </>
        }
      />
      <Toolbar count={filtered.length}>
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar por nome, SKU, categoria..." />
        <label className="flex h-8 items-center gap-2 rounded-full border px-3 text-xs font-medium">
          <input
            type="checkbox"
            checked={onlyLow}
            onChange={(e) => setOnlyLow(e.target.checked)}
            data-testid="inventory-only-low"
            className="h-3.5 w-3.5"
          />
          Abaixo do mínimo ({lowCount})
        </label>
      </Toolbar>
      <DataTable
        testId="inventory-table"
        columns={COLUMNS}
        rows={filtered}
        getRowId={(r) => String(r.id)}
        isLoading={isLoading}
        empty={<EmptyState icon={Package} title="Nenhum item no estoque" description="Cadastre itens ou importe uma planilha." />}
      />
      <EntityFormDialog entity="inventory_items" open={showForm} onClose={() => setShowForm(false)} />
    </div>
  );
}
