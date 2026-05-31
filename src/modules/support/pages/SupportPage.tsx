import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getDb } from "@/lib/db/client";
import { useRequiredSession } from "@/hooks/useSession";
import { emit } from "@/lib/events/bus";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { formatDateTime } from "@/lib/utils";
import { HeadphonesIcon, Plus, Wrench } from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import type { Ticket } from "@/types";

export default function SupportPage() {
  const session = useRequiredSession();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ subject: "", description: "", priority: "media" });
  const [filter, setFilter] = useState("all");

  const { data: tickets = [], isLoading } = useQuery({
    queryKey: ["tickets", session.company.id],
    queryFn: async () => {
      const db = await getDb();
      return db.select<Ticket[]>(
        "SELECT * FROM tickets WHERE company_id=? AND deleted_at IS NULL ORDER BY created_at DESC",
        [session.company.id]
      );
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const db = await getDb();
      const id = uuidv4();
      await db.execute(
        "INSERT INTO tickets (id, company_id, subject, description, priority, agent_id) VALUES (?,?,?,?,?,?)",
        [id, session.company.id, form.subject, form.description || null, form.priority, session.user.id]
      );
      await emit({
        type: "ticket.created",
        companyId: session.company.id,
        actorId: session.user.id,
        entityType: "ticket",
        entityId: id,
        title: `Ticket criado: ${form.subject}`,
        module: "support",
        newValue: form,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tickets", session.company.id] });
      setShowForm(false);
      setForm({ subject: "", description: "", priority: "media" });
    },
  });

  const convertToWOMutation = useMutation({
    mutationFn: async (ticket: Ticket) => {
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
        metadata: { work_order_id: woId, number },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tickets", session.company.id] });
      qc.invalidateQueries({ queryKey: ["work-orders", session.company.id] });
    },
  });

  const filtered = filter === "all" ? tickets : tickets.filter((t) => t.status === filter);

  const STATUS_FILTERS = [
    { value: "all", label: "Todos" },
    { value: "aberto", label: "Abertos" },
    { value: "em_atendimento", label: "Em atendimento" },
    { value: "aguardando", label: "Aguardando" },
    { value: "resolvido", label: "Resolvidos" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Suporte / Tickets"
        description="Central de atendimento"
        actions={
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus size={14} />
            Novo ticket
          </button>
        }
      />

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              filter === f.value
                ? "bg-primary text-primary-foreground"
                : "border hover:bg-muted"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* New ticket form */}
      {showForm && (
        <div className="rounded-xl border bg-card p-5 space-y-4">
          <h3 className="font-semibold">Novo ticket</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-1.5">
              <label className="text-sm font-medium">Assunto *</label>
              <input
                value={form.subject}
                onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                className="flex h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                placeholder="Descreva o problema"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Prioridade</label>
              <select
                value={form.priority}
                onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
                className="flex h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="baixa">Baixa</option>
                <option value="media">Média</option>
                <option value="alta">Alta</option>
                <option value="urgente">Urgente</option>
              </select>
            </div>
            <div className="col-span-2 space-y-1.5">
              <label className="text-sm font-medium">Descrição</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={3}
                className="flex w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring resize-none"
                placeholder="Detalhes adicionais..."
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowForm(false)} className="rounded-md border px-4 py-1.5 text-sm hover:bg-muted transition-colors">
              Cancelar
            </button>
            <button
              onClick={() => createMutation.mutate()}
              disabled={!form.subject || createMutation.isPending}
              className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              Criar ticket
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 rounded-lg bg-muted/30 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={HeadphonesIcon} title="Nenhum ticket encontrado" />
      ) : (
        <div className="space-y-2">
          {filtered.map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between rounded-xl border bg-card px-4 py-3 hover:bg-muted/30 transition-colors"
            >
              <div className="space-y-0.5 min-w-0">
                <p className="font-medium truncate">{t.subject}</p>
                <p className="text-xs text-muted-foreground">{formatDateTime(t.created_at)}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0 ml-4">
                <StatusBadge status={t.priority} />
                <StatusBadge status={t.status} />
                {!t.work_order_id && t.status !== "resolvido" && t.status !== "fechado" && (
                  <button
                    onClick={() => convertToWOMutation.mutate(t)}
                    disabled={convertToWOMutation.isPending}
                    title="Converter em OS"
                    className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted transition-colors"
                  >
                    <Wrench size={12} />
                    Criar OS
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
