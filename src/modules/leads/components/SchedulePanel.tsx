import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MessageCircle } from "lucide-react";
import { CalendarView, type CalendarItem } from "@/components/shared/CalendarView";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { getDb } from "@/lib/db/client";
import { emit } from "@/lib/events/bus";
import { useRequiredSession } from "@/hooks/useSession";
import { usePermission } from "@/hooks/usePermission";
import { todayIso } from "@/lib/utils";
import { PRESENCE_LABELS, formatIsoDate, formatRating, openExternal, whatsappUrl } from "@/lib/prospecting/contact";
import { nextOutreachDay, outreachItems, rescheduleLead } from "@/lib/prospecting/schedule";
import type { Lead, Role } from "@/types";

const FIELD = "h-9 rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring";

/** Cronograma de abordagens da campanha no calendário; o lead escolhido mostra o contato e remarca no próprio lugar. */
export function SchedulePanel({ leads }: { leads: Lead[] }) {
  const [onlyPending, setOnlyPending] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Abre no próximo dia com lead novo e não pula de mês quando um lead é remarcado (só define o foco uma vez).
  const [focus, setFocus] = useState(() => nextOutreachDay(leads, todayIso()));
  useEffect(() => {
    if (!focus) setFocus(nextOutreachDay(leads, todayIso()));
  }, [focus, leads]);

  const items = useMemo(() => outreachItems(leads, { onlyPending }), [leads, onlyPending]);
  const selected = leads.find((lead) => lead.id === selectedId) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <label className="flex h-9 items-center gap-2 rounded-md border bg-background px-2.5 text-sm">
          <input type="checkbox" checked={onlyPending} onChange={(event) => setOnlyPending(event.target.checked)} />
          Só leads novos
        </label>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <CalendarView items={items} date={focus} label="Cronograma de abordagem" onSelect={(item: CalendarItem) => setSelectedId(item.id)} />
        <section aria-label="Lead escolhido" className="h-fit rounded-xl border bg-card p-4">
          {selected ? (
            <LeadOutreach key={`${selected.id}:${selected.outreach_date ?? ""}`} lead={selected} />
          ) : (
            <p className="text-sm text-muted-foreground">{items.length ? "Nenhum lead escolhido" : "Nenhum lead agendado"}</p>
          )}
        </section>
      </div>
    </div>
  );
}

function LeadOutreach({ lead }: { lead: Lead }) {
  const session = useRequiredSession();
  const companyId = session.company.id;
  const canEdit = usePermission("edit", "leads");
  const qc = useQueryClient();
  const [date, setDate] = useState(lead.outreach_date ?? "");
  const wa = whatsappUrl(lead.whatsapp);
  const current = lead.outreach_date ?? "";

  // A data só é gravada ao confirmar: o campo de data passa por datas válidas (ano 0002, 0020...) enquanto se digita.
  const reschedule = useMutation({
    mutationFn: async (next: string) => {
      const db = await getDb();
      await rescheduleLead(db, companyId, lead.id, next || null, { role: session.membership.role as Role });
      await emit({
        type: "lead.rescheduled",
        companyId,
        actorId: session.user.id,
        entityType: "lead",
        entityId: lead.id,
        title: next ? `Abordagem de ${lead.name} remarcada para ${formatIsoDate(next)}` : `Abordagem de ${lead.name} sem data`,
        module: "leads",
        oldValue: { outreach_date: lead.outreach_date ?? null },
        newValue: { outreach_date: next || null },
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leads", companyId] }),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (date !== current) reschedule.mutate(date);
  };

  return (
    <div className="space-y-3 text-sm">
      <div className="space-y-1.5">
        <h3 className="text-base font-semibold leading-tight">{lead.name}</h3>
        {(lead.category || lead.business_type) && <p className="text-muted-foreground">{[lead.category, lead.business_type].filter(Boolean).join(" · ")}</p>}
        <StatusBadge status={lead.status} tone={lead.status === "fechado" ? "success" : undefined} />
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
        <dt className="text-muted-foreground">Telefone</dt>
        <dd>{lead.phone ?? "—"}</dd>
        <dt className="text-muted-foreground">WhatsApp</dt>
        <dd>
          {wa ? (
            <button type="button" onClick={() => void openExternal(wa)} className="inline-flex items-center gap-1 text-primary-text hover:underline">
              <MessageCircle size={14} /> {lead.whatsapp}
            </button>
          ) : (
            "—"
          )}
        </dd>
        <dt className="text-muted-foreground">Google</dt>
        <dd>{formatRating(lead.google_rating, lead.google_reviews)}</dd>
        <dt className="text-muted-foreground">Presença</dt>
        <dd>{lead.presence_kind ? PRESENCE_LABELS[lead.presence_kind] : "—"}</dd>
      </dl>
      {canEdit ? (
        <form onSubmit={submit} className="space-y-1.5">
          <label className="block text-muted-foreground" htmlFor={`outreach-${lead.id}`}>Abordar em</label>
          <div className="flex gap-2">
            <input id={`outreach-${lead.id}`} type="date" aria-label="Abordar em" value={date} onChange={(event) => setDate(event.target.value)} className={`${FIELD} min-w-0 flex-1`} />
            <button
              type="submit"
              disabled={reschedule.isPending || date === current}
              className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              Remarcar
            </button>
          </div>
          {reschedule.error && <p role="alert" className="text-xs text-destructive">{reschedule.error instanceof Error ? reschedule.error.message : String(reschedule.error)}</p>}
        </form>
      ) : (
        <p>
          <span className="text-muted-foreground">Abordar em</span> {formatIsoDate(lead.outreach_date)}
        </p>
      )}
    </div>
  );
}
