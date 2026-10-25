import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save, UserMinus } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { emit } from "@/lib/events/bus";
import { useRequiredSession } from "@/hooks/useSession";
import { usePermission } from "@/hooks/usePermission";
import { CalendarView } from "@/components/shared/CalendarView";
import { EditableTable, type EditableColumn, type EditableTableChanges } from "@/components/shared/EditableTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { FileAttachments } from "@/components/shared/FileAttachments";
import { PageHeader } from "@/components/shared/PageHeader";
import { KpiCard } from "@/components/shared/KpiCard";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { TabList, TabPanel } from "@/components/shared/Tabs";
import { cn, formatDay, todayIso } from "@/lib/utils";
import { fetchEmployees, fetchHrTasks, fetchRequests } from "@/lib/hr/queries";
import { REQUEST_TYPES, tenureLabel, vacationBalance } from "@/lib/hr/rules";
import { CONTRACT_LABEL, CONTRACT_TYPES, EMPLOYEE_STATUSES, emptyEmployeeInput, employeeToInput, fetchEmployee, saveEmployee, type EmployeeAddress, type EmployeeInput } from "@/lib/hr/employees";
import { cycleCases, setTaskDone, startTermination } from "@/lib/hr/employment";
import { fetchEmployeeTimeEntries, formatMinutes, parseDuration, timeBankSummary } from "@/lib/hr/timebank";
import { requestCalendarItems, saveRequestRows, saveTaskRows, saveTimeEntryRows, timeEntryCalendarItems, timeEntryRows, type TimeEntryRow } from "@/lib/hr/tableEdits";
import { CycleCaseCard } from "../components/CycleCaseCard";
import { TerminationForm, type TerminationDraft } from "../components/TerminationForm";
import { ViewSwitch, type ListOrCalendar } from "../components/ViewSwitch";
import { BTN_PRIMARY, BTN_SECONDARY, BackLink, ErrorAlert, INPUT, Notice, balanceTone, errorMessage } from "../components/hrUi";
import type { ContractType, Employee, EmployeeStatus, HrRequest, HrTask, Role } from "@/types";

const REQUEST_STATUSES = [
  { value: "pendente", label: "Pendente" },
  { value: "aprovada", label: "Aprovada" },
  { value: "recusada", label: "Recusada" },
];
const TASK_STATUSES = [
  { value: "pendente", label: "Pendente" },
  { value: "concluida", label: "Concluída" },
];

type Tab = "dados" | "ferias" | "horas" | "ciclo" | "documentos";

const TABS: { id: Tab; label: string }[] = [
  { id: "dados", label: "Dados" },
  { id: "ferias", label: "Férias e solicitações" },
  { id: "horas", label: "Banco de horas" },
  { id: "ciclo", label: "Admissão e desligamento" },
  { id: "documentos", label: "Documentos" },
];

/** Campo do formulário da ficha (rótulo em cima, ocupa 1 ou 2 colunas). */
function Field({ label, children, wide, hint }: { label: string; children: ReactNode; wide?: boolean; hint?: string }) {
  return (
    <label className={cn("space-y-1.5 text-sm font-medium", wide && "sm:col-span-2")}>
      <span>{label}</span>
      {children}
      {hint && <span className="block text-xs font-normal text-muted-foreground">{hint}</span>}
    </label>
  );
}

function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="rounded-xl border bg-card p-5">
      <legend className="px-1 text-sm font-bold">{title}</legend>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </fieldset>
  );
}

/** Ficha do colaborador (Gestão de RH): dados pessoais e de contrato, férias, banco de horas, ciclo e documentos. Sem salário. */
export default function EmployeeDetailPage() {
  const { id = "" } = useParams();
  const isNew = id === "nova";
  const session = useRequiredSession();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const companyId = session.company.id;
  const today = todayIso();
  const canCreate = usePermission("create", "hr_admin");
  const canEdit = usePermission("edit", "hr_admin");
  const canSave = isNew ? canCreate : canEdit;
  const [tab, setTab] = useState<Tab>("dados");
  const [form, setForm] = useState<EmployeeInput>(emptyEmployeeInput);
  const [journey, setJourney] = useState("8h00");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [terminating, setTerminating] = useState(false);
  const [formError, setFormError] = useState("");
  const [requestView, setRequestView] = useState<ListOrCalendar>("lista");
  const [hoursView, setHoursView] = useState<ListOrCalendar>("lista");
  const actor = { role: session.membership.role as Role, userId: session.user.id };

  const { data: employee, isLoading } = useQuery({
    queryKey: ["hr", "employee", companyId, id],
    queryFn: async () => fetchEmployee(await getDb(), companyId, id),
    enabled: !isNew,
  });
  const { data: employees = [] } = useQuery({ queryKey: ["hr", "employees", companyId], queryFn: () => fetchEmployees(companyId) });
  const { data: requests = [] } = useQuery({ queryKey: ["hr", "requests", companyId], queryFn: () => fetchRequests(companyId), enabled: !isNew });
  const { data: tasks = [] } = useQuery({ queryKey: ["hr", "tasks", companyId], queryFn: () => fetchHrTasks(companyId), enabled: !isNew });
  const { data: entries = [] } = useQuery({
    queryKey: ["hr", "employee-time", companyId, id],
    queryFn: async () => fetchEmployeeTimeEntries(await getDb(), companyId, id),
    enabled: !isNew,
  });

  // Carrega a ficha no formulário (e recarrega quando outra tela ou o próprio salvar a atualiza).
  const loadedKey = employee ? `${employee.id}|${employee.updated_at}` : isNew ? "nova" : "";
  useEffect(() => {
    if (employee) {
      setForm(employeeToInput(employee));
      setJourney(formatMinutes(Number(employee.daily_minutes) || 480, { signed: false }));
    } else if (isNew) {
      setForm(emptyEmployeeInput());
      setJourney("8h00");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedKey]);
  useEffect(() => { setTab("dados"); }, [id]);

  const myRequests = useMemo(() => requests.filter((request) => request.employee_id === id), [requests, id]);
  const myTasks = useMemo(() => tasks.filter((task) => task.employee_id === id), [tasks, id]);
  const cases = employee ? cycleCases([employee], myTasks, today) : [];
  const otherTasks = myTasks.filter((task) => task.category === "geral");
  const hours = timeBankSummary(entries);
  const year = Number(today.slice(0, 4));
  const balance = employee ? vacationBalance(employee, myRequests, year) : null;
  const managers = employees.filter((item) => item.id !== id && (item.status !== "desligado" || item.id === form.manager_employee_id));
  // "Desligado" só aparece para quem já está desligado (desligar é pelo diálogo, que gera o checklist de saída).
  const statusOptions = EMPLOYEE_STATUSES.filter((option) => option.value !== "desligado" || employee?.status === "desligado");
  const statusHint = isNew
    ? undefined
    : employee?.status === "desligado"
      ? "Para readmitir, mude para Ativo e salve: a data e o motivo do desligamento e o checklist de saída deixam de valer."
      : "Para desligar, use “Registrar desligamento” (gera o checklist de saída).";
  const canTerminate = canEdit && !!employee && employee.status !== "desligado" && !employee.termination_date;

  const refresh = () => qc.invalidateQueries({ queryKey: ["hr"] });
  const set = <K extends keyof EmployeeInput>(key: K, value: EmployeeInput[K]) => setForm((current) => ({ ...current, [key]: value }));
  const setAddress = (key: keyof EmployeeAddress, value: string) => setForm((current) => ({ ...current, address: { ...current.address, [key]: value } }));

  const save = useMutation({
    mutationFn: async () => {
      const daily = parseDuration(journey);
      if (daily === null || daily <= 0) throw new Error("Jornada diária inválida. Use 8h, 8:48 ou 6h.");
      const result = await saveEmployee(await getDb(), companyId, { ...form, daily_minutes: daily }, isNew ? null : id, today);
      await emit({ type: result.created ? "employee.created" : "employee.updated", companyId, actorId: session.user.id, entityType: "employee", entityId: result.id, title: `${result.created ? "Colaborador cadastrado" : "Ficha atualizada"}: ${form.name.trim()}`, module: "hr_manage" });
      return result;
    },
    onSuccess: (result) => {
      void refresh();
      setError("");
      setNotice(result.merged ? "Já havia uma ficha com este e-mail: ela foi completada com o que você preencheu (campos em branco mantiveram o que já estava nela)." : result.created ? "Colaborador cadastrado. Agora dá para lançar horas e anexar documentos." : "Ficha salva.");
      if (isNew) navigate(`/hr/manage/colaboradores/${result.id}`, { replace: true });
    },
    onError: (cause) => { setNotice(""); setError(errorMessage(cause)); },
  });

  const terminate = useMutation({
    mutationFn: async (draft: TerminationDraft) => {
      const result = await startTermination(await getDb(), companyId, id, draft, session.user.id, today);
      await emit({ type: "employee.termination_registered", companyId, actorId: session.user.id, entityType: "employee", entityId: id, title: `Desligamento ${result.effective ? "registrado" : `agendado para ${formatDay(draft.date)}`}: ${employee?.name ?? ""}`, module: "hr_manage" });
    },
    onSuccess: () => { void refresh(); setTerminating(false); setFormError(""); setTab("ciclo"); },
    onError: (cause) => setFormError(errorMessage(cause)),
  });

  async function saveHours(changes: EditableTableChanges<TimeEntryRow>) {
    const { created } = await saveTimeEntryRows(await getDb(), companyId, actor, changes, today, { mode: "rh", employeeId: id });
    for (const entryId of created) await emit({ type: "hr_time_entry.created", companyId, actorId: session.user.id, entityType: "hr_time_entry", entityId: entryId, title: `Banco de horas: ${employee?.name ?? "colaborador"}`, module: "hr_manage" });
  }

  async function saveRequests(changes: EditableTableChanges<HrRequest>) {
    const { created } = await saveRequestRows(await getDb(), companyId, actor, changes, today, { employeeId: id });
    for (const requestId of created) await emit({ type: "hr_request.created", companyId, actorId: session.user.id, entityType: "hr_request", entityId: requestId, title: `Solicitação registrada pelo RH: ${employee?.name ?? ""}`, module: "hr_manage" });
  }

  async function saveOtherTasks(changes: EditableTableChanges<HrTask>) {
    await saveTaskRows(await getDb(), companyId, actor, { created: changes.created.map((fields) => ({ ...fields, employee_id: id })), updated: changes.updated }, [id]);
  }

  const toggle = useMutation({
    mutationFn: async ({ taskId, done }: { taskId: string; done: boolean }) => setTaskDone(await getDb(), companyId, taskId, done),
    onSuccess: () => void refresh(),
    onError: (cause) => setError(errorMessage(cause)),
  });

  const hourRows = timeEntryRows(entries);
  const requestColumns: EditableColumn<HrRequest>[] = [
    { key: "type", header: "Tipo", kind: "select", options: REQUEST_TYPES, required: true },
    { key: "start_date", header: "Início", kind: "date", required: true },
    { key: "end_date", header: "Fim", kind: "date", required: true },
    { key: "days", header: "Dias", kind: "number", readOnly: true },
    { key: "reason", header: "Motivo", kind: "text" },
    { key: "status", header: "Status", kind: "select", options: REQUEST_STATUSES, readOnly: true, render: (request) => <StatusBadge status={request.status} tone={request.status === "aprovada" ? "success" : undefined} /> },
  ];
  const hourColumns: EditableColumn<TimeEntryRow>[] = [
    { key: "entry_date", header: "Data", kind: "date", required: true },
    { key: "hours", header: "Horas", kind: "text", required: true, placeholder: "1:30 ou -0:30", render: (entry) => <span className={cn("font-medium tabular-nums", balanceTone(entry.minutes))}>{entry.hours}</span> },
    { key: "reason", header: "Motivo", kind: "text", required: true },
    { key: "status", header: "Status", kind: "select", options: REQUEST_STATUSES, readOnly: true, render: (entry) => <StatusBadge status={entry.status} tone={entry.status === "aprovada" ? "success" : undefined} /> },
  ];
  const taskColumns: EditableColumn<HrTask>[] = [
    { key: "title", header: "Pendência", kind: "text", required: true },
    { key: "due_date", header: "Prazo", kind: "date" },
    { key: "status", header: "Status", kind: "select", options: TASK_STATUSES, required: true, render: (task) => <StatusBadge status={task.status} /> },
  ];

  const back = <BackLink to="/hr/manage">Colaboradores</BackLink>;

  if (!isNew && !isLoading && !employee) {
    return (
      <div className="space-y-4">
        {back}
        <PageHeader title="Colaborador" />
        <EmptyState title="Colaborador não encontrado" description="Ele pode ter sido removido. Volte à lista de colaboradores." />
      </div>
    );
  }

  const title = isNew ? "Novo colaborador" : employee?.name ?? "Colaborador";
  const description = isNew
    ? "Cadastre a ficha de quem já trabalha na empresa. Para quem ainda vai entrar, prefira “Nova admissão”, que já cria o checklist de entrada."
    : employee ? [employee.position, employee.department, employee.contract_type ? CONTRACT_LABEL[employee.contract_type] : null, employee.hire_date ? (employee.hire_date.slice(0, 10) > today ? `começa em ${formatDay(employee.hire_date)}` : `há ${tenureLabel(employee.hire_date, today)}`) : null].filter(Boolean).join(" · ") : undefined;

  const dataForm = (
    <form
      className="space-y-5"
      onSubmit={(event) => { event.preventDefault(); if (canSave) save.mutate(); }}
      aria-label="Dados do colaborador"
    >
      <FormSection title="Identificação">
        <Field label="Nome completo" wide><input className={INPUT} value={form.name} onChange={(event) => set("name", event.target.value)} required disabled={!canSave} /></Field>
        <Field label="E-mail"><input type="email" className={INPUT} value={form.email} onChange={(event) => set("email", event.target.value)} disabled={!canSave} /></Field>
        <Field label="CPF"><input className={INPUT} inputMode="numeric" placeholder="000.000.000-00" value={form.document} onChange={(event) => set("document", event.target.value)} disabled={!canSave} /></Field>
        <Field label="RG"><input className={INPUT} value={form.rg} onChange={(event) => set("rg", event.target.value)} disabled={!canSave} /></Field>
        <Field label="PIS/PASEP"><input className={INPUT} inputMode="numeric" value={form.pis} onChange={(event) => set("pis", event.target.value)} disabled={!canSave} /></Field>
        <Field label="Telefone"><input type="tel" className={INPUT} placeholder="(15) 99999-0000" value={form.phone} onChange={(event) => set("phone", event.target.value)} disabled={!canSave} /></Field>
        <Field label="Nascimento"><input type="date" className={INPUT} value={form.birth_date} onChange={(event) => set("birth_date", event.target.value)} disabled={!canSave} /></Field>
      </FormSection>

      <FormSection title="Contrato">
        <Field label="Setor"><input className={INPUT} value={form.department} onChange={(event) => set("department", event.target.value)} disabled={!canSave} /></Field>
        <Field label="Cargo"><input className={INPUT} value={form.position} onChange={(event) => set("position", event.target.value)} disabled={!canSave} /></Field>
        <Field label="Admissão"><input type="date" className={INPUT} value={form.hire_date} onChange={(event) => set("hire_date", event.target.value)} disabled={!canSave} /></Field>
        <Field label="Contrato">
          <select className={INPUT} value={form.contract_type} onChange={(event) => set("contract_type", event.target.value as ContractType | "")} disabled={!canSave}>
            <option value="">Não informado</option>
            {CONTRACT_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </Field>
        <Field label="Jornada diária" hint="Base do banco de horas (ex.: 8h, 8:48, 6h)."><input className={INPUT} value={journey} onChange={(event) => setJourney(event.target.value)} disabled={!canSave} /></Field>
        <Field label="Dias de férias por ano"><input type="number" min={0} max={60} className={INPUT} value={form.vacation_days_entitled} onChange={(event) => set("vacation_days_entitled", Number(event.target.value))} disabled={!canSave} /></Field>
        <Field label="Situação" hint={statusHint}>
          <select className={INPUT} value={form.status} onChange={(event) => set("status", event.target.value as EmployeeStatus)} disabled={!canSave}>
            {statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </Field>
        <Field label="Gestor direto">
          <select className={INPUT} value={form.manager_employee_id} onChange={(event) => set("manager_employee_id", event.target.value)} disabled={!canSave}>
            <option value="">Sem gestor definido</option>
            {managers.map((item: Employee) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </Field>
      </FormSection>

      <FormSection title="Endereço">
        <Field label="Logradouro" wide><input className={INPUT} value={form.address.logradouro} onChange={(event) => setAddress("logradouro", event.target.value)} disabled={!canSave} /></Field>
        <Field label="Número"><input className={INPUT} value={form.address.numero} onChange={(event) => setAddress("numero", event.target.value)} disabled={!canSave} /></Field>
        <Field label="Complemento"><input className={INPUT} value={form.address.complemento} onChange={(event) => setAddress("complemento", event.target.value)} disabled={!canSave} /></Field>
        <Field label="Bairro"><input className={INPUT} value={form.address.bairro} onChange={(event) => setAddress("bairro", event.target.value)} disabled={!canSave} /></Field>
        <Field label="Cidade"><input className={INPUT} value={form.address.cidade} onChange={(event) => setAddress("cidade", event.target.value)} disabled={!canSave} /></Field>
        <Field label="UF"><input className={INPUT} maxLength={2} placeholder="SP" value={form.address.uf} onChange={(event) => setAddress("uf", event.target.value.toUpperCase())} disabled={!canSave} /></Field>
        <Field label="CEP"><input className={INPUT} inputMode="numeric" placeholder="00000-000" value={form.address.cep} onChange={(event) => setAddress("cep", event.target.value)} disabled={!canSave} /></Field>
      </FormSection>

      <FormSection title="Contato de emergência">
        <Field label="Nome"><input className={INPUT} value={form.emergency_contact_name} onChange={(event) => set("emergency_contact_name", event.target.value)} disabled={!canSave} /></Field>
        <Field label="Telefone"><input type="tel" className={INPUT} value={form.emergency_contact_phone} onChange={(event) => set("emergency_contact_phone", event.target.value)} disabled={!canSave} /></Field>
      </FormSection>

      <fieldset className="rounded-xl border bg-card p-5">
        <legend className="px-1 text-sm font-bold">Observações</legend>
        <textarea aria-label="Observações" rows={4} className="flex w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-60" value={form.notes} onChange={(event) => set("notes", event.target.value)} disabled={!canSave} />
      </fieldset>

      {canSave && (
        <div className="flex justify-end gap-2">
          {isNew && <Link to="/hr/manage" className={BTN_SECONDARY}>Cancelar</Link>}
          <button type="submit" disabled={save.isPending || !form.name.trim()} className={BTN_PRIMARY}><Save size={14} /> {isNew ? "Cadastrar colaborador" : "Salvar ficha"}</button>
        </div>
      )}
    </form>
  );

  return (
    <div className="space-y-4">
      {back}
      <PageHeader
        title={title}
        description={description}
        className="pb-2"
        actions={canTerminate && !terminating ? <button type="button" onClick={() => { setFormError(""); setTerminating(true); }} className={BTN_SECONDARY}><UserMinus size={14} /> Registrar desligamento</button> : undefined}
      />

      {employee && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <StatusBadge status={employee.status === "ativo" ? "active" : employee.status} />
          {employee.termination_date && (
            <span className={employee.status === "desligado" ? "text-muted-foreground" : "font-medium text-amber-700 dark:text-amber-400"}>
              {employee.status === "desligado" ? "Desligado em" : "Desligamento agendado para"} {formatDay(employee.termination_date)}{employee.termination_reason ? ` · ${employee.termination_reason}` : ""}
            </span>
          )}
          {employee.email && <span className="text-muted-foreground">{employee.email}</span>}
        </div>
      )}

      <ErrorAlert message={error} onClose={() => setError("")} />
      {terminating && employee && (
        <TerminationForm today={today} employee={{ id: employee.id, name: employee.name }} busy={terminate.isPending} error={formError} onCancel={() => { setTerminating(false); setFormError(""); }} onSubmit={(draft) => terminate.mutate(draft)} />
      )}
      {notice && !error && <Notice>{notice}</Notice>}

      {isNew ? (
        canCreate ? dataForm : <EmptyState title="Sem permissão para cadastrar" description="Peça ao RH para cadastrar o colaborador." />
      ) : !employee ? (
        <div className="h-48 animate-pulse rounded-xl border bg-card" />
      ) : (
        <>
          <div>
            <TabList tabs={TABS} value={tab} onChange={setTab} label="Seções da ficha do colaborador" idPrefix="colaborador" />
          </div>
          {tab === "dados" && <TabPanel idPrefix="colaborador" id="dados">{dataForm}</TabPanel>}

          {/* Férias, banco de horas e ciclo ficam montados (só escondidos): trocar de aba ou ver o calendário não perde o rascunho das tabelas. */}
          {balance && (
            <div hidden={tab !== "ferias"}>
              <TabPanel idPrefix="colaborador" id="ferias">
                <div className="grid gap-3 sm:grid-cols-3">
                  <KpiCard title={`Férias disponíveis em ${year}`} value={`${balance.available} dias`} />
                  <KpiCard title="Aprovadas no ano" value={`${balance.used} dias`} />
                  <KpiCard title="Em análise" value={`${balance.pending} dias`} />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link to="/hr/manage" className="text-sm font-medium text-primary-text hover:underline">Decidir em Gestão de RH</Link>
                  <ViewSwitch value={requestView} onChange={setRequestView} label="Ver solicitações em" />
                </div>
                <div hidden={requestView !== "lista"}>
                  <EditableTable<HrRequest>
                    resource="hr_admin"
                    label={`Solicitações de ${employee.name}`}
                    title="Solicitações"
                    rows={myRequests}
                    columns={requestColumns}
                    newRow={() => ({ type: "ferias" })}
                    onSave={saveRequests}
                    onRefresh={refresh}
                    emptyMessage="Nenhuma solicitação. O colaborador pede férias, folgas e envia atestados pelo Meu RH; o RH também registra aqui com Adicionar."
                  />
                </div>
                {requestView === "calendario" && <CalendarView items={requestCalendarItems(myRequests, new Map([[employee.id, employee.name]]))} label={`Férias e folgas de ${employee.name}`} />}
              </TabPanel>
            </div>
          )}

          <div hidden={tab !== "horas"}>
            <TabPanel idPrefix="colaborador" id="horas">
              <div className="grid gap-3 sm:grid-cols-3">
                <KpiCard title="Saldo" value={<span className={balanceTone(hours.balance)}>{formatMinutes(hours.balance)}</span>} />
                <KpiCard title="Horas extras aprovadas" value={formatMinutes(hours.credits, { signed: false })} />
                <KpiCard title="Em análise" value={hours.pendingCount} />
              </div>
              <div className="flex justify-end"><ViewSwitch value={hoursView} onChange={setHoursView} label="Ver lançamentos em" /></div>
              <div hidden={hoursView !== "lista"}>
                <EditableTable<TimeEntryRow>
                  resource="hr_admin"
                  label={`Banco de horas de ${employee.name}`}
                  title="Lançamentos"
                  rows={hourRows}
                  columns={hourColumns}
                  newRow={() => ({ entry_date: today })}
                  onSave={saveHours}
                  onRefresh={refresh}
                  emptyMessage="Nenhum lançamento no banco de horas. Adicionar lança já aprovado (1:30 = hora extra, -0:30 = compensação)."
                />
              </div>
              {hoursView === "calendario" && <CalendarView items={timeEntryCalendarItems(hourRows, new Map([[employee.id, employee.name]]))} label={`Banco de horas de ${employee.name}`} />}
            </TabPanel>
          </div>

          <div hidden={tab !== "ciclo"}>
            <TabPanel idPrefix="colaborador" id="ciclo">
              {cases.length === 0 ? (
                <EmptyState title="Sem processo de admissão ou desligamento" description="Admissões iniciadas em “Admissões e desligamentos” e desligamentos registrados aqui aparecem com o checklist." />
              ) : (
                <div className="grid gap-4 lg:grid-cols-2">
                  {cases.map((item) => (
                    <CycleCaseCard key={item.kind} item={item} today={today} canEdit={canEdit} busy={toggle.isPending} onToggle={(taskId, done) => toggle.mutate({ taskId, done })} />
                  ))}
                </div>
              )}
              <EditableTable<HrTask>
                resource="hr_admin"
                label={`Outras pendências de ${employee.name}`}
                title="Outras pendências"
                rows={otherTasks}
                columns={taskColumns}
                newRow={() => ({ status: "pendente" })}
                onSave={saveOtherTasks}
                onRefresh={refresh}
                emptyMessage="Nenhuma outra pendência. Adicionar pede um documento, treinamento ou atualização a esta pessoa."
              />
            </TabPanel>
          </div>

          {tab === "documentos" && <TabPanel idPrefix="colaborador" id="documentos"><FileAttachments entityType="employee" entityId={employee.id} canEdit={canEdit} /></TabPanel>}
        </>
      )}

    </div>
  );
}
