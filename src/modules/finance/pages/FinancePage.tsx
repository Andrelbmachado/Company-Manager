import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "@/lib/db/client";
import { usePermission } from "@/hooks/usePermission";
import { useRequiredSession } from "@/hooks/useSession";
import { CrudDialog } from "@/components/shared/CrudDialog";
import { DetailDrawer, DetailGrid, DetailItem } from "@/components/shared/DetailDrawer";
import { EmptyState } from "@/components/shared/EmptyState";
import { KpiCard } from "@/components/shared/KpiCard";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Plus, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import type { Payable, Receivable } from "@/types";

type Tab = "payables" | "receivables";
type FinanceRecord = { id: string; description: string; amount: number; due_date?: string | null; status: string; raw: Payable | Receivable };
const STATUSES = ["aberta", "aprovada", "paga", "recebida", "vencida", "cancelada"];
const EMPTY = { description: "", amount: "0", due_date: "", status: "aberta" };

export default function FinancePage() {
  const session = useRequiredSession();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("receivables");
  const canCreatePay = usePermission("create", "payables");
  const canCreateRec = usePermission("create", "receivables");
  const canEditPay = usePermission("edit", "payables");
  const canEditRec = usePermission("edit", "receivables");
  const [selected, setSelected] = useState<FinanceRecord | null>(null);
  const [form, setForm] = useState<Record<string, string>>(EMPTY);
  const [dialog, setDialog] = useState<"create" | "edit" | null>(null);
  const { data: payables = [] } = useQuery({ queryKey: ["payables", session.company.id], queryFn: async () => (await getDb()).select<Payable[]>("SELECT * FROM payables WHERE company_id=? AND deleted_at IS NULL ORDER BY due_date ASC", [session.company.id]) });
  const { data: receivables = [] } = useQuery({ queryKey: ["receivables", session.company.id], queryFn: async () => (await getDb()).select<Receivable[]>("SELECT * FROM receivables WHERE company_id=? AND deleted_at IS NULL ORDER BY due_date ASC", [session.company.id]) });
  const totalPay = payables.filter((item) => ["aberta", "aprovada"].includes(item.status)).reduce((sum, item) => sum + item.amount, 0);
  const totalRec = receivables.filter((item) => item.status === "aberta").reduce((sum, item) => sum + item.amount, 0);
  const rows: FinanceRecord[] = tab === "payables" ? payables.map((item) => ({ id: item.id, description: item.description, amount: item.amount, due_date: item.due_date, status: item.status, raw: item })) : receivables.map((item) => ({ id: item.id, description: item.description ?? item.ref_id ?? "Recebimento manual", amount: item.amount, due_date: item.due_date, status: item.status, raw: item }));
  const canCreate = tab === "payables" ? canCreatePay : canCreateRec;
  const canEdit = tab === "payables" ? canEditPay : canEditRec;
  const saveMutation = useMutation({ mutationFn: async () => {
    const db = await getDb();
    if (dialog === "edit" && selected) {
      if (tab === "payables") await db.execute("UPDATE payables SET description=?, amount=?, due_date=?, status=?, updated_at=datetime('now') WHERE id=?", [form.description, Number(form.amount), form.due_date || null, form.status, selected.id]);
      else await db.execute("UPDATE receivables SET description=?, amount=?, due_date=?, status=?, updated_at=datetime('now') WHERE id=?", [form.description, Number(form.amount), form.due_date || null, form.status, selected.id]);
    } else if (tab === "payables") await db.execute("INSERT INTO payables (id, company_id, description, amount, due_date, status) VALUES (?,?,?,?,?,?)", [uuidv4(), session.company.id, form.description, Number(form.amount), form.due_date || null, form.status]);
    else await db.execute("INSERT INTO receivables (id, company_id, ref_type, description, amount, due_date, status) VALUES (?,?,?,?,?,?,?)", [uuidv4(), session.company.id, "Manual", form.description, Number(form.amount), form.due_date || null, form.status]);
  }, onSuccess: () => { qc.invalidateQueries({ queryKey: ["payables", session.company.id] }); qc.invalidateQueries({ queryKey: ["receivables", session.company.id] }); setSelected(null); setDialog(null); setForm(EMPTY); } });
  return <div className="space-y-6">
    <PageHeader title="Financeiro" description="Contas a pagar e a receber" actions={canCreate ? <button onClick={() => { setForm(EMPTY); setDialog("create"); }} className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"><Plus size={14} /> {tab === "payables" ? "Nova conta a pagar" : "Nova conta a receber"}</button> : undefined} />
    <div className="grid gap-4 md:grid-cols-3"><KpiCard title="A receber" value={formatCurrency(totalRec)} icon={TrendingUp} iconClassName="bg-emerald-50 text-emerald-600" /><KpiCard title="A pagar" value={formatCurrency(totalPay)} icon={TrendingDown} iconClassName="bg-red-50 text-red-600" /><KpiCard title="Saldo projetado" value={formatCurrency(totalRec-totalPay)} icon={Wallet} /></div>
    <div className="flex w-fit gap-1 rounded-lg border bg-muted/30 p-1">{(["receivables", "payables"] as Tab[]).map((item) => <button key={item} onClick={() => { setTab(item); setSelected(null); }} className={`rounded-md px-4 py-1.5 text-sm font-medium ${tab === item ? "bg-background shadow-sm" : "text-muted-foreground"}`}>{item === "receivables" ? "A Receber" : "A Pagar"}</button>)}</div>
    {rows.length === 0 ? <EmptyState icon={Wallet} title="Nenhum lançamento" /> : <div className="overflow-hidden rounded-xl border"><table className="w-full text-sm"><thead className="bg-muted/30"><tr><th className="px-4 py-3 text-left">Descrição</th><th className="px-4 py-3 text-left">Valor</th><th className="px-4 py-3 text-left">Vencimento</th><th className="px-4 py-3 text-left">Status</th></tr></thead><tbody className="divide-y">{rows.map((row) => <tr key={row.id} onClick={() => setSelected(row)} className="cursor-pointer hover:bg-muted/20"><td className="px-4 py-3 font-medium">{row.description}</td><td className="px-4 py-3">{formatCurrency(row.amount)}</td><td className="px-4 py-3">{formatDate(row.due_date)}</td><td className="px-4 py-3"><StatusBadge status={row.status} /></td></tr>)}</tbody></table></div>}
    {selected && <DetailDrawer title={selected.description} subtitle={tab === "payables" ? "Conta a pagar" : "Conta a receber"} onClose={() => setSelected(null)} onEdit={canEdit ? () => { setForm({ description: selected.description, amount: String(selected.amount), due_date: selected.due_date?.slice(0, 10) ?? "", status: selected.status }); setDialog("edit"); } : undefined}><DetailGrid><DetailItem label="Valor" value={formatCurrency(selected.amount)} /><DetailItem label="Vencimento" value={formatDate(selected.due_date)} /><DetailItem label="Status" value={<StatusBadge status={selected.status} />} /></DetailGrid></DetailDrawer>}
    {dialog && <CrudDialog title={dialog === "edit" ? "Editar lançamento" : "Novo lançamento"} fields={[{ key: "description", label: "Descrição", required: true }, { key: "amount", label: "Valor", type: "number" }, { key: "due_date", label: "Vencimento", type: "date" }, { key: "status", label: "Status", type: "select", options: STATUSES.map((status) => ({ value: status, label: status })) }]} values={form} onChange={(key, value) => setForm((current) => ({ ...current, [key]: value }))} onClose={() => setDialog(null)} onSubmit={() => saveMutation.mutate()} busy={saveMutation.isPending} />}
  </div>;
}
