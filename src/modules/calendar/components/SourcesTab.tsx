// Menu "Agendas conectadas" do calendário: agendas por link iCal editadas na própria tabela (sem modal) e o botão
// Sincronizar agora. Quem não gerencia o
// calendário conecta só no próprio nome; o link (endereço secreto, dá acesso à agenda) só aparece inteiro para
// quem pode alterar aquela agenda.
import { useMemo, useState } from "react";
import { RefreshCw, Trash2 } from "lucide-react";
import { EditableTable, type EditableColumn, type EditableTableChanges } from "@/components/shared/EditableTable";
import { getDb } from "@/lib/db/client";
import { confirmAction } from "@/lib/confirm";
import { emit } from "@/lib/events/bus";
import { canDeleteSource, canManageSource, saveSources, deleteSource, type CalendarActor, type SourceInput } from "@/lib/calendar/store";
import { formatDateTime } from "@/lib/utils";
import type { CalendarSource } from "@/types";
import { COMPANY_OWNER, ownerUserId, ownerValue } from "../eventRows";

interface SourceRow {
  id: string;
  name: string;
  url: string;
  person: string;
  last_error: string | null;
  last_sync_at: string | null;
}

export interface PersonOption {
  value: string;
  label: string;
}

interface SourcesTabProps {
  actor: CalendarActor;
  sources: CalendarSource[];
  people: PersonOption[];
  canEdit: boolean;
  syncing: boolean;
  loading: boolean;
  onRefresh(): Promise<unknown>;
  /** Depois de gravar: sincroniza as agendas novas ou com link trocado. */
  onSaved(): void;
  onSync(sourceId: string): Promise<void>;
  /** Sincroniza todas as agendas. */
  onSyncAll(): void;
}

const SYNC_BUTTON = "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50";
const ROW_BUTTON = "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50";

/** Só protocolo e servidor: o resto do link de uma agenda pública costuma ser o segredo. */
function maskUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}/…`;
  } catch {
    return "…";
  }
}

function status(row: SourceRow) {
  if (row.last_error) return <span className="block min-w-[16rem] text-destructive">{row.last_error}</span>;
  if (row.last_sync_at) return <span className="text-muted-foreground">Sincronizada em {formatDateTime(row.last_sync_at)}</span>;
  return <span className="text-muted-foreground">Aguardando sincronização</span>;
}

function toInput(row: Partial<SourceRow>): SourceInput {
  const input: SourceInput = {};
  if (row.name !== undefined) input.name = row.name;
  if (row.url !== undefined) input.url = row.url;
  if (row.person !== undefined) input.user_id = ownerUserId(row.person);
  return input;
}

export function SourcesTab({ actor, sources, people, canEdit, syncing, loading, onRefresh, onSaved, onSync, onSyncAll }: SourcesTabProps) {
  const [error, setError] = useState<string | null>(null);
  const rows = useMemo<SourceRow[]>(
    () =>
      sources.map((source) => ({
        id: source.id,
        name: source.name,
        url: canManageSource(actor, source) ? (source.url ?? "") : maskUrl(source.url ?? ""),
        person: ownerValue(source.user_id),
        last_error: source.last_error ?? null,
        last_sync_at: source.last_sync_at ?? null,
      })),
    [actor, sources],
  );
  const columns = useMemo<EditableColumn<SourceRow>[]>(
    () => [
      { key: "name", header: "Nome", kind: "text", required: true, placeholder: "Ex.: Agenda do técnico", width: 200 },
      { key: "url", header: "Link iCal", kind: "text", required: true, placeholder: "https://… ou webcal://… (.ics)", render: (row) => <span className="block min-w-[12rem] break-all">{row.url}</span> },
      { key: "person", header: "Pessoa", kind: "select", required: true, readOnly: !canEdit, options: [{ value: COMPANY_OWNER, label: "Empresa (todos)" }, ...people], width: 180 },
      { key: "last_error", header: "Situação", kind: "text", readOnly: true, render: status },
    ],
    [canEdit, people],
  );

  async function save({ created, updated }: EditableTableChanges<SourceRow>) {
    setError(null);
    const db = await getDb();
    const ids = await saveSources(db, actor, { created: created.map(toInput), updated: updated.map((row) => ({ ...toInput(row), id: row.id })) });
    await Promise.all(
      ids.map((id, index) =>
        emit({ type: "calendar.source_connected", companyId: actor.companyId, actorId: actor.userId, entityType: "calendar_source", entityId: id, title: `Agenda conectada: ${created[index]?.name ?? ""}`.trim(), module: "calendar" }),
      ),
    );
    onSaved();
  }

  async function remove(row: SourceRow) {
    setError(null);
    const ok = await confirmAction(`Excluir a agenda "${row.name}"? Os eventos dela saem do calendário do app (a agenda de origem não muda).`, { title: "Excluir agenda", okLabel: "Excluir" });
    if (!ok) return;
    try {
      await deleteSource(await getDb(), actor, row.id);
      await emit({ type: "calendar.source_deleted", companyId: actor.companyId, actorId: actor.userId, entityType: "calendar_source", entityId: row.id, title: `Agenda excluída: ${row.name}`, module: "calendar" });
      await onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível excluir a agenda.");
    }
  }

  return (
    <div className="space-y-4">
      <details className="rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground">Como pegar o link (.ics)</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Google Agenda: Configurações → escolha a agenda → Integrar agenda → “Endereço secreto no formato iCal”.</li>
          <li>iCloud: app Calendário → compartilhar a agenda → marque “Agenda pública” → copie o link (webcal://).</li>
          <li>Outlook: Configurações → Calendário → Calendários compartilhados → Publicar um calendário → link ICS.</li>
        </ul>
      </details>
      {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
      <EditableTable<SourceRow>
        resource="calendar"
        label="Agendas conectadas"
        title="Agendas conectadas"
        rows={rows}
        columns={columns}
        loading={loading}
        onSave={save}
        onRefresh={onRefresh}
        newRow={() => ({ person: actor.userId })}
        emptyMessage="Nenhuma agenda conectada"
        actions={
          <button type="button" className={SYNC_BUTTON} disabled={syncing || !sources.length} onClick={onSyncAll}>
            <RefreshCw size={14} className={syncing ? "animate-spin" : undefined} /> {syncing ? "Sincronizando..." : "Sincronizar agora"}
          </button>
        }
        rowActions={(row) => {
          const source = sources.find((item) => item.id === row.id);
          return (
            <span className="inline-flex gap-1">
              <button type="button" className={ROW_BUTTON} disabled={syncing} onClick={() => void onSync(row.id)}>
                <RefreshCw size={13} /> Sincronizar
              </button>
              {source && canDeleteSource(actor, source) && (
                <button type="button" className={ROW_BUTTON} onClick={() => void remove(row)}>
                  <Trash2 size={13} /> Excluir
                </button>
              )}
            </span>
          );
        }}
      />
    </div>
  );
}
