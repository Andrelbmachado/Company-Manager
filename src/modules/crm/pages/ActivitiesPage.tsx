import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CalendarCheck, Plus } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageToolbar } from "@/components/shared/PageToolbar";
import { StatCard } from "@/components/shared/StatCard";
import { ACTIVITY_KIND_LABELS, ACTIVITY_KINDS, activityState, type ActivityState } from "@/lib/crm/activities";
import { fold } from "@/lib/crm/queries";
import { cn } from "@/lib/utils";
import type { CrmActivity } from "@/types";
import { ActivityFormDialog, ActivityItem, useActivityActions } from "../components/Activities";
import { BTN_PRIMARY, CARD, SELECT } from "../components/ui";
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

/** Agenda do CRM: ligações, reuniões, e-mails, tarefas e notas de todos os registros, com os atrasados em destaque. */
export default function ActivitiesPage() {
  const { userId, role, can } = useCrmSession();
  const [params] = useSearchParams();
  const { data: activities = [], isLoading } = useActivities();
  const { data: users = [], names } = useCompanyUsers();
  const entityNames = useEntityNames();
  const { handlers, dialogs } = useActivityActions();
  const initialState = params.get("estado");
  const [state, setState] = useState<StateFilter>(STATE_OPTIONS.some((option) => option.value === initialState) ? (initialState as StateFilter) : "abertas");
  const [kind, setKind] = useState("");
  const [owner, setOwner] = useState(MANAGERS.has(role) ? "" : "me");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);

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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Atividades"
        description="Ligações, reuniões, e-mails e tarefas com clientes"
        actions={can("create", "crm_activities") ? <button type="button" onClick={() => setCreating(true)} className={BTN_PRIMARY}><Plus size={14} /> Nova atividade</button> : undefined}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="A fazer" value={counts.abertas} />
        <StatCard title="Atrasadas" value={<span className={cn(counts.atrasada > 0 && "text-destructive")}>{counts.atrasada}</span>} hint="prazo já passou" />
        <StatCard title="Para hoje" value={counts.hoje} />
        <StatCard title="Feitas em 7 dias" value={counts.semana} />
      </div>

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

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, index) => <div key={index} className="h-14 animate-pulse rounded-lg bg-muted/30" />)}</div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={CalendarCheck} title={activities.length ? "Nenhuma atividade com esses filtros" : "Nenhuma atividade"} description={state === "atrasada" ? "Nenhum follow-up atrasado. Tudo em dia." : "Registre ligações, reuniões e próximos passos nas fichas dos clientes ou aqui."} />
      ) : (
        <ul className={cn(CARD, "divide-y px-5")}>
          {filtered.map((activity) => (
            <ActivityItem
              key={activity.id}
              activity={activity}
              showEntity
              userName={activity.user_id ? names.get(activity.user_id) : null}
              entityName={entityNames.name(activity.entity_type, activity.entity_id)}
              customerName={entityNames.customer(activity.customer_id)}
              {...handlers(activity)}
            />
          ))}
        </ul>
      )}

      {creating && <ActivityFormDialog onClose={() => setCreating(false)} />}
      {dialogs}
    </div>
  );
}
