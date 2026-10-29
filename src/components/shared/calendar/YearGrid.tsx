// Visão Ano do CalendarView: os 12 meses em miniatura; dia com item ganha o fundo marcado (mais itens, mais forte)
// e abre a visão Dia ao clicar.
import { cn } from "@/lib/utils";
import { addDays, monthGridDays, type DayEntry } from "./layout";
import { WEEKDAYS_SHORT } from "./MonthGrid";

interface YearGridProps {
  year: string;
  today: string;
  entries: Map<string, DayEntry[]>;
  onOpenDay: (day: string) => void;
}

const MONTH_NAME = new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "UTC" });

export function YearGrid({ year, today, entries, onOpenDay }: YearGridProps) {
  const months = Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}-01`);
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4" data-calendar-grid="year">
      {months.map((first) => {
        const month = first.slice(0, 7);
        const name = MONTH_NAME.format(new Date(`${first}T00:00:00Z`));
        // Só as semanas que tocam o mês (4 a 6 linhas).
        const days = monthGridDays(first).filter((_, index, all) => {
          const weekStart = all[index - (index % 7)];
          return weekStart.slice(0, 7) === month || addDays(weekStart, 6).slice(0, 7) === month;
        });
        return (
          <section key={month} aria-label={name} className="rounded-xl border bg-card p-3">
            <h3 className="mb-2 text-sm font-semibold capitalize">{name}</h3>
            <div className="grid grid-cols-7 gap-0.5 text-center">
              {WEEKDAYS_SHORT.map((weekday) => (
                <span key={weekday} className="text-caption text-muted-foreground">{weekday.charAt(0)}</span>
              ))}
              {days.map((day) => {
                if (day.slice(0, 7) !== month) return <span key={day} />;
                const count = entries.get(day)?.length ?? 0;
                const isToday = day === today;
                return (
                  <button
                    key={day}
                    type="button"
                    data-day={day}
                    onClick={() => onOpenDay(day)}
                    aria-label={`Abrir o dia ${day.slice(8)}/${day.slice(5, 7)}/${day.slice(0, 4)}${count ? ` (${count} ${count === 1 ? "item" : "itens"})` : ""}`}
                    aria-current={isToday ? "date" : undefined}
                    title={count ? `${count} ${count === 1 ? "item" : "itens"}` : undefined}
                    className={cn(
                      "flex h-7 items-center justify-center rounded-md text-xs tabular-nums hover:ring-1 hover:ring-ring",
                      count > 0 && (count > 4 ? "bg-foreground/25 font-semibold" : "bg-foreground/10 font-medium"),
                      isToday && "bg-primary font-semibold text-primary-foreground",
                    )}
                  >
                    {Number(day.slice(8))}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
