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
import { FolderKanban, Plus } from "lucide-react";
import type { Project } from "@/types";

const STATUSES = ["planejado", "andamento", "pausado", "concluido", "cancelado"];
const EMPTY = { name: "", status: "planejado", budget: "0", start_date: "", end_date: "" };

export default function ProjectsPage() {
  const session = useRequiredSession();
  const qc = useQueryClient();
  const canCreate = usePermission("create", "projects");
  const canEdit = usePermission("edit", "projects");
  const [selected, setSelected] = useState<Project | null>(null);
  const [form, setForm] = useState<Record<string, string>>(EMPTY);
  const [dialog, setDialog] = useState<"create" | "edit" | null>(null);
  const { data: projects = [], isLoading } = useQuery({ queryKey: ["projects", session.company.id], queryFn: async () => (await getDb()).select<Project[]>("SELECT * FROM projects WHERE company_id=? AND deleted_at IS NULL ORDER BY created_at DESC", [session.company.id]) });
  const saveMutation = useMutation({ mutationFn: async () => {
    const db = await getDb();
    if (dialog === "edit" && selected) await db.execute("UPDATE projects SET name=?, status=?, budget=?, start_date=?, end_date=?, updated_at=datetime('now') WHERE id=?", [form.name, form.status, Number(form.budget), form.start_date || null, form.end_date || null, selected.id]);
    else await db.execute("INSERT INTO projects (id, company_id, name, status, budget, start_date, end_date, owner_id) VALUES (?,?,?,?,?,?,?,?)", [uuidv4(), session.company.id, form.name, form.status, Number(form.budget), form.start_date || null, form.end_date || null, session.user.id]);
  }, onSuccess: () => { qc.invalidateQueries({ queryKey: ["projects", session.company.id] }); setSelected((item) => dialog === "edit" && item ? { ...item, ...form, status: form.status as Project["status"], budget: Number(form.budget) } : item); setDialog(null); setForm(EMPTY); } });
  return <div className="space-y-6">
    <PageHeader title="Projetos" description="Gestao de projetos e tarefas" actions={canCreate ? <button onClick={() => { setForm(EMPTY); setDialog("create"); }} className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"><Plus size={14} /> Novo projeto</button> : undefined} />
    {isLoading ? <div className="h-36 animate-pulse rounded-xl bg-muted/30" /> : projects.length === 0 ? <EmptyState icon={FolderKanban} title="Nenhum projeto" /> : <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{projects.map((project) => <button key={project.id} onClick={() => setSelected(project)} className="space-y-3 rounded-xl border bg-card p-4 text-left transition-shadow hover:shadow-md"><div className="flex items-start justify-between gap-2"><p className="font-semibold">{project.name}</p><StatusBadge status={project.status} /></div><p className="text-sm text-muted-foreground">Orcamento: {formatCurrency(project.budget)}</p><p className="text-xs text-muted-foreground">Prazo: {formatDate(project.end_date)}</p></button>)}</div>}
    {selected && <DetailDrawer title={selected.name} subtitle="Projeto" onClose={() => setSelected(null)} onEdit={canEdit ? () => { setForm({ name: selected.name, status: selected.status, budget: String(selected.budget), start_date: selected.start_date?.slice(0, 10) ?? "", end_date: selected.end_date?.slice(0, 10) ?? "" }); setDialog("edit"); } : undefined}><DetailGrid><DetailItem label="Status" value={<StatusBadge status={selected.status} />} /><DetailItem label="Orcamento" value={formatCurrency(selected.budget)} /><DetailItem label="Inicio" value={formatDate(selected.start_date)} /><DetailItem label="Prazo" value={formatDate(selected.end_date)} /></DetailGrid></DetailDrawer>}
    {dialog && <CrudDialog title={dialog === "edit" ? "Editar projeto" : "Novo projeto"} fields={[{ key: "name", label: "Nome", required: true }, { key: "status", label: "Status", type: "select", options: STATUSES.map((status) => ({ value: status, label: status })) }, { key: "budget", label: "Orcamento", type: "number" }, { key: "start_date", label: "Inicio", type: "date" }, { key: "end_date", label: "Prazo", type: "date" }]} values={form} onChange={(key, value) => setForm((current) => ({ ...current, [key]: value }))} onClose={() => setDialog(null)} onSubmit={() => saveMutation.mutate()} busy={saveMutation.isPending} />}
  </div>;
}
