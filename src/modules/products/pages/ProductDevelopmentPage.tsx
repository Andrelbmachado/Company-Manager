import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { CalendarView } from "@/components/shared/CalendarView";
import { EditableTable, type EditableColumn, type EditableTableChanges } from "@/components/shared/EditableTable";
import { KpiCard } from "@/components/shared/KpiCard";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageToolbar } from "@/components/shared/PageToolbar";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { usePermission } from "@/hooks/usePermission";
import { useRequiredSession } from "@/hooks/useSession";
import { confirmAction } from "@/lib/confirm";
import { getDb } from "@/lib/db/client";
import { emit } from "@/lib/events/bus";
import { useLabel } from "@/lib/labels/useLabel";
import {
  deleteInitiative,
  INITIATIVE_STATUS_OPTIONS,
  INITIATIVE_TYPE_OPTIONS,
  isActiveInitiative,
  loadInitiatives,
  milestoneItems,
  saveInitiativeChanges,
  type InitiativeType,
  type ProductInitiative,
} from "@/lib/products/initiatives";
import { cn } from "@/lib/utils";
import { ViewSwitch, type ListOrCalendar } from "@/modules/hr/components/ViewSwitch";
import type { Role } from "@/types";

const statusLabel = (value: string) => INITIATIVE_STATUS_OPTIONS.find((option) => option.value === value)?.label ?? value;

/** Desenvolvimento de Produtos: roadmap de produtos físicos e digitais, editável na tabela, com os marcos no calendário. */
export default function ProductDevelopmentPage() {
  const session = useRequiredSession();
  const companyId = session.company.id;
  const role = session.membership.role as Role;
  const qc = useQueryClient();
  const title = useLabel("module.products");
  const canDelete = usePermission("delete", "product_development");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | InitiativeType>("all");
  const [showFilters, setShowFilters] = useState(false);
  const [view, setView] = useState<ListOrCalendar>("lista");
  const [error, setError] = useState("");

  const queryKey = ["product-development", companyId];
  const query = useQuery({ queryKey, queryFn: async () => loadInitiatives(await getDb(), companyId) });
  const initiatives = useMemo(() => query.data ?? [], [query.data]);

  const filtered = useMemo(() => {
    const needle = normalizeSearch(search);
    return initiatives.filter((item) => {
      const matches = !needle || [item.name, item.owner ?? "", statusLabel(item.status), item.next_milestone ?? ""].some((value) => normalizeSearch(value).includes(needle));
      return matches && (typeFilter === "all" || item.type === typeFilter);
    });
  }, [initiatives, search, typeFilter]);

  async function save(changes: EditableTableChanges<ProductInitiative>) {
    const db = await getDb();
    const result = await saveInitiativeChanges(db, companyId, role, changes);
    for (const id of result.created) {
      await emit({ type: "product_initiative.created", companyId, actorId: session.user.id, entityType: "product_initiative", entityId: id, title: "Iniciativa de produto criada", module: "products" });
    }
    for (const fields of changes.updated) {
      await emit({ type: "product_initiative.updated", companyId, actorId: session.user.id, entityType: "product_initiative", entityId: fields.id, title: "Iniciativa de produto atualizada", module: "products", newValue: fields });
    }
  }

  async function remove(item: ProductInitiative) {
    if (!(await confirmAction(`Excluir a iniciativa "${item.name}"?`, { title: "Excluir iniciativa", okLabel: "Excluir" }))) return;
    try {
      await deleteInitiative(await getDb(), companyId, role, item.id);
      await emit({ type: "product_initiative.deleted", companyId, actorId: session.user.id, entityType: "product_initiative", entityId: item.id, title: `Iniciativa excluída: ${item.name}`, module: "products" });
      setError("");
      await qc.invalidateQueries({ queryKey });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  const columns: EditableColumn<ProductInitiative>[] = [
    { key: "name", header: "Produto", kind: "text", required: true, render: (item) => <span className="font-medium">{item.name}</span> },
    { key: "type", header: "Tipo", kind: "select", options: INITIATIVE_TYPE_OPTIONS, required: true },
    { key: "status", header: "Status", kind: "select", options: INITIATIVE_STATUS_OPTIONS, required: true, render: (item) => <StatusBadge status={statusLabel(item.status)} tone={item.status === "lancado" ? "success" : item.status === "pausado" ? "neutral" : "info"} /> },
    { key: "owner", header: "Responsável", kind: "text" },
    { key: "next_milestone", header: "Próximo marco", kind: "text" },
    { key: "milestone_date", header: "Data do marco", kind: "date" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={title} description="Roadmap de produtos físicos e digitais" />

      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard title="Iniciativas ativas" value={initiatives.filter(isActiveInitiative).length} />
        <KpiCard title="Produtos físicos" value={initiatives.filter((item) => item.type === "fisico").length} />
        <KpiCard title="Produtos digitais" value={initiatives.filter((item) => item.type === "digital").length} />
      </div>

      <PageToolbar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Buscar produtos..."
        onFilterClick={() => setShowFilters((visible) => !visible)}
        filterActive={typeFilter !== "all"}
      >
        <ViewSwitch value={view} onChange={setView} label="Ver iniciativas em" />
      </PageToolbar>

      {showFilters && (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/20 px-4 py-3">
          <span className="mr-1 text-sm font-medium">Tipo</span>
          {([["all", "Todos"], ["fisico", "Físicos"], ["digital", "Digitais"]] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={typeFilter === value}
              onClick={() => setTypeFilter(value)}
              className={cn("rounded-full border px-3 py-1 text-xs font-medium transition-colors hover:bg-muted", typeFilter === value && "border-primary bg-primary text-primary-foreground hover:bg-primary/90")}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}

      {view === "lista" ? (
        <EditableTable<ProductInitiative>
          resource="product_development"
          label="Iniciativas de produto"
          title="Iniciativas"
          rows={filtered}
          columns={columns}
          loading={query.isLoading}
          newRow={() => ({ type: "digital", status: "planejado" })}
          onSave={save}
          onRefresh={() => query.refetch()}
          rowActions={canDelete ? (item) => (
            <button type="button" onClick={() => void remove(item)} aria-label={`Excluir ${item.name}`} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive">
              <Trash2 size={14} />
            </button>
          ) : undefined}
          emptyMessage={initiatives.length === 0 ? "Nenhuma iniciativa cadastrada. Use Adicionar." : "Nenhum produto encontrado."}
        />
      ) : (
        <CalendarView items={milestoneItems(filtered)} label="Marcos das iniciativas" />
      )}
    </div>
  );
}

function normalizeSearch(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}
