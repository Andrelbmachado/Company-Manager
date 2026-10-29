// Calendário no visual do Google Agenda (Dia / Semana / Mês / Ano) para tudo que é cronograma ou agenda no app.
// Dias e horários no fuso de São Paulo por padrão (prop timeZone), semana de domingo a sábado.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { addDays, addMonths, APP_TIME_ZONE, dayToDate, itemsByDay, layoutWeek, monthGridDays, startOfWeek, todayIn, zonedInstant, zonedParts } from "./calendar/layout";
import { MonthGrid } from "./calendar/MonthGrid";
import { WeekGrid } from "./calendar/WeekGrid";
import { YearGrid } from "./calendar/YearGrid";

/**
 * Item do calendário. `start`/`end`: 'YYYY-MM-DD' = dia inteiro (fim exclusivo, como em calendar_events);
 * instante ISO com Z ou deslocamento; "YYYY-MM-DD HH:MM" (datetime do SQLite) = UTC; "YYYY-MM-DDTHH:MM" sem fuso
 * (campo datetime-local) = horário no fuso do calendário. Sem `end`, evento com horário dura 30 min na tela.
 */
export interface CalendarItem {
  id: string;
  title: string;
  start: string;
  end?: string;
  allDay?: boolean;
  /** Cor do item (agenda de origem, funcionário): pinta o fundo do item, sem faixa lateral. */
  color?: string;
  /** Nome da agenda/fonte, mostrado na dica. */
  sourceLabel?: string;
  /** Ordem dentro do dia na visão Mês: menor primeiro (padrão 0). Presença usa 1 para não esconder os eventos. */
  priority?: number;
}

export type CalendarViewMode = "day" | "week" | "month" | "year";

export interface CalendarRange {
  /** Primeiro dia mostrado ('YYYY-MM-DD'). */
  start: string;
  /** Dia seguinte ao último mostrado (exclusivo). */
  end: string;
}

export interface CalendarViewProps {
  items: CalendarItem[];
  /** Visão inicial (ou controlada, junto com onViewChange). */
  view?: CalendarViewMode;
  onViewChange?: (view: CalendarViewMode) => void;
  /** Dia em foco ao abrir ('YYYY-MM-DD'); padrão: hoje no fuso. */
  date?: string;
  /** Chamado ao abrir e ao navegar, com os dias visíveis (para carregar só o período). */
  onRangeChange?: (range: CalendarRange) => void;
  onSelect?: (item: CalendarItem) => void;
  /** Clique num espaço vazio: dia inteiro ('YYYY-MM-DD', allDay) ou horário (instante ISO UTC). */
  onCreate?: (start: string, options: { allDay: boolean }) => void;
  timeZone?: string;
  /** Relógio (testes). */
  now?: Date;
  label?: string;
  /** Itens por dia na visão Mês antes do "+N mais" (padrão 3). */
  maxPerDay?: number;
  /** Controles extras na barra do calendário, à direita (filtros, agendas conectadas). */
  toolbar?: ReactNode;
  className?: string;
}

const VIEWS: { id: CalendarViewMode; label: string }[] = [
  { id: "day", label: "Dia" },
  { id: "week", label: "Semana" },
  { id: "month", label: "Mês" },
  { id: "year", label: "Ano" },
];

const STEP_LABEL: Record<CalendarViewMode, [string, string]> = {
  month: ["Mês anterior", "Próximo mês"],
  week: ["Semana anterior", "Próxima semana"],
  day: ["Dia anterior", "Próximo dia"],
  year: ["Ano anterior", "Próximo ano"],
};

const BUTTON = "inline-flex h-8 items-center justify-center rounded-md border px-3 text-sm font-medium transition-colors hover:bg-muted";
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const format = (day: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("pt-BR", { ...options, timeZone: "UTC" }).format(dayToDate(day));

/** Título do período: "2026", "Outubro de 2026", "25 – 31 de outubro de 2026", "Domingo, 25 de outubro de 2026". */
export function periodTitle(view: CalendarViewMode, focus: string): string {
  if (view === "year") return focus.slice(0, 4);
  if (view === "month") return capitalize(format(focus, { month: "long", year: "numeric" }));
  if (view === "day") return capitalize(format(focus, { weekday: "long", day: "numeric", month: "long", year: "numeric" }));
  const first = startOfWeek(focus);
  const last = addDays(first, 6);
  const [firstYear, lastYear] = [first.slice(0, 4), last.slice(0, 4)];
  if (first.slice(0, 7) === last.slice(0, 7)) return `${Number(first.slice(8))} – ${Number(last.slice(8))} de ${format(first, { month: "long" })} de ${firstYear}`;
  if (firstYear === lastYear) return `${format(first, { day: "numeric", month: "short" })} – ${format(last, { day: "numeric", month: "short" })} de ${lastYear}`;
  return `${format(first, { day: "numeric", month: "short", year: "numeric" })} – ${format(last, { day: "numeric", month: "short", year: "numeric" })}`;
}

function rangeFor(view: CalendarViewMode, focus: string): CalendarRange & { days: string[] } {
  if (view === "year") {
    const first = `${focus.slice(0, 4)}-01-01`;
    const end = `${Number(focus.slice(0, 4)) + 1}-01-01`;
    const count = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000);
    return { days: Array.from({ length: count }, (_, index) => addDays(first, index)), start: first, end };
  }
  if (view === "month") {
    const days = monthGridDays(focus);
    return { days, start: days[0], end: addDays(days[days.length - 1], 1) };
  }
  const first = view === "week" ? startOfWeek(focus) : focus;
  const count = view === "week" ? 7 : 1;
  const days = Array.from({ length: count }, (_, index) => addDays(first, index));
  return { days, start: first, end: addDays(first, count) };
}

export function CalendarView({ items, view = "month", onViewChange, date, onRangeChange, onSelect, onCreate, timeZone = APP_TIME_ZONE, now, label = "Calendário", maxPerDay, toolbar, className }: CalendarViewProps) {
  const [mode, setMode] = useState<CalendarViewMode>(view);
  const today = todayIn(now ?? new Date(), timeZone);
  const [focus, setFocus] = useState(date ?? today);
  const range = useMemo(() => rangeFor(mode, focus), [mode, focus]);
  const rangeCallback = useRef(onRangeChange);
  rangeCallback.current = onRangeChange;

  useEffect(() => setMode(view), [view]);
  useEffect(() => {
    if (date) setFocus(date);
  }, [date]);
  useEffect(() => {
    rangeCallback.current?.({ start: range.start, end: range.end });
  }, [range.start, range.end]);

  const changeView = (next: CalendarViewMode) => {
    setMode(next);
    onViewChange?.(next);
  };
  const openDay = (day: string) => {
    setFocus(day);
    changeView("day");
  };
  const step = (direction: 1 | -1) =>
    setFocus((current) => (mode === "year" ? addMonths(current, direction * 12) : mode === "month" ? addMonths(current, direction) : addDays(current, direction * (mode === "week" ? 7 : 1))));
  const nowParts = zonedParts(now ?? new Date(), timeZone);

  const createDay = onCreate ? (day: string) => onCreate(day, { allDay: true }) : undefined;
  const createSlot = onCreate ? (day: string, minute: number | null) => (minute === null ? onCreate(day, { allDay: true }) : onCreate(zonedInstant(day, minute, timeZone), { allDay: false })) : undefined;

  return (
    <section aria-label={label} className={cn("space-y-3", className)} data-calendar-view={mode}>
      {/* Hoje, Dia / Semana / Mês / Ano, setas e o período lado a lado; filtros da tela à direita. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
          <button type="button" className={BUTTON} onClick={() => setFocus(today)}>Hoje</button>
          <div role="group" aria-label="Visualização do calendário" className="inline-flex max-w-full flex-wrap rounded-md border p-0.5">
            {VIEWS.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={mode === option.id}
                onClick={() => changeView(option.id)}
                className={cn("rounded px-3 py-1 text-sm font-medium transition-colors", mode === option.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="flex items-center">
            <button type="button" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={STEP_LABEL[mode][0]} onClick={() => step(-1)}>
              <ChevronLeft size={18} />
            </button>
            <button type="button" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={STEP_LABEL[mode][1]} onClick={() => step(1)}>
              <ChevronRight size={18} />
            </button>
          </div>
          <h2 className="text-lg font-semibold" aria-live="polite">{periodTitle(mode, focus)}</h2>
        </div>
        {toolbar && <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 [&_input]:max-w-full [&_select]:max-w-full">{toolbar}</div>}
      </div>

      {mode === "year" ? (
        <YearGrid year={focus.slice(0, 4)} today={today} entries={itemsByDay(items, range.start, range.days.length, timeZone)} onOpenDay={openDay} />
      ) : mode === "month" ? (
        <MonthGrid maxPerDay={maxPerDay} days={range.days} month={focus.slice(0, 7)} today={today} entries={itemsByDay(items, range.start, range.days.length, timeZone)} onSelect={onSelect} onCreate={createDay} onOpenDay={openDay} />
      ) : (
        <WeekGrid
          days={range.days}
          today={today}
          positioned={layoutWeek(items, range.start, { timeZone, days: range.days.length })}
          nowMinute={range.days.includes(nowParts.day) ? nowParts.minute : null}
          onSelect={onSelect}
          onCreate={createSlot}
          onOpenDay={mode === "week" ? openDay : undefined}
        />
      )}
    </section>
  );
}
