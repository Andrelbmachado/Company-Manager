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
import { StatusBadge } from "@/components/shared/StatusBadge";
import { formatDateTime } from "@/lib/utils";
import { Archive, Plus } from "lucide-react";
import type { Custody, InventoryItem } from "@/types";

interface CustodyView extends Custody { item_name?: string; holder_name?: string; }
const STATUSES = ["em_custodia", "devolvido", "consumido", "perdido"];
const EMPTY = { item_id: "", quantity: "1", status: "em_custodia", due_back_at: "" };

export default function CustodyPage() {
  const session = useRequiredSession();
  const qc = useQueryClient();
  const canCreate = usePermission("create", "custody");
  const canEdit = usePermission("edit", "custody");
  const [selected, setSelected] = useState<CustodyView | null>(null);
  const [form, setForm] = useState<Record<string, string>>(EMPTY);
  const [dialog, setDialog] = useState<"create" | "edit" | null>(null);
  const { data: custodies = [], isLoading } = useQuery({ queryKey: ["custodies", session.company.id], queryFn: async () => (await getDb()).select<CustodyView[]>(`SELECT c.*, i.name as item_name, u.name as holder_name FROM custodies c LEFT JOIN inventory_items i ON i.id = c.item_id LEFT JOIN users u ON u.id = c.holder_id WHERE c.company_id=? AND c.deleted_at IS NULL ORDER BY c.checked_out_at DESC`, [session.company.id]) });
  const { data: items = [] } = useQuery({ queryKey: ["inventory-options", session.company.id], queryFn: async () => (await getDb()).select<InventoryItem[]>("SELECT * FROM inventory_items WHERE company_id=? AND deleted_at IS NULL ORDER BY name", [session.company.id]) });
  const saveMutation = useMutation({ mutationFn: async () => {
    const db = await getDb();
    if (dialog === "edit" && selected) await db.execute("UPDATE custodies SET item_id=?, quantity=?, status=?, due_back_at=?, updated_at=datetime('now') WHERE id=?", [form.item_id || null, Number(form.quantity), form.status, form.due_back_at || null, selected.id]);
    else await db.execute("INSERT INTO custodies (id, company_id, item_id, holder_id, quantity, status, due_back_at) VALUES (?,?,?,?,?,?,?)", [uuidv4(), session.company.id, form.item_id || null, session.user.id, Number(form.quantity), form.status, form.due_back_at || null]);
  }, onSuccess: () => { qc.invalidateQueries({ queryKey: ["custodies", session.company.id] }); qc.invalidateQueries({ queryKey: ["inventory-custodies", session.company.id] }); setSelected(null); setDialog(null); setForm(EMPTY); } });
  const fields = [{ key: "item_id", label: "Item", type: "select" as const, options: [{ value: "", label: "Selecione" }, ...items.map((item) => ({ value: item.id, label: item.name }))] }, { key: "quantity", label: "Quantidade", type: "number" as const }, { key: "status", label: "Status", type: "select" as const, options: STATUSES.map((status) => ({ value: status, label: status })) }, { key: "due_back_at", label: "Devolucao prevista", type: "date" as const }];
  return <div className="space-y-6">
    <PageHeader title="Custodia" description="Pecas e ativos em posse de tecnicos" actions={canCreate ? <button onClick={() => { setForm(EMPTY); setDialog("create"); }} className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"><Plus size={14} /> Nova custodia</button> : undefined} />
    {isLoading ? <div className="h-28 animate-pulse rounded-xl bg-muted/30" /> : custodies.length === 0 ? <EmptyState icon={Archive} title="Nenhuma custodia" /> : <div className="overflow-hidden rounded-xl border"><table className="w-full text-sm"><thead className="bg-muted/30"><tr><th className="px-4 py-3 text-left">Item</th><th className="px-4 py-3 text-left">Responsavel</th><th className="px-4 py-3 text-left">Qtd.</th><th className="px-4 py-3 text-left">Status</th><th className="px-4 py-3 text-left">Retirada</th></tr></thead><tbody className="divide-y">{custodies.map((item) => <tr key={item.id} onClick={() => setSelected(item)} className="cursor-pointer hover:bg-muted/20"><td className="px-4 py-3 font-medium">{item.item_name ?? "—"}</td><td className="px-4 py-3">{item.holder_name ?? "—"}</td><td className="px-4 py-3">{item.quantity}</td><td className="px-4 py-3"><StatusBadge status={item.status} /></td><td className="px-4 py-3 text-muted-foreground">{formatDateTime(item.checked_out_at)}</td></tr>)}</tbody></table></div>}
    {selected && <DetailDrawer title={selected.item_name ?? "Custodia"} subtitle="Registro de custodia" onClose={() => setSelected(null)} onEdit={canEdit ? () => { setForm({ item_id: selected.item_id ?? "", quantity: String(selected.quantity), status: selected.status, due_back_at: selected.due_back_at?.slice(0, 10) ?? "" }); setDialog("edit"); } : undefined}><DetailGrid><DetailItem label="Responsavel" value={selected.holder_name} /><DetailItem label="Quantidade" value={selected.quantity} /><DetailItem label="Status" value={<StatusBadge status={selected.status} />} /><DetailItem label="Retirada" value={formatDateTime(selected.checked_out_at)} /><DetailItem label="Devolucao prevista" value={formatDateTime(selected.due_back_at)} /></DetailGrid></DetailDrawer>}
    {dialog && <CrudDialog title={dialog === "edit" ? "Editar custodia" : "Nova custodia"} fields={fields} values={form} onChange={(key, value) => setForm((current) => ({ ...current, [key]: value }))} onClose={() => setDialog(null)} onSubmit={() => saveMutation.mutate()} busy={saveMutation.isPending} />}
  </div>;
}
