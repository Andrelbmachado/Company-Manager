import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "@/lib/db/client";
import { emit } from "@/lib/events/bus";
import { usePermission } from "@/hooks/usePermission";
import { useRequiredSession } from "@/hooks/useSession";
import { hasFullTicketAccess } from "@/lib/permissions/rbac";
import { EditableTable, type EditableColumn, type EditableTableChanges } from "@/components/shared/EditableTable";
import { ImportExportButtons } from "@/components/shared/ImportExportButtons";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { cn, formatDateTime } from "@/lib/utils";
import { saveTicketChanges, TICKET_PRIORITY_OPTIONS, TICKET_STATUS_OPTIONS, type TicketFields } from "@/lib/support/tickets";
import { ArrowLeft, Building2, CheckCircle2, HeadphonesIcon, Pencil, RotateCcw, Save, UserRound, Wrench, X } from "lucide-react";
import type { Role, Ticket } from "@/types";

interface TicketView extends Ticket {
  opener_name?: string | null;
  agent_name?: string | null;
}

interface TicketActivity {
  id: string;
  actor_id?: string | null;
  action: string;
  title?: string | null;
  description?: string | null;
  actor_name?: string | null;
  created_at: string;
}

const STATUS_FILTERS = [
  { value: "all", label: "Todos" },
  { value: "aberto", label: "Abertos" },
  { value: "em_atendimento", label: "Em atendimento" },
  { value: "aguardando", label: "Aguardando" },
  { value: "resolvido", label: "Resolvidos" },
];

const INPUT = "flex h-9 w-full rounded-md border bg-background px-3 text-sm font-normal outline-none focus:ring-2 focus:ring-ring";
const BUTTON = "flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50";

/** Suporte: tickets numa tabela editável (abrir e alterar no próprio lugar) e a ficha de cada ticket com a linha do tempo. */
export default function SupportPage() {
  const session = useRequiredSession();
  const role = session.membership.role as Role;
  const companyId = session.company.id;
  const qc = useQueryClient();
  const canEditTicket = usePermission("edit", "tickets");
  const canCreateWorkOrder = usePermission("create", "work_orders");
  const canViewAllTickets = hasFullTicketAccess(role);
  const [selectedTicket, setSelectedTicket] = useState<TicketView | null>(null);
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState("");
  const [filter, setFilter] = useState("all");
  const [form, setForm] = useState({ subject: "", description: "", priority: "media" });

  const ticketsQuery = useQuery({
    queryKey: ["tickets", companyId, session.user.id, canViewAllTickets],
    queryFn: async () => {
      const db = await getDb();
      return db.select<TicketView[]>(
        `SELECT t.*, opener.name as opener_name, agent.name as agent_name
         FROM tickets t
         LEFT JOIN users opener ON opener.id = t.opened_by
         LEFT JOIN users agent ON agent.id = t.agent_id
         WHERE t.company_id=? ${canViewAllTickets ? "" : "AND t.opened_by=?"} AND t.deleted_at IS NULL
         ORDER BY t.created_at DESC`,
        canViewAllTickets ? [companyId] : [companyId, session.user.id]
      );
    },
  });
  const tickets = ticketsQuery.data ?? [];

  const { data: timeline = [], isLoading: loadingTimeline } = useQuery({
    queryKey: ["ticket-timeline", companyId, selectedTicket?.id],
    enabled: Boolean(selectedTicket),
    queryFn: async () => {
      const db = await getDb();
      return db.select<TicketActivity[]>(
        `SELECT a.*, u.name as actor_name
         FROM activities a
         LEFT JOIN users u ON u.id = a.actor_id
         WHERE a.company_id=? AND a.entity_type='ticket' AND a.entity_id=?
         ORDER BY a.created_at ASC`,
        [companyId, selectedTicket!.id]
      );
    },
  });

  const refreshTickets = () => qc.invalidateQueries({ queryKey: ["tickets", companyId] });

  /** Grava pela camada de dados (confere a permissão de novo) e registra cada ticket aberto ou alterado no histórico. */
  async function persist(changes: { updated: (TicketFields & { id: string })[]; created: TicketFields[] }) {
    const db = await getDb();
    const result = await saveTicketChanges(db, companyId, { role, userId: session.user.id }, changes);
    for (const [index, id] of result.created.entries()) {
      await emit({ type: "ticket.created", companyId, actorId: session.user.id, entityType: "ticket", entityId: id, title: "Ticket aberto", description: changes.created[index].subject ?? undefined, module: "support" });
    }
    for (const fields of changes.updated) {
      const status = fields.status ? TICKET_STATUS_OPTIONS.find((option) => option.value === fields.status)?.label : null;
      await emit({ type: "ticket.updated", companyId, actorId: session.user.id, entityType: "ticket", entityId: fields.id, title: status ? `Status: ${status}` : "Ticket atualizado", module: "support", newValue: fields });
    }
  }

  async function saveTable(changes: EditableTableChanges<TicketView>) {
    await persist({
      created: changes.created.map((row) => ({ subject: row.subject, description: row.description, priority: row.priority, status: row.status })),
      updated: changes.updated.map(({ id, subject, description, priority, status }) => withoutUndefined({ id, subject, description, priority, status })),
    });
  }

  const updateMutation = useMutation({
    mutationFn: async (ticket: TicketView) => {
      const fields: TicketFields & { id: string } = { id: ticket.id };
      if (form.subject.trim() !== ticket.subject) fields.subject = form.subject;
      if ((form.description.trim() || null) !== (ticket.description ?? null)) fields.description = form.description;
      if (form.priority !== ticket.priority) fields.priority = form.priority as Ticket["priority"];
      if (Object.keys(fields).length > 1) await persist({ created: [], updated: [fields] });
      return { ...ticket, subject: form.subject.trim(), description: form.description.trim() || null, priority: form.priority as Ticket["priority"] };
    },
    onSuccess: (ticket) => {
      setSelectedTicket(ticket);
      setEditing(false);
      setEditError("");
      void refreshTickets();
      void qc.invalidateQueries({ queryKey: ["ticket-timeline", companyId, ticket.id] });
    },
    onError: (error) => setEditError(error instanceof Error ? error.message : String(error)),
  });

  const convertToWOMutation = useMutation({
    mutationFn: async (ticket: TicketView) => {
      const db = await getDb();
      const woId = uuidv4();
      const woCount = await db.select<[{ n: number }]>("SELECT COUNT(*) as n FROM work_orders WHERE company_id=?", [companyId]);
      const number = `OS-${String(woCount[0].n + 1).padStart(4, "0")}`;
      await db.execute(
        "INSERT INTO work_orders (id, company_id, number, customer_id, ticket_id, technician_id, priority) VALUES (?,?,?,?,?,?,?)",
        [woId, companyId, number, ticket.customer_id ?? null, ticket.id, session.user.id, ticket.priority]
      );
      await db.execute("UPDATE tickets SET work_order_id=?, status='resolvido', updated_at=datetime('now') WHERE id=?", [woId, ticket.id]);
      await emit({ type: "ticket.converted_to_work_order", companyId, actorId: session.user.id, entityType: "ticket", entityId: ticket.id, title: `Ticket convertido em ${number}`, module: "support" });
      return { ...ticket, work_order_id: woId, status: "resolvido" as const };
    },
    onSuccess: (ticket) => {
      setSelectedTicket(ticket);
      void refreshTickets();
      void qc.invalidateQueries({ queryKey: ["ticket-timeline", companyId, ticket.id] });
      void qc.invalidateQueries({ queryKey: ["work-orders", companyId] });
    },
  });

  const reopenMutation = useMutation({
    mutationFn: async (ticket: TicketView) => {
      const db = await getDb();
      await db.execute("UPDATE tickets SET status='aberto', updated_at=datetime('now') WHERE id=?", [ticket.id]);
      await emit({ type: "ticket.reopened", companyId, actorId: session.user.id, entityType: "ticket", entityId: ticket.id, title: `Ticket reaberto por ${session.user.name}`, module: "support" });
      return { ...ticket, status: "aberto" as const };
    },
    onSuccess: (ticket) => {
      setSelectedTicket(ticket);
      void refreshTickets();
      void qc.invalidateQueries({ queryKey: ["ticket-timeline", companyId, ticket.id] });
    },
  });

  const filtered = filter === "all" ? tickets : tickets.filter((ticket) => ticket.status === filter);

  const columns: EditableColumn<TicketView>[] = [
    {
      key: "subject",
      header: "Assunto",
      kind: "text",
      required: true,
      render: (ticket) => (
        <button type="button" onClick={() => { setEditing(false); setSelectedTicket(ticket); }} className="text-left font-medium hover:underline">
          {ticket.subject}
        </button>
      ),
    },
    { key: "priority", header: "Prioridade", kind: "select", options: TICKET_PRIORITY_OPTIONS, required: true, render: (ticket) => <StatusBadge status={ticket.priority} /> },
    { key: "status", header: "Status", kind: "select", options: TICKET_STATUS_OPTIONS, required: true, render: (ticket) => <StatusBadge status={ticket.status} /> },
    { key: "description", header: "Descrição", kind: "text", placeholder: "Detalhes (opcional)" },
    { key: "requester_area", header: "Área", kind: "text", readOnly: true },
    { key: "opener_name", header: "Aberto por", kind: "text", readOnly: true },
    { key: "created_at", header: "Aberto em", kind: "text", readOnly: true, render: (ticket) => <span className="whitespace-nowrap text-muted-foreground">{formatDateTime(ticket.created_at)}</span> },
  ];

  if (selectedTicket) {
    const canReopen =
      ["resolvido", "fechado"].includes(selectedTicket.status) &&
      (selectedTicket.opened_by === session.user.id || selectedTicket.agent_id === session.user.id || timeline.some((activity) => activity.actor_id === session.user.id) || canViewAllTickets);

    return (
      <div className="space-y-6">
        <button onClick={() => { setSelectedTicket(null); setEditing(false); }} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft size={15} />
          Voltar para tickets
        </button>

        <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-6">
          <div className="min-w-0 flex-1">
            <div className="mb-3 flex items-center gap-2">
              {editing ? (
                <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  Prioridade
                  <select aria-label="Prioridade" value={form.priority} onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value }))} className={cn(INPUT, "h-8 w-36")}>
                    {TICKET_PRIORITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
              ) : (
                <StatusBadge status={selectedTicket.priority} />
              )}
              <StatusBadge status={selectedTicket.status} />
            </div>
            {editing ? (
              <input aria-label="Assunto" value={form.subject} onChange={(event) => setForm((current) => ({ ...current, subject: event.target.value }))} className={cn(INPUT, "h-10 max-w-xl text-lg font-semibold")} />
            ) : (
              <h1 className="text-2xl font-semibold tracking-tight">{selectedTicket.subject}</h1>
            )}
            <p className="mt-1 text-sm text-muted-foreground">Aberto em {formatDateTime(selectedTicket.created_at)}</p>
          </div>
          <div className="flex gap-2">
            {editing ? (
              <>
                <button type="button" onClick={() => { setEditing(false); setEditError(""); }} className={BUTTON}>
                  <X size={14} /> Cancelar
                </button>
                <button type="button" disabled={updateMutation.isPending || !form.subject.trim()} onClick={() => updateMutation.mutate(selectedTicket)} className="flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                  <Save size={14} /> Salvar
                </button>
              </>
            ) : (
              <>
                {canEditTicket && (
                  <button type="button" onClick={() => { setForm({ subject: selectedTicket.subject, description: selectedTicket.description ?? "", priority: selectedTicket.priority }); setEditError(""); setEditing(true); }} className={BUTTON}>
                    <Pencil size={14} /> Editar
                  </button>
                )}
                {canReopen && (
                  <button type="button" onClick={() => reopenMutation.mutate(selectedTicket)} className={BUTTON}>
                    <RotateCcw size={14} />
                    Reabrir ticket
                  </button>
                )}
                {canCreateWorkOrder && !selectedTicket.work_order_id && !["resolvido", "fechado"].includes(selectedTicket.status) && (
                  <button type="button" onClick={() => convertToWOMutation.mutate(selectedTicket)} className="flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                    <Wrench size={14} />
                    Criar OS
                  </button>
                )}
              </>
            )}
          </div>
        </div>
        {editError && <p role="alert" className="text-sm font-medium text-destructive">{editError}</p>}

        <div className="grid gap-8 lg:grid-cols-[1fr_18rem]">
          <section>
            <h2 className="mb-4 text-sm font-semibold">Linha do tempo</h2>
            {loadingTimeline ? (
              <div className="h-28 animate-pulse rounded-lg bg-muted/40" />
            ) : timeline.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma atividade registrada neste ticket.</p>
            ) : (
              <div className="space-y-0">
                {timeline.map((activity, index) => (
                  <div key={activity.id} className="relative flex gap-3 pb-6">
                    {index < timeline.length - 1 && <div className="absolute left-3 top-7 h-full w-px bg-border" />}
                    <div className="z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border bg-background text-primary-text">
                      <CheckCircle2 size={13} />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{activity.title ?? activity.action}</p>
                      {activity.description && <p className="mt-1 text-sm text-muted-foreground">{activity.description}</p>}
                      <p className="mt-1 text-xs text-muted-foreground">
                        {activity.actor_name ?? "Sistema"} · {formatDateTime(activity.created_at)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <aside className="space-y-5 border-l pl-6">
            <Info label="Área solicitante" value={selectedTicket.requester_area ?? "Não informada"} icon={Building2} />
            <Info label="Aberto por" value={selectedTicket.opener_name ?? "Não informado"} icon={UserRound} />
            <Info label="Técnico responsável" value={selectedTicket.agent_name ?? "Aguardando atribuição"} icon={Wrench} />
            <Info label="Canal" value={selectedTicket.channel} icon={HeadphonesIcon} />
            <div>
              <p className="text-xs font-medium text-muted-foreground">Descrição</p>
              {editing ? (
                <textarea aria-label="Descrição" rows={5} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} className="mt-1 flex w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
              ) : (
                <p className="mt-1 text-sm leading-relaxed">{selectedTicket.description ?? "Sem descrição adicional."}</p>
              )}
            </div>
          </aside>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Suporte"
        description="Tickets"
        actions={<ImportExportButtons entity="tickets" onImported={() => void refreshTickets()} />}
      />

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por status">
        {STATUS_FILTERS.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-pressed={filter === item.value}
            onClick={() => setFilter(item.value)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${filter === item.value ? "bg-primary text-primary-foreground" : "border hover:bg-muted"}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <EditableTable<TicketView>
        resource="tickets"
        label="Tickets"
        title="Tickets"
        rows={filtered}
        columns={columns}
        loading={ticketsQuery.isLoading}
        newRow={() => ({ priority: "media", status: "aberto" })}
        onSave={saveTable}
        onRefresh={() => ticketsQuery.refetch()}
        emptyMessage={filter === "all" ? "Nenhum ticket. Use Adicionar para abrir um." : "Nenhum ticket com este status."}
      />
    </div>
  );
}

/** Tira as chaves que a tabela não mandou (undefined), para gravar só o que mudou. */
function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function Info({ label, value, icon: Icon }: { label: string; value: string; icon: React.ElementType }) {
  return (
    <div className="flex gap-3">
      <Icon size={15} className="mt-0.5 shrink-0 text-muted-foreground" />
      <div>
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="mt-0.5 text-sm">{value}</p>
      </div>
    </div>
  );
}
