// Visões Semana e Dia do CalendarView: faixa de dia inteiro no topo e grade de 24 h com os eventos posicionados
// (sobrepostos lado a lado, em colunas). Clicar num horário vazio cria (meia em meia hora).
import { useEffect, useRef, type MouseEvent } from "react";
import { cn } from "@/lib/utils";
import type { CalendarItem } from "../CalendarView";
import { formatMinute, MINUTES_PER_DAY, weekday, type Positioned } from "./layout";
import { itemAccent, itemTooltip, WEEKDAYS_SHORT } from "./MonthGrid";

interface WeekGridProps {
  days: string[];
  today: string;
  positioned: Positioned[];
  /** Minuto atual (linha de "agora") se hoje estiver na faixa. */
  nowMinute?: number | null;
  hourHeight?: number;
  onSelect?: (item: CalendarItem) => void;
  onCreate?: (day: string, minute: number | null) => void;
  onOpenDay?: (day: string) => void;
}

const ALL_DAY_ROW = 24;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const FIRST_VISIBLE_HOUR = 7;

export function WeekGrid({ days, today, positioned, nowMinute, hourHeight = 48, onSelect, onCreate, onOpenDay }: WeekGridProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const allDay = positioned.filter((entry) => entry.allDay);
  const timed = positioned.filter((entry) => !entry.allDay);
  const allDayRows = allDay.reduce((max, entry) => Math.max(max, entry.row + 1), 0);
  const columns = { gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` };

  useEffect(() => {
    const earliest = timed.reduce((min, entry) => Math.min(min, Math.floor(entry.startMinute / 60)), FIRST_VISIBLE_HOUR);
    if (scroller.current) scroller.current.scrollTop = Math.max(0, earliest - 0.5) * hourHeight;
    // Só ao montar e ao trocar de período: rolar sozinho a cada atualização atrapalharia.
  }, [days[0], days.length, hourHeight]);

  function createAt(event: MouseEvent<HTMLDivElement>, day: string) {
    if (!onCreate || event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const minute = Math.floor(((event.clientY - rect.top) / hourHeight) * 2) * 30;
    onCreate(day, Math.min(Math.max(minute, 0), MINUTES_PER_DAY - 30));
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-card" data-calendar-grid={days.length === 1 ? "day" : "week"}>
      <div className="flex border-b">
        <div className="w-14 shrink-0" />
        <div className="grid flex-1" style={columns}>
          {days.map((day) => {
            const isToday = day === today;
            return (
              <button
                key={day}
                type="button"
                onClick={() => onOpenDay?.(day)}
                disabled={!onOpenDay}
                aria-current={isToday ? "date" : undefined}
                className="flex flex-col items-center gap-0.5 border-l py-2 text-xs font-medium text-muted-foreground enabled:hover:bg-muted/50"
              >
                <span>{WEEKDAYS_SHORT[weekday(day)]}</span>
                <span className={cn("flex h-8 w-8 items-center justify-center rounded-full text-lg font-semibold tabular-nums text-foreground", isToday && "bg-primary text-primary-foreground")}>{Number(day.slice(8))}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex border-b">
        <div className="flex w-14 shrink-0 items-center justify-end pr-2 text-caption text-muted-foreground">Dia inteiro</div>
        <div className="relative flex-1" style={{ height: Math.max(allDayRows, 1) * ALL_DAY_ROW + 6 }}>
          <div className="absolute inset-0 grid" style={columns}>
            {days.map((day) => (
              <div key={day} className={cn("border-l", onCreate && "cursor-pointer")} onClick={(event) => (event.target === event.currentTarget ? onCreate?.(day, null) : undefined)} />
            ))}
          </div>
          {allDay.map((entry) => (
            <button
              key={`${entry.item.id}-${entry.dayIndex}`}
              type="button"
              data-item-id={entry.item.id}
              title={itemTooltip(entry.item)}
              onClick={() => onSelect?.(entry.item)}
              style={{
                ...itemAccent(entry.item),
                left: `calc(${(entry.dayIndex / days.length) * 100}% + 2px)`,
                width: `calc(${(entry.span / days.length) * 100}% - 4px)`,
                top: entry.row * ALL_DAY_ROW + 3,
                height: ALL_DAY_ROW - 3,
              }}
              className={cn(
                "absolute truncate rounded border-l-[3px] border-l-foreground/40 bg-muted px-1.5 text-left text-xs font-medium hover:bg-accent",
                entry.continuesBefore && "rounded-l-none",
                entry.continuesAfter && "rounded-r-none",
              )}
            >
              {entry.item.title}
            </button>
          ))}
        </div>
      </div>

      <div ref={scroller} className="max-h-[36rem] overflow-y-auto">
        <div className="relative flex" style={{ height: 24 * hourHeight }}>
          <div className="relative w-14 shrink-0">
            {HOURS.slice(1).map((hour) => (
              <span key={hour} className="absolute right-2 -translate-y-1/2 text-caption tabular-nums text-muted-foreground" style={{ top: hour * hourHeight }}>
                {formatMinute(hour * 60)}
              </span>
            ))}
          </div>
          <div className="relative grid flex-1" style={columns}>
            {days.map((day, dayIndex) => (
              <div
                key={day}
                data-day={day}
                onClick={(event) => createAt(event, day)}
                className={cn("relative border-l", onCreate && "cursor-pointer")}
                style={{ backgroundImage: "linear-gradient(to bottom, hsl(var(--border)) 1px, transparent 1px)", backgroundSize: `100% ${hourHeight}px` }}
              >
                {timed
                  .filter((entry) => entry.dayIndex === dayIndex)
                  .map((entry) => {
                    const time = `${formatMinute(entry.startMinute)}–${formatMinute(entry.endMinute)}`;
                    const height = Math.max(((entry.endMinute - entry.startMinute) / 60) * hourHeight - 2, 18);
                    return (
                      <button
                        key={`${entry.item.id}-${entry.startMinute}`}
                        type="button"
                        data-item-id={entry.item.id}
                        title={itemTooltip(entry.item, time)}
                        onClick={() => onSelect?.(entry.item)}
                        style={{
                          ...itemAccent(entry.item),
                          top: (entry.startMinute / 60) * hourHeight + 1,
                          height,
                          left: `calc(${(entry.column / entry.columns) * 100}% + 2px)`,
                          width: `calc(${100 / entry.columns}% - 4px)`,
                        }}
                        className="absolute flex flex-col overflow-hidden rounded border-l-[3px] border-l-foreground/40 bg-muted px-1.5 py-0.5 text-left text-xs shadow-sm ring-1 ring-card hover:bg-accent"
                      >
                        <span className="truncate font-medium">{entry.item.title}</span>
                        {height >= 32 && <span className="truncate tabular-nums text-muted-foreground">{time}</span>}
                      </button>
                    );
                  })}
                {day === today && nowMinute != null && (
                  <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-foreground" style={{ top: (nowMinute / 60) * hourHeight }}>
                    <span className="absolute -left-1 -top-1 h-2.5 w-2.5 rounded-full bg-foreground" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
