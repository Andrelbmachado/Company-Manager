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
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { Plus, Wrench } from "lucide-react";
import type { WorkOrder } from "@/types";

const STATUSES = ["aberta", "atribuida", "aguardando_peca", "em_execucao", "concluida", "cancelada"];
const PRIORITIES = ["baixa", "media", "alta", "urgente"];
const EMPTY = { number: "", status: "aberta", priority: "media", labor_cost: "0", materials_cost: "0" };

export default function WorkOrdersPage() {
  const session = useRequiredSession();
  const qc = useQueryClient();
  const canCreate = usePermission("create", "work_orders");
  const canEdit = usePermission("edit", "work_orders");
  const [selected, setSelected] = useState<WorkOrder | null>(null);
  const [form, setForm] = useState<Record<string, string>>(EMPTY);
  const [dialog, setDialog] = useState<"create" | "edit" | null>(null);
  const { data: orders = [], isLoading } = useQuery({ queryKey: ["work-orders", session.company.id], queryFn: async () => (await getDb()).select<WorkOrder[]>("SELECT * FROM work_orders WHERE company_id=? AND deleted_at IS NULL ORDER BY created_at DESC", [session.company.id]) });
  const saveMutation = useMutation({ mutationFn: async () => {
    const db = await getDb();
    if (dialog === "edit" && selected) await db.execute("UPDATE work_orders SET number=?, status=?, priority=?, labor_cost=?, materials_cost=?, updated_at=datetime('now') WHERE id=?", [form.number, form.status, form.priority, Number(form.labor_cost), Number(form.materials_cost), selected.id]);
    else {
      const count = await db.select<[{ n: number }]>("SELECT COUNT(*) as n FROM work_orders WHERE company_id=?", [session.company.id]);
      await db.execute("INSERT INTO work_orders (id, company_id, number, technician_id, status, priority, labor_cost, materials_cost) VALUES (?,?,?,?,?,?,?,?)", [uuidv4(), session.company.id, form.number || `OS-${String(count[0].n + 1).padStart(4, "0")}`, session.user.id, form.status, form.priority, Number(form.labor_cost), Number(form.materials_cost)]);
    }
  }, onSuccess: () => { qc.invalidateQueries({ queryKey: ["work-orders", session.company.id] }); setSelected((item) => dialog === "edit" && item ? { ...item, ...form, status: form.status as WorkOrder["status"], priority: form.priority as WorkOrder["priority"], labor_cost: Number(form.labor_cost), materials_cost: Number(form.materials_cost) } : item); setDialog(null); setForm(EMPTY); } });
  return <div className="space-y-6">
    <PageHeader title="Ordens de Servico" description="Gestao de OS" actions={canCreate ? <button onClick={() => { setForm(EMPTY); setDialog("create"); }} className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"><Plus size={14} /> Nova OS</button> : undefined} />
    {isLoading ? <div className="h-32 animate-pulse rounded-xl bg-muted/30" /> : orders.length === 0 ? <EmptyState icon={Wrench} title="Nenhuma ordem de servico" /> : <div className="overflow-hidden rounded-xl border"><table className="w-full text-sm"><thead className="bg-muted/30"><tr><th className="px-4 py-3 text-left">Numero</th><th className="px-4 py-3 text-left">Status</th><th className="px-4 py-3 text-left">Prioridade</th><th className="px-4 py-3 text-left">Aberta em</th><th className="px-4 py-3 text-left">Custo total</th></tr></thead><tbody className="divide-y">{orders.map((order) => <tr key={order.id} onClick={() => setSelected(order)} className="cursor-pointer hover:bg-muted/20"><td className="px-4 py-3 font-medium">{order.number}</td><td className="px-4 py-3"><StatusBadge status={order.status} /></td><td className="px-4 py-3"><StatusBadge status={order.priority} /></td><td className="px-4 py-3 text-muted-foreground">{formatDateTime(order.opened_at)}</td><td className="px-4 py-3 text-muted-foreground">{formatCurrency(order.labor_cost + order.materials_cost)}</td></tr>)}</tbody></table></div>}
    {selected && <DetailDrawer title={selected.number} subtitle="Ordem de servico" onClose={() => setSelected(null)} onEdit={canEdit ? () => { setForm({ number: selected.number, status: selected.status, priority: selected.priority, labor_cost: String(selected.labor_cost), materials_cost: String(selected.materials_cost) }); setDialog("edit"); } : undefined}><DetailGrid><DetailItem label="Status" value={<StatusBadge status={selected.status} />} /><DetailItem label="Prioridade" value={<StatusBadge status={selected.priority} />} /><DetailItem label="Abertura" value={formatDateTime(selected.opened_at)} /><DetailItem label="Custo de mao de obra" value={formatCurrency(selected.labor_cost)} /><DetailItem label="Custo de materiais" value={formatCurrency(selected.materials_cost)} /><DetailItem label="Custo total" value={formatCurrency(selected.labor_cost + selected.materials_cost)} /></DetailGrid></DetailDrawer>}
    {dialog && <CrudDialog title={dialog === "edit" ? "Editar OS" : "Nova OS"} fields={[{ key: "number", label: "Numero (automatico se vazio)" }, { key: "status", label: "Status", type: "select", options: STATUSES.map((status) => ({ value: status, label: status })) }, { key: "priority", label: "Prioridade", type: "select", options: PRIORITIES.map((priority) => ({ value: priority, label: priority })) }, { key: "labor_cost", label: "Custo de mao de obra", type: "number" }, { key: "materials_cost", label: "Custo de materiais", type: "number" }]} values={form} onChange={(key, value) => setForm((current) => ({ ...current, [key]: value }))} onClose={() => setDialog(null)} onSubmit={() => saveMutation.mutate()} busy={saveMutation.isPending} />}
  </div>;
}
