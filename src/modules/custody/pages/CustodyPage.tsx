import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "@/lib/db/client";
import { usePermission } from "@/hooks/usePermission";
import { useRequiredSession } from "@/hooks/useSession";
import { CrudDialog } from "@/components/shared/CrudDialog";
import { DetailDrawer, DetailGrid, DetailItem } from "@/components/shared/DetailDrawer";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageToolbar } from "@/components/shared/PageToolbar";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { formatDateTime } from "@/lib/utils";
import { Archive, Pencil, Plus, Trash2 } from "lucide-react";
import type { Custody, InventoryItem } from "@/types";

interface CustodyView extends Custody {
  item_name?: string;
  holder_name?: string;
}

const STATUSES = ["em_custodia", "devolvido", "consumido", "perdido"];
const EMPTY = { item_id: "", quantity: "1", status: "em_custodia", due_back_at: "" };

export default function CustodyPage() {
  const session = useRequiredSession();
  const qc = useQueryClient();
  const canCreate = usePermission("create", "custody");
  const canEdit = usePermission("edit", "custody");
  const canDelete = usePermission("delete", "custody");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showFilters, setShowFilters] = useState(false);
  const [listEditing, setListEditing] = useState(false);
  const [selected, setSelected] = useState<CustodyView | null>(null);
  const [form, setForm] = useState<Record<string, string>>(EMPTY);
  const [dialog, setDialog] = useState<"create" | "edit" | null>(null);
  const { data: custodies = [], isLoading } = useQuery({
    queryKey: ["custodies", session.company.id],
    queryFn: async () => (await getDb()).select<CustodyView[]>(
      `SELECT c.*, i.name as item_name, u.name as holder_name
       FROM custodies c
       LEFT JOIN inventory_items i ON i.id = c.item_id
       LEFT JOIN users u ON u.id = c.holder_id
       WHERE c.company_id=? AND c.deleted_at IS NULL
       ORDER BY c.checked_out_at DESC`,
      [session.company.id]
    ),
  });
  const { data: items = [] } = useQuery({
    queryKey: ["inventory-options", session.company.id],
    queryFn: async () => (await getDb()).select<InventoryItem[]>(
      "SELECT * FROM inventory_items WHERE company_id=? AND deleted_at IS NULL ORDER BY name",
      [session.company.id]
    ),
  });
  const saveMutation = useMutation({
    mutationFn: async () => {
      const db = await getDb();
      if (dialog === "edit" && selected) {
        await db.execute(
          "UPDATE custodies SET item_id=?, quantity=?, status=?, due_back_at=?, updated_at=datetime('now') WHERE id=?",
          [form.item_id || null, Number(form.quantity), form.status, form.due_back_at || null, selected.id]
        );
      } else {
        await db.execute(
          "INSERT INTO custodies (id, company_id, item_id, holder_id, quantity, status, due_back_at) VALUES (?,?,?,?,?,?,?)",
          [uuidv4(), session.company.id, form.item_id || null, session.user.id, Number(form.quantity), form.status, form.due_back_at || null]
        );
      }
    },
    onSuccess: () => {
      invalidateCustodyQueries();
      setSelected(null);
      setDialog(null);
      setForm(EMPTY);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await (await getDb()).execute(
        "UPDATE custodies SET deleted_at=datetime('now'), updated_at=datetime('now') WHERE id=?",
        [id]
      );
    },
    onSuccess: () => {
      invalidateCustodyQueries();
      setSelected(null);
    },
  });
  const fields = [
    { key: "item_id", label: "Item", type: "select" as const, options: [{ value: "", label: "Selecione" }, ...items.map((item) => ({ value: item.id, label: item.name }))] },
    { key: "quantity", label: "Quantidade", type: "number" as const },
    { key: "status", label: "Status", type: "select" as const, options: STATUSES.map((status) => ({ value: status, label: status })) },
    { key: "due_back_at", label: "Devolução prevista", type: "date" as const },
  ];
  const filteredCustodies = custodies.filter((custody) => {
    const query = normalizeSearch(search);
    const matchesSearch = [custody.item_name, custody.holder_name, custody.status]
      .some((value) => normalizeSearch(value ?? "").includes(query));
    return matchesSearch && (statusFilter === "all" || custody.status === statusFilter);
  });

  function invalidateCustodyQueries() {
    qc.invalidateQueries({ queryKey: ["custodies", session.company.id] });
    qc.invalidateQueries({ queryKey: ["inventory-custodies", session.company.id] });
    qc.invalidateQueries({ queryKey: ["dashboard-kpis"] });
  }

  function removeCustody(custody: CustodyView) {
    if (window.confirm(`Remover o registro de custódia de "${custody.item_name ?? "peça sem nome"}"?`)) {
      deleteMutation.mutate(custody.id);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Custódia de peça" description="Peças e ativos em posse de técnicos" />

      <PageToolbar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Buscar em custódia de peça..."
        onFilterClick={() => setShowFilters((visible) => !visible)}
        filterActive={statusFilter !== "all"}
      >
        {canEdit && (
          <button
            onClick={() => setListEditing((active) => !active)}
            className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
          >
            <Pencil size={14} />
            {listEditing ? "Concluir" : "Editar"}
          </button>
        )}
        {canCreate && (
          <button
            onClick={() => {
              setForm(EMPTY);
              setDialog("create");
            }}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Plus size={14} />
            Adicionar
          </button>
        )}
      </PageToolbar>

      {showFilters && (
        <div className="flex items-center gap-3 rounded-lg border bg-muted/20 px-4 py-3">
          <label className="text-sm font-medium" htmlFor="custody-status-filter">Status</label>
          <select
            id="custody-status-filter"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="h-8 rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="all">Todos</option>
            {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        </div>
      )}

      {isLoading ? (
        <div className="h-28 animate-pulse rounded-xl bg-muted/30" />
      ) : filteredCustodies.length === 0 ? (
        <EmptyState icon={Archive} title={custodies.length === 0 ? "Nenhuma custódia de peça" : "Nenhuma custódia de peça encontrada"} />
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className="px-4 py-3 text-left">Item</th>
                <th className="px-4 py-3 text-left">Responsável</th>
                <th className="px-4 py-3 text-left">Qtd.</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Retirada</th>
                {listEditing && canDelete && <th className="w-16 px-4 py-3 text-right">Ação</th>}
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredCustodies.map((custody) => (
                <tr key={custody.id} onClick={() => setSelected(custody)} className="cursor-pointer hover:bg-muted/20">
                  <td className="px-4 py-3 font-medium">{custody.item_name ?? "—"}</td>
                  <td className="px-4 py-3">{custody.holder_name ?? "—"}</td>
                  <td className="px-4 py-3">{custody.quantity}</td>
                  <td className="px-4 py-3"><StatusBadge status={custody.status} /></td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDateTime(custody.checked_out_at)}</td>
                  {listEditing && canDelete && (
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          removeCustody(custody);
                        }}
                        aria-label={`Remover custódia de ${custody.item_name ?? "peça"}`}
                        title={`Remover custódia de ${custody.item_name ?? "peça"}`}
                        className="rounded-md p-1.5 text-destructive transition-colors hover:bg-destructive/10"
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <DetailDrawer
          title={selected.item_name ?? "Custódia de peça"}
          subtitle="Registro de custódia de peça"
          onClose={() => setSelected(null)}
          onEdit={canEdit ? () => {
            setForm({ item_id: selected.item_id ?? "", quantity: String(selected.quantity), status: selected.status, due_back_at: selected.due_back_at?.slice(0, 10) ?? "" });
            setDialog("edit");
          } : undefined}
        >
          <DetailGrid>
            <DetailItem label="Responsável" value={selected.holder_name} />
            <DetailItem label="Quantidade" value={selected.quantity} />
            <DetailItem label="Status" value={<StatusBadge status={selected.status} />} />
            <DetailItem label="Retirada" value={formatDateTime(selected.checked_out_at)} />
            <DetailItem label="Devolução prevista" value={formatDateTime(selected.due_back_at)} />
          </DetailGrid>
        </DetailDrawer>
      )}
      {dialog && (
        <CrudDialog
          title={dialog === "edit" ? "Editar custódia de peça" : "Nova custódia de peça"}
          fields={fields}
          values={form}
          onChange={(key, value) => setForm((current) => ({ ...current, [key]: value }))}
          onClose={() => setDialog(null)}
          onSubmit={() => saveMutation.mutate()}
          busy={saveMutation.isPending}
        />
      )}
    </div>
  );
}

function normalizeSearch(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}
