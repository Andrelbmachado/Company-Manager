import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Trash2, X } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { emit } from "@/lib/events/bus";
import { useRequiredSession } from "@/hooks/useSession";
import { usePermission } from "@/hooks/usePermission";
import { EditableTable, type EditableColumn, type EditableTableChanges } from "@/components/shared/EditableTable";
import { ImportExportButtons } from "@/components/shared/ImportExportButtons";
import { KpiCard } from "@/components/shared/KpiCard";
import { PageHeader } from "@/components/shared/PageHeader";
import { useLabel } from "@/lib/labels/useLabel";
import { StatusBadge, statusLabel } from "@/components/shared/StatusBadge";
import { TabList, TabPanel } from "@/components/shared/Tabs";
import { confirmAction } from "@/lib/confirm";
import { cn, formatDay, todayIso } from "@/lib/utils";
import { fetchAnnouncements, fetchEmployees, fetchHrTasks, fetchRequests } from "@/lib/hr/queries";
import { REQUEST_TYPES, approvalError, isOnVacation, vacationBalance } from "@/lib/hr/rules";
import { CONTRACT_TYPES } from "@/lib/hr/employees";
import { CYCLE_LABEL, applyDueTerminations } from "@/lib/hr/employment";
import { saveAnnouncementRows, saveEmployeeRows, saveRequestRows, saveTaskRows } from "@/lib/hr/tableEdits";
import { ErrorAlert, errorMessage } from "../components/hrUi";
import type { Employee, HrAnnouncement, HrRequest, HrTask, Role } from "@/types";

type Tab = "solicitacoes" | "colaboradores" | "comunicados" | "pendencias";
type EmployeeRow = Employee & { vacation: string };

const TABS: { id: Tab; label: string }[] = [
  { id: "solicitacoes", label: "Solicitações" },
  { id: "colaboradores", label: "Colaboradores" },
  { id: "comunicados", label: "Comunicados" },
  { id: "pendencias", label: "Pendências" },
];
const CATEGORIES = [
  { value: "comunicado", label: "Comunicado" },
  { value: "politica", label: "Política" },
  { value: "beneficio", label: "Benefício" },
];
const REQUEST_STATUSES = [
  { value: "pendente", label: "Pendente" },
  { value: "aprovada", label: "Aprovada" },
  { value: "recusada", label: "Recusada" },
];
const TASK_STATUSES = [
  { value: "pendente", label: "Pendente" },
  { value: "concluida", label: "Concluída" },
];
const BTN_APPROVE = "flex items-center gap-1 rounded-md bg-status-success px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50";
const BTN_REFUSE = "flex items-center gap-1 rounded-md bg-status-danger px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50";

/** Gestão de RH: colaboradores, solicitações, comunicados e pendências, tudo editável na tabela. Sem dados de salário. */
export default function HrManagePage() {
  const session = useRequiredSession();
  const title = useLabel("module.hr_manage");
  const qc = useQueryClient();
  const companyId = session.company.id;
  const actor = { role: session.membership.role as Role, userId: session.user.id };
  const today = todayIso();
  const canEdit = usePermission("edit", "hr_admin");
  const canApprove = usePermission("approve", "hr_admin");
  const canDelete = usePermission("delete", "hr_admin");
  const [tab, setTab] = useState<Tab>("solicitacoes");
  const [filter, setFilter] = useState<"pendente" | "todas">("pendente");
  const [error, setError] = useState("");

  const employeesQuery = useQuery({ queryKey: ["hr", "employees", companyId], queryFn: () => fetchEmployees(companyId) });
  const requestsQuery = useQuery({ queryKey: ["hr", "requests", companyId], queryFn: () => fetchRequests(companyId) });
  const announcementsQuery = useQuery({ queryKey: ["hr", "announcements", companyId], queryFn: () => fetchAnnouncements(companyId) });
  const tasksQuery = useQuery({ queryKey: ["hr", "tasks", companyId], queryFn: () => fetchHrTasks(companyId) });
  const employees = useMemo(() => employeesQuery.data ?? [], [employeesQuery.data]);
  const requests = useMemo(() => requestsQuery.data ?? [], [requestsQuery.data]);
  const announcements = announcementsQuery.data ?? [];
  const tasks = tasksQuery.data ?? [];

  const byId = useMemo(() => new Map(employees.map((employee) => [employee.id, employee])), [employees]);
  const names = useMemo(() => new Map(employees.map((employee) => [employee.id, employee.name])), [employees]);
  const active = employees.filter((employee) => employee.status !== "desligado");
  const pending = requests.filter((request) => request.status === "pendente");
  const TAB_ITEMS = TABS.map((item) => ({ id: item.id, label: `${item.label}${item.id === "solicitacoes" && pending.length > 0 ? ` (${pending.length})` : ""}` }));
  const onVacation = active.filter((employee) => isOnVacation(requests, employee.id, today)).length;
  const year = Number(today.slice(0, 4));
  const lateTasks = tasks.filter((task) => task.status === "pendente" && task.due_date && task.due_date < today).length;
  const employeeOptions = employees.map((employee) => ({ value: employee.id, label: employee.status === "desligado" ? `${employee.name} (desligado)` : employee.name }));

  const refresh = () => qc.invalidateQueries({ queryKey: ["hr"] });

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
    onError: (cause) => { void refresh(); setError(errorMessage(cause)); },
  });

  async function removeAnnouncement(item: HrAnnouncement) {
    if (!(await confirmAction(`Remover o comunicado "${item.title}"?`, { title: "Remover comunicado", okLabel: "Remover" }))) return;
    try {
      if (!canDelete) throw new Error("Seu perfil não tem permissão para remover comunicados.");
      await (await getDb()).execute("UPDATE hr_announcements SET deleted_at=datetime('now'), updated_at=datetime('now') WHERE id=? AND company_id=? AND deleted_at IS NULL", [item.id, companyId]);
      setError("");
      await refresh();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function saveRequests(changes: EditableTableChanges<HrRequest>) {
    const { created } = await saveRequestRows(await getDb(), companyId, actor, changes, today);
    for (const id of created) await emit({ type: "hr_request.created", companyId, actorId: session.user.id, entityType: "hr_request", entityId: id, title: "Solicitação registrada pelo RH", module: "hr_manage" });
    if (created.length) setFilter("pendente");
  }

  async function saveEmployees(changes: EditableTableChanges<EmployeeRow>) {
    const { created } = await saveEmployeeRows(await getDb(), companyId, actor.role, changes, today);
    for (const id of created) await emit({ type: "employee.created", companyId, actorId: session.user.id, entityType: "employee", entityId: id, title: "Colaborador cadastrado", module: "hr_manage" });
    for (const fields of changes.updated) await emit({ type: "employee.updated", companyId, actorId: session.user.id, entityType: "employee", entityId: fields.id, title: `Ficha atualizada: ${byId.get(fields.id)?.name ?? ""}`, module: "hr_manage" });
  }

  async function saveAnnouncements(changes: EditableTableChanges<HrAnnouncement>) {
    const { created } = await saveAnnouncementRows(await getDb(), companyId, actor, changes);
    for (const id of created) await emit({ type: "hr_announcement.published", companyId, actorId: session.user.id, entityType: "hr_announcement", entityId: id, title: "Comunicado publicado", module: "hr_manage" });
  }

  async function saveTasks(changes: EditableTableChanges<HrTask>) {
    await saveTaskRows(await getDb(), companyId, actor, changes, active.map((employee) => employee.id));
  }

  const shownRequests = requests.filter((request) => filter === "todas" || request.status === "pendente");
  const employeeRows: EmployeeRow[] = employees.map((employee) => {
    const balance = vacationBalance(employee, requests.filter((request) => request.employee_id === employee.id), year);
    return { ...employee, vacation: `${balance.available} de ${balance.entitled} dias` };
  });
  const sortedAnnouncements = [...announcements].sort((a, b) => b.pinned - a.pinned || b.published_at.localeCompare(a.published_at));

  const requestColumns: EditableColumn<HrRequest>[] = [
    { key: "employee_id", header: "Colaborador", kind: "select", options: employeeOptions, required: true, render: (request) => <span className="font-medium">{names.get(request.employee_id) ?? "—"}</span> },
    { key: "type", header: "Tipo", kind: "select", options: REQUEST_TYPES, required: true },
    { key: "start_date", header: "Início", kind: "date", required: true },
    { key: "end_date", header: "Fim", kind: "date", required: true },
    { key: "days", header: "Dias", kind: "number", readOnly: true },
    { key: "reason", header: "Motivo", kind: "text" },
    { key: "status", header: "Status", kind: "select", options: REQUEST_STATUSES, readOnly: true, render: (request) => <StatusBadge status={request.status} tone={request.status === "aprovada" ? "success" : undefined} /> },
  ];

  const employeeColumns: EditableColumn<EmployeeRow>[] = [
    { key: "name", header: "Nome", kind: "text", required: true, render: (employee) => <Link to={`/hr/manage/colaboradores/${employee.id}`} className="font-medium hover:underline">{employee.name}</Link> },
    { key: "email", header: "E-mail", kind: "email" },
    { key: "department", header: "Setor", kind: "text" },
    { key: "position", header: "Cargo", kind: "text" },
    { key: "hire_date", header: "Admissão", kind: "date" },
    { key: "contract_type", header: "Contrato", kind: "select", options: CONTRACT_TYPES },
    { key: "vacation", header: "Férias disponíveis", kind: "text", readOnly: true },
    {
      key: "status",
      header: "Situação",
      kind: "select",
      readOnly: true,
      sortValue: (employee) => statusLabel(isOnVacation(requests, employee.id, today) ? "em_ferias" : employee.status === "ativo" ? "active" : employee.status),
      render: (employee) => (
        <span className="inline-flex flex-wrap gap-1.5">
          <StatusBadge status={isOnVacation(requests, employee.id, today) ? "em_ferias" : employee.status === "ativo" ? "active" : employee.status} />
          {employee.termination_date && employee.status !== "desligado" && <StatusBadge status={`sai em ${formatDay(employee.termination_date)}`} tone="warning" />}
        </span>
      ),
    },
  ];

  const announcementColumns: EditableColumn<HrAnnouncement>[] = [
    { key: "title", header: "Título", kind: "text", required: true, render: (item) => <span className="font-medium">{item.title}</span> },
    { key: "category", header: "Categoria", kind: "select", options: CATEGORIES, required: true, render: (item) => <StatusBadge status={item.category} /> },
    { key: "pinned", header: "Fixado no topo", kind: "bool" },
    { key: "body", header: "Texto", kind: "text", required: true },
    { key: "published_at", header: "Publicado em", kind: "date", readOnly: true },
  ];

  const taskColumns: EditableColumn<HrTask>[] = [
    { key: "employee_id", header: "Colaborador", kind: "select", options: [{ value: "todos", label: "Todos os colaboradores ativos" }, ...employeeOptions], required: true, render: (task) => <span className="font-medium">{names.get(task.employee_id) ?? "—"}</span> },
    { key: "title", header: "Pendência", kind: "text", required: true },
    { key: "category", header: "Tipo", kind: "text", readOnly: true, render: (task) => (task.category === "admissao" || task.category === "desligamento" ? <Link to="/hr/manage/admissoes" className="hover:underline">{CYCLE_LABEL[task.category]}</Link> : "Geral") },
    { key: "due_date", header: "Prazo", kind: "date" },
    {
      key: "status",
      header: "Status",
      kind: "select",
      options: TASK_STATUSES,
      required: true,
      render: (task) => (
        <span className="inline-flex gap-1.5">
          <StatusBadge status={task.status === "concluida" ? "concluida" : "pendente"} />
          {task.status === "pendente" && !!task.due_date && task.due_date < today && <StatusBadge status="vencida" />}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={title} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard title="Colaboradores ativos" value={active.length} />
        <KpiCard title="Solicitações pendentes" value={pending.length} />
        <KpiCard title="De férias hoje" value={onVacation} />
        <KpiCard title="Pendências em atraso" value={lateTasks} />
      </div>

      <ErrorAlert message={error} onClose={() => setError("")} />

      <TabList tabs={TAB_ITEMS} value={tab} onChange={setTab} label="Seções da gestão de RH" idPrefix="rh" />

      {/* Abas e listas ficam montadas (só escondidas): trocar de aba ou ver o calendário não perde em silêncio o rascunho das tabelas. */}
      <div hidden={tab !== "solicitacoes"}>
        <TabPanel idPrefix="rh" id="solicitacoes">
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-2">
                {(["pendente", "todas"] as const).map((value) => (
                  <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)} className={cn("rounded-md border px-3 py-1.5 text-sm font-medium", filter === value ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>{value === "pendente" ? "Pendentes" : "Todas"}</button>
                ))}
              </div>
            </div>
            <div>
              <EditableTable<HrRequest>
                resource="hr_admin"
                label="Solicitações"
                title="Solicitações"
                rows={shownRequests}
                columns={requestColumns}
                loading={requestsQuery.isLoading}
                newRow={() => ({ type: "ferias" })}
                onSave={saveRequests}
                onRefresh={refresh}
                rowActions={(request) => request.status === "pendente" && canApprove ? (
                  <span className="inline-flex gap-1.5">
                    <button type="button" disabled={decide.isPending} onClick={() => decide.mutate({ id: request.id, approve: true })} className={BTN_APPROVE}><Check size={13} /> Aprovar</button>
                    <button type="button" disabled={decide.isPending} onClick={() => decide.mutate({ id: request.id, approve: false })} className={BTN_REFUSE}><X size={13} /> Recusar</button>
                  </span>
                ) : null}
                emptyMessage={filter === "pendente" ? "Nada aguardando decisão" : "Nenhuma solicitação"}
              />
            </div>
          </section>
        </TabPanel>
      </div>

      <div hidden={tab !== "colaboradores"}>
        <TabPanel idPrefix="rh" id="colaboradores">
          <EditableTable<EmployeeRow>
            resource="hr_admin"
            label="Colaboradores"
            title="Colaboradores"
            rows={employeeRows}
            columns={employeeColumns}
            loading={employeesQuery.isLoading}
            newRow={() => ({ contract_type: "clt" })}
            onSave={saveEmployees}
            onRefresh={refresh}
            actions={<ImportExportButtons entity="employees" onImported={() => void refresh()} />}
            rowActions={(employee) => <Link to={`/hr/manage/colaboradores/${employee.id}`} className="inline-block whitespace-nowrap rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted">{canEdit ? "Abrir ficha" : "Ver ficha"}</Link>}
            emptyMessage="Nenhum colaborador cadastrado"
          />
        </TabPanel>
      </div>

      <div hidden={tab !== "comunicados"}>
        <TabPanel idPrefix="rh" id="comunicados">
          <EditableTable<HrAnnouncement>
            resource="hr_admin"
            label="Comunicados"
            title="Comunicados"
            rows={sortedAnnouncements}
            columns={announcementColumns}
            loading={announcementsQuery.isLoading}
            newRow={() => ({ category: "comunicado", pinned: 0 })}
            onSave={saveAnnouncements}
            onRefresh={refresh}
            rowActions={canDelete ? (item) => (
              <button type="button" onClick={() => void removeAnnouncement(item)} aria-label={`Remover ${item.title}`} className="rounded-md border p-1.5 text-status-danger hover:bg-muted dark:text-red-400"><Trash2 size={14} /></button>
            ) : undefined}
            emptyMessage="Nenhum comunicado"
          />
        </TabPanel>
      </div>

      <div hidden={tab !== "pendencias"}>
        <TabPanel idPrefix="rh" id="pendencias">
          <section className="space-y-3">
            <div>
              <EditableTable<HrTask>
                resource="hr_admin"
                label="Pendências"
                title="Pendências"
                rows={tasks}
                columns={taskColumns}
                loading={tasksQuery.isLoading}
                newRow={() => ({ employee_id: "todos", status: "pendente" })}
                onSave={saveTasks}
                onRefresh={refresh}
                emptyMessage="Nenhuma pendência"
              />
            </div>
          </section>
        </TabPanel>
      </div>
    </div>
  );
}
