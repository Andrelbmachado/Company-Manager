import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { v4 as uuidv4 } from "uuid";
import { getDb } from "@/lib/db/client";
import { emit } from "@/lib/events/bus";
import { usePermission } from "@/hooks/usePermission";
import { useRequiredSession } from "@/hooks/useSession";
import { hasFullTicketAccess, ROLE_LABELS } from "@/lib/permissions/rbac";
import { EmptyState } from "@/components/shared/EmptyState";
import { CrudDialog } from "@/components/shared/CrudDialog";
import { ImportExportButtons } from "@/components/shared/ImportExportButtons";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { formatDateTime, initials } from "@/lib/utils";
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  Clock3,
  HeadphonesIcon,
  Plus,
  Pencil,
  RotateCcw,
  UserRound,
  Wrench,
} from "lucide-react";
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

export default function SupportPage() {
  const session = useRequiredSession();
  const role = session.membership.role as Role;
  const qc = useQueryClient();
  const canCreateTicket = usePermission("create", "tickets");
  const canEditTicket = usePermission("edit", "tickets");
  const canCreateWorkOrder = usePermission("create", "work_orders");
  const canViewAllTickets = hasFullTicketAccess(role);
  const [selectedTicket, setSelectedTicket] = useState<TicketView | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(false);
  const [filter, setFilter] = useState("all");
  const [form, setForm] = useState({ subject: "", description: "", priority: "media" });

  const { data: tickets = [], isLoading } = useQuery({
    queryKey: ["tickets", session.company.id, session.user.id, canViewAllTickets],
    queryFn: async () => {
      const db = await getDb();
      return db.select<TicketView[]>(
        `SELECT t.*, opener.name as opener_name, agent.name as agent_name
         FROM tickets t
         LEFT JOIN users opener ON opener.id = t.opened_by
         LEFT JOIN users agent ON agent.id = t.agent_id
         WHERE t.company_id=? ${canViewAllTickets ? "" : "AND t.opened_by=?"} AND t.deleted_at IS NULL
         ORDER BY t.created_at DESC`,
        canViewAllTickets ? [session.company.id] : [session.company.id, session.user.id]
      );
    },
  });

  const { data: timeline = [], isLoading: loadingTimeline } = useQuery({
    queryKey: ["ticket-timeline", session.company.id, selectedTicket?.id],
    enabled: Boolean(selectedTicket),
    queryFn: async () => {
      const db = await getDb();
      return db.select<TicketActivity[]>(
        `SELECT a.*, u.name as actor_name
         FROM activities a
         LEFT JOIN users u ON u.id = a.actor_id
         WHERE a.company_id=? AND a.entity_type='ticket' AND a.entity_id=?
         ORDER BY a.created_at ASC`,
        [session.company.id, selectedTicket!.id]
      );
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const db = await getDb();
      const id = uuidv4();
      await db.execute(
        "INSERT INTO tickets (id, company_id, subject, description, priority, opened_by, requester_area) VALUES (?,?,?,?,?,?,?)",
        [id, session.company.id, form.subject, form.description || null, form.priority, session.user.id, ROLE_LABELS[role]]
      );
      await emit({
        type: "ticket.created",
        companyId: session.company.id,
        actorId: session.user.id,
        entityType: "ticket",
        entityId: id,
        title: `Ticket aberto por ${ROLE_LABELS[role]}`,
        description: form.subject,
        module: "support",
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tickets", session.company.id] });
      setShowForm(false);
      setForm({ subject: "", description: "", priority: "media" });
    },
  });

  const convertToWOMutation = useMutation({
    mutationFn: async (ticket: TicketView) => {
      const db = await getDb();
      const woId = uuidv4();
      const woCount = await db.select<[{ n: number }]>(
        "SELECT COUNT(*) as n FROM work_orders WHERE company_id=?",
        [session.company.id]
      );
      const number = `OS-${String(woCount[0].n + 1).padStart(4, "0")}`;
      await db.execute(
        "INSERT INTO work_orders (id, company_id, number, customer_id, ticket_id, technician_id, priority) VALUES (?,?,?,?,?,?,?)",
        [woId, session.company.id, number, ticket.customer_id ?? null, ticket.id, session.user.id, ticket.priority]
      );
      await db.execute(
        "UPDATE tickets SET work_order_id=?, status='resolvido', updated_at=datetime('now') WHERE id=?",
        [woId, ticket.id]
      );
      await emit({
        type: "ticket.converted_to_work_order",
        companyId: session.company.id,
        actorId: session.user.id,
        entityType: "ticket",
        entityId: ticket.id,
        title: `Ticket convertido em ${number}`,
        module: "support",
      });
      return { ...ticket, work_order_id: woId, status: "resolvido" as const };
    },
    onSuccess: (ticket) => {
      setSelectedTicket(ticket);
      qc.invalidateQueries({ queryKey: ["tickets", session.company.id] });
      qc.invalidateQueries({ queryKey: ["ticket-timeline", session.company.id, ticket.id] });
      qc.invalidateQueries({ queryKey: ["work-orders", session.company.id] });
    },
  });

  const reopenMutation = useMutation({
    mutationFn: async (ticket: TicketView) => {
      const db = await getDb();
      await db.execute("UPDATE tickets SET status='aberto', updated_at=datetime('now') WHERE id=?", [ticket.id]);
      await emit({
        type: "ticket.reopened",
        companyId: session.company.id,
        actorId: session.user.id,
        entityType: "ticket",
        entityId: ticket.id,
        title: `Ticket reaberto por ${session.user.name}`,
        module: "support",
      });
      return { ...ticket, status: "aberto" as const };
    },
    onSuccess: (ticket) => {
      setSelectedTicket(ticket);
      qc.invalidateQueries({ queryKey: ["tickets", session.company.id] });
      qc.invalidateQueries({ queryKey: ["ticket-timeline", session.company.id, ticket.id] });
    },
  });
  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTicket) return;
      const db = await getDb();
      await db.execute("UPDATE tickets SET subject=?, description=?, priority=?, status=?, updated_at=datetime('now') WHERE id=?", [form.subject, form.description || null, form.priority, selectedTicket.status, selectedTicket.id]);
    },
    onSuccess: () => {
      setSelectedTicket((ticket) => ticket ? { ...ticket, subject: form.subject, description: form.description, priority: form.priority as Ticket["priority"] } : null);
      qc.invalidateQueries({ queryKey: ["tickets", session.company.id] });
      setEditing(false);
    },
  });

  const filtered = filter === "all" ? tickets : tickets.filter((ticket) => ticket.status === filter);

  if (selectedTicket) {
    const canReopen =
      ["resolvido", "fechado"].includes(selectedTicket.status) &&
      (
        selectedTicket.opened_by === session.user.id ||
        selectedTicket.agent_id === session.user.id ||
        timeline.some((activity) => activity.actor_id === session.user.id) ||
        canViewAllTickets
      );

    return (
      <div className="space-y-6">
        <button onClick={() => setSelectedTicket(null)} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft size={15} />
          Voltar para tickets
        </button>

        <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-6">
          <div>
            <div className="mb-3 flex items-center gap-2">
              <StatusBadge status={selectedTicket.priority} />
              <StatusBadge status={selectedTicket.status} />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">{selectedTicket.subject}</h1>
            <p className="mt-1 text-sm text-muted-foreground">Aberto em {formatDateTime(selectedTicket.created_at)}</p>
          </div>
          <div className="flex gap-2">
            {canEditTicket && (
              <button onClick={() => { setForm({ subject: selectedTicket.subject, description: selectedTicket.description ?? "", priority: selectedTicket.priority }); setEditing(true); }} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted">
                <Pencil size={14} /> Editar
              </button>
            )}
            {canReopen && (
              <button
                onClick={() => reopenMutation.mutate(selectedTicket)}
                className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted"
              >
                <RotateCcw size={14} />
                Reabrir ticket
              </button>
            )}
            {canCreateWorkOrder && !selectedTicket.work_order_id && !["resolvido", "fechado"].includes(selectedTicket.status) && (
              <button
                onClick={() => convertToWOMutation.mutate(selectedTicket)}
                className="flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                <Wrench size={14} />
                Criar OS
              </button>
            )}
          </div>
        </div>

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
            <Info label="Area solicitante" value={selectedTicket.requester_area ?? "Nao informada"} icon={Building2} />
            <Info label="Aberto por" value={selectedTicket.opener_name ?? "Nao informado"} icon={UserRound} />
            <Info label="Tecnico responsavel" value={selectedTicket.agent_name ?? "Aguardando atribuicao"} icon={Wrench} />
            <Info label="Canal" value={selectedTicket.channel} icon={HeadphonesIcon} />
            <div>
              <p className="text-xs font-medium text-muted-foreground">Descricao</p>
              <p className="mt-1 text-sm leading-relaxed">{selectedTicket.description ?? "Sem descricao adicional."}</p>
            </div>
          </aside>
        </div>
        {editing && <CrudDialog title="Editar ticket" fields={[{ key: "subject", label: "Assunto", required: true }, { key: "priority", label: "Prioridade", type: "select", options: ["baixa", "media", "alta", "urgente"].map((priority) => ({ value: priority, label: priority })) }, { key: "description", label: "Descricao", type: "textarea" }]} values={form} onChange={(key, value) => setForm((current) => ({ ...current, [key]: value }))} onClose={() => setEditing(false)} onSubmit={() => updateMutation.mutate()} busy={updateMutation.isPending} />}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Suporte"
        description="Tickets"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ImportExportButtons entity="tickets" onImported={() => void qc.invalidateQueries({ queryKey: ["tickets", session.company.id] })} />
            {canCreateTicket && (
              <button
                onClick={() => setShowForm(true)}
                className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                <Plus size={14} />
                Novo ticket
              </button>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((item) => (
          <button
            key={item.value}
            onClick={() => setFilter(item.value)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${filter === item.value ? "bg-primary text-primary-foreground" : "border hover:bg-muted"}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {showForm && (
        <div className="rounded-xl border bg-card p-5">
          <h3 className="font-semibold">Novo ticket</h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5 text-sm font-medium sm:col-span-2">
              Assunto
              <input value={form.subject} onChange={(event) => setForm((current) => ({ ...current, subject: event.target.value }))} className="flex h-9 w-full rounded-md border bg-background px-3 text-sm font-normal outline-none focus:ring-2 focus:ring-ring" />
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              Prioridade
              <select value={form.priority} onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value }))} className="flex h-9 w-full rounded-md border bg-background px-3 text-sm font-normal outline-none focus:ring-2 focus:ring-ring">
                <option value="baixa">Baixa</option>
                <option value="media">Media</option>
                <option value="alta">Alta</option>
                <option value="urgente">Urgente</option>
              </select>
            </label>
            <label className="space-y-1.5 text-sm font-medium sm:col-span-2">
              Descricao
              <textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} rows={3} className="flex w-full resize-none rounded-md border bg-background px-3 py-2 text-sm font-normal outline-none focus:ring-2 focus:ring-ring" />
            </label>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => setShowForm(false)} className="rounded-md border px-4 py-1.5 text-sm hover:bg-muted">Cancelar</button>
            <button onClick={() => createMutation.mutate()} disabled={!form.subject || createMutation.isPending} className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">Criar ticket</button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, index) => <div key={index} className="h-20 animate-pulse rounded-lg bg-muted/30" />)}</div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={HeadphonesIcon} title="Nenhum ticket encontrado" />
      ) : (
        <div className="divide-y rounded-xl border bg-card">
          {filtered.map((ticket) => (
            <button key={ticket.id} onClick={() => setSelectedTicket(ticket)} className="flex w-full items-center gap-4 px-4 py-4 text-left transition-colors hover:bg-muted/30">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                {initials(ticket.opener_name ?? ticket.requester_area ?? "TI")}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{ticket.subject}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {ticket.requester_area ?? "Area nao informada"} · {ticket.opener_name ?? "Solicitante"} · {formatDateTime(ticket.created_at)}
                </p>
              </div>
              <div className="hidden items-center gap-2 sm:flex">
                <StatusBadge status={ticket.priority} />
                <StatusBadge status={ticket.status} />
              </div>
              <Clock3 size={15} className="text-muted-foreground" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
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
