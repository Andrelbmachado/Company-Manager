// Aba "Eventos do app": reuniões, ausências, férias e eventos criados no app, editados na própria tabela. Horas em
// São Paulo; no dia inteiro o Fim é o último dia (inclusivo). Eventos das agendas conectadas não entram aqui: mudam
// na agenda de origem. Ausências aprovadas no RH aparecem no calendário, mas são alteradas no RH.
import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { EditableTable, type EditableColumn, type EditableTableChanges } from "@/components/shared/EditableTable";
import { todayIn } from "@/components/shared/calendar/layout";
import { getDb } from "@/lib/db/client";
import { confirmAction } from "@/lib/confirm";
import { EVENT_KIND_LABEL } from "@/lib/calendar/feed";
import { canDeleteEvent, deleteLocalEvent, LOCAL_EVENT_KINDS, saveLocalEvents, type CalendarActor, type LocalEventInput } from "@/lib/calendar/store";
import type { CalendarEvent } from "@/types";
import { COMPANY_OWNER, eventInput, ownerUserId, sortEventRows, toEventRow, type EventRow } from "../eventRows";
import type { PersonOption } from "./SourcesTab";

interface EventsTabProps {
  actor: CalendarActor;
  events: CalendarEvent[];
  people: PersonOption[];
  canEdit: boolean;
  loading: boolean;
  onRefresh(): Promise<unknown>;
}

const ROW_BUTTON = "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground";
export const KIND_OPTIONS = LOCAL_EVENT_KINDS.map((kind) => ({ value: kind, label: EVENT_KIND_LABEL[kind] }));

/** Erro de uma linha com o título dela na frente (a tabela pode ter várias linhas alteradas). */
function rowInput(row: Partial<EventRow>): LocalEventInput {
  try {
    return eventInput(row);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(row.title ? `${row.title}: ${message}` : message);
  }
}

export function EventsTab({ actor, events, people, canEdit, loading, onRefresh }: EventsTabProps) {
  const [error, setError] = useState<string | null>(null);
  const local = useMemo(() => events.filter((event) => !event.source_id), [events]);
  const rows = useMemo(() => sortEventRows(local.map(toEventRow), todayIn()), [local]);
  const columns = useMemo<EditableColumn<EventRow>[]>(
    () => [
      { key: "title", header: "Título", kind: "text", required: true, width: 220 },
      { key: "kind", header: "Tipo", kind: "select", required: true, options: KIND_OPTIONS },
      { key: "all_day", header: "Dia inteiro", kind: "bool" },
      { key: "start_day", header: "Início", kind: "date", required: true },
      { key: "start_time", header: "Hora de início", kind: "text", placeholder: "09:00" },
      { key: "end_day", header: "Fim", kind: "date" },
      { key: "end_time", header: "Hora de fim", kind: "text", placeholder: "10:00" },
      { key: "person", header: "Pessoa", kind: "select", required: true, readOnly: !canEdit, options: [{ value: COMPANY_OWNER, label: "Empresa (todos)" }, ...people] },
      { key: "location", header: "Local", kind: "text" },
    ],
    [canEdit, people],
  );

  async function save({ created, updated }: EditableTableChanges<EventRow>) {
    setError(null);
    const byId = new Map(rows.map((row) => [row.id, row]));
    const updates = updated.map((patch) => {
      const input: LocalEventInput & { id: string } = { ...rowInput({ ...byId.get(patch.id), ...patch }), id: patch.id };
      if (patch.person !== undefined) input.user_id = ownerUserId(patch.person);
      return input;
    });
    const creates = created.map((values) => ({ ...rowInput(values), user_id: ownerUserId(values.person) }));
    await saveLocalEvents(await getDb(), actor, { created: creates, updated: updates });
  }

  async function remove(row: EventRow) {
    setError(null);
    if (!(await confirmAction(`Excluir o evento "${row.title}"?`, { title: "Excluir evento", okLabel: "Excluir" }))) return;
    try {
      await deleteLocalEvent(await getDb(), actor, row.id);
      await onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível excluir o evento.");
    }
  }

  return (
    <div className="space-y-4">
      {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
      <EditableTable<EventRow>
        resource="calendar"
        label="Eventos do app"
        title="Eventos do app"
        rows={rows}
        columns={columns}
        loading={loading}
        onSave={save}
        onRefresh={onRefresh}
        newRow={() => ({ kind: "evento", all_day: 1, start_day: todayIn(), person: actor.userId })}
        emptyMessage="Nenhum evento criado no app. Use Adicionar ou clique num dia do calendário."
        rowActions={(row) => {
          const event = local.find((item) => item.id === row.id);
          return event && canDeleteEvent(actor, event) ? (
            <button type="button" className={ROW_BUTTON} onClick={() => void remove(row)}>
              <Trash2 size={13} /> Excluir
            </button>
          ) : null;
        }}
      />
      <p className="text-xs text-muted-foreground">
        Horas no horário de Brasília (09:30, 9h30). Com Dia inteiro marcado, Fim é o último dia e as horas são ignoradas. Ausências aprovadas no RH aparecem no calendário e são
        alteradas no RH.
      </p>
    </div>
  );
}
