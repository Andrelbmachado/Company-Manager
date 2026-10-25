// Cronograma de abordagens da prospecção no CalendarView: cada lead com `outreach_date` é um evento de dia inteiro.
// Remarcar grava só `outreach_date` ('YYYY-MM-DD', dia local); `outreach_day` (o "Dia N" do seed) fica como está.
import type { CalendarItem } from "@/components/shared/CalendarView";
import { addDays, isDayKey } from "@/components/shared/calendar/layout";
import type { DatabaseLike } from "@/lib/db/demo";
import { normalizeValue } from "@/lib/importexport/normalize";
import { can } from "@/lib/permissions/rbac";
import type { Lead, Role } from "@/types";
import { LEAD_STATUSES } from "./contact";

/** Status fora do funil (CRM, legados) também aparecem com o nome certo. */
const STATUS_LABELS: Record<string, string> = {
  ...Object.fromEntries(LEAD_STATUSES.map((status) => [status.value, status.label])),
  convertido: "Convertido",
  qualificado: "Qualificado",
  descartado: "Descartado",
};

export const leadStatusLabel = (status: string) => STATUS_LABELS[status] ?? status;

type ScheduleLead = Pick<Lead, "id" | "name" | "status" | "outreach_date">;

/** 'YYYY-MM-DD' que existe no calendário (2026-02-30 não). */
function validDay(value: string | null | undefined): value is string {
  return isDayKey(value) && addDays(value, 0) === value;
}

/** Leads com data de abordagem → eventos de dia inteiro (fim exclusivo). `onlyPending` = só os novos. */
export function outreachItems(leads: readonly ScheduleLead[], options: { onlyPending?: boolean } = {}): CalendarItem[] {
  return leads
    .filter((lead) => validDay(lead.outreach_date) && (!options.onlyPending || lead.status === "novo"))
    .map((lead) => ({
      id: lead.id,
      title: lead.name,
      start: lead.outreach_date as string,
      end: addDays(lead.outreach_date as string, 1),
      allDay: true,
      sourceLabel: leadStatusLabel(lead.status),
    }));
}

/** Dia que o calendário abre: o próximo (a partir de hoje) com lead novo; senão o primeiro com lead novo; senão o primeiro. */
export function nextOutreachDay(leads: readonly ScheduleLead[], today: string): string | undefined {
  const days = (filter: (lead: ScheduleLead) => boolean) =>
    leads
      .filter((lead) => validDay(lead.outreach_date) && filter(lead))
      .map((lead) => lead.outreach_date as string)
      .sort();
  const pending = days((lead) => lead.status === "novo");
  return pending.find((day) => day >= today) ?? pending[0] ?? days(() => true)[0];
}

/**
 * Remarca a abordagem do lead (`date` 'YYYY-MM-DD' ou dd/mm/aaaa; null tira do cronograma). Com `role`, exige `edit`
 * em `leads` também aqui. Só mexe em lead ativo da empresa.
 */
export async function rescheduleLead(db: DatabaseLike, companyId: string, leadId: string, date: string | null, actor: { role?: Role } = {}): Promise<void> {
  if (actor.role && !can(actor.role, "edit", "leads")) throw new Error("Sem permissão para remarcar abordagens.");
  let day: string | null = null;
  if (date != null && date.trim()) {
    const parsed = normalizeValue("date", date);
    if (!parsed.ok || !validDay(parsed.value as string)) throw new Error("Data inválida: use dd/mm/aaaa.");
    day = parsed.value as string;
  }
  const [lead] = await db.select<Lead[]>("SELECT * FROM leads WHERE company_id=? AND id=? AND deleted_at IS NULL", [companyId, leadId]);
  if (!lead) throw new Error("Lead não encontrado.");
  await db.execute("UPDATE leads SET outreach_date=?, updated_at=? WHERE company_id=? AND id=?", [day, new Date().toISOString(), companyId, leadId]);
}
