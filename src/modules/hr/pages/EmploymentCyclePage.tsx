import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserMinus } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { emit } from "@/lib/events/bus";
import { useRequiredSession } from "@/hooks/useSession";
import { usePermission } from "@/hooks/usePermission";
import { CalendarView } from "@/components/shared/CalendarView";
import { EditableTable, type EditableColumn, type EditableTableChanges } from "@/components/shared/EditableTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { KpiCard } from "@/components/shared/KpiCard";
import { PageHeader } from "@/components/shared/PageHeader";
import { cn, formatDay, todayIso } from "@/lib/utils";
import { fetchEmployees, fetchHrTasks } from "@/lib/hr/queries";
import { CONTRACT_TYPES } from "@/lib/hr/employees";
import { applyDueTerminations, cancelTermination, checkAdmissions, cycleCases, setTaskDone, startAdmission, startTermination, type AdmissionInput, type CycleCase } from "@/lib/hr/employment";
import { saveEmployeeRows, taskCalendarItems } from "@/lib/hr/tableEdits";
import { CycleCaseCard } from "../components/CycleCaseCard";
import { TerminationForm, type TerminationDraft } from "../components/TerminationForm";
import { ViewSwitch, type ListOrCalendar } from "../components/ViewSwitch";
import { BTN_SECONDARY, BTN_SMALL, ErrorAlert, errorMessage } from "../components/hrUi";
import type { ContractType, Employee, Role } from "@/types";

type Filter = "andamento" | "concluidos";
type AdmissionRow = Employee & { checklist: string };

/**
 * Gestão de RH > Admissões e desligamentos: admissões numa EditableTable (Adicionar inicia a admissão com o
 * checklist), desligamento num formulário no próprio lugar e os checklists de cada processo, também no calendário.
 */
export default function EmploymentCyclePage() {
  const session = useRequiredSession();
  const qc = useQueryClient();
  const companyId = session.company.id;
  const role = session.membership.role as Role;
  const today = todayIso();
  const canCreate = usePermission("create", "hr_admin");
  const canEdit = usePermission("edit", "hr_admin");
  const [filter, setFilter] = useState<Filter>("andamento");
  const [view, setView] = useState<ListOrCalendar>("lista");
  const [terminating, setTerminating] = useState(false);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["hr", "cycle", companyId, today],
    queryFn: async () => {
      // Desligamento agendado vira "desligado" quando a data chega (idempotente; só quem pode editar efetiva).
      if (canEdit) await applyDueTerminations(await getDb(), companyId, today);
      const [employees, tasks] = await Promise.all([fetchEmployees(companyId), fetchHrTasks(companyId)]);
      return { employees, cases: cycleCases(employees, tasks, today) };
    },
  });
  const employees = useMemo(() => data?.employees ?? [], [data]);
  const cases = useMemo(() => data?.cases ?? [], [data]);
  const names = useMemo(() => new Map(employees.map((employee) => [employee.id, employee.name])), [employees]);
  const open = cases.filter((item) => !item.complete);
  const finished = cases.filter((item) => item.complete);
  const shown = filter === "andamento" ? open : finished;
  const lateItems = open.reduce((sum, item) => sum + item.late, 0);
  const canLeave = employees.filter((employee) => employee.status !== "desligado" && !employee.termination_date);
  const admissions = shown.filter((item) => item.kind === "admissao");
  const terminations = shown.filter((item) => item.kind === "desligamento");
  const admissionRows: AdmissionRow[] = admissions.map((item) => ({ ...item.employee, checklist: `${item.done} de ${item.total} itens${item.late ? ` (${item.late} em atraso)` : ""}` }));

  const refresh = () => qc.invalidateQueries({ queryKey: ["hr"] });

  const toggle = useMutation({
    mutationFn: async ({ taskId, done }: { taskId: string; done: boolean }) => setTaskDone(await getDb(), companyId, taskId, done),
    onSuccess: () => void refresh(),
    onError: (cause) => setError(errorMessage(cause)),
  });

  async function saveAdmissions(changes: EditableTableChanges<AdmissionRow>) {
    const db = await getDb();
    const admissions: AdmissionInput[] = changes.created.map((fields) => ({
      name: String(fields.name ?? ""),
      email: String(fields.email ?? ""),
      department: String(fields.department ?? ""),
      position: String(fields.position ?? ""),
      hire_date: String(fields.hire_date ?? ""),
      contract_type: (fields.contract_type ?? "") as ContractType | "",
    }));
    // Tudo conferido antes da primeira escrita: se falhar, a tabela mantém as linhas e nada fica gravado pela metade.
    await checkAdmissions(db, companyId, role, admissions);
    if (changes.updated.length) await saveEmployeeRows(db, companyId, role, { created: [], updated: changes.updated }, today);
    for (const admission of admissions) {
      const result = await startAdmission(db, companyId, admission, session.user.id);
      await emit({ type: "employee.admission_started", companyId, actorId: session.user.id, entityType: "employee", entityId: result.employeeId, title: `Admissão iniciada: ${admission.name.trim()}`, module: "hr_manage" });
    }
    if (changes.created.length) setFilter("andamento");
  }

  const terminate = useMutation({
    mutationFn: async (draft: TerminationDraft) => {
      if (!canCreate) throw new Error("Seu perfil não tem permissão para registrar desligamentos.");
      const result = await startTermination(await getDb(), companyId, draft.employeeId, draft, session.user.id, today);
      await emit({ type: "employee.termination_registered", companyId, actorId: session.user.id, entityType: "employee", entityId: draft.employeeId, title: `Desligamento ${result.effective ? "registrado" : `agendado para ${formatDay(draft.date)}`}: ${names.get(draft.employeeId) ?? "colaborador"}`, module: "hr_manage" });
    },
    onSuccess: () => { void refresh(); setTerminating(false); setFormError(""); setFilter("andamento"); },
    onError: (cause) => setFormError(errorMessage(cause)),
  });

  const cancel = useMutation({
    mutationFn: async (item: CycleCase) => {
      await cancelTermination(await getDb(), companyId, item.employee.id);
      await emit({ type: "employee.termination_cancelled", companyId, actorId: session.user.id, entityType: "employee", entityId: item.employee.id, title: `Desligamento cancelado: ${item.employee.name}`, module: "hr_manage" });
    },
    onSuccess: () => { void refresh(); setError(""); },
    onError: (cause) => setError(errorMessage(cause)),
  });

  const renderCase = (item: CycleCase) => (
    <CycleCaseCard
      key={`${item.employee.id}-${item.kind}`}
      item={item}
      today={today}
      canEdit={canEdit}
      busy={toggle.isPending}
      linkEmployee
      onToggle={(taskId, done) => toggle.mutate({ taskId, done })}
      actions={item.kind === "desligamento" && item.employee.status !== "desligado" && !!item.employee.termination_date && canEdit
        ? <button type="button" disabled={cancel.isPending} onClick={() => cancel.mutate(item)} className={BTN_SMALL}>Cancelar desligamento agendado</button>
        : undefined}
    />
  );

  const admissionColumns: EditableColumn<AdmissionRow>[] = [
    { key: "name", header: "Nome completo", kind: "text", required: true, render: (employee) => <Link to={`/hr/manage/colaboradores/${employee.id}`} className="font-medium hover:underline">{employee.name}</Link> },
    { key: "email", header: "E-mail", kind: "email" },
    { key: "department", header: "Setor", kind: "text" },
    { key: "position", header: "Cargo", kind: "text" },
    { key: "hire_date", header: "Data de início", kind: "date", required: true },
    { key: "contract_type", header: "Contrato", kind: "select", options: CONTRACT_TYPES },
    { key: "checklist", header: "Checklist", kind: "text", readOnly: true },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Admissões e desligamentos"
        actions={canCreate && !terminating ? (
          <button type="button" onClick={() => { setFormError(""); setTerminating(true); }} disabled={canLeave.length === 0} className={BTN_SECONDARY}><UserMinus size={14} /> Registrar desligamento</button>
        ) : undefined}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard title="Admissões em andamento" value={open.filter((item) => item.kind === "admissao").length} />
        <KpiCard title="Desligamentos em andamento" value={open.filter((item) => item.kind === "desligamento").length} />
        <KpiCard title="Itens em atraso" value={lateItems} />
        <KpiCard title="Processos concluídos" value={finished.length} />
      </div>

      <ErrorAlert message={error} onClose={() => setError("")} />

      {terminating && (
        <TerminationForm
          today={today}
          employees={canLeave.map((employee) => ({ id: employee.id, name: employee.name }))}
          busy={terminate.isPending}
          error={formError}
          onCancel={() => { setTerminating(false); setFormError(""); }}
          onSubmit={(draft) => terminate.mutate(draft)}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2" role="group" aria-label="Mostrar processos">
          {(["andamento", "concluidos"] as const).map((value) => (
            <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)} className={cn("rounded-md border px-3 py-1.5 text-sm font-medium", filter === value ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>
              {value === "andamento" ? `Em andamento (${open.length})` : `Concluídos (${finished.length})`}
            </button>
          ))}
        </div>
        <ViewSwitch value={view} onChange={setView} label="Ver checklists em" />
      </div>

      <EditableTable<AdmissionRow>
        resource="hr_admin"
        label="Admissões"
        title="Admissões"
        rows={admissionRows}
        columns={admissionColumns}
        loading={isLoading}
        newRow={() => ({ contract_type: "clt" })}
        onSave={saveAdmissions}
        onRefresh={refresh}
        emptyMessage="Nenhuma admissão"
      />

      {view === "calendario" ? (
        <CalendarView items={taskCalendarItems(shown.flatMap((item) => item.tasks), names)} label="Prazos dos checklists" />
      ) : isLoading ? <div className="h-36 animate-pulse rounded-xl border bg-card" /> : shown.length === 0 ? (
        <EmptyState title={filter === "andamento" ? "Nenhum processo em andamento" : "Nenhum processo concluído"} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <section aria-label="Checklists de admissão" className="space-y-3">
            <h2 className="font-bold">Admissões <span className="font-normal text-muted-foreground">({admissions.length})</span></h2>
            {admissions.length === 0 ? <p className="rounded-xl border bg-card px-5 py-6 text-sm text-muted-foreground">Nenhuma admissão</p> : admissions.map(renderCase)}
          </section>
          <section aria-label="Desligamentos" className="space-y-3">
            <h2 className="font-bold">Desligamentos <span className="font-normal text-muted-foreground">({terminations.length})</span></h2>
            {terminations.length === 0 ? <p className="rounded-xl border bg-card px-5 py-6 text-sm text-muted-foreground">Nenhum desligamento</p> : terminations.map(renderCase)}
          </section>
        </div>
      )}
    </div>
  );
}
