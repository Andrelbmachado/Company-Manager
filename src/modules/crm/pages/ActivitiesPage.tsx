import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CalendarView, type CalendarItem } from "@/components/shared/CalendarView";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageToolbar } from "@/components/shared/PageToolbar";
import { StatCard } from "@/components/shared/StatCard";
import { ACTIVITY_KIND_LABELS, ACTIVITY_KINDS, activityState, type ActivityState } from "@/lib/crm/activities";
import { fold } from "@/lib/crm/queries";
import { cn } from "@/lib/utils";
import type { CrmActivity } from "@/types";
import { ViewSwitch, type ListOrCalendar } from "@/modules/catalog/components/inline";
import { ActivitiesTable } from "../components/Activities";
import { ENTITY_LABELS, entityHref } from "../components/format";
import { SELECT } from "../components/ui";
import { useActivities, useCompanyUsers, useCrmSession, useEntityNames } from "../components/useCrm";

type StateFilter = "" | "abertas" | ActivityState;

const STATE_OPTIONS: { value: StateFilter; label: string }[] = [
  { value: "abertas", label: "A fazer" },
  { value: "atrasada", label: "Atrasadas" },
  { value: "hoje", label: "Para hoje" },
  { value: "feita", label: "Feitas" },
  { value: "", label: "Todas" },
];

const MANAGERS = new Set(["ceo", "admin", "gerente"]);

/**
 * Agenda do CRM: ligações, reuniões, e-mails, tarefas e notas de todos os registros, numa tabela editável (os atrasados
 * em destaque) ou no calendário pelo prazo; clicar no calendário abre o registro da atividade.
 */
export default function ActivitiesPage() {
  const { userId, role } = useCrmSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { data: activities = [], isLoading } = useActivities();
  const { data: users = [] } = useCompanyUsers();
  const entityNames = useEntityNames();
  const initialState = params.get("estado");
  const [state, setState] = useState<StateFilter>(STATE_OPTIONS.some((option) => option.value === initialState) ? (initialState as StateFilter) : "abertas");
  const [kind, setKind] = useState("");
  const [owner, setOwner] = useState(MANAGERS.has(role) ? "" : "me");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<ListOrCalendar>("lista");

  const mine = useMemo(() => {
    const ownerId = owner === "me" ? userId : owner;
    return activities.filter((activity) => !ownerId || activity.user_id === ownerId);
  }, [activities, owner, userId]);
  const counts = useMemo(() => {
    const result = { abertas: 0, atrasada: 0, hoje: 0, semana: 0 };
    const weekAgo = Date.now() - 7 * 86_400_000;
    for (const activity of mine) {
      const current = activityState(activity);
      if (current !== "feita") result.abertas += 1;
      if (current === "atrasada") result.atrasada += 1;
      if (current === "hoje") result.hoje += 1;
      if (current === "feita" && new Date(activity.done_at ?? 0).getTime() >= weekAgo) result.semana += 1;
    }
    return result;
  }, [mine]);

  const filtered = useMemo(() => {
    const term = fold(search.trim());
    const list = mine.filter((activity) => {
      const current = activityState(activity);
      if (state === "abertas" && current === "feita") return false;
      if (state && state !== "abertas" && current !== state) return false;
      if (kind && activity.kind !== kind) return false;
      if (!term) return true;
      return [activity.subject, activity.body, activity.outcome, entityNames.name(activity.entity_type, activity.entity_id), entityNames.customer(activity.customer_id)].some((field) => fold(field).includes(term));
    });
    // A fazer: prazo mais próximo primeiro (sem prazo no fim); feitas: mais recentes primeiro.
    const pendingFirst = (a: CrmActivity, b: CrmActivity) => String(a.due_at ?? "9999").localeCompare(String(b.due_at ?? "9999"));
    return state === "feita" || state === "" ? list : [...list].sort(pendingFirst);
  }, [mine, state, kind, search, entityNames]);

  const calendarItems: CalendarItem[] = filtered
    .filter((activity) => activity.due_at)
    .map((activity) => ({
      id: activity.id,
      title: `${activity.subject ?? ACTIVITY_KIND_LABELS[activity.kind]}${entityNames.name(activity.entity_type, activity.entity_id) ? ` · ${entityNames.name(activity.entity_type, activity.entity_id)}` : ""}`,
      start: activity.due_at!,
      sourceLabel: `${ACTIVITY_KIND_LABELS[activity.kind]} · ${ENTITY_LABELS[activity.entity_type]}${activity.done_at ? " (feita)" : ""}`,
    }));

  // Os mesmos filtros na barra da tabela (lista) e na barra do calendário.
  const filterBar = (
    <PageToolbar search={search} onSearchChange={setSearch} searchPlaceholder="Buscar por assunto, cliente, oportunidade...">
      <select value={state} onChange={(event) => setState(event.target.value as StateFilter)} aria-label="Filtrar por situação" className={SELECT}>
        {STATE_OPTIONS.map((option) => <option key={option.value || "todas"} value={option.value}>{option.label}</option>)}
      </select>
      <select value={kind} onChange={(event) => setKind(event.target.value)} aria-label="Filtrar por tipo" className={SELECT}>
        <option value="">Todos os tipos</option>
        {ACTIVITY_KINDS.map((option) => <option key={option} value={option}>{ACTIVITY_KIND_LABELS[option]}</option>)}
      </select>
      <select value={owner} onChange={(event) => setOwner(event.target.value)} aria-label="Filtrar por responsável" className={SELECT}>
        <option value="">Todos os responsáveis</option>
        <option value="me">Minhas</option>
        {users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
      </select>
    </PageToolbar>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Atividades"
        actions={<ViewSwitch value={view} onChange={setView} label="Ver atividades em" />}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="A fazer" value={counts.abertas} />
        <StatCard title="Atrasadas" value={<span className={cn(counts.atrasada > 0 && "text-destructive")}>{counts.atrasada}</span>} />
        <StatCard title="Para hoje" value={counts.hoje} />
        <StatCard title="Feitas em 7 dias" value={counts.semana} />
      </div>

      {/* A lista fica montada (só escondida) enquanto o calendário aparece: o rascunho não se perde em silêncio. */}
      <div hidden={view !== "lista"}>
        <ActivitiesTable
          activities={filtered}
          loading={isLoading}
          showEntity
          title="Atividades"
          actions={filterBar}
          emptyMessage={activities.length ? (state === "atrasada" ? "Nenhum follow-up atrasado" : "Nenhuma atividade com esses filtros") : undefined}
        />
      </div>
      {view === "calendario" && (
        <CalendarView
          items={calendarItems}
          label="Agenda do CRM"
          toolbar={filterBar}
          onSelect={(item) => {
            const activity = filtered.find((row) => row.id === item.id);
            const href = activity ? entityHref(activity.entity_type, activity.entity_id, activity.customer_id) : null;
            if (href) navigate(href);
          }}
        />
      )}
    </div>
  );
}
