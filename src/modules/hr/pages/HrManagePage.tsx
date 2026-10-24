import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { v4 as uuidv4 } from "uuid";
import { Check, Pin, Plus, Trash2, X } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { emit } from "@/lib/events/bus";
import { useRequiredSession } from "@/hooks/useSession";
import { usePermission } from "@/hooks/usePermission";
import { CrudDialog } from "@/components/shared/CrudDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { ImportExportButtons } from "@/components/shared/ImportExportButtons";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatCard } from "@/components/shared/StatCard";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { TabList, TabPanel } from "@/components/shared/Tabs";
import { cn, formatDay, todayIso } from "@/lib/utils";
import { fetchAnnouncements, fetchEmployees, fetchHrTasks, fetchRequests } from "@/lib/hr/queries";
import { REQUEST_TYPE_LABEL, approvalError, isOnVacation, vacationBalance } from "@/lib/hr/rules";
import { CYCLE_LABEL, applyDueTerminations } from "@/lib/hr/employment";
import type { HrAnnouncementCategory, HrRequest } from "@/types";

type Tab = "solicitacoes" | "colaboradores" | "comunicados" | "pendencias";
type Dialog = "announcement" | "task" | null;

const TABS: { id: Tab; label: string }[] = [
  { id: "solicitacoes", label: "Solicitações" },
  { id: "colaboradores", label: "Colaboradores" },
  { id: "comunicados", label: "Comunicados" },
  { id: "pendencias", label: "Pendências" },
];
const CATEGORIES: { value: HrAnnouncementCategory; label: string }[] = [
  { value: "comunicado", label: "Comunicado" },
  { value: "politica", label: "Política" },
  { value: "beneficio", label: "Benefício" },
];
const th = "whitespace-nowrap px-4 py-3 text-left font-medium text-muted-foreground";

/** Gestão de RH: visão completa de colaboradores, solicitações, comunicados e pendências. Sem dados de salário. */
export default function HrManagePage() {
  const session = useRequiredSession();
  const qc = useQueryClient();
  const companyId = session.company.id;
  const today = todayIso();
  const canCreate = usePermission("create", "hr_admin");
  const canEdit = usePermission("edit", "hr_admin");
  const canApprove = usePermission("approve", "hr_admin");
  const canDelete = usePermission("delete", "hr_admin");
  const [tab, setTab] = useState<Tab>("solicitacoes");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<"pendente" | "todas">("pendente");
  const [error, setError] = useState("");

  const { data: employees = [] } = useQuery({ queryKey: ["hr", "employees", companyId], queryFn: () => fetchEmployees(companyId) });
  const { data: requests = [] } = useQuery({ queryKey: ["hr", "requests", companyId], queryFn: () => fetchRequests(companyId) });
  const { data: announcements = [] } = useQuery({ queryKey: ["hr", "announcements", companyId], queryFn: () => fetchAnnouncements(companyId) });
  const { data: tasks = [] } = useQuery({ queryKey: ["hr", "tasks", companyId], queryFn: () => fetchHrTasks(companyId) });

  const byId = useMemo(() => new Map(employees.map((employee) => [employee.id, employee])), [employees]);
  const active = employees.filter((employee) => employee.status !== "desligado");
  const pending = requests.filter((request) => request.status === "pendente");
  const TAB_ITEMS = TABS.map((item) => ({ id: item.id, label: `${item.label}${item.id === "solicitacoes" && pending.length > 0 ? ` (${pending.length})` : ""}` }));
  const onVacation = active.filter((employee) => isOnVacation(requests, employee.id, today)).length;
  const year = Number(today.slice(0, 4));
  const lateTasks = tasks.filter((task) => task.status === "pendente" && task.due_date && task.due_date < today).length;

  const refresh = () => qc.invalidateQueries({ queryKey: ["hr"] });
  const done = () => { void refresh(); setDialog(null); setError(""); };
  const fail = (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause));

  // Desligamento agendado vira "desligado" quando a data chega (idempotente; só quem pode editar efetiva).
  useEffect(() => {
    if (!canEdit) return;
    let alive = true;
    void (async () => {
      const changed = await applyDueTerminations(await getDb(), companyId, today).catch(() => 0);
      if (alive && changed > 0) void qc.invalidateQueries({ queryKey: ["hr"] });
    })();
    return () => { alive = false; };
  }, [canEdit, companyId, today, qc]);

  const decide = useMutation({
    mutationFn: async ({ id, approve }: { id: string; approve: boolean }) => {
      const status = approve ? "aprovada" : "recusada";
      const db = await getDb();
      // Decide sobre o que está no banco agora, não sobre a tela: outra pessoa do RH pode ter decidido antes.
      const [current] = await db.select<HrRequest[]>("SELECT * FROM hr_requests WHERE id=? AND company_id=?", [id, companyId]);
      if (!current) throw new Error("Solicitação não encontrada.");
      const fresh = await fetchRequests(companyId);
      const problem = approve ? approvalError(current, byId.get(current.employee_id), fresh) : current.status !== "pendente" ? "Esta solicitação já foi decidida." : null;
      if (problem) throw new Error(problem);
      await db.execute(
        "UPDATE hr_requests SET status=?, decided_by=?, decided_at=?, updated_at=datetime('now') WHERE id=? AND company_id=? AND status='pendente'",
        [status, session.user.id, new Date().toISOString(), id, companyId],
      );
      await emit({ type: "hr_request.decided", companyId, actorId: session.user.id, entityType: "hr_request", entityId: id, title: `Solicitação ${status}`, module: "hr" });
    },
    onSuccess: () => { void refresh(); setError(""); },
    onError: (cause) => { void refresh(); fail(cause); },
  });

  const saveAnnouncement = useMutation({
    mutationFn: async () => {
      await (await getDb()).execute(
        "INSERT INTO hr_announcements (id, company_id, title, body, category, pinned, published_by, published_at) VALUES (?,?,?,?,?,?,?,?)",
        [uuidv4(), companyId, form.title.trim(), form.body.trim(), form.category, form.pinned === "sim" ? 1 : 0, session.user.id, new Date().toISOString()],
      );
    },
    onSuccess: done,
    onError: fail,
  });

  const togglePin = useMutation({
    mutationFn: async ({ id, pinned }: { id: string; pinned: number }) => {
      await (await getDb()).execute("UPDATE hr_announcements SET pinned=?, updated_at=datetime('now') WHERE id=? AND company_id=?", [pinned ? 0 : 1, id, companyId]);
    },
    onSuccess: () => void refresh(),
    onError: fail,
  });

  const removeAnnouncement = useMutation({
    mutationFn: async (id: string) => {
      await (await getDb()).execute("UPDATE hr_announcements SET deleted_at=datetime('now'), updated_at=datetime('now') WHERE id=? AND company_id=?", [id, companyId]);
    },
    onSuccess: () => void refresh(),
    onError: fail,
  });

  const saveTask = useMutation({
    mutationFn: async () => {
      const db = await getDb();
      const targets = form.employee_id === "todos" ? active : active.filter((employee) => employee.id === form.employee_id);
      for (const employee of targets) {
        await db.execute(
          "INSERT INTO hr_tasks (id, company_id, employee_id, title, due_date, status, created_by) VALUES (?,?,?,?,?,?,?)",
          [uuidv4(), companyId, employee.id, form.title.trim(), form.due_date || null, "pendente", session.user.id],
        );
      }
    },
    onSuccess: done,
    onError: fail,
  });

  const shownRequests = requests.filter((request) => filter === "todas" || request.status === "pendente");

  return (
    <div className="space-y-6">
      <PageHeader title="Gestão de RH" description="Colaboradores, solicitações, comunicados e pendências. Esta área é só do RH e da diretoria; os demais setores veem o Meu RH." />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Colaboradores ativos" value={active.length} hint={`${employees.length - active.length} desligado(s) no cadastro`} />
        <StatCard title="Solicitações pendentes" value={pending.length} hint={pending.length ? "Aguardando decisão do RH" : "Nada aguardando"} />
        <StatCard title="De férias hoje" value={onVacation} hint="Férias aprovadas cobrindo a data de hoje" />
        <StatCard title="Pendências em atraso" value={lateTasks} hint="Itens pedidos aos colaboradores, com prazo vencido" />
      </div>

      {error && !dialog && (
        <p role="alert" className="flex items-start justify-between gap-3 rounded-lg border border-status-danger bg-card px-4 py-2.5 text-sm">
          <span><strong className="text-status-danger dark:text-red-400">Não foi possível concluir. </strong>{error}</span>
          <button onClick={() => setError("")} className="shrink-0 font-medium underline">fechar</button>
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-b">
        <TabList tabs={TAB_ITEMS} value={tab} onChange={setTab} label="Seções da gestão de RH" idPrefix="rh" />
        <div className="mb-2 flex gap-2">
          {tab === "colaboradores" && (
            <>
              {/* TODO(integração): os botões ligam sozinhos quando o motor de importação (Tarefa 5) registrar a entidade
                  "employees" em src/lib/importexport/importers/employees.ts, reexportando employeeImportEntity de @/lib/hr/employeeImport. */}
              <ImportExportButtons entity="employees" onImported={() => void refresh()} />
              {canCreate && <Link to="/hr/manage/colaboradores/nova" className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"><Plus size={14} /> Novo colaborador</Link>}
            </>
          )}
          {tab === "comunicados" && canCreate && <button onClick={() => { setError(""); setForm({ title: "", body: "", category: "comunicado", pinned: "nao" }); setDialog("announcement"); }} className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"><Plus size={14} /> Novo comunicado</button>}
          {tab === "pendencias" && canCreate && <button onClick={() => { setError(""); setForm({ employee_id: "todos", title: "", due_date: "" }); setDialog("task"); }} className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"><Plus size={14} /> Nova pendência</button>}
        </div>
      </div>

      <TabPanel idPrefix="rh" id={tab}>
      {tab === "solicitacoes" && (
        <section className="space-y-3">
          <div className="flex gap-2">
            {(["pendente", "todas"] as const).map((value) => (
              <button key={value} onClick={() => setFilter(value)} className={cn("rounded-md border px-3 py-1.5 text-sm font-medium", filter === value ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>{value === "pendente" ? "Pendentes" : "Todas"}</button>
            ))}
          </div>
          {shownRequests.length === 0 ? <EmptyState title="Nenhuma solicitação aqui" description={filter === "pendente" ? "Nada aguardando decisão." : undefined} /> : (
            <div className="overflow-x-auto rounded-xl border bg-card">
              <table className="w-full text-sm">
                <thead className="bg-muted"><tr>{["Colaborador", "Setor", "Tipo", "Período", "Dias", "Motivo", "Status", ""].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                <tbody className="divide-y">
                  {shownRequests.map((request) => {
                    const employee = byId.get(request.employee_id);
                    return (
                      <tr key={request.id}>
                        <td className="px-4 py-3 font-medium">{employee?.name ?? "—"}</td>
                        <td className="px-4 py-3 text-muted-foreground">{employee?.department ?? "—"}</td>
                        <td className="px-4 py-3">{REQUEST_TYPE_LABEL[request.type]}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDay(request.start_date)} a {formatDay(request.end_date)}</td>
                        <td className="px-4 py-3 tabular-nums">{request.days}</td>
                        <td className="max-w-56 truncate px-4 py-3 text-muted-foreground">{request.reason ?? "—"}</td>
                        <td className="px-4 py-3"><StatusBadge status={request.status} tone={request.status === "aprovada" ? "success" : undefined} /></td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          {request.status === "pendente" && canApprove && (
                            <span className="inline-flex gap-1.5">
                              <button onClick={() => decide.mutate({ id: request.id, approve: true })} className="flex items-center gap-1 rounded-md bg-status-success px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90"><Check size={13} /> Aprovar</button>
                              <button onClick={() => decide.mutate({ id: request.id, approve: false })} className="flex items-center gap-1 rounded-md bg-status-danger px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90"><X size={13} /> Recusar</button>
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === "colaboradores" && (
        employees.length === 0 ? <EmptyState title="Nenhum colaborador cadastrado" description={canCreate ? "Cadastre os colaboradores para controlar férias e pendências." : undefined} /> : (
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted"><tr>{["Nome", "Setor", "Cargo", "Admissão", "Férias disponíveis", "Situação", ""].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody className="divide-y">
                {employees.map((employee) => {
                  const balance = vacationBalance(employee, requests.filter((request) => request.employee_id === employee.id), year);
                  const vacationNow = isOnVacation(requests, employee.id, today);
                  return (
                    <tr key={employee.id}>
                      <td className="px-4 py-3"><Link to={`/hr/manage/colaboradores/${employee.id}`} className="font-medium hover:underline">{employee.name}</Link><p className="text-xs text-muted-foreground">{employee.email}</p></td>
                      <td className="px-4 py-3 text-muted-foreground">{employee.department ?? "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{employee.position ?? "—"}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDay(employee.hire_date)}</td>
                      <td className="px-4 py-3 tabular-nums">{balance.available} de {balance.entitled} dias</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex flex-wrap gap-1.5">
                          <StatusBadge status={vacationNow ? "em_ferias" : employee.status === "ativo" ? "active" : employee.status} />
                          {employee.termination_date && employee.status !== "desligado" && <StatusBadge status={`sai em ${formatDay(employee.termination_date)}`} tone="warning" />}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right"><Link to={`/hr/manage/colaboradores/${employee.id}`} className="rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted">{canEdit ? "Abrir ficha" : "Ver ficha"}</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      {tab === "comunicados" && (
        announcements.length === 0 ? <EmptyState title="Nenhum comunicado" description="Publique avisos e políticas: todos os setores veem no Meu RH." /> : (
          <ul className="space-y-3">
            {[...announcements].sort((a, b) => b.pinned - a.pinned || b.published_at.localeCompare(a.published_at)).map((item) => (
              <li key={item.id} className="rounded-xl border bg-card p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={item.category} />
                  {item.pinned ? <span className="text-xs font-semibold text-primary-text">Fixado</span> : null}
                  <span className="text-xs text-muted-foreground">{formatDay(item.published_at)}</span>
                  <span className="ml-auto flex gap-1">
                    {canEdit && <button onClick={() => togglePin.mutate({ id: item.id, pinned: item.pinned })} aria-label={item.pinned ? "Desafixar" : "Fixar"} className="rounded-md border p-1.5 hover:bg-muted"><Pin size={14} /></button>}
                    {canDelete && <button onClick={() => removeAnnouncement.mutate(item.id)} aria-label={`Remover ${item.title}`} className="rounded-md border p-1.5 text-status-danger hover:bg-muted dark:text-red-400"><Trash2 size={14} /></button>}
                  </span>
                </div>
                <h3 className="mt-2 font-bold">{item.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{item.body}</p>
              </li>
            ))}
          </ul>
        )
      )}

      {tab === "pendencias" && (
        tasks.length === 0 ? <EmptyState title="Nenhuma pendência" description="Peça documentos, treinamentos ou atualizações cadastrais a um colaborador ou a todos." /> : (
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted"><tr>{["Colaborador", "Pendência", "Tipo", "Prazo", "Status"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody className="divide-y">
                {tasks.map((task) => {
                  const late = task.status === "pendente" && !!task.due_date && task.due_date < today;
                  return (
                    <tr key={task.id}>
                      <td className="px-4 py-3 font-medium">{byId.get(task.employee_id)?.name ?? "—"}</td>
                      <td className="px-4 py-3">{task.title}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{task.category === "admissao" || task.category === "desligamento" ? <Link to="/hr/manage/admissoes" className="hover:underline">{CYCLE_LABEL[task.category]}</Link> : "Geral"}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDay(task.due_date)}</td>
                      <td className="px-4 py-3"><span className="inline-flex gap-1.5"><StatusBadge status={task.status === "concluida" ? "concluida" : "pendente"} />{late && <StatusBadge status="vencida" />}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      </TabPanel>

      {dialog === "announcement" && (
        <CrudDialog
          title="Novo comunicado"
          fields={[
            { key: "title", label: "Título", required: true },
            { key: "category", label: "Categoria", type: "select", options: CATEGORIES },
            { key: "pinned", label: "Fixar no topo", type: "select", options: [{ value: "nao", label: "Não" }, { value: "sim", label: "Sim" }] },
            { key: "body", label: "Texto", type: "textarea", required: true },
          ]}
          values={form} onChange={(k, v) => setForm((c) => ({ ...c, [k]: v }))} onClose={() => setDialog(null)} onSubmit={() => saveAnnouncement.mutate()} busy={saveAnnouncement.isPending} submitLabel="Publicar"
        >
          {error && <p role="alert" className="mt-3 text-sm font-medium text-status-danger dark:text-red-400">{error}</p>}
        </CrudDialog>
      )}
      {dialog === "task" && (
        <CrudDialog
          title="Nova pendência"
          fields={[
            { key: "employee_id", label: "Para quem", type: "select", options: [{ value: "todos", label: "Todos os colaboradores ativos" }, ...active.map((employee) => ({ value: employee.id, label: employee.name }))] },
            { key: "title", label: "O que precisa ser feito", required: true },
            { key: "due_date", label: "Prazo", type: "date" },
          ]}
          values={form} onChange={(k, v) => setForm((c) => ({ ...c, [k]: v }))} onClose={() => setDialog(null)} onSubmit={() => saveTask.mutate()} busy={saveTask.isPending} submitLabel="Criar pendência"
        >
          {error && <p role="alert" className="mt-3 text-sm font-medium text-status-danger dark:text-red-400">{error}</p>}
        </CrudDialog>
      )}
    </div>
  );
}
