import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlarmClock, CalendarCheck, CheckSquare, Mail, Pencil, Phone, Plus, RotateCcw, StickyNote, Trash2, Users } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { getDb } from "@/lib/db/client";
import {
  ACTIVITY_KIND_LABELS,
  ACTIVITY_KINDS,
  activityState,
  completeActivity,
  createActivity,
  deleteActivity,
  fetchOverdueFollowUps,
  reopenActivity,
  updateActivity,
  type ActivityFilter,
} from "@/lib/crm/activities";
import { cn } from "@/lib/utils";
import type { CrmActivity, CrmActivityKind, CrmEntityType } from "@/types";
import { ENTITY_LABELS, entityHref, formatWhen, fromLocalInput, toLocalInput } from "./format";
import { ConfirmDialog, errorText, Modal } from "./Modal";
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, CARD, INPUT, LINK, SELECT, TEXTAREA, TONE_CLASS } from "./ui";
import { useActivities, useAudit, useCompanyUsers, useCrmSession, useCustomers, useEntityNames, useInvalidateCrm } from "./useCrm";

const KIND_ICONS: Record<CrmActivityKind, typeof Phone> = {
  ligacao: Phone,
  email: Mail,
  reuniao: Users,
  tarefa: CheckSquare,
  nota: StickyNote,
};

export interface ActivityEntity {
  type: CrmEntityType;
  id: string;
  customerId?: string | null;
}

interface ActivityFormDialogProps {
  activity?: CrmActivity | null;
  /** Registro dono da atividade nova. Sem ele, a pessoa escolhe o cliente. */
  entity?: ActivityEntity | null;
  onClose: () => void;
}

export function ActivityFormDialog({ activity, entity, onClose }: ActivityFormDialogProps) {
  const { companyId, userId } = useCrmSession();
  const invalidate = useInvalidateCrm();
  const audit = useAudit();
  const { data: users = [] } = useCompanyUsers();
  const { data: customers = [] } = useCustomers(!activity && !entity);
  const [kind, setKind] = useState<CrmActivityKind>(activity?.kind ?? "ligacao");
  const [subject, setSubject] = useState(activity?.subject ?? "");
  const [body, setBody] = useState(activity?.body ?? "");
  const [due, setDue] = useState(toLocalInput(activity?.due_at));
  const [owner, setOwner] = useState(activity?.user_id ?? userId);
  const [customerId, setCustomerId] = useState("");
  const [done, setDone] = useState(false);
  const [outcome, setOutcome] = useState(activity?.outcome ?? "");
  const isNote = kind === "nota";

  const mutation = useMutation({
    mutationFn: async () => {
      const db = await getDb();
      if (activity) {
        await updateActivity(db, companyId, activity.id, { kind, subject, body, due_at: isNote ? null : fromLocalInput(due), user_id: owner, outcome: activity.done_at ? outcome : activity.outcome ?? null });
        await audit("crm_activity.updated", "crm_activity", activity.id, `Atividade editada: ${subject || ACTIVITY_KIND_LABELS[kind]}`);
        return activity.id;
      }
      const target: ActivityEntity | null = entity ?? (customerId ? { type: "customer", id: customerId } : null);
      if (!target) throw new Error("Escolha o cliente da atividade.");
      const id = await createActivity(db, companyId, userId, {
        entity_type: target.type,
        entity_id: target.id,
        customer_id: target.customerId ?? null,
        kind,
        subject,
        body,
        due_at: isNote ? null : fromLocalInput(due),
        user_id: owner,
        done: isNote || done,
        outcome: done ? outcome : null,
      });
      await audit("crm_activity.created", "crm_activity", id, `Atividade criada: ${subject || ACTIVITY_KIND_LABELS[kind]}`);
      return id;
    },
    onSuccess: () => {
      invalidate("activities");
      onClose();
    },
  });

  return (
    <Modal
      title={activity ? "Editar atividade" : "Nova atividade"}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={BTN_SECONDARY}>Cancelar</button>
          <button type="button" onClick={() => mutation.mutate()} disabled={mutation.isPending || (!subject.trim() && !body.trim()) || (!activity && !entity && !customerId)} className={BTN_PRIMARY}>
            Salvar
          </button>
        </>
      }
    >
      <div className="grid gap-4 text-sm sm:grid-cols-2">
        {!activity && !entity && (
          <label className="space-y-1.5 font-medium sm:col-span-2">
            Cliente
            <select value={customerId} onChange={(event) => setCustomerId(event.target.value)} className={`${SELECT} w-full font-normal`}>
              <option value="">Escolha o cliente…</option>
              {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
            </select>
          </label>
        )}
        <label className="space-y-1.5 font-medium">
          Tipo
          <select value={kind} onChange={(event) => setKind(event.target.value as CrmActivityKind)} className={`${SELECT} w-full font-normal`}>
            {ACTIVITY_KINDS.map((option) => <option key={option} value={option}>{ACTIVITY_KIND_LABELS[option]}</option>)}
          </select>
        </label>
        <label className="space-y-1.5 font-medium">
          Responsável
          <select value={owner} onChange={(event) => setOwner(event.target.value)} className={`${SELECT} w-full font-normal`}>
            {users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
            {!users.some((user) => user.id === owner) && <option value={owner}>—</option>}
          </select>
        </label>
        <label className="space-y-1.5 font-medium sm:col-span-2">
          Assunto
          <input value={subject} onChange={(event) => setSubject(event.target.value)} className={`${INPUT} font-normal`} placeholder="Ex.: Ligar para apresentar a proposta" />
        </label>
        <label className="space-y-1.5 font-medium sm:col-span-2">
          Descrição
          <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={3} className={`${TEXTAREA} font-normal`} />
        </label>
        {!isNote && (
          <label className="space-y-1.5 font-medium">
            Prazo (follow-up)
            <input type="datetime-local" value={due} onChange={(event) => setDue(event.target.value)} className={`${INPUT} font-normal`} />
          </label>
        )}
        {!activity && !isNote && (
          <label className="flex items-center gap-2 self-end pb-2">
            <input type="checkbox" checked={done} onChange={(event) => setDone(event.target.checked)} /> Já foi feita
          </label>
        )}
        {((!activity && done && !isNote) || (activity?.done_at && !isNote)) && (
          <label className="space-y-1.5 font-medium sm:col-span-2">
            Resultado
            <input value={outcome} onChange={(event) => setOutcome(event.target.value)} className={`${INPUT} font-normal`} placeholder="Ex.: Pediu nova proposta com desconto" />
          </label>
        )}
        {mutation.error && <p role="alert" className="text-destructive sm:col-span-2">{errorText(mutation.error)}</p>}
      </div>
    </Modal>
  );
}

/** Concluir uma atividade, com o resultado opcional. */
export function CompleteActivityDialog({ activity, onClose }: { activity: CrmActivity; onClose: () => void }) {
  const { companyId } = useCrmSession();
  const invalidate = useInvalidateCrm();
  const audit = useAudit();
  const [outcome, setOutcome] = useState("");
  const mutation = useMutation({
    mutationFn: async () => {
      await completeActivity(await getDb(), companyId, activity.id, outcome);
      await audit("crm_activity.completed", "crm_activity", activity.id, `Atividade concluída: ${activity.subject ?? ACTIVITY_KIND_LABELS[activity.kind]}`);
    },
    onSuccess: () => {
      invalidate("activities");
      onClose();
    },
  });
  return (
    <Modal
      title="Concluir atividade"
      description={activity.subject ?? ACTIVITY_KIND_LABELS[activity.kind]}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={BTN_SECONDARY}>Cancelar</button>
          <button type="button" onClick={() => mutation.mutate()} disabled={mutation.isPending} className={BTN_PRIMARY}>Concluir</button>
        </>
      }
    >
      <label className="block space-y-1.5 text-sm font-medium">
        Resultado (opcional)
        <input value={outcome} onChange={(event) => setOutcome(event.target.value)} className={`${INPUT} font-normal`} placeholder="Ex.: Cliente pediu retorno na sexta" />
      </label>
      {mutation.error && <p role="alert" className="mt-3 text-sm text-destructive">{errorText(mutation.error)}</p>}
    </Modal>
  );
}

const STATE_BADGE = {
  feita: { label: "Feita", tone: "success" },
  atrasada: { label: "Atrasada", tone: "danger" },
  hoje: { label: "Hoje", tone: "warning" },
  pendente: { label: "Pendente", tone: "info" },
} as const;

export function ActivityStateBadge({ activity }: { activity: Pick<CrmActivity, "done_at" | "due_at"> }) {
  const badge = STATE_BADGE[activityState(activity)];
  return <span className={cn("inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-semibold", TONE_CLASS[badge.tone])}>{badge.label}</span>;
}

interface ActivityItemProps {
  activity: CrmActivity;
  /** Mostrar a que registro a atividade pertence (lista geral e ficha do cliente). */
  showEntity?: boolean;
  userName?: string | null;
  entityName?: string | null;
  customerName?: string | null;
  onEdit?: () => void;
  onComplete?: () => void;
  onReopen?: () => void;
  onDelete?: () => void;
}

export function ActivityItem({ activity, showEntity, userName, entityName, customerName, onEdit, onComplete, onReopen, onDelete }: ActivityItemProps) {
  const Icon = KIND_ICONS[activity.kind] ?? StickyNote;
  const href = entityHref(activity.entity_type, activity.entity_id, activity.customer_id);
  const meta: ReactNode[] = [];
  if (activity.due_at && !activity.done_at) meta.push(<span key="due" className="inline-flex items-center gap-1"><AlarmClock size={12} aria-hidden="true" /> {formatWhen(activity.due_at)}</span>);
  if (activity.done_at) meta.push(<span key="done" className="inline-flex items-center gap-1"><CalendarCheck size={12} aria-hidden="true" /> {formatWhen(activity.done_at)}</span>);
  if (userName) meta.push(<span key="user">{userName}</span>);
  return (
    <li className="flex gap-3 py-3">
      <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground", activityState(activity) === "atrasada" && "bg-status-danger text-white")}>
        <Icon size={15} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium">{activity.subject ?? ACTIVITY_KIND_LABELS[activity.kind]}</p>
          <span className="text-xs text-muted-foreground">{ACTIVITY_KIND_LABELS[activity.kind]}</span>
          {activity.kind !== "nota" && <ActivityStateBadge activity={activity} />}
        </div>
        {activity.body && <p className="whitespace-pre-line text-sm text-muted-foreground">{activity.body}</p>}
        {activity.outcome && <p className="text-sm"><span className="text-muted-foreground">Resultado:</span> {activity.outcome}</p>}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {meta}
          {!activity.due_at && !activity.done_at && <span>Criada em {formatWhen(activity.created_at)}</span>}
          {showEntity && (
            <span>
              {ENTITY_LABELS[activity.entity_type]}:{" "}
              {href ? <Link to={href} className={LINK}>{entityName ?? "abrir"}</Link> : entityName ?? "—"}
              {customerName && activity.entity_type !== "customer" && activity.customer_id && (
                <> · <Link to={`/crm/clientes/${activity.customer_id}`} className={LINK}>{customerName}</Link></>
              )}
            </span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-start gap-1">
        {onComplete && !activity.done_at && <button type="button" onClick={onComplete} className={BTN_GHOST}><CheckSquare size={12} /> Concluir</button>}
        {onReopen && activity.done_at && activity.kind !== "nota" && <button type="button" onClick={onReopen} className={BTN_GHOST} aria-label="Reabrir"><RotateCcw size={12} /></button>}
        {onEdit && <button type="button" onClick={onEdit} className={BTN_GHOST} aria-label="Editar atividade"><Pencil size={12} /></button>}
        {onDelete && <button type="button" onClick={onDelete} className={BTN_GHOST} aria-label="Excluir atividade"><Trash2 size={12} /></button>}
      </div>
    </li>
  );
}

/** Ações (concluir, reabrir, editar, excluir) de uma lista de atividades, com os diálogos. */
export function useActivityActions() {
  const { companyId, can } = useCrmSession();
  const invalidate = useInvalidateCrm();
  const audit = useAudit();
  const [editing, setEditing] = useState<CrmActivity | null>(null);
  const [completing, setCompleting] = useState<CrmActivity | null>(null);
  const [removing, setRemoving] = useState<CrmActivity | null>(null);
  const reopen = useMutation({
    mutationFn: async (activity: CrmActivity) => reopenActivity(await getDb(), companyId, activity.id),
    onSuccess: () => invalidate("activities"),
  });
  const remove = useMutation({
    mutationFn: async (activity: CrmActivity) => {
      await deleteActivity(await getDb(), companyId, activity.id);
      await audit("crm_activity.deleted", "crm_activity", activity.id, `Atividade excluída: ${activity.subject ?? ACTIVITY_KIND_LABELS[activity.kind]}`);
    },
    onSuccess: () => {
      invalidate("activities");
      setRemoving(null);
    },
  });
  const canEdit = can("edit", "crm_activities");
  const canDelete = can("delete", "crm_activities");
  const handlers = (activity: CrmActivity) => ({
    onEdit: canEdit ? () => setEditing(activity) : undefined,
    onComplete: canEdit ? () => setCompleting(activity) : undefined,
    onReopen: canEdit ? () => reopen.mutate(activity) : undefined,
    onDelete: canDelete ? () => setRemoving(activity) : undefined,
  });
  const dialogs = (
    <>
      {editing && <ActivityFormDialog activity={editing} onClose={() => setEditing(null)} />}
      {completing && <CompleteActivityDialog activity={completing} onClose={() => setCompleting(null)} />}
      {removing && (
        <ConfirmDialog
          title="Excluir atividade"
          message={`Excluir "${removing.subject ?? ACTIVITY_KIND_LABELS[removing.kind]}"?`}
          confirmLabel="Excluir"
          danger
          busy={remove.isPending}
          error={errorText(remove.error)}
          onConfirm={() => remove.mutate(removing)}
          onClose={() => setRemoving(null)}
        />
      )}
    </>
  );
  return { handlers, dialogs };
}

interface ActivityTimelineProps {
  filter: ActivityFilter;
  /** Dono das atividades novas criadas aqui. */
  entity: ActivityEntity;
  showEntity?: boolean;
  title?: string;
}

/** Linha do tempo de um registro: atividades pendentes primeiro (prazo mais próximo), depois o histórico. */
export function ActivityTimeline({ filter, entity, showEntity, title = "Atividades" }: ActivityTimelineProps) {
  const { can } = useCrmSession();
  const { data: activities = [], isLoading } = useActivities(filter);
  const { names } = useCompanyUsers();
  const entityNames = useEntityNames();
  const { handlers, dialogs } = useActivityActions();
  const [creating, setCreating] = useState(false);
  const pending = activities
    .filter((activity) => !activity.done_at)
    .sort((a, b) => String(a.due_at ?? "9999").localeCompare(String(b.due_at ?? "9999")));
  const history = activities.filter((activity) => activity.done_at);

  const item = (activity: CrmActivity) => (
    <ActivityItem
      key={activity.id}
      activity={activity}
      showEntity={showEntity && activity.entity_type !== entity.type}
      userName={activity.user_id ? names.get(activity.user_id) : null}
      entityName={entityNames.name(activity.entity_type, activity.entity_id)}
      {...handlers(activity)}
    />
  );

  return (
    <section className={cn(CARD, "p-5")} aria-label={title}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">{title}</h2>
        {can("create", "crm_activities") && (
          <button type="button" onClick={() => setCreating(true)} className={BTN_SECONDARY}>
            <Plus size={14} /> Nova atividade
          </button>
        )}
      </div>
      {isLoading ? (
        <div className="mt-4 h-24 animate-pulse rounded-lg bg-muted/30" />
      ) : activities.length === 0 ? (
        <EmptyState icon={CalendarCheck} title="Nenhuma atividade" description="Registre ligações, reuniões e próximos passos para não perder o follow-up." className="py-8" />
      ) : (
        <div className="mt-2">
          {pending.length > 0 && (
            <>
              <h3 className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">A fazer</h3>
              <ul className="divide-y">{pending.map(item)}</ul>
            </>
          )}
          {history.length > 0 && (
            <>
              <h3 className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Histórico</h3>
              <ul className="divide-y">{history.map(item)}</ul>
            </>
          )}
        </div>
      )}
      {creating && <ActivityFormDialog entity={entity} onClose={() => setCreating(false)} />}
      {dialogs}
    </section>
  );
}

/**
 * Follow-ups atrasados (pendentes com prazo vencido). `userId` = só os da pessoa; null = de todos.
 * Também é o widget "crm.followups" da home por setor (src/modules/dashboard/pages/DashboardPage.tsx).
 */
export function OverdueFollowUps({ userId, limit = 6, className }: { userId: string | null; limit?: number; className?: string }) {
  const { companyId, can } = useCrmSession();
  const { names } = useCompanyUsers();
  const entityNames = useEntityNames();
  const { handlers, dialogs } = useActivityActions();
  const { data: overdue = [], isLoading } = useQuery({
    queryKey: ["overdue-follow-ups", companyId, userId ?? "todos"],
    queryFn: async () => fetchOverdueFollowUps(await getDb(), companyId, userId),
    refetchInterval: 60_000,
  });
  if (!can("view", "crm_activities")) return null;
  return (
    <section className={cn(CARD, "p-5", className)} aria-label="Follow-ups atrasados">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <AlarmClock size={16} aria-hidden="true" /> Follow-ups atrasados
          {overdue.length > 0 && <span className="rounded-md bg-status-danger px-1.5 py-0.5 text-xs font-semibold text-white">{overdue.length}</span>}
        </h2>
        <Link to="/crm/atividades?estado=atrasada" className={cn(LINK, "text-sm")}>Ver todas</Link>
      </div>
      {isLoading ? (
        <div className="mt-4 h-16 animate-pulse rounded-lg bg-muted/30" />
      ) : overdue.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Nenhum follow-up atrasado. Tudo em dia.</p>
      ) : (
        <ul className="mt-1 divide-y">
          {overdue.slice(0, limit).map((activity) => (
            <ActivityItem
              key={activity.id}
              activity={activity}
              showEntity
              userName={userId ? null : activity.user_id ? names.get(activity.user_id) : null}
              entityName={entityNames.name(activity.entity_type, activity.entity_id)}
              customerName={entityNames.customer(activity.customer_id)}
              onComplete={handlers(activity).onComplete}
            />
          ))}
        </ul>
      )}
      {dialogs}
    </section>
  );
}
