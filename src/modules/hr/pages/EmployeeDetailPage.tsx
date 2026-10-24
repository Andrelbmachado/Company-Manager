import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Save, UserMinus } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { emit } from "@/lib/events/bus";
import { useRequiredSession } from "@/hooks/useSession";
import { usePermission } from "@/hooks/usePermission";
import { EmptyState } from "@/components/shared/EmptyState";
import { FileAttachments } from "@/components/shared/FileAttachments";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatCard } from "@/components/shared/StatCard";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { TabList, TabPanel } from "@/components/shared/Tabs";
import { cn, formatDay, todayIso } from "@/lib/utils";
import { fetchEmployees, fetchHrTasks, fetchRequests } from "@/lib/hr/queries";
import { REQUEST_TYPE_LABEL, tenureLabel, vacationBalance } from "@/lib/hr/rules";
import { CONTRACT_LABEL, CONTRACT_TYPES, EMPLOYEE_STATUSES, emptyEmployeeInput, employeeToInput, fetchEmployee, saveEmployee, type EmployeeAddress, type EmployeeInput } from "@/lib/hr/employees";
import { cycleCases, setTaskDone, startTermination } from "@/lib/hr/employment";
import { addTimeEntry, fetchEmployeeTimeEntries, formatMinutes, parseDuration, timeBankSummary } from "@/lib/hr/timebank";
import { CycleCaseCard } from "../components/CycleCaseCard";
import { TerminationDialog, type TerminationDraft } from "../components/TerminationDialog";
import { TimeEntryDialog, type TimeEntryDraft } from "../components/TimeEntryDialog";
import { BTN_PRIMARY, BTN_SECONDARY, BackLink, ErrorAlert, INPUT, Notice, Panel, TH, balanceTone, errorMessage } from "../components/hrUi";
import type { ContractType, Employee, EmployeeStatus } from "@/types";

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
  const [dialog, setDialog] = useState<"termination" | "hours" | null>(null);
  const [dialogError, setDialogError] = useState("");

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
  const statusOptions = EMPLOYEE_STATUSES.filter((option) => option.value !== "desligado" || form.status === "desligado");
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
      setNotice(result.merged ? "Já havia um cadastro com este e-mail (criado no primeiro acesso ao Meu RH): a ficha dele foi completada." : result.created ? "Colaborador cadastrado. Agora dá para lançar horas e anexar documentos." : "Ficha salva.");
      if (isNew) navigate(`/hr/manage/colaboradores/${result.id}`, { replace: true });
    },
    onError: (cause) => { setNotice(""); setError(errorMessage(cause)); },
  });

  const terminate = useMutation({
    mutationFn: async (draft: TerminationDraft) => {
      const result = await startTermination(await getDb(), companyId, id, draft, session.user.id, today);
      await emit({ type: "employee.termination_registered", companyId, actorId: session.user.id, entityType: "employee", entityId: id, title: `Desligamento ${result.effective ? "registrado" : `agendado para ${formatDay(draft.date)}`}: ${employee?.name ?? ""}`, module: "hr_manage" });
    },
    onSuccess: () => { void refresh(); setDialog(null); setDialogError(""); setTab("ciclo"); },
    onError: (cause) => setDialogError(errorMessage(cause)),
  });

  const launch = useMutation({
    mutationFn: async (draft: TimeEntryDraft) => {
      const entryId = await addTimeEntry(await getDb(), companyId, { ...draft, employeeId: id }, session.user.id, today, session.user.id);
      await emit({ type: "hr_time_entry.created", companyId, actorId: session.user.id, entityType: "hr_time_entry", entityId: entryId, title: `Banco de horas: ${employee?.name ?? "colaborador"} ${formatMinutes(draft.minutes ?? 0)}`, module: "hr_manage" });
    },
    onSuccess: () => { void refresh(); setDialog(null); setDialogError(""); },
    onError: (cause) => setDialogError(errorMessage(cause)),
  });

  const toggle = useMutation({
    mutationFn: async ({ taskId, done }: { taskId: string; done: boolean }) => setTaskDone(await getDb(), companyId, taskId, done),
    onSuccess: () => void refresh(),
    onError: (cause) => setError(errorMessage(cause)),
  });

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
    : employee ? [employee.position, employee.department, employee.contract_type ? CONTRACT_LABEL[employee.contract_type] : null, employee.hire_date ? `há ${tenureLabel(employee.hire_date, today)}` : null].filter(Boolean).join(" · ") : undefined;

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
        <Field label="Situação" hint={form.status === "desligado" ? undefined : "Para desligar, use “Registrar desligamento” (gera o checklist de saída)."}>
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
        actions={canTerminate ? <button type="button" onClick={() => { setDialogError(""); setDialog("termination"); }} className={BTN_SECONDARY}><UserMinus size={14} /> Registrar desligamento</button> : undefined}
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
      {notice && !error && <Notice>{notice}</Notice>}

      {isNew ? (
        canCreate ? dataForm : <EmptyState title="Sem permissão para cadastrar" description="Peça ao RH para cadastrar o colaborador." />
      ) : !employee ? (
        <div className="h-48 animate-pulse rounded-xl border bg-card" />
      ) : (
        <>
          <div className="overflow-x-auto border-b">
            <TabList tabs={TABS} value={tab} onChange={setTab} label="Seções da ficha do colaborador" idPrefix="colaborador" />
          </div>
          <TabPanel idPrefix="colaborador" id={tab}>
            {tab === "dados" && dataForm}

            {tab === "ferias" && balance && (
              <>
                <div className="grid gap-3 sm:grid-cols-3">
                  <StatCard title={`Férias disponíveis em ${year}`} value={`${balance.available} dias`} hint={`${balance.entitled} de direito por ano`} />
                  <StatCard title="Aprovadas no ano" value={`${balance.used} dias`} hint="Férias que começam neste ano" />
                  <StatCard title="Em análise" value={`${balance.pending} dias`} hint="Pedidos aguardando o RH" />
                </div>
                <Panel title="Solicitações" actions={<Link to="/hr/manage" className="text-sm font-medium text-primary-text hover:underline">Decidir em Gestão de RH</Link>}>
                  {myRequests.length === 0 ? <p className="px-5 py-6 text-sm text-muted-foreground">Nenhuma solicitação. O colaborador pede férias, folgas e envia atestados pelo Meu RH.</p> : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-muted"><tr>{["Tipo", "Período", "Dias", "Motivo", "Status"].map((h) => <th key={h} className={TH}>{h}</th>)}</tr></thead>
                        <tbody className="divide-y">
                          {myRequests.map((request) => (
                            <tr key={request.id}>
                              <td className="px-4 py-3 font-medium">{REQUEST_TYPE_LABEL[request.type]}</td>
                              <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDay(request.start_date)} a {formatDay(request.end_date)}</td>
                              <td className="px-4 py-3 tabular-nums">{request.days}</td>
                              <td className="max-w-64 truncate px-4 py-3 text-muted-foreground">{request.reason ?? "—"}</td>
                              <td className="px-4 py-3"><StatusBadge status={request.status} tone={request.status === "aprovada" ? "success" : undefined} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Panel>
              </>
            )}

            {tab === "horas" && (
              <>
                <div className="grid gap-3 sm:grid-cols-3">
                  <StatCard title="Saldo" value={<span className={balanceTone(hours.balance)}>{formatMinutes(hours.balance)}</span>} hint={`Jornada de ${formatMinutes(Number(employee.daily_minutes) || 480, { signed: false })} por dia`} />
                  <StatCard title="Horas extras aprovadas" value={formatMinutes(hours.credits, { signed: false })} hint={`${formatMinutes(hours.debits, { signed: false })} compensadas`} />
                  <StatCard title="Em análise" value={hours.pendingCount} hint={hours.pendingCount ? `${formatMinutes(hours.pending)} aguardando aprovação` : "Nada aguardando"} />
                </div>
                <Panel
                  title="Lançamentos"
                  actions={canCreate && employee.status !== "desligado" ? <button type="button" onClick={() => { setDialogError(""); setDialog("hours"); }} className={BTN_PRIMARY}><Plus size={14} /> Lançar horas</button> : undefined}
                >
                  {entries.length === 0 ? <p className="px-5 py-6 text-sm text-muted-foreground">Nenhum lançamento no banco de horas.</p> : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-muted"><tr>{["Data", "Horas", "Motivo", "Status"].map((h) => <th key={h} className={TH}>{h}</th>)}</tr></thead>
                        <tbody className="divide-y">
                          {entries.map((entry) => (
                            <tr key={entry.id}>
                              <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDay(entry.entry_date)}</td>
                              <td className={cn("px-4 py-3 font-medium tabular-nums", balanceTone(entry.minutes))}>{formatMinutes(entry.minutes)}</td>
                              <td className="max-w-72 truncate px-4 py-3 text-muted-foreground">{entry.reason ?? "—"}</td>
                              <td className="px-4 py-3"><StatusBadge status={entry.status} tone={entry.status === "aprovada" ? "success" : undefined} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Panel>
              </>
            )}

            {tab === "ciclo" && (
              <>
                {cases.length === 0 ? (
                  <EmptyState title="Sem processo de admissão ou desligamento" description="Admissões iniciadas em “Admissões e desligamentos” e desligamentos registrados aqui aparecem com o checklist." />
                ) : (
                  <div className="grid gap-4 lg:grid-cols-2">
                    {cases.map((item) => (
                      <CycleCaseCard key={item.kind} item={item} today={today} canEdit={canEdit} busy={toggle.isPending} onToggle={(taskId, done) => toggle.mutate({ taskId, done })} />
                    ))}
                  </div>
                )}
                {otherTasks.length > 0 && (
                  <Panel title="Outras pendências">
                    <ul className="divide-y">
                      {otherTasks.map((task) => (
                        <li key={task.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                          <span className={cn(task.status === "concluida" && "text-muted-foreground line-through")}>{task.title}</span>
                          <span className="flex items-center gap-2 text-xs text-muted-foreground">{task.due_date ? `prazo ${formatDay(task.due_date)}` : "sem prazo"}<StatusBadge status={task.status} /></span>
                        </li>
                      ))}
                    </ul>
                  </Panel>
                )}
              </>
            )}

            {tab === "documentos" && <FileAttachments entityType="employee" entityId={employee.id} canEdit={canEdit} />}
          </TabPanel>
        </>
      )}

      {dialog === "termination" && employee && (
        <TerminationDialog today={today} employee={{ id: employee.id, name: employee.name }} busy={terminate.isPending} error={dialogError} onClose={() => setDialog(null)} onSubmit={(draft) => terminate.mutate(draft)} />
      )}
      {dialog === "hours" && employee && (
        <TimeEntryDialog
          title={`Lançar horas para ${employee.name}`}
          today={today}
          employeeId={employee.id}
          busy={launch.isPending}
          error={dialogError}
          help="Lançado pelo RH, já entra aprovado no saldo."
          onClose={() => setDialog(null)}
          onSubmit={(draft) => launch.mutate(draft)}
        />
      )}
    </div>
  );
}
