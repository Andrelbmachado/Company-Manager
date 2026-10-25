// Linhas da tabela "Eventos do app" e textos de data do Calendário. O evento gravado (instante UTC ou dia, fim
// exclusivo como no iCal) vira dia + hora de São Paulo com fim inclusivo, do jeito que a pessoa lê e digita; o
// caminho de volta monta o LocalEventInput do store ("YYYY-MM-DDTHH:MM" é horário de parede de São Paulo).
import { addDays, formatMinute, isDayKey, parseInstant, zonedParts } from "@/components/shared/calendar/layout";
import { FEED_TIME_ZONE } from "@/lib/calendar/feed";
import type { LocalEventInput } from "@/lib/calendar/store";
import { formatDay } from "@/lib/utils";
import type { CalendarEvent, CalendarEventKind } from "@/types";

/** Valor do seletor de pessoa para "da empresa toda" (user_id NULL). */
export const COMPANY_OWNER = "empresa";

export const ownerValue = (userId: string | null | undefined) => userId ?? COMPANY_OWNER;
export const ownerUserId = (value: string | null | undefined) => (!value || value === COMPANY_OWNER ? null : value);

export interface EventRow {
  id: string;
  title: string;
  kind: CalendarEventKind;
  all_day: number;
  start_day: string;
  start_time: string | null;
  /** Último dia (inclusivo) no dia inteiro; dia do fim no evento com horário. */
  end_day: string | null;
  end_time: string | null;
  person: string;
  location: string | null;
}

const TIME_RE = /^(\d{1,2})(?:[:hH.](\d{2})?)?(?:h|H)?$/;
const COMPACT_TIME_RE = /^(\d{2})(\d{2})$/;

/** "9", "09:30", "9h30", "15h", "0930" → "HH:MM". Outro texto: erro com o formato esperado. */
export function normalizeTime(text: string): string {
  const value = text.replace(/\s+/g, "");
  const match = TIME_RE.exec(value) ?? COMPACT_TIME_RE.exec(value);
  const hour = match ? Number(match[1]) : NaN;
  const minute = match ? Number(match[2] ?? 0) : NaN;
  if (!match || hour > 23 || minute > 59) throw new Error(`Hora inválida: "${text.trim()}". Use HH:MM (ex.: 09:30).`);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function toEventRow(event: CalendarEvent): EventRow {
  const base = { id: event.id, title: event.title, kind: event.kind, location: event.location ?? null, person: ownerValue(event.user_id) };
  if (Number(event.all_day) === 1) {
    const first = event.starts_at.slice(0, 10);
    const endText = event.ends_at?.slice(0, 10);
    const last = isDayKey(endText) && endText > first ? addDays(endText, -1) : first;
    return { ...base, all_day: 1, start_day: first, start_time: null, end_day: last, end_time: null };
  }
  const start = parseInstant(event.starts_at, FEED_TIME_ZONE);
  const end = event.ends_at ? parseInstant(event.ends_at, FEED_TIME_ZONE) : null;
  const startParts = start ? zonedParts(start, FEED_TIME_ZONE) : { day: event.starts_at.slice(0, 10), minute: 0 };
  const endParts = end ? zonedParts(end, FEED_TIME_ZONE) : null;
  return {
    ...base,
    all_day: 0,
    start_day: startParts.day,
    start_time: formatMinute(startParts.minute),
    end_day: endParts?.day ?? null,
    end_time: endParts ? formatMinute(endParts.minute) : null,
  };
}

/** Linha completa (gravada + rascunho) → dados do store. A pessoa (user_id) fica a cargo de quem chama. */
export function eventInput(row: Partial<EventRow>): LocalEventInput {
  const allDay = Number(row.all_day) === 1;
  const startDay = row.start_day ?? "";
  if (!isDayKey(startDay)) throw new Error("Data de início inválida.");
  const input: LocalEventInput = { title: row.title ?? "", kind: row.kind ?? "evento", location: row.location ?? null, all_day: allDay ? 1 : 0 };
  if (allDay) {
    const endDay = row.end_day || null;
    if (endDay && !isDayKey(endDay)) throw new Error("Data de fim inválida.");
    if (endDay && endDay < startDay) throw new Error("A data de fim deve ser depois do início.");
    return { ...input, starts_at: startDay, ends_at: endDay ? addDays(endDay, 1) : null };
  }
  if (!row.start_time) throw new Error("Informe a hora de início (HH:MM) ou marque Dia inteiro.");
  const startTime = normalizeTime(row.start_time);
  const endTime = row.end_time ? normalizeTime(row.end_time) : null;
  return { ...input, starts_at: `${startDay}T${startTime}`, ends_at: endTime ? `${row.end_day || startDay}T${endTime}` : null };
}

/** Quando acontece, em São Paulo: "20/10/2026 (dia inteiro)", "20/10/2026 a 22/10/2026", "20/10/2026, 14:00–15:00". */
export function describeWhen(start: string, end: string | null | undefined, allDay: boolean): string {
  if (allDay) {
    const first = start.slice(0, 10);
    const endText = end?.slice(0, 10);
    const last = isDayKey(endText) && endText > first ? addDays(endText, -1) : first;
    return last === first ? `${formatDay(first)} (dia inteiro)` : `${formatDay(first)} a ${formatDay(last)}`;
  }
  const from = parseInstant(start, FEED_TIME_ZONE);
  if (!from) return start;
  const a = zonedParts(from, FEED_TIME_ZONE);
  const to = end ? parseInstant(end, FEED_TIME_ZONE) : null;
  if (!to) return `${formatDay(a.day)}, ${formatMinute(a.minute)}`;
  const b = zonedParts(to, FEED_TIME_ZONE);
  return a.day === b.day
    ? `${formatDay(a.day)}, ${formatMinute(a.minute)}–${formatMinute(b.minute)}`
    : `${formatDay(a.day)} ${formatMinute(a.minute)} a ${formatDay(b.day)} ${formatMinute(b.minute)}`;
}

/** Próximos e em andamento primeiro (do mais cedo ao mais tarde); depois os passados, do mais recente ao mais antigo. */
export function sortEventRows(rows: EventRow[], today: string): EventRow[] {
  const lastDay = (row: EventRow) => row.end_day ?? row.start_day;
  return [...rows].sort((a, b) => {
    const pastA = lastDay(a) < today;
    const pastB = lastDay(b) < today;
    if (pastA !== pastB) return pastA ? 1 : -1;
    const keyA = `${a.start_day} ${a.all_day ? "" : (a.start_time ?? "")}`;
    const keyB = `${b.start_day} ${b.all_day ? "" : (b.start_time ?? "")}`;
    return (pastA ? keyB.localeCompare(keyA) : keyA.localeCompare(keyB)) || a.title.localeCompare(b.title, "pt-BR");
  });
}
