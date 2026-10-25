// Alternância "Lista | Calendário" das telas do grupo de pessoas (RH, produtos, projetos): a mesma informação na
// EditableTable ou no CalendarView. Botões com aria-pressed (não é aba: o conteúdo é o mesmo, em outra visão).
import { CalendarDays, List } from "lucide-react";
import { cn } from "@/lib/utils";

export type ListOrCalendar = "lista" | "calendario";

export function ViewSwitch({ value, onChange, label = "Visão", className }: { value: ListOrCalendar; onChange: (value: ListOrCalendar) => void; label?: string; className?: string }) {
  const options: { id: ListOrCalendar; text: string; Icon: typeof List }[] = [
    { id: "lista", text: "Lista", Icon: List },
    { id: "calendario", text: "Calendário", Icon: CalendarDays },
  ];
  return (
    <div role="group" aria-label={label} className={cn("inline-flex rounded-md border p-0.5", className)}>
      {options.map(({ id, text, Icon }) => (
        <button
          key={id}
          type="button"
          aria-pressed={value === id}
          onClick={() => onChange(id)}
          className={cn("inline-flex items-center gap-1.5 rounded px-3 py-1 text-sm font-medium transition-colors", value === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
        >
          <Icon size={14} aria-hidden="true" /> {text}
        </button>
      ))}
    </div>
  );
}
