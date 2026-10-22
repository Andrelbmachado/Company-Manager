import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { v4 as uuidv4 } from "uuid";
import { Check, Pin, Plus, Trash2, X } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { emit } from "@/lib/events/bus";
import { useRequiredSession } from "@/hooks/useSession";
import { usePermission } from "@/hooks/usePermission";
import { CrudDialog, type CrudField } from "@/components/shared/CrudDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatCard } from "@/components/shared/StatCard";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { cn, formatDay, todayIso } from "@/lib/utils";
import { fetchAnnouncements, fetchEmployees, fetchHrTasks, fetchRequests } from "@/lib/hr/queries";
import { REQUEST_TYPE_LABEL, isOnVacation, vacationBalance } from "@/lib/hr/rules";
import type { Employee, EmployeeStatus, HrAnnouncementCategory } from "@/types";

type Tab = "solicitacoes" | "colaboradores" | "comunicados" | "pendencias";
type Dialog = "employee" | "announcement" | "task" | null;

const TABS: { id: Tab; label: string }[] = [
  { id: "solicitacoes", label: "Solicitações" },
  { id: "colaboradores", label: "Colaboradores" },
  { id: "comunicados", label: "Comunicados" },
  { id: "pendencias", label: "Pendências" },
];
const EMPLOYEE_STATUSES: { value: EmployeeStatus; label: string }[] = [
  { value: "ativo", label: "Ativo" },
  { value: "afastado", label: "Afastado" },
  { value: "desligado", label: "Desligado" },
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
  const [editing, setEditing] = useState<Employee | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<"pendente" | "todas">("pendente");

  const { data: employees = [] } = useQuery({ queryKey: ["hr", "employees", companyId], queryFn: () => fetchEmployees(companyId) });
  const { data: requests = [] } = useQuery({ queryKey: ["hr", "requests", companyId], queryFn: () => fetchRequests(companyId) });
  const { data: announcements = [] } = useQuery({ queryKey: ["hr", "announcements", companyId], queryFn: () => fetchAnnouncements(companyId) });
  const { data: tasks = [] } = useQuery({ queryKey: ["hr", "tasks", companyId], queryFn: () => fetchHrTasks(companyId) });

  const byId = useMemo(() => new Map(employees.map((employee) => [employee.id, employee])), [employees]);
  const active = employees.filter((employee) => employee.status !== "desligado");
  const pending = requests.filter((request) => request.status === "pendente");
  const onVacation = active.filter((employee) => isOnVacation(requests, employee.id, today)).length;
  const lateTasks = tasks.filter((task) => task.status === "pendente" && task.due_date && task.due_date < today).length;
  const year = Number(today.slice(0, 4));

  const refresh = () => qc.invalidateQueries({ queryKey: ["hr"] });
  const done = () => { void refresh(); setDialog(null); setEditing(null); };

  const decide = useMutation({
    mutationFn: async ({ id, approve }: { id: string; approve: boolean }) => {
      const status = approve ? "aprovada" : "recusada";
      await (await getDb()).execute(
        "UPDATE hr_requests SET status=?, decided_by=?, decided_at=?, updated_at=datetime('now') WHERE id=? AND company_id=?",
        [status, session.user.id, new Date().toISOString(), id, companyId],
      );
      await emit({ type: "hr_request.decided", companyId, actorId: session.user.id, entityType: "hr_request", entityId: id, title: `Solicitação ${status}`, module: "hr" });
    },
    onSuccess: () => void refresh(),
  });

  const saveEmployee = useMutation({
    mutationFn: async () => {
      const db = await getDb();
      const values = [form.name.trim(), form.email.trim() || null, form.department.trim() || null, form.position.trim() || null, form.hire_date || null, Number(form.vacation_days_entitled) || 30, form.status];
      if (editing) await db.execute("UPDATE employees SET name=?, email=?, department=?, position=?, hire_date=?, vacation_days_entitled=?, status=?, updated_at=datetime('now') WHERE id=? AND company_id=?", [...values, editing.id, companyId]);
      else await db.execute("INSERT INTO employees (id, company_id, name, email, department, position, hire_date, vacation_days_entitled, status) VALUES (?,?,?,?,?,?,?,?,?)", [uuidv4(), companyId, ...values]);
    },
    onSuccess: done,
  });

  const saveAnnouncement = useMutation({
    mutationFn: async () => {
      await (await getDb()).execute(
        "INSERT INTO hr_announcements (id, company_id, title, body, category, pinned, published_by, published_at) VALUES (?,?,?,?,?,?,?,?)",
        [uuidv4(), companyId, form.title.trim(), form.body.trim(), form.category, form.pinned === "sim" ? 1 : 0, session.user.id, new Date().toISOString()],
      );
    },
    onSuccess: done,
  });

  const togglePin = useMutation({
    mutationFn: async ({ id, pinned }: { id: string; pinned: number }) => {
      await (await getDb()).execute("UPDATE hr_announcements SET pinned=?, updated_at=datetime('now') WHERE id=? AND company_id=?", [pinned ? 0 : 1, id, companyId]);
    },
    onSuccess: () => void refresh(),
  });

  const removeAnnouncement = useMutation({
    mutationFn: async (id: string) => {
      await (await getDb()).execute("UPDATE hr_announcements SET deleted_at=datetime('now'), updated_at=datetime('now') WHERE id=? AND company_id=?", [id, companyId]);
    },
    onSuccess: () => void refresh(),
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
  });

  function openEmployee(employee: Employee | null) {
    setEditing(employee);
    setForm(employee
      ? { name: employee.name, email: employee.email ?? "", department: employee.department ?? "", position: employee.position ?? "", hire_date: employee.hire_date?.slice(0, 10) ?? "", vacation_days_entitled: String(employee.vacation_days_entitled), status: employee.status === "em_ferias" ? "ativo" : employee.status }
      : { name: "", email: "", department: "", position: "", hire_date: "", vacation_days_entitled: "30", status: "ativo" });
    setDialog("employee");
  }

  const employeeFields: CrudField[] = [
    { key: "name", label: "Nome", required: true },
    { key: "email", label: "E-mail", type: "email" },
    { key: "department", label: "Setor" },
    { key: "position", label: "Cargo" },
    { key: "hire_date", label: "Admissão", type: "date" },
    { key: "vacation_days_entitled", label: "Dias de férias por ano", type: "number" },
    { key: "status", label: "Situação", type: "select", options: EMPLOYEE_STATUSES },
  ];

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

      <div className="flex flex-wrap items-center justify-between gap-3 border-b">
        <div role="tablist" className="flex gap-1">
          {TABS.map((item) => (
            <button key={item.id} role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)} className={cn("-mb-px border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors", tab === item.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
              {item.label}{item.id === "solicitacoes" && pending.length > 0 ? ` (${pending.length})` : ""}
            </button>
          ))}
        </div>
        <div className="mb-2 flex gap-2">
          {tab === "colaboradores" && canCreate && <button onClick={() => openEmployee(null)} className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"><Plus size={14} /> Novo colaborador</button>}
          {tab === "comunicados" && canCreate && <button onClick={() => { setForm({ title: "", body: "", category: "comunicado", pinned: "nao" }); setDialog("announcement"); }} className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"><Plus size={14} /> Novo comunicado</button>}
          {tab === "pendencias" && canCreate && <button onClick={() => { setForm({ employee_id: "todos", title: "", due_date: "" }); setDialog("task"); }} className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"><Plus size={14} /> Nova pendência</button>}
        </div>
      </div>

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
                      <td className="px-4 py-3"><p className="font-medium">{employee.name}</p><p className="text-xs text-muted-foreground">{employee.email}</p></td>
                      <td className="px-4 py-3 text-muted-foreground">{employee.department ?? "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{employee.position ?? "—"}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDay(employee.hire_date)}</td>
                      <td className="px-4 py-3 tabular-nums">{balance.available} de {balance.entitled} dias</td>
                      <td className="px-4 py-3"><StatusBadge status={vacationNow ? "em_ferias" : employee.status === "ativo" ? "active" : employee.status} /></td>
                      <td className="px-4 py-3 text-right">{canEdit && <button onClick={() => openEmployee(employee)} className="rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted">Editar</button>}</td>
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
                  {item.pinned ? <span className="text-xs font-semibold text-primary">Fixado</span> : null}
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
              <thead className="bg-muted"><tr>{["Colaborador", "Pendência", "Prazo", "Status"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody className="divide-y">
                {tasks.map((task) => {
                  const late = task.status === "pendente" && !!task.due_date && task.due_date < today;
                  return (
                    <tr key={task.id}>
                      <td className="px-4 py-3 font-medium">{byId.get(task.employee_id)?.name ?? "—"}</td>
                      <td className="px-4 py-3">{task.title}</td>
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

      {dialog === "employee" && (
        <CrudDialog title={editing ? "Editar colaborador" : "Novo colaborador"} fields={employeeFields} values={form} onChange={(k, v) => setForm((c) => ({ ...c, [k]: v }))} onClose={() => setDialog(null)} onSubmit={() => saveEmployee.mutate()} busy={saveEmployee.isPending} />
      )}
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
        />
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
        />
      )}
    </div>
  );
}
