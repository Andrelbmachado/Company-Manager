import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserMinus, UserPlus } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { emit } from "@/lib/events/bus";
import { useRequiredSession } from "@/hooks/useSession";
import { usePermission } from "@/hooks/usePermission";
import { CrudDialog } from "@/components/shared/CrudDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatCard } from "@/components/shared/StatCard";
import { cn, formatDay, todayIso } from "@/lib/utils";
import { fetchEmployees, fetchHrTasks } from "@/lib/hr/queries";
import { CONTRACT_TYPES } from "@/lib/hr/employees";
import { applyDueTerminations, cancelTermination, cycleCases, setTaskDone, startAdmission, startTermination, type CycleCase } from "@/lib/hr/employment";
import { CycleCaseCard } from "../components/CycleCaseCard";
import { TerminationDialog, type TerminationDraft } from "../components/TerminationDialog";
import { BTN_PRIMARY, BTN_SECONDARY, BTN_SMALL, DialogError, ErrorAlert, errorMessage } from "../components/hrUi";
import type { ContractType } from "@/types";

type Filter = "andamento" | "concluidos";
type Dialog = "admission" | "termination" | null;

const EMPTY_ADMISSION = { name: "", email: "", department: "", position: "", hire_date: "", contract_type: "clt" };

/** Gestão de RH > Admissões e desligamentos: checklist de entrada e de saída de cada colaborador. */
export default function EmploymentCyclePage() {
  const session = useRequiredSession();
  const qc = useQueryClient();
  const companyId = session.company.id;
  const today = todayIso();
  const canCreate = usePermission("create", "hr_admin");
  const canEdit = usePermission("edit", "hr_admin");
  const [filter, setFilter] = useState<Filter>("andamento");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [admission, setAdmission] = useState<Record<string, string>>(EMPTY_ADMISSION);
  const [error, setError] = useState("");
  const [dialogError, setDialogError] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["hr", "cycle", companyId, today],
    queryFn: async () => {
      // Desligamento agendado vira "desligado" quando a data chega (idempotente; só quem pode editar efetiva).
      if (canEdit) await applyDueTerminations(await getDb(), companyId, today);
      const [employees, tasks] = await Promise.all([fetchEmployees(companyId), fetchHrTasks(companyId)]);
      return { employees, cases: cycleCases(employees, tasks, today) };
    },
  });
  const employees = data?.employees ?? [];
  const cases = data?.cases ?? [];
  const open = cases.filter((item) => !item.complete);
  const finished = cases.filter((item) => item.complete);
  const shown = filter === "andamento" ? open : finished;
  const lateItems = open.reduce((sum, item) => sum + item.late, 0);
  const canLeave = employees.filter((employee) => employee.status !== "desligado" && !employee.termination_date);

  const refresh = () => qc.invalidateQueries({ queryKey: ["hr"] });
  const closeDialog = () => { setDialog(null); setDialogError(""); };

  const toggle = useMutation({
    mutationFn: async ({ taskId, done }: { taskId: string; done: boolean }) => setTaskDone(await getDb(), companyId, taskId, done),
    onSuccess: () => void refresh(),
    onError: (cause) => setError(errorMessage(cause)),
  });

  const admit = useMutation({
    mutationFn: async () => {
      const { name, email, department, position, hire_date, contract_type } = admission;
      const result = await startAdmission(await getDb(), companyId, { name, email, department, position, hire_date, contract_type: contract_type as ContractType }, session.user.id);
      await emit({ type: "employee.admission_started", companyId, actorId: session.user.id, entityType: "employee", entityId: result.employeeId, title: `Admissão iniciada: ${admission.name.trim()}`, module: "hr_manage" });
    },
    onSuccess: () => { void refresh(); closeDialog(); setAdmission(EMPTY_ADMISSION); setFilter("andamento"); },
    onError: (cause) => setDialogError(errorMessage(cause)),
  });

  const terminate = useMutation({
    mutationFn: async (draft: TerminationDraft) => {
      const result = await startTermination(await getDb(), companyId, draft.employeeId, draft, session.user.id, today);
      const name = employees.find((employee) => employee.id === draft.employeeId)?.name ?? "colaborador";
      await emit({ type: "employee.termination_registered", companyId, actorId: session.user.id, entityType: "employee", entityId: draft.employeeId, title: `Desligamento ${result.effective ? "registrado" : `agendado para ${formatDay(draft.date)}`}: ${name}`, module: "hr_manage" });
    },
    onSuccess: () => { void refresh(); closeDialog(); setFilter("andamento"); },
    onError: (cause) => setDialogError(errorMessage(cause)),
  });

  const cancel = useMutation({
    mutationFn: async (item: CycleCase) => {
      await cancelTermination(await getDb(), companyId, item.employee.id);
      await emit({ type: "employee.termination_cancelled", companyId, actorId: session.user.id, entityType: "employee", entityId: item.employee.id, title: `Desligamento cancelado: ${item.employee.name}`, module: "hr_manage" });
    },
    onSuccess: () => { void refresh(); setError(""); },
    onError: (cause) => setError(errorMessage(cause)),
  });

  const admissions = shown.filter((item) => item.kind === "admissao");
  const terminations = shown.filter((item) => item.kind === "desligamento");

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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Admissões e desligamentos"
        description="Cada entrada e cada saída tem um checklist com prazos contados a partir da data de início ou de saída."
        actions={canCreate ? (
          <>
            <button type="button" onClick={() => { setDialogError(""); setDialog("termination"); }} disabled={canLeave.length === 0} className={BTN_SECONDARY}><UserMinus size={14} /> Registrar desligamento</button>
            <button type="button" onClick={() => { setDialogError(""); setAdmission(EMPTY_ADMISSION); setDialog("admission"); }} className={BTN_PRIMARY}><UserPlus size={14} /> Nova admissão</button>
          </>
        ) : undefined}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Admissões em andamento" value={open.filter((item) => item.kind === "admissao").length} hint="Checklist de entrada com itens abertos" />
        <StatCard title="Desligamentos em andamento" value={open.filter((item) => item.kind === "desligamento").length} hint={`${open.filter((item) => item.kind === "desligamento" && item.employee.status !== "desligado" && !!item.employee.termination_date).length} agendado(s) para data futura`} />
        <StatCard title="Itens em atraso" value={lateItems} hint={lateItems ? "Prazo vencido nos processos abertos" : "Tudo dentro do prazo"} />
        <StatCard title="Processos concluídos" value={finished.length} hint="Checklists com todos os itens feitos" />
      </div>

      <ErrorAlert message={error} onClose={() => setError("")} />

      <div className="flex gap-2" role="group" aria-label="Mostrar processos">
        {(["andamento", "concluidos"] as const).map((value) => (
          <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)} className={cn("rounded-md border px-3 py-1.5 text-sm font-medium", filter === value ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>
            {value === "andamento" ? `Em andamento (${open.length})` : `Concluídos (${finished.length})`}
          </button>
        ))}
      </div>

      {isLoading ? <div className="h-36 animate-pulse rounded-xl border bg-card" /> : shown.length === 0 ? (
        <EmptyState
          title={filter === "andamento" ? "Nenhum processo em andamento" : "Nenhum processo concluído"}
          description={filter === "andamento" && canCreate ? "Use “Nova admissão” quando alguém for entrar e “Registrar desligamento” quando alguém for sair." : undefined}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <section aria-label="Admissões" className="space-y-3">
            <h2 className="font-bold">Admissões <span className="font-normal text-muted-foreground">({admissions.length})</span></h2>
            {admissions.length === 0 ? <p className="rounded-xl border bg-card px-5 py-6 text-sm text-muted-foreground">Nenhuma admissão {filter === "andamento" ? "em andamento" : "concluída"}.</p> : admissions.map(renderCase)}
          </section>
          <section aria-label="Desligamentos" className="space-y-3">
            <h2 className="font-bold">Desligamentos <span className="font-normal text-muted-foreground">({terminations.length})</span></h2>
            {terminations.length === 0 ? <p className="rounded-xl border bg-card px-5 py-6 text-sm text-muted-foreground">Nenhum desligamento {filter === "andamento" ? "em andamento" : "concluído"}.</p> : terminations.map(renderCase)}
          </section>
        </div>
      )}

      {dialog === "admission" && (
        <CrudDialog
          title="Nova admissão"
          fields={[
            { key: "name", label: "Nome completo", required: true },
            { key: "email", label: "E-mail", type: "email" },
            { key: "department", label: "Setor" },
            { key: "position", label: "Cargo" },
            { key: "hire_date", label: "Data de início", type: "date", required: true },
            { key: "contract_type", label: "Contrato", type: "select", options: CONTRACT_TYPES },
          ]}
          values={admission}
          onChange={(key, value) => setAdmission((current) => ({ ...current, [key]: value }))}
          onClose={closeDialog}
          onSubmit={() => admit.mutate()}
          busy={admit.isPending}
          submitLabel="Iniciar admissão"
        >
          <p className="mt-3 text-xs text-muted-foreground">Cria o cadastro e o checklist de entrada (documentos, exame admissional, contrato, acessos, integração e avaliação de experiência). O resto da ficha você completa depois.</p>
          <DialogError message={dialogError} />
        </CrudDialog>
      )}
      {dialog === "termination" && (
        <TerminationDialog
          today={today}
          employees={canLeave.map((employee) => ({ id: employee.id, name: employee.name }))}
          busy={terminate.isPending}
          error={dialogError}
          onClose={closeDialog}
          onSubmit={(draft) => terminate.mutate(draft)}
        />
      )}
    </div>
  );
}
