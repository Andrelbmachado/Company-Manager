// Peças das fichas abertas no próprio lugar (abaixo da tabela, sem modal nem painel lateral): painel com título e
// Fechar, grade de informações e o seletor Lista | Calendário das telas com datas. Usadas por financeiro e compras.
import { useEffect, useRef, type ReactNode } from "react";
import { CalendarDays, List, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function InlinePanel({ title, subtitle, onClose, actions, children, className }: {
  title: string;
  subtitle?: ReactNode;
  onClose?: () => void;
  /** Botões ao lado do título. */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    // Leva a ficha para a vista quando ela abre abaixo de uma tabela comprida (jsdom não tem scrollIntoView).
    ref.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [title]);
  return (
    <section ref={ref} aria-label={title} className={cn("space-y-4 rounded-xl border bg-card p-4", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold">{title}</h2>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          {onClose && (
            <button type="button" onClick={onClose} className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
              <X size={14} aria-hidden="true" /> Fechar
            </button>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}

export function InfoGrid({ children }: { children: ReactNode }) {
  return <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{children}</dl>;
}

export function InfoItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm">{value === null || value === undefined || value === "" ? "—" : value}</dd>
    </div>
  );
}

export type ListOrCalendar = "lista" | "calendario";

/** Alterna a lista (EditableTable) e a visão de calendário (CalendarView) da mesma informação. */
export function ViewToggle({ value, onChange }: { value: ListOrCalendar; onChange: (value: ListOrCalendar) => void }) {
  const option = (id: ListOrCalendar, label: string, icon: ReactNode) => (
    <button
      type="button"
      aria-pressed={value === id}
      onClick={() => onChange(id)}
      className={cn("inline-flex h-8 items-center gap-1.5 px-3 text-sm font-medium transition-colors", value === id ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
    >
      {icon} {label}
    </button>
  );
  return (
    <div role="group" aria-label="Visualização" className="inline-flex overflow-hidden rounded-md border">
      {option("lista", "Lista", <List size={14} aria-hidden="true" />)}
      {option("calendario", "Calendário", <CalendarDays size={14} aria-hidden="true" />)}
    </div>
  );
}
