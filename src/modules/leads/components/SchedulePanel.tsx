import { useMemo, useState } from "react";
import { CalendarDays, MessageCircle } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { cn } from "@/lib/utils";
import { PRESENCE_LABELS, formatIsoDate, formatRating, openExternal, whatsappUrl } from "@/lib/prospecting/contact";
import { LeadStatusBadge } from "./LeadsPanel";
import type { Lead } from "@/types";

interface Day {
  day: number;
  date: string;
  leads: Lead[];
}

function weekday(isoDate: string): string {
  return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString("pt-BR", { weekday: "long", timeZone: "UTC" });
}

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function SchedulePanel({ leads, perDay }: { leads: Lead[]; perDay: number }) {
  const [onlyPending, setOnlyPending] = useState(false);

  const days = useMemo<Day[]>(() => {
    const byDay = new Map<number, Day>();
    for (const lead of leads) {
      if (!lead.outreach_day || !lead.outreach_date) continue;
      const entry = byDay.get(lead.outreach_day) ?? { day: lead.outreach_day, date: lead.outreach_date, leads: [] };
      entry.leads.push(lead);
      byDay.set(lead.outreach_day, entry);
    }
    return [...byDay.values()]
      .map((entry) => ({ ...entry, leads: entry.leads.sort((a, b) => (a.priority_rank ?? 0) - (b.priority_rank ?? 0)) }))
      .sort((a, b) => a.day - b.day);
  }, [leads]);

  const today = todayIso();
  const nextDay = days.find((entry) => entry.date >= today && entry.leads.some((lead) => lead.status === "novo"));
  const visible = onlyPending ? days.filter((entry) => entry.leads.some((lead) => lead.status === "novo")) : days;

  if (days.length === 0) {
    return <EmptyState icon={CalendarDays} title="Sem cronograma" description="O cronograma é gerado junto com a importação dos leads." />;
  }

  const approached = leads.filter((lead) => lead.status !== "novo").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {perDay} leads por dia útil · {days.length} dias · {formatIsoDate(days[0].date)} a {formatIsoDate(days[days.length - 1].date)} ·{" "}
          {approached} de {leads.length} já abordados. Prioridade: sites quebrados primeiro, depois mais avaliações no Google.
        </p>
        <label className="flex h-9 items-center gap-2 rounded-md border bg-background px-2.5 text-sm">
          <input type="checkbox" checked={onlyPending} onChange={(event) => setOnlyPending(event.target.checked)} />
          Só dias com leads novos
        </label>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {visible.map((entry) => {
          const highlight = entry.day === nextDay?.day;
          return (
            <section key={entry.day} className={cn("rounded-xl border bg-card", highlight && "border-primary/50 ring-1 ring-primary/30")}>
              <header className="flex items-center justify-between border-b px-4 py-3">
                <div>
                  <p className="text-sm font-semibold">Dia {entry.day} · {formatIsoDate(entry.date)}</p>
                  <p className="text-xs capitalize text-muted-foreground">{weekday(entry.date)}{highlight ? " · próximo a abordar" : ""}</p>
                </div>
                <span className="text-xs text-muted-foreground">
                  {entry.leads.filter((lead) => lead.status !== "novo").length}/{entry.leads.length} abordados
                </span>
              </header>
              <ul className="divide-y">
                {entry.leads.map((lead) => {
                  const wa = whatsappUrl(lead.whatsapp);
                  return (
                    <li key={lead.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          <span className="mr-1.5 text-muted-foreground">#{lead.priority_rank}</span>{lead.name}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {lead.category} · {formatRating(lead.google_rating, lead.google_reviews)} ·{" "}
                          <span className={lead.presence_kind === "site_quebrado" ? "font-medium text-red-600" : undefined}>
                            {lead.presence_kind ? PRESENCE_LABELS[lead.presence_kind] : "—"}
                          </span>{" "}
                          · {lead.phone ?? "sem telefone"}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {wa && (
                          <button type="button" title="Abrir WhatsApp" aria-label={`Abrir WhatsApp de ${lead.name}`} onClick={() => void openExternal(wa)} className="text-emerald-600 hover:text-emerald-700">
                            <MessageCircle size={16} />
                          </button>
                        )}
                        <LeadStatusBadge status={lead.status} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
