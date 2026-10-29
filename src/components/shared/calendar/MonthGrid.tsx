// Visão Mês do CalendarView: 6 semanas de domingo a sábado, até 3 itens por dia e "+N mais" (abre o dia).
import type { CSSProperties, MouseEvent } from "react";
import { cn } from "@/lib/utils";
import type { CalendarItem } from "../CalendarView";
import { formatMinute, type DayEntry } from "./layout";

export const WEEKDAYS_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"] as const;

interface MonthGridProps {
  days: string[];
  /** 'YYYY-MM' do mês mostrado (os dias de fora ficam apagados). */
  month: string;
  today: string;
  entries: Map<string, DayEntry[]>;
  maxPerDay?: number;
  onSelect?: (item: CalendarItem) => void;
  onCreate?: (day: string) => void;
  onOpenDay: (day: string) => void;
}

/** Cor do item (agenda, funcionário; dado, não token): pinta o fundo inteiro, sem faixa lateral. */
export const itemAccent = (item: CalendarItem): CSSProperties | undefined =>
  item.color ? { backgroundColor: `color-mix(in srgb, ${item.color} 30%, hsl(var(--card)))` } : undefined;

export function itemTooltip(item: CalendarItem, time?: string): string {
  return [time, item.title, item.sourceLabel].filter(Boolean).join(" · ");
}

export function MonthGrid({ days, month, today, entries, maxPerDay = 3, onSelect, onCreate, onOpenDay }: MonthGridProps) {
  return (
    <div className="overflow-hidden rounded-xl border bg-border" data-calendar-grid="month">
      <div className="grid grid-cols-7 gap-px">
        {WEEKDAYS_SHORT.map((name) => (
          <div key={name} className="bg-card px-2 py-2 text-xs font-medium text-muted-foreground">{name}</div>
        ))}
        {days.map((day) => {
          const list = entries.get(day) ?? [];
          const visible = list.length > maxPerDay ? list.slice(0, maxPerDay - 1) : list;
          const hidden = list.length - visible.length;
          const outside = day.slice(0, 7) !== month;
          const isToday = day === today;
          const create = onCreate
            ? (event: MouseEvent) => {
                if (event.target === event.currentTarget) onCreate(day);
              }
            : undefined;
          return (
            <div key={day} data-day={day} onClick={create} className={cn("flex min-h-[6.5rem] flex-col gap-1 p-1.5", outside ? "bg-background" : "bg-card", onCreate && "cursor-pointer")}>
              <button
                type="button"
                onClick={() => onOpenDay(day)}
                aria-label={`Abrir o dia ${day.slice(8)}/${day.slice(5, 7)}/${day.slice(0, 4)}`}
                aria-current={isToday ? "date" : undefined}
                className={cn(
                  "flex h-7 w-7 items-center justify-center self-start rounded-full text-sm font-semibold tabular-nums hover:bg-muted",
                  outside && "text-muted-foreground",
                  isToday && "bg-primary text-primary-foreground hover:bg-primary/90",
                )}
              >
                {Number(day.slice(8))}
              </button>
              {visible.map((entry) => {
                const time = entry.allDay ? undefined : formatMinute(entry.startMinute);
                return (
                  <button
                    key={entry.item.id}
                    type="button"
                    data-item-id={entry.item.id}
                    title={itemTooltip(entry.item, time)}
                    onClick={() => onSelect?.(entry.item)}
                    style={itemAccent(entry.item)}
                    className={cn(
                      "flex w-full min-w-0 items-center gap-1 truncate rounded px-1.5 py-0.5 text-left text-xs",
                      entry.allDay || entry.item.color ? "bg-muted font-medium hover:brightness-110" : "hover:bg-muted",
                    )}
                  >
                    {!entry.allDay && (
                      <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/60" style={entry.item.color ? { backgroundColor: entry.item.color } : undefined} />
                    )}
                    {time && <span className="shrink-0 tabular-nums text-muted-foreground">{time}</span>}
                    <span className="truncate">{entry.item.title}</span>
                  </button>
                );
              })}
              {hidden > 0 && (
                <button type="button" onClick={() => onOpenDay(day)} className="self-start rounded px-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
                  +{hidden} mais
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
