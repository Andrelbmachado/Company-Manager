// Agenda da empresa em iCal (.ics) para importar no Google Agenda, no Calendário da Apple ou no Outlook: eventos
// criados no app (reuniões, ausências, férias) e as férias/ausências aprovadas no RH. Eventos das agendas
// conectadas por link ficam de fora (são de cada pessoa e voltariam em duplicidade para quem assina as duas).
// Do RH vai só o tipo e o nome: o motivo (atestado, por exemplo) não sai do app.
import { addDays, isDayKey, parseInstant, zonedParts } from "@/components/shared/calendar/layout";
import type { DatabaseLike } from "@/lib/db/demo";
import type { CalendarEvent, CalendarEventKind, CalendarSource, Employee, HrRequest } from "@/types";

export const FEED_TIME_ZONE = "America/Sao_Paulo";
const UID_DOMAIN = "company-manager";
const DEFAULT_MINUTES = 30;

export const EVENT_KIND_LABEL: Record<CalendarEventKind, string> = {
  reuniao: "Reunião",
  ausencia: "Ausência",
  ferias: "Férias",
  externo: "Agenda conectada",
  evento: "Evento",
};

/** Título da ausência aprovada no RH: férias pelo nome; folga, atestado e outros como "Ausência" (sem o motivo). */
export const absenceTitle = (type: HrRequest["type"], name: string) => `${type === "ferias" ? "Férias" : "Ausência"}: ${name}`;

/** Evento do app (sem agenda de origem, ou de uma agenda local), não excluído. */
export function isLocalEvent(event: Pick<CalendarEvent, "source_id">, sources: Pick<CalendarSource, "id" | "kind">[] = []): boolean {
  if (!event.source_id) return true;
  return sources.some((source) => source.id === event.source_id && source.kind === "local");
}

// ── formato iCal ──────────────────────────────────────────────────

const encoder = new TextEncoder();

/** Escapa texto (RFC 5545, 3.3.11). */
export function escapeIcsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n?|\n/g, "\\n");
}

/** Dobra a linha em pedaços de até 75 bytes (a continuação começa com espaço, que também conta). */
export function foldIcsLine(line: string): string[] {
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    const limit = parts.length === 0 ? 75 : 74;
    if (bytes + size > limit) {
      parts.push(current);
      current = "";
      bytes = 0;
    }
    current += char;
    bytes += size;
  }
  parts.push(current);
  return parts.map((part, index) => (index === 0 ? part : ` ${part}`));
}

const compactDay = (day: string) => day.replace(/-/g, "");
const compactInstant = (date: Date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

interface FeedEntry {
  uid: string;
  title: string;
  allDay: boolean;
  /** Dia inteiro: 'YYYY-MM-DD' (fim exclusivo). Com horário: instantes. */
  startDay?: string;
  endDay?: string;
  start?: Date;
  end?: Date;
  location?: string | null;
  description?: string | null;
  category: string;
}

function eventEntry(event: CalendarEvent): FeedEntry | null {
  const category = EVENT_KIND_LABEL[event.kind] ?? "Evento";
  const base = { uid: `${event.id}@${UID_DOMAIN}`, title: event.title, location: event.location, description: event.description, category };
  if (Number(event.all_day) === 1 || isDayKey(event.starts_at)) {
    const startDay = isDayKey(event.starts_at) ? event.starts_at : (() => {
      const start = parseInstant(event.starts_at, FEED_TIME_ZONE);
      return start ? zonedParts(start, FEED_TIME_ZONE).day : null;
    })();
    if (!startDay) return null;
    const endDay = event.ends_at && isDayKey(event.ends_at) && event.ends_at > startDay ? event.ends_at : addDays(startDay, 1);
    return { ...base, allDay: true, startDay, endDay };
  }
  const start = parseInstant(event.starts_at, FEED_TIME_ZONE);
  if (!start) return null;
  const parsedEnd = event.ends_at ? parseInstant(event.ends_at, FEED_TIME_ZONE) : null;
  const end = parsedEnd && parsedEnd.getTime() > start.getTime() ? parsedEnd : new Date(start.getTime() + DEFAULT_MINUTES * 60_000);
  return { ...base, allDay: false, start, end };
}

function serialize(entries: FeedEntry[], calendarName: string, now: Date): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Company Manager//Agenda da empresa//PT-BR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(calendarName)}`,
    `X-WR-TIMEZONE:${FEED_TIME_ZONE}`,
  ];
  const stamp = compactInstant(now);
  for (const entry of entries) {
    lines.push("BEGIN:VEVENT", `UID:${entry.uid}`, `DTSTAMP:${stamp}`);
    if (entry.allDay) lines.push(`DTSTART;VALUE=DATE:${compactDay(entry.startDay!)}`, `DTEND;VALUE=DATE:${compactDay(entry.endDay!)}`);
    else lines.push(`DTSTART:${compactInstant(entry.start!)}`, `DTEND:${compactInstant(entry.end!)}`);
    lines.push(`SUMMARY:${escapeIcsText(entry.title)}`);
    if (entry.location) lines.push(`LOCATION:${escapeIcsText(entry.location)}`);
    if (entry.description) lines.push(`DESCRIPTION:${escapeIcsText(entry.description)}`);
    lines.push(`CATEGORIES:${escapeIcsText(entry.category)}`, `TRANSP:${entry.allDay ? "TRANSPARENT" : "OPAQUE"}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.flatMap(foldIcsLine).join("\r\n")}\r\n`;
}

const sortKey = (entry: FeedEntry) => (entry.allDay ? `${entry.startDay}T00:00:00.000Z` : entry.start!.toISOString());

/** Texto .ics da agenda da empresa (determinístico: mesma base e mesmo `now` geram o mesmo texto). */
export async function buildCompanyFeed(db: DatabaseLike, companyId: string, options: { now?: Date } = {}): Promise<string> {
  const now = options.now ?? new Date();
  const [company] = (await db.select<{ id: string; name: string }[]>("SELECT * FROM companies WHERE id = ?", [companyId])).filter((row) => row.id === companyId);
  const sources = await db.select<CalendarSource[]>("SELECT * FROM calendar_sources WHERE company_id = ? AND deleted_at IS NULL", [companyId]);
  const events = await db.select<CalendarEvent[]>("SELECT * FROM calendar_events WHERE company_id = ? AND deleted_at IS NULL", [companyId]);
  const requests = await db.select<HrRequest[]>("SELECT * FROM hr_requests WHERE company_id = ? AND deleted_at IS NULL", [companyId]);
  const employees = await db.select<Employee[]>("SELECT * FROM employees WHERE company_id = ? AND deleted_at IS NULL", [companyId]);

  const entries: FeedEntry[] = [];
  for (const event of events) {
    if (event.deleted_at || !isLocalEvent(event, sources)) continue;
    const entry = eventEntry(event);
    if (entry) entries.push(entry);
  }
  const names = new Map(employees.map((employee) => [employee.id, employee.name]));
  for (const request of requests) {
    if (request.deleted_at || request.status !== "aprovada" || !isDayKey(request.start_date.slice(0, 10))) continue;
    const name = names.get(request.employee_id);
    if (!name) continue;
    const startDay = request.start_date.slice(0, 10);
    const lastDay = isDayKey(request.end_date?.slice(0, 10)) && request.end_date.slice(0, 10) >= startDay ? request.end_date.slice(0, 10) : startDay;
    entries.push({
      uid: `hr-${request.id}@${UID_DOMAIN}`,
      title: absenceTitle(request.type, name),
      allDay: true,
      startDay,
      endDay: addDays(lastDay, 1),
      category: request.type === "ferias" ? "Férias" : "Ausência",
    });
  }
  entries.sort((a, b) => sortKey(a).localeCompare(sortKey(b)) || a.uid.localeCompare(b.uid));
  return serialize(entries, company?.name ? company.name : "Agenda da empresa", now);
}
