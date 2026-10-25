import { CalendarDays } from "lucide-react";
import { PagePlaceholder } from "@/components/shared/PagePlaceholder";
import { useLabel } from "@/lib/labels/useLabel";

/**
 * Calendário da empresa (rota /calendar/*, recurso `calendar`, item em Visão Geral). Página provisória: a Tarefa 5 do
 * redesign troca o conteúdo (CalendarView, fontes por link iCal em calendar_sources, eventos em calendar_events,
 * filtro por funcionário e exportação da agenda da empresa) sem mexer em rota, sidebar nem RBAC.
 */
export default function CalendarPage() {
  const title = useLabel("module.calendar");
  return (
    <PagePlaceholder
      title={title}
      icon={CalendarDays}
      message="Aqui vão aparecer as ausências, reuniões e as agendas conectadas por link (Google Agenda, iCloud, Outlook)."
    />
  );
}
