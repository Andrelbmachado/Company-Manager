// Leitura de agendas iCal (.ics) publicadas por link: Google Agenda ("Endereço secreto no formato iCal"),
// Apple/iCloud (agenda pública) e Outlook ("Publicar agenda"). O ical.js lê o arquivo e expande as recorrências
// (RRULE, RDATE, EXDATE, exceções por RECURRENCE-ID); o instante de cada ocorrência é calculado aqui com o Intl a
// partir do horário de parede e do TZID, porque nem todo servidor manda o VTIMEZONE (e os do Windows usam nomes
// próprios). Horário sem fuso (flutuante) é lido no fuso do app (America/Sao_Paulo).
import ICAL from "ical.js";
import type { CalendarItem, CalendarRange } from "@/components/shared/CalendarView";
import { addDays, APP_TIME_ZONE, zonedInstant } from "@/components/shared/calendar/layout";

type IcalComponent = InstanceType<typeof ICAL.Component>;
type IcalEvent = InstanceType<typeof ICAL.Event>;
type IcalTime = InstanceType<typeof ICAL.Time>;

/** Erro com mensagem pronta para a pessoa (link que não é agenda, arquivo com defeito). */
export class IcsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IcsError";
  }
}

/** Uma ocorrência lida da agenda. `uid` (= `id`) é a chave na fonte: UID do evento ou, na recorrência, UID + início. */
export interface IcsOccurrence extends CalendarItem {
  uid: string;
  allDay: boolean;
  location: string | null;
  description: string | null;
}

export interface ParseIcsOptions {
  /** Fuso do app: horário flutuante e limites do período. */
  timeZone?: string;
}

const DAY_MS = 86_400_000;
/** Ocorrências cujo início original passa do período por até isto ainda são lidas (exceção movida para dentro). */
const SLACK_DAYS = 32;
/** Teto de ocorrências percorridas por evento (regra diária desde 1990 cabe; regra por minuto não trava a tela). */
const MAX_ITERATIONS = 50_000;
const MAX_TITLE = 300;
const MAX_TEXT = 2_000;

/** Fusos do Windows (Outlook/Exchange) mais comuns no Brasil → nome IANA. Os demais usam o VTIMEZONE do arquivo. */
const WINDOWS_ZONES: Record<string, string> = {
  "E. South America Standard Time": "America/Sao_Paulo",
  "Central Brazilian Standard Time": "America/Cuiaba",
  "SA Western Standard Time": "America/Manaus",
  "SA Eastern Standard Time": "America/Fortaleza",
  "Bahia Standard Time": "America/Bahia",
  "Tocantins Standard Time": "America/Araguaina",
  "SA Pacific Standard Time": "America/Bogota",
  "UTC-02": "America/Noronha",
  "Eastern Standard Time": "America/New_York",
  "Central Standard Time": "America/Chicago",
  "Pacific Standard Time": "America/Los_Angeles",
  "GMT Standard Time": "Europe/London",
  "W. Europe Standard Time": "Europe/Berlin",
  "Romance Standard Time": "Europe/Paris",
  "GTB Standard Time": "Europe/Athens",
};

const zoneCheck = new Map<string, boolean>();

function isIanaZone(name: string): boolean {
  let valid = zoneCheck.get(name);
  if (valid === undefined) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: name });
      valid = true;
    } catch {
      valid = false;
    }
    zoneCheck.set(name, valid);
  }
  return valid;
}

/** TZID do arquivo → fuso que o Intl entende (ou null: usa o VTIMEZONE, ou é flutuante). */
export function resolveZoneName(tzid: string | null | undefined): string | null {
  if (!tzid) return null;
  const name = tzid.trim().replace(/^"|"$/g, "");
  if (!name || name === "floating") return null;
  if (/^(utc|gmt|z|etc\/utc|etc\/gmt)$/i.test(name)) return "UTC";
  if (WINDOWS_ZONES[name]) return WINDOWS_ZONES[name];
  if (isIanaZone(name)) return name;
  // TZID com prefixo, como o "/mozilla.org/20050126_1/America/Sao_Paulo" do Thunderbird antigo.
  const tail = /([A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+)$/.exec(name)?.[1];
  if (tail && isIanaZone(tail)) return tail;
  return null;
}

const pad = (value: number) => String(value).padStart(2, "0");
const dayOf = (time: IcalTime) => `${String(time.year).padStart(4, "0")}-${pad(time.month)}-${pad(time.day)}`;

type Moment = { allDay: true; day: string } | { allDay: false; ms: number };

/** Instante (ou dia) de um horário do ical.js, com o TZID do parâmetro da propriedade. */
function momentOf(time: IcalTime, tzid: string | null, fallbackZone: string): Moment {
  if (time.isDate) return { allDay: true, day: dayOf(time) };
  const day = dayOf(time);
  const minute = time.hour * 60 + time.minute;
  const zone = time.zone;
  if (zone === ICAL.Timezone.utcTimezone || zone?.tzid === "UTC") return { allDay: false, ms: Date.UTC(time.year, time.month - 1, time.day, time.hour, time.minute, time.second) };
  const name = resolveZoneName(tzid) ?? resolveZoneName(zone?.tzid);
  if (name === "UTC") return { allDay: false, ms: Date.UTC(time.year, time.month - 1, time.day, time.hour, time.minute, time.second) };
  if (name) return { allDay: false, ms: Date.parse(zonedInstant(day, minute, name)) + time.second * 1000 };
  // Fuso desconhecido do Intl, mas definido por um VTIMEZONE no próprio arquivo.
  if (zone && zone !== ICAL.Timezone.localTimezone && zone.tzid && zone.tzid !== "floating") return { allDay: false, ms: time.toUnixTime() * 1000 };
  return { allDay: false, ms: Date.parse(zonedInstant(day, minute, fallbackZone)) + time.second * 1000 };
}

const momentKey = (moment: Moment) => (moment.allDay ? moment.day : new Date(moment.ms).toISOString());

function tzidOf(component: IcalComponent, property: "dtstart" | "dtend" | "recurrence-id"): string | null {
  const value = component.getFirstProperty(property)?.getParameter("tzid");
  return typeof value === "string" ? value : Array.isArray(value) ? (value[0] ?? null) : null;
}

function textOf(component: IcalComponent, property: string, limit: number): string | null {
  const value = component.getFirstPropertyValue(property);
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\r\n?/g, "\n").trim();
  return text ? text.slice(0, limit) : null;
}

const isCancelled = (component: IcalComponent) => String(component.getFirstPropertyValue("status") ?? "").toUpperCase() === "CANCELLED";

/** Hash curto e estável (chave de evento sem UID). */
function shortHash(text: string): string {
  let hash = 5381;
  for (let index = 0; index < text.length; index++) hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
  return (hash >>> 0).toString(36);
}

function readCalendar(text: string): IcalComponent {
  const body = text.replace(/^﻿/, "").trim();
  if (/^<(!doctype|html|\?xml|head|body)/i.test(body) || /<html[\s>]/i.test(body.slice(0, 1000))) {
    throw new IcsError("O link devolveu uma página da web, não uma agenda. Use o endereço no formato iCal (.ics): no Google Agenda, \"Endereço secreto no formato iCal\".");
  }
  if (!/BEGIN:VCALENDAR/i.test(body)) throw new IcsError("O conteúdo do link não é uma agenda iCal (.ics).");
  let parsed: unknown;
  try {
    parsed = ICAL.parse(body);
  } catch {
    throw new IcsError("A agenda iCal está com defeito e não pôde ser lida.");
  }
  const roots = (Array.isArray(parsed) && typeof parsed[0] === "string" ? [parsed] : (parsed as unknown[])) as unknown[];
  for (const root of roots) {
    const component = new ICAL.Component(root as ConstructorParameters<typeof ICAL.Component>[0]);
    if (component.name === "vcalendar") return component;
  }
  throw new IcsError("O conteúdo do link não é uma agenda iCal (.ics).");
}

interface Bounds {
  startDay: string;
  endDay: string;
  startMs: number;
  endMs: number;
}

function overlaps(start: Moment, end: Moment, bounds: Bounds): boolean {
  if (start.allDay) {
    const endDay = end.allDay ? end.day : start.day;
    return start.day < bounds.endDay && endDay > bounds.startDay;
  }
  const endMs = end.allDay ? start.ms : Math.max(end.ms, start.ms + 1);
  return start.ms < bounds.endMs && endMs > bounds.startMs;
}

function beyond(moment: Moment, bounds: Bounds): boolean {
  return moment.allDay ? moment.day >= addDays(bounds.endDay, SLACK_DAYS) : moment.ms >= bounds.endMs + SLACK_DAYS * DAY_MS;
}

/**
 * Lê o texto .ics e devolve as ocorrências que tocam o período (`range.end` exclusivo, dias no fuso do app),
 * em ordem de início. Dia inteiro: `start`/`end` 'YYYY-MM-DD' (fim exclusivo); com horário: instantes ISO UTC
 * (`end` ausente quando o evento não tem duração). Eventos cancelados ficam de fora; evento com dado quebrado é
 * ignorado, e se nenhum puder ser lido o erro é lançado. Lança `IcsError` com mensagem legível.
 */
export function parseIcs(text: string, range: CalendarRange, options: ParseIcsOptions = {}): IcsOccurrence[] {
  const timeZone = options.timeZone ?? APP_TIME_ZONE;
  const calendar = readCalendar(text);
  const bounds: Bounds = {
    startDay: range.start,
    endDay: range.end,
    startMs: Date.parse(zonedInstant(range.start, 0, timeZone)),
    endMs: Date.parse(zonedInstant(range.end, 0, timeZone)),
  };

  const components = calendar.getAllSubcomponents("vevent");
  const masters: IcalComponent[] = [];
  const exceptions = new Map<string, IcalComponent[]>();
  for (const component of components) {
    if (component.hasProperty("recurrence-id")) {
      const uid = String(component.getFirstPropertyValue("uid") ?? "");
      exceptions.set(uid, [...(exceptions.get(uid) ?? []), component]);
    } else masters.push(component);
  }

  const result: (IcsOccurrence & { sortKey: number })[] = [];
  const usedKeys = new Map<string, number>();
  let failures = 0;
  let readable = 0;

  const push = (key: string, item: IcalComponent, start: Moment, end: Moment) => {
    const count = (usedKeys.get(key) ?? 0) + 1;
    usedKeys.set(key, count);
    const uid = count === 1 ? key : `${key}#${count}`;
    let startText: string;
    let endText: string | undefined;
    let sortKey: number;
    if (start.allDay) {
      const endDay = end.allDay && end.day > start.day ? end.day : addDays(start.day, 1);
      startText = start.day;
      endText = endDay;
      sortKey = Date.parse(zonedInstant(start.day, 0, timeZone));
    } else {
      startText = new Date(start.ms).toISOString();
      endText = !end.allDay && end.ms > start.ms ? new Date(end.ms).toISOString() : undefined;
      sortKey = start.ms;
    }
    result.push({
      id: uid,
      uid,
      title: textOf(item, "summary", MAX_TITLE) ?? "(Sem título)",
      start: startText,
      end: endText,
      allDay: start.allDay,
      location: textOf(item, "location", MAX_TEXT),
      description: textOf(item, "description", MAX_TEXT),
      sortKey,
    });
  };

  const baseUid = (component: IcalComponent) => {
    const uid = String(component.getFirstPropertyValue("uid") ?? "").trim();
    if (uid) return uid;
    const start = component.getFirstProperty("dtstart")?.toICALString() ?? "";
    return `sem-uid-${shortHash(`${textOf(component, "summary", MAX_TITLE) ?? ""}|${start}`)}`;
  };

  // Sem `exceptions`, o ICAL.Event liga ao evento TODAS as exceções (RECURRENCE-ID) do arquivo, de qualquer UID, e
  // a exceção de um evento substituía a ocorrência de outro no mesmo horário (além de custar O(n²) no arquivo).
  const readSingle = (component: IcalComponent, key: string) => {
    const event: IcalEvent = new ICAL.Event(component, { exceptions: [] });
    const startTz = tzidOf(component, "dtstart");
    const start = momentOf(event.startDate, startTz, timeZone);
    const end = momentOf(event.endDate, component.hasProperty("dtend") ? (tzidOf(component, "dtend") ?? startTz) : startTz, timeZone);
    readable++;
    if (overlaps(start, end, bounds)) push(key, component, start, end);
  };

  for (const component of masters) {
    try {
      const rawUid = String(component.getFirstPropertyValue("uid") ?? "");
      if (isCancelled(component)) {
        exceptions.delete(rawUid);
        readable++;
        continue;
      }
      const uid = baseUid(component);
      if (!component.hasProperty("rrule") && !component.hasProperty("rdate")) {
        readSingle(component, uid);
        continue;
      }
      const event: IcalEvent = new ICAL.Event(component, { exceptions: exceptions.get(rawUid) ?? [] });
      exceptions.delete(rawUid);
      const startTz = tzidOf(component, "dtstart");
      const iterator = event.iterator();
      // Atalho sem as contas de fuso (Intl) para as ocorrências que terminam bem antes do período: uma reunião diária
      // desde 2015 percorre milhares delas a cada sincronização. O dia de parede do evento difere do dia de São Paulo
      // em no máximo 1 dia, daí a folga; ocorrência com exceção (RECURRENCE-ID) segue o caminho completo.
      const spanDays = Math.ceil(Math.max(0, event.duration.toSeconds()) / 86_400) + 1;
      const exceptionIds = event.exceptions as unknown as Record<string, unknown>;
      const hasExceptions = Object.keys(exceptionIds).length > 0;
      const canSkip = event.rangeExceptions.length === 0;
      const isException = (time: IcalTime) => time.toString() in exceptionIds || time.convertToZone(ICAL.Timezone.utcTimezone).toString() in exceptionIds;
      readable++;
      for (let index = 0; index < MAX_ITERATIONS; index++) {
        const next = iterator.next();
        if (!next) break;
        if (canSkip && addDays(dayOf(next), spanDays) < bounds.startDay && !(hasExceptions && isException(next))) continue;
        const original = momentOf(next, startTz, timeZone);
        if (beyond(original, bounds)) break;
        const details = event.getOccurrenceDetails(next);
        const item = details.item.component;
        if (item !== component && isCancelled(item)) continue;
        const itemStartTz = item === component ? startTz : tzidOf(item, "dtstart");
        const itemEndTz = item === component ? startTz : item.hasProperty("dtend") ? (tzidOf(item, "dtend") ?? itemStartTz) : itemStartTz;
        const start = momentOf(details.startDate, itemStartTz, timeZone);
        const end = momentOf(details.endDate, itemEndTz, timeZone);
        if (overlaps(start, end, bounds)) push(`${uid}::${momentKey(original)}`, item, start, end);
      }
    } catch {
      failures++;
    }
  }

  // Exceções sem o evento principal no arquivo: valem como eventos avulsos (chave UID + início original).
  for (const list of exceptions.values()) {
    for (const component of list) {
      try {
        if (isCancelled(component)) continue;
        const recurrenceId = component.getFirstPropertyValue("recurrence-id") as IcalTime;
        const original = momentOf(recurrenceId, tzidOf(component, "recurrence-id"), timeZone);
        readSingle(component, `${baseUid(component)}::${momentKey(original)}`);
      } catch {
        failures++;
      }
    }
  }

  if (failures > 0 && readable === 0) throw new IcsError("Nenhum evento da agenda pôde ser lido: o arquivo .ics está com defeito.");
  result.sort((a, b) => a.sortKey - b.sortKey || a.title.localeCompare(b.title, "pt-BR"));
  return result.map(({ sortKey: _sortKey, ...item }) => item);
}
