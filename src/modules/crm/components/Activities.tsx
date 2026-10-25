// Atividades do CRM (ligações, e-mails, reuniões, tarefas e notas). Lista e linha do tempo são EditableTable: Editar
// muda assunto, prazo (dia + hora), responsável e resultado; a coluna Feita conclui ou reabre; Adicionar registra a
// atividade na própria tabela. Os follow-ups atrasados (home e Clientes) concluem com um clique.
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlarmClock, CalendarCheck, CheckSquare, ExternalLink, Mail, Phone, StickyNote, Trash2, Users } from "lucide-react";
import { EditableTable, type EditableColumn, type EditableTableChanges } from "@/components/shared/EditableTable";
import { activityRowFrom, saveActivityRows, type ActivityEntity, type ActivityRow } from "@/lib/commercial/crmEdits";
import { confirmAction } from "@/lib/confirm";
import { getDb } from "@/lib/db/client";
import { ACTIVITY_KIND_LABELS, ACTIVITY_KINDS, activityState, completeActivity, deleteActivity, fetchOverdueFollowUps, type ActivityFilter } from "@/lib/crm/activities";
import { cn } from "@/lib/utils";
import { ROW_ACTION, ROW_DANGER, refreshQueries, useEditActor } from "@/modules/catalog/components/inline";
import type { CrmActivity, CrmActivityKind } from "@/types";
import { ENTITY_LABELS, entityHref, formatWhen } from "./format";
import { errorText } from "./Modal";
import { BTN_GHOST, CARD, LINK, TONE_CLASS } from "./ui";
import { useActivities, useAudit, useCompanyUsers, useCrmSession, useCustomers, useEntityNames, useInvalidateCrm } from "./useCrm";

export type { ActivityEntity } from "@/lib/commercial/crmEdits";

const KIND_ICONS: Record<CrmActivityKind, typeof Phone> = {
  ligacao: Phone,
  email: Mail,
  reuniao: Users,
  tarefa: CheckSquare,
  nota: StickyNote,
};

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
  /** Mostrar a que registro a atividade pertence. */
  showEntity?: boolean;
  userName?: string | null;
  entityName?: string | null;
  customerName?: string | null;
  onComplete?: () => void;
  completing?: boolean;
}

/** Uma atividade em lista compacta (follow-ups atrasados). */
export function ActivityItem({ activity, showEntity, userName, entityName, customerName, onComplete, completing }: ActivityItemProps) {
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
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {meta}
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
      {onComplete && !activity.done_at && (
        <div className="flex shrink-0 items-start">
          <button type="button" onClick={onComplete} disabled={completing} className={BTN_GHOST}><CheckSquare size={12} /> Concluir</button>
        </div>
      )}
    </li>
  );
}

interface ActivitiesTableProps {
  activities: CrmActivity[];
  loading?: boolean;
  /** Dono das atividades novas (ficha do cliente, oportunidade). Sem ele, a linha nova escolhe o cliente. */
  entity?: ActivityEntity;
  /** Coluna "Registro" (a que cliente/oportunidade/proposta a atividade pertence). */
  showEntity?: boolean;
  title: string;
  emptyMessage?: string;
}

/** Tabela editável de atividades (lista do CRM e linhas do tempo). */
export function ActivitiesTable({ activities, loading, entity, showEntity, title, emptyMessage }: ActivitiesTableProps) {
  const { companyId, userId, can } = useCrmSession();
  const actor = useEditActor();
  const qc = useQueryClient();
  const invalidate = useInvalidateCrm();
  const audit = useAudit();
  const { data: users = [], names } = useCompanyUsers();
  const { data: customers = [] } = useCustomers(!entity);
  const entityNames = useEntityNames();
  const rows = activities.map(activityRowFrom);
  const label = (row: Pick<CrmActivity, "subject" | "kind">) => row.subject ?? ACTIVITY_KIND_LABELS[row.kind];
  const remove = useMutation({
    mutationFn: async (activity: CrmActivity) => {
      await deleteActivity(await getDb(), companyId, activity.id);
      await audit("crm_activity.deleted", "crm_activity", activity.id, `Atividade excluída: ${label(activity)}`);
    },
    onSuccess: () => invalidate("activities"),
  });

  const customerColumn: EditableColumn<ActivityRow> = {
    key: "customer_id",
    header: "Cliente",
    kind: "select",
    width: 180,
    options: customers.map((customer) => ({ value: customer.id, label: customer.name })),
    render: (row) => (row.customer_id ? <Link to={`/crm/clientes/${row.customer_id}`} className={LINK}>{entityNames.customer(row.customer_id) ?? "Cliente"}</Link> : <span className="text-muted-foreground">—</span>),
  };
  const entityColumn: EditableColumn<ActivityRow> = {
    key: "entity_id",
    header: "Registro",
    kind: "text",
    readOnly: true,
    sortValue: (row) => `${ENTITY_LABELS[row.entity_type]}: ${entityNames.name(row.entity_type, row.entity_id) ?? ""}`,
    render: (row) => {
      const href = entityHref(row.entity_type, row.entity_id, row.customer_id);
      const name = entityNames.name(row.entity_type, row.entity_id);
      return (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {ENTITY_LABELS[row.entity_type]}: {href ? <Link to={href} className={LINK}>{name ?? "abrir"}</Link> : name ?? "—"}
        </span>
      );
    },
  };
  const columns: EditableColumn<ActivityRow>[] = [
    {
      key: "kind",
      header: "Tipo",
      kind: "select",
      required: true,
      options: ACTIVITY_KINDS.map((kind) => ({ value: kind, label: ACTIVITY_KIND_LABELS[kind] })),
      render: (row) => {
        const Icon = KIND_ICONS[row.kind] ?? StickyNote;
        return <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-muted-foreground"><Icon size={14} aria-hidden="true" /> {ACTIVITY_KIND_LABELS[row.kind]}</span>;
      },
    },
    { key: "subject", header: "Assunto", kind: "text", width: 220, placeholder: "Ex.: Ligar para apresentar a proposta", sortValue: label, render: (row) => <span className="font-medium">{label(row)}</span> },
    { key: "body", header: "Descrição", kind: "text", width: 200, render: (row) => <span className="line-clamp-2 text-muted-foreground">{row.body ?? "—"}</span> },
    ...(entity ? [] : [customerColumn]),
    { key: "due_day", header: "Prazo", kind: "date", render: (row) => <span className={cn("whitespace-nowrap", activityState(row) === "atrasada" ? "font-semibold text-destructive" : "text-muted-foreground")}>{row.due_at ? formatWhen(row.due_at) : "—"}</span> },
    { key: "due_time", header: "Hora", kind: "text", width: 80, placeholder: "09:00", render: (row) => <span className="text-muted-foreground">{row.due_time ?? "—"}</span> },
    { key: "user_id", header: "Responsável", kind: "select", options: users.map((user) => ({ value: user.id, label: user.name })), render: (row) => <span className="whitespace-nowrap text-muted-foreground">{row.user_id ? names.get(row.user_id) ?? "—" : "—"}</span> },
    { key: "done", header: "Feita", kind: "bool" },
    { key: "outcome", header: "Resultado", kind: "text", placeholder: "Ex.: Pediu nova proposta" },
    {
      key: "done_at",
      header: "Situação",
      kind: "select",
      readOnly: true,
      sortValue: (row) => (row.kind === "nota" ? "Nota" : STATE_BADGE[activityState(row)].label),
      render: (row) => (row.kind === "nota" ? <span className="text-xs text-muted-foreground">Nota</span> : <ActivityStateBadge activity={row} />),
    },
    ...(showEntity ? [entityColumn] : []),
  ];

  async function save(changes: EditableTableChanges<ActivityRow>) {
    const result = await saveActivityRows(await getDb(), companyId, actor, changes, { entity });
    const byId = new Map(activities.map((activity) => [activity.id, activity]));
    for (const id of result.updated) {
      const before = byId.get(id);
      await audit("crm_activity.updated", "crm_activity", id, `Atividade editada: ${before ? label(before) : ""}`);
    }
    for (const [index, id] of result.created.entries()) {
      const row = changes.created[index];
      await audit("crm_activity.created", "crm_activity", id, `Atividade criada: ${row?.subject ?? (row?.kind ? ACTIVITY_KIND_LABELS[row.kind] : "")}`);
    }
    invalidate("activities");
  }

  return (
    <EditableTable<ActivityRow>
      resource="crm_activities"
      title={title}
      label={title}
      rows={rows}
      columns={columns}
      loading={loading}
      onSave={save}
      onRefresh={() => refreshQueries(qc, ["crm-activities", "overdue-follow-ups"])}
      newRow={() => ({ kind: "ligacao", user_id: userId, done: 0 })}
      emptyMessage={emptyMessage ?? "Nenhuma atividade"}
      rowActions={(row) => {
        const href = showEntity ? entityHref(row.entity_type, row.entity_id, row.customer_id) : null;
        return (
          <span className="flex items-center gap-1">
            {href && (
              <Link to={href} className={ROW_ACTION} aria-label={`Abrir registro de ${label(row)}`}>
                <ExternalLink size={13} /> Abrir
              </Link>
            )}
            {can("delete", "crm_activities") && (
              <button
                type="button"
                className={ROW_DANGER}
                disabled={remove.isPending}
                aria-label={`Excluir atividade ${label(row)}`}
                onClick={async () => {
                  if (await confirmAction(`Excluir "${label(row)}"?`, { title: "Excluir atividade", okLabel: "Excluir" })) remove.mutate(row);
                }}
              >
                <Trash2 size={13} />
              </button>
            )}
          </span>
        );
      }}
    />
  );
}

interface ActivityTimelineProps {
  filter: ActivityFilter;
  /** Dono das atividades novas criadas aqui. */
  entity: ActivityEntity;
  showEntity?: boolean;
  title?: string;
}

/** Linha do tempo de um registro: pendentes primeiro (prazo mais próximo), depois o histórico, numa tabela editável. */
export function ActivityTimeline({ filter, entity, showEntity, title = "Atividades" }: ActivityTimelineProps) {
  const { data: activities = [], isLoading } = useActivities(filter);
  const pending = activities.filter((activity) => !activity.done_at).sort((a, b) => String(a.due_at ?? "9999").localeCompare(String(b.due_at ?? "9999")));
  const history = activities.filter((activity) => activity.done_at);
  return <ActivitiesTable activities={[...pending, ...history]} loading={isLoading} entity={entity} showEntity={showEntity} title={title} />;
}

/**
 * Follow-ups atrasados (pendentes com prazo vencido). `userId` = só os da pessoa; null = de todos. Concluir grava na
 * hora (o resultado pode ser anotado depois na tabela de atividades).
 * Também é o widget "crm.followups" da home por setor (src/modules/dashboard/pages/DashboardPage.tsx).
 */
export function OverdueFollowUps({ userId, limit = 6, className, actions }: { userId: string | null; limit?: number; className?: string; actions?: ReactNode }) {
  const { companyId, can } = useCrmSession();
  const { names } = useCompanyUsers();
  const entityNames = useEntityNames();
  const invalidate = useInvalidateCrm();
  const audit = useAudit();
  const [completingId, setCompletingId] = useState<string | null>(null);
  const { data: overdue = [], isLoading } = useQuery({
    queryKey: ["overdue-follow-ups", companyId, userId ?? "todos"],
    queryFn: async () => fetchOverdueFollowUps(await getDb(), companyId, userId),
    refetchInterval: 60_000,
  });
  const complete = useMutation({
    mutationFn: async (activity: CrmActivity) => {
      setCompletingId(activity.id);
      await completeActivity(await getDb(), companyId, activity.id, null);
      await audit("crm_activity.completed", "crm_activity", activity.id, `Atividade concluída: ${activity.subject ?? ACTIVITY_KIND_LABELS[activity.kind]}`);
    },
    onSettled: () => {
      setCompletingId(null);
      invalidate("activities");
    },
  });
  if (!can("view", "crm_activities")) return null;
  const canComplete = can("edit", "crm_activities");
  return (
    <section className={cn(CARD, "p-5", className)} aria-label="Follow-ups atrasados">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <AlarmClock size={16} aria-hidden="true" /> Follow-ups atrasados
          {overdue.length > 0 && <span className="rounded-md bg-status-danger px-1.5 py-0.5 text-xs font-semibold text-white">{overdue.length}</span>}
        </h2>
        <div className="flex items-center gap-2">
          {actions}
          <Link to="/crm/atividades?estado=atrasada" className={cn(LINK, "text-sm")}>Ver todas</Link>
        </div>
      </div>
      {complete.error && <p role="alert" className="mt-2 text-sm text-destructive">{errorText(complete.error)}</p>}
      {isLoading ? (
        <div className="mt-4 h-16 animate-pulse rounded-lg bg-muted/30" />
      ) : overdue.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Tudo em dia.</p>
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
              onComplete={canComplete ? () => complete.mutate(activity) : undefined}
              completing={completingId === activity.id}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
