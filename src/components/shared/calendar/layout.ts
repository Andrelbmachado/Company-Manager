// Contas do CalendarView, sem React. Dias são chaves 'YYYY-MM-DD' (aritmética em UTC, sem fuso); horários são
// minutos desde a meia-noite no fuso do calendário (padrão America/Sao_Paulo, independente do fuso da máquina).
// A semana começa no domingo. Eventos sobrepostos dividem a largura do dia em colunas; dia inteiro (e evento de
// 24 h ou mais) vai para a faixa do topo.
import type { CalendarItem } from "../CalendarView";

export const APP_TIME_ZONE = "America/Sao_Paulo";
export const MINUTES_PER_DAY = 24 * 60;
/** Duração mostrada para evento sem fim (ou com fim antes do início). */
export const DEFAULT_DURATION_MINUTES = 30;

const DAY_MS = 86_400_000;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = (value: number) => String(value).padStart(2, "0");

// ── dias ──────────────────────────────────────────────────────────

export const isDayKey = (value: string | undefined | null): value is string => !!value && DAY_RE.test(value);

function dayToUtc(day: string): number {
  const match = DAY_RE.exec(day);
  if (!match) throw new Error(`Dia inválido: ${day}`);
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function utcToDay(ms: number): string {
  const date = new Date(ms);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** Data (meia-noite UTC) para formatar o dia com Intl usando timeZone "UTC". */
export const dayToDate = (day: string) => new Date(dayToUtc(day));

export const addDays = (day: string, amount: number) => utcToDay(dayToUtc(day) + amount * DAY_MS);

/** Quantos dias de `from` até `to` (negativo se `to` vem antes). */
export const diffDays = (from: string, to: string) => Math.round((dayToUtc(to) - dayToUtc(from)) / DAY_MS);

/** 0 = domingo ... 6 = sábado. */
export const weekday = (day: string) => new Date(dayToUtc(day)).getUTCDay();

export const startOfWeek = (day: string) => addDays(day, -weekday(day));

export const startOfMonth = (day: string) => `${day.slice(0, 7)}-01`;

/** Primeiro dia do mês `amount` meses depois (ou antes) do mês de `day`. */
export function addMonths(day: string, amount: number): string {
  const date = new Date(dayToUtc(startOfMonth(day)));
  date.setUTCMonth(date.getUTCMonth() + amount);
  return utcToDay(date.getTime());
}

/** As 42 casas (6 semanas, domingo a sábado) da grade do mês de `day`. */
export function monthGridDays(day: string): string[] {
  const first = startOfWeek(startOfMonth(day));
  return Array.from({ length: 42 }, (_, index) => addDays(first, index));
}

// ── fuso ──────────────────────────────────────────────────────────

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Dia e minuto do instante no fuso dado. */
export function zonedParts(instant: Date, timeZone = APP_TIME_ZONE): { day: string; minute: number; second: number } {
  const parts: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(instant)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  const hour = parts.hour === 24 ? 0 : parts.hour;
  return { day: `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`, minute: hour * 60 + parts.minute, second: parts.second };
}

/** Diferença (ms) entre o relógio do fuso e o UTC naquele instante. */
function offsetAt(ms: number, timeZone: string): number {
  const { day, minute, second } = zonedParts(new Date(ms), timeZone);
  const wall = dayToUtc(day) + minute * 60_000 + second * 1000;
  return wall - Math.floor(ms / 1000) * 1000;
}

/** Instante (ISO UTC) de um horário de parede no fuso: zonedInstant("2026-10-25", 540) = 09:00 em São Paulo. */
export function zonedInstant(day: string, minute: number, timeZone = APP_TIME_ZONE): string {
  const wall = dayToUtc(day) + minute * 60_000;
  let ms = wall - offsetAt(wall, timeZone);
  const corrected = wall - offsetAt(ms, timeZone);
  if (corrected !== ms) ms = corrected;
  return new Date(ms).toISOString();
}

export const todayIn = (now = new Date(), timeZone = APP_TIME_ZONE) => zonedParts(now, timeZone).day;

export const weekStartFor = (now = new Date(), timeZone = APP_TIME_ZONE) => startOfWeek(todayIn(now, timeZone));

const OFFSET_RE = /(?:Z|[+-]\d{2}:?\d{2})$/i;
const SQLITE_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/;
const WALL_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/;

/**
 * Texto de data/hora → instante. Com Z ou deslocamento: o próprio instante. "YYYY-MM-DD HH:MM[:SS]" (datetime do
 * SQLite) é UTC. "YYYY-MM-DDTHH:MM" sem fuso (campo datetime-local) é horário de parede no fuso do calendário.
 */
export function parseInstant(value: string, timeZone = APP_TIME_ZONE): Date | null {
  const text = value.trim();
  let date: Date;
  if (OFFSET_RE.test(text)) date = new Date(text);
  else if (SQLITE_RE.test(text)) date = new Date(`${text.replace(" ", "T")}Z`);
  else {
    const wall = WALL_RE.exec(text);
    if (wall) date = new Date(new Date(zonedInstant(wall[1], Number(wall[2]) * 60 + Number(wall[3]), timeZone)).getTime() + Number(wall[4] ?? 0) * 1000);
    else if (isDayKey(text)) date = new Date(zonedInstant(text, 0, timeZone));
    else date = new Date(text);
  }
  return Number.isNaN(date.getTime()) ? null : date;
}

// ── itens ─────────────────────────────────────────────────────────

export interface NormalizedItem {
  item: CalendarItem;
  /** Faixa do topo: dia inteiro ou evento de 24 h ou mais. */
  allDay: boolean;
  /** Primeiro e último dia (inclusive) no fuso do calendário. */
  startDay: string;
  endDay: string;
  /** Minuto do início em `startDay` e do fim em `endDay` (0–1440). Dia inteiro: 0 e 1440. */
  startMinute: number;
  endMinute: number;
}

/**
 * Lê o item: `start` só com a data (ou `allDay`) = dia inteiro, com `end` exclusivo como em calendar_events
 * ("2026-10-22" a "2026-10-28" cobre de 22 a 27). Item com data inválida devolve null (não aparece).
 */
export function normalizeItem(item: CalendarItem, timeZone = APP_TIME_ZONE): NormalizedItem | null {
  if (item.allDay || isDayKey(item.start)) {
    const startDay = isDayKey(item.start) ? item.start : (() => {
      const start = parseInstant(item.start, timeZone);
      return start ? zonedParts(start, timeZone).day : null;
    })();
    if (!startDay) return null;
    let endDay = startDay;
    if (item.end) {
      if (isDayKey(item.end)) endDay = addDays(item.end, -1);
      else {
        const end = parseInstant(item.end, timeZone);
        if (end) endDay = zonedParts(new Date(end.getTime() - 1), timeZone).day;
      }
      if (endDay < startDay) endDay = startDay;
    }
    return { item, allDay: true, startDay, endDay, startMinute: 0, endMinute: MINUTES_PER_DAY };
  }

  const start = parseInstant(item.start, timeZone);
  if (!start) return null;
  const parsedEnd = item.end ? parseInstant(item.end, timeZone) : null;
  const end = parsedEnd && parsedEnd.getTime() > start.getTime() ? parsedEnd : new Date(start.getTime() + DEFAULT_DURATION_MINUTES * 60_000);
  const from = zonedParts(start, timeZone);
  if (end.getTime() - start.getTime() >= DAY_MS) {
    return { item, allDay: true, startDay: from.day, endDay: zonedParts(new Date(end.getTime() - 1), timeZone).day, startMinute: 0, endMinute: MINUTES_PER_DAY };
  }
  const to = zonedParts(end, timeZone);
  // Termina à meia-noite: fica no dia anterior, até 24:00.
  const endsAtMidnight = to.minute === 0 && to.day > from.day;
  return {
    item,
    allDay: false,
    startDay: from.day,
    endDay: endsAtMidnight ? addDays(to.day, -1) : to.day,
    startMinute: from.minute,
    endMinute: endsAtMidnight ? MINUTES_PER_DAY : to.minute,
  };
}

export interface Positioned {
  item: CalendarItem;
  allDay: boolean;
  /** Coluna do dia (0 = primeiro dia da faixa). */
  dayIndex: number;
  /** Dias cobertos dentro da faixa (dia inteiro); 1 nos eventos com horário. */
  span: number;
  /** Linha na faixa do topo (dia inteiro); 0 nos eventos com horário. */
  row: number;
  /** Minutos do trecho neste dia (0–1440). */
  startMinute: number;
  endMinute: number;
  /** Coluna do evento entre os sobrepostos e quantas colunas o grupo tem. */
  column: number;
  columns: number;
  /** O evento começou antes / continua depois do trecho mostrado. */
  continuesBefore: boolean;
  continuesAfter: boolean;
}

export interface LayoutOptions {
  timeZone?: string;
  /** Quantos dias a partir de `firstDay` (7 = semana, 1 = dia). */
  days?: number;
}

const byTitle = (a: CalendarItem, b: CalendarItem) => a.title.localeCompare(b.title, "pt-BR") || a.id.localeCompare(b.id);

/** Posição de cada item numa faixa de dias (semana de domingo a sábado por padrão). */
export function layoutWeek(items: CalendarItem[], weekStart: string, options: LayoutOptions = {}): Positioned[] {
  const timeZone = options.timeZone ?? APP_TIME_ZONE;
  const days = options.days ?? 7;
  const lastDay = addDays(weekStart, days - 1);
  const normalized = items.map((item) => normalizeItem(item, timeZone)).filter((item): item is NormalizedItem => item !== null);

  const allDay: Positioned[] = [];
  for (const entry of normalized.filter((candidate) => candidate.allDay)) {
    if (entry.endDay < weekStart || entry.startDay > lastDay) continue;
    const first = entry.startDay < weekStart ? weekStart : entry.startDay;
    const last = entry.endDay > lastDay ? lastDay : entry.endDay;
    allDay.push({
      item: entry.item,
      allDay: true,
      dayIndex: diffDays(weekStart, first),
      span: diffDays(first, last) + 1,
      row: 0,
      startMinute: 0,
      endMinute: MINUTES_PER_DAY,
      column: 0,
      columns: 1,
      continuesBefore: entry.startDay < weekStart,
      continuesAfter: entry.endDay > lastDay,
    });
  }
  allDay.sort((a, b) => a.dayIndex - b.dayIndex || b.span - a.span || byTitle(a.item, b.item));
  const laneEnds: number[] = [];
  for (const entry of allDay) {
    let lane = laneEnds.findIndex((end) => end < entry.dayIndex);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = entry.dayIndex + entry.span - 1;
    entry.row = lane;
  }

  const timed: Positioned[] = [];
  for (const entry of normalized.filter((candidate) => !candidate.allDay)) {
    for (let day = entry.startDay; day <= entry.endDay; day = addDays(day, 1)) {
      if (day < weekStart || day > lastDay) continue;
      const startMinute = day === entry.startDay ? entry.startMinute : 0;
      const endMinute = day === entry.endDay ? entry.endMinute : MINUTES_PER_DAY;
      if (endMinute <= startMinute) continue;
      timed.push({
        item: entry.item,
        allDay: false,
        dayIndex: diffDays(weekStart, day),
        span: 1,
        row: 0,
        startMinute,
        endMinute,
        column: 0,
        columns: 1,
        continuesBefore: day !== entry.startDay,
        continuesAfter: day !== entry.endDay,
      });
    }
  }
  timed.sort((a, b) => a.dayIndex - b.dayIndex || a.startMinute - b.startMinute || b.endMinute - b.startMinute - (a.endMinute - a.startMinute) || byTitle(a.item, b.item));

  // Grupos de eventos que se sobrepõem (em cadeia): cada um pega a primeira coluna livre; o grupo inteiro divide a
  // largura pelo número de colunas que usou. Encostar (fim = início do outro) não é sobrepor.
  let group: Positioned[] = [];
  let columnEnds: number[] = [];
  let groupEnd = -1;
  let groupDay = -1;
  const closeGroup = () => {
    for (const entry of group) entry.columns = columnEnds.length;
    group = [];
    columnEnds = [];
    groupEnd = -1;
  };
  for (const entry of timed) {
    if (entry.dayIndex !== groupDay || entry.startMinute >= groupEnd) {
      closeGroup();
      groupDay = entry.dayIndex;
    }
    let column = columnEnds.findIndex((end) => end <= entry.startMinute);
    if (column < 0) column = columnEnds.length;
    columnEnds[column] = entry.endMinute;
    entry.column = column;
    group.push(entry);
    groupEnd = Math.max(groupEnd, entry.endMinute);
  }
  closeGroup();

  return [...allDay, ...timed];
}

/** Um dia só (visão Dia). */
export const layoutDay = (items: CalendarItem[], day: string, options: Omit<LayoutOptions, "days"> = {}) => layoutWeek(items, day, { ...options, days: 1 });

export interface DayEntry {
  item: CalendarItem;
  allDay: boolean;
  /** Minuto do início neste dia (eventos com horário que começaram antes começam em 0). */
  startMinute: number;
}

/** Itens de cada dia de uma faixa (grade do mês): dia inteiro primeiro, depois por horário. */
export function itemsByDay(items: CalendarItem[], firstDay: string, count: number, timeZone = APP_TIME_ZONE): Map<string, DayEntry[]> {
  const lastDay = addDays(firstDay, count - 1);
  const map = new Map<string, DayEntry[]>();
  for (const entry of items.map((item) => normalizeItem(item, timeZone))) {
    if (!entry || entry.endDay < firstDay || entry.startDay > lastDay) continue;
    for (let day = entry.startDay < firstDay ? firstDay : entry.startDay; day <= entry.endDay && day <= lastDay; day = addDays(day, 1)) {
      const startMinute = entry.allDay || day !== entry.startDay ? 0 : entry.startMinute;
      if (!entry.allDay && day === entry.endDay && day !== entry.startDay && entry.endMinute === 0) continue;
      const list = map.get(day) ?? [];
      list.push({ item: entry.item, allDay: entry.allDay, startMinute });
      map.set(day, list);
    }
  }
  for (const list of map.values()) list.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.startMinute - b.startMinute || byTitle(a.item, b.item));
  return map;
}

/** "09:05" a partir dos minutos do dia. */
export const formatMinute = (minute: number) => `${pad(Math.floor(minute / 60) % 24)}:${pad(minute % 60)}`;
