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
import { formatCurrency, formatDate } from "@/lib/utils";
import { Plus, Target } from "lucide-react";
import type { Opportunity } from "@/types";

const STAGES = ["novo", "qualificacao", "proposta", "negociacao", "ganho", "perdido"] as const;
const EMPTY = { title: "", value: "0", stage: "novo", probability: "20", expected_close_date: "" };

export default function OpportunitiesPage() {
  const session = useRequiredSession();
  const qc = useQueryClient();
  const canCreate = usePermission("create", "opportunities");
  const canEdit = usePermission("edit", "opportunities");
  const [selected, setSelected] = useState<Opportunity | null>(null);
  const [form, setForm] = useState<Record<string, string>>(EMPTY);
  const [dialog, setDialog] = useState<"create" | "edit" | null>(null);

  const { data: opportunities = [], isLoading } = useQuery({
    queryKey: ["opportunities", session.company.id],
    queryFn: async () => (await getDb()).select<Opportunity[]>("SELECT * FROM opportunities WHERE company_id=? AND deleted_at IS NULL ORDER BY created_at DESC", [session.company.id]),
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const db = await getDb();
      const status = form.stage === "ganho" ? "won" : form.stage === "perdido" ? "lost" : "open";
      if (dialog === "edit" && selected) {
        await db.execute("UPDATE opportunities SET title=?, value=?, stage=?, probability=?, expected_close_date=?, status=?, updated_at=datetime('now') WHERE id=?", [form.title, Number(form.value), form.stage, Number(form.probability), form.expected_close_date || null, status, selected.id]);
      } else {
        await db.execute("INSERT INTO opportunities (id, company_id, title, value, stage, probability, expected_close_date, status) VALUES (?,?,?,?,?,?,?,?)", [uuidv4(), session.company.id, form.title, Number(form.value), form.stage, Number(form.probability), form.expected_close_date || null, status]);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["opportunities", session.company.id] });
      setSelected((item) => dialog === "edit" && item ? { ...item, ...form, value: Number(form.value), probability: Number(form.probability), stage: form.stage as Opportunity["stage"] } : item);
      setDialog(null);
      setForm(EMPTY);
    },
  });

  const byStage = Object.fromEntries(STAGES.map((stage) => [stage, opportunities.filter((item) => item.stage === stage)]));
  return (
    <div className="space-y-6">
      <PageHeader title="Oportunidades" description="Funil de vendas" actions={canCreate ? <button onClick={() => { setForm(EMPTY); setDialog("create"); }} className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"><Plus size={14} /> Nova oportunidade</button> : undefined} />
      {isLoading ? <div className="h-48 animate-pulse rounded-xl bg-muted/30" /> : opportunities.length === 0 ? <EmptyState icon={Target} title="Nenhuma oportunidade" /> : (
        <div className="grid grid-cols-2 items-start gap-3 md:grid-cols-3 lg:grid-cols-6">
          {STAGES.map((stage) => <div key={stage} className="space-y-2 rounded-xl border bg-card p-3">
            <div className="flex items-center justify-between"><StatusBadge status={stage} /><span className="text-xs text-muted-foreground">{byStage[stage].length}</span></div>
            <p className="text-xs font-medium text-muted-foreground">{formatCurrency(byStage[stage].reduce((sum, item) => sum + item.value, 0))}</p>
            {byStage[stage].map((item) => <button key={item.id} onClick={() => setSelected(item)} className="w-full rounded-lg border bg-background p-2 text-left text-xs hover:bg-muted/40"><p className="truncate font-medium">{item.title}</p><p className="mt-1 text-muted-foreground">{formatCurrency(item.value)}</p></button>)}
          </div>)}
        </div>
      )}
      {selected && <DetailDrawer title={selected.title} subtitle="Oportunidade" onClose={() => setSelected(null)} onEdit={canEdit ? () => { setForm({ title: selected.title, value: String(selected.value), stage: selected.stage, probability: String(selected.probability), expected_close_date: selected.expected_close_date?.slice(0, 10) ?? "" }); setDialog("edit"); } : undefined}><DetailGrid><DetailItem label="Etapa" value={<StatusBadge status={selected.stage} />} /><DetailItem label="Valor" value={formatCurrency(selected.value)} /><DetailItem label="Probabilidade" value={`${selected.probability}%`} /><DetailItem label="Fechamento previsto" value={formatDate(selected.expected_close_date)} /></DetailGrid></DetailDrawer>}
      {dialog && <CrudDialog title={dialog === "edit" ? "Editar oportunidade" : "Nova oportunidade"} fields={[{ key: "title", label: "Titulo", required: true }, { key: "value", label: "Valor", type: "number" }, { key: "stage", label: "Etapa", type: "select", options: STAGES.map((stage) => ({ value: stage, label: stage })) }, { key: "probability", label: "Probabilidade (%)", type: "number" }, { key: "expected_close_date", label: "Fechamento previsto", type: "date" }]} values={form} onChange={(key, value) => setForm((current) => ({ ...current, [key]: value }))} onClose={() => setDialog(null)} onSubmit={() => saveMutation.mutate()} busy={saveMutation.isPending} />}
    </div>
  );
}
