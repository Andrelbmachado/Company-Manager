// Calendário da empresa: CalendarView com presença e ausências dos funcionários, eventos do app e agendas conectadas;
// filtro por funcionário na barra do calendário, formulário no próprio lugar ao clicar num dia ou horário vazio e
// detalhes do item escolhido (sem modal). A presença é montada só para o período na tela (dia, semana ou mês).
import { useMemo, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { CalendarView, type CalendarItem, type CalendarRange } from "@/components/shared/CalendarView";
import { diffDays } from "@/components/shared/calendar/layout";
import { getDb } from "@/lib/db/client";
import { confirmAction } from "@/lib/confirm";
import { EVENT_KIND_LABEL } from "@/lib/calendar/feed";
import {
  canDeleteEvent,
  createLocalEvent,
  deleteLocalEvent,
  LOCAL_EVENT_KINDS,
  parsePersonFilter,
  presenceItems,
  type CalendarActor,
  type CalendarData,
  type CalendarEntry,
  type LocalEventInput,
} from "@/lib/calendar/store";
import type { CalendarEventKind } from "@/types";
import { COMPANY_OWNER, describeWhen, ownerUserId } from "../eventRows";
import type { PersonOption } from "./SourcesTab";

const KIND_OPTIONS = LOCAL_EVENT_KINDS.map((kind) => ({ value: kind, label: EVENT_KIND_LABEL[kind] }));
/** Acima disso (visão Ano) a presença não é montada: seriam milhares de itens e o ano mostra só a contagem. */
const PRESENCE_MAX_DAYS = 42;

interface CalendarTabProps {
  actor: CalendarActor;
  data: CalendarData | null;
  /** Agendas, eventos do app e ausências do RH (já filtrados pela pessoa). */
  entries: CalendarEntry[];
  /** Contas da empresa (dono do evento). */
  people: PersonOption[];
  /** Opções do filtro "Funcionário": as contas e os colaboradores sem conta no app. */
  filterOptions: PersonOption[];
  person: string;
  onPersonChange(value: string): void;
  /** Dia para abrir na visão Dia (link das datas do Meu RH). */
  focusDay?: string;
  canCreate: boolean;
  canEdit: boolean;
  onChanged(): Promise<unknown>;
}

interface Draft {
  start: string;
  allDay: boolean;
}

const BUTTON = "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50";
const PRIMARY = "inline-flex items-center gap-1.5 rounded-md border border-transparent bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50";
const FIELD = "h-9 rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring";
const ONE_HOUR = 60 * 60_000;

const ORIGIN_TEXT: Record<CalendarEntry["origin"], string> = {
  agenda: "Agenda conectada: altere na agenda de origem.",
  app: "Criado no app.",
  rh: "Ausência aprovada no RH: altere no RH.",
  presenca: "Na empresa neste dia (sem ausência aprovada no RH).",
};

const message = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);

export function CalendarTab({ actor, data, entries, people, filterOptions, person, onPersonChange, focusDay, canCreate, canEdit, onChanged }: CalendarTabProps) {
  const [range, setRange] = useState<CalendarRange | null>(null);
  const items = useMemo(() => {
    if (!data || !range || diffDays(range.start, range.end) > PRESENCE_MAX_DAYS) return entries;
    return [...entries, ...presenceItems(data, range.start, range.end, parsePersonFilter(person))];
  }, [data, entries, range, person]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<CalendarEventKind>("evento");
  const [owner, setOwner] = useState(actor.userId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const names = useMemo(() => new Map(people.map((option) => [option.value, option.label])), [people]);
  const selected = selectedId ? items.find((entry) => entry.id === selectedId) ?? null : null;

  function openDraft(start: string, options: { allDay: boolean }) {
    setSelectedId(null);
    setError(null);
    setDraft({ start, allDay: options.allDay });
    setTitle("");
    setKind(options.allDay ? "evento" : "reuniao");
    setOwner(actor.userId);
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!draft || busy) return;
    setBusy(true);
    setError(null);
    try {
      const input: LocalEventInput = {
        title,
        kind,
        all_day: draft.allDay ? 1 : 0,
        starts_at: draft.start,
        ends_at: draft.allDay ? null : new Date(Date.parse(draft.start) + ONE_HOUR).toISOString(),
      };
      if (canEdit) input.user_id = ownerUserId(owner);
      await createLocalEvent(await getDb(), actor, input);
      setDraft(null);
      await onChanged();
    } catch (cause) {
      setError(message(cause, "Não foi possível criar o evento."));
    } finally {
      setBusy(false);
    }
  }

  async function remove(entry: CalendarEntry) {
    if (!entry.event) return;
    if (!(await confirmAction(`Excluir o evento "${entry.title}"?`, { title: "Excluir evento", okLabel: "Excluir" }))) return;
    setError(null);
    try {
      await deleteLocalEvent(await getDb(), actor, entry.event.id);
      setSelectedId(null);
      await onChanged();
    } catch (cause) {
      setError(message(cause, "Não foi possível excluir o evento."));
    }
  }

  return (
    <div className="space-y-4">
      {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}

      {draft && (
        <form aria-label="Novo evento" onSubmit={(event) => void create(event)} className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4">
          <p className="w-full text-sm font-medium">Novo evento: {describeWhen(draft.start, null, draft.allDay)}</p>
          <label className="flex min-w-[14rem] flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground">
            Título
            <input aria-label="Título do novo evento" value={title} maxLength={300} autoFocus onChange={(event) => setTitle(event.target.value)} className={`${FIELD} text-foreground`} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            Tipo
            <select aria-label="Tipo do novo evento" value={kind} onChange={(event) => setKind(event.target.value as CalendarEventKind)} className={`${FIELD} text-foreground`}>
              {KIND_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          {canEdit && (
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              Pessoa
              <select aria-label="Pessoa do novo evento" value={owner} onChange={(event) => setOwner(event.target.value)} className={`${FIELD} text-foreground`}>
                <option value={COMPANY_OWNER}>Empresa (todos)</option>
                {people.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          )}
          <div className="flex gap-2">
            <button type="submit" className={PRIMARY} disabled={busy}>{busy ? "Criando..." : "Criar evento"}</button>
            <button type="button" className={BUTTON} disabled={busy} onClick={() => setDraft(null)}>Cancelar</button>
          </div>
        </form>
      )}

      {selected && (
        <section aria-label="Evento selecionado" className="rounded-xl border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <h3 className="text-base font-semibold">{selected.title}</h3>
              <p className="text-sm">{describeWhen(selected.start, selected.end, !!selected.allDay)}</p>
              <p className="text-sm text-muted-foreground">
                {selected.sourceLabel} · {selected.personName ?? (selected.userId ? names.get(selected.userId) ?? "Pessoa sem acesso ao app" : "Empresa")}
              </p>
              {selected.location && <p className="text-sm text-muted-foreground">Local: {selected.location}</p>}
              {selected.description && <p className="whitespace-pre-line text-sm text-muted-foreground">{selected.description}</p>}
              <p className="text-xs text-muted-foreground">{ORIGIN_TEXT[selected.origin]}</p>
            </div>
            <button type="button" aria-label="Fechar detalhes" className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => setSelectedId(null)}>
              <X size={16} />
            </button>
          </div>
          {selected.event && canDeleteEvent(actor, selected.event) && (
            <div className="mt-3 flex gap-2">
              <button type="button" className={BUTTON} onClick={() => void remove(selected)}>Excluir evento</button>
            </div>
          )}
        </section>
      )}

      <CalendarView
        items={items}
        view={focusDay ? "day" : "month"}
        date={focusDay}
        maxPerDay={6}
        onRangeChange={setRange}
        toolbar={
          <select aria-label="Funcionário" value={person} onChange={(event) => onPersonChange(event.target.value)} className={`${FIELD} h-8 w-full min-w-0 text-foreground sm:w-56`}>
            <option value="">Todos os funcionários</option>
            {filterOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        }
        label="Calendário da empresa"
        onSelect={(item: CalendarItem) => {
          setDraft(null);
          setSelectedId(item.id);
        }}
        onCreate={canCreate ? openDraft : undefined}
      />
    </div>
  );
}
