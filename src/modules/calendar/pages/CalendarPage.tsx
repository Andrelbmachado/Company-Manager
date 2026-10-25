// Calendário da empresa (rota /calendar/*, recurso `calendar`, item em Visão Geral): ausências aprovadas no RH,
// eventos criados no app e agendas conectadas por link iCal (Google Agenda, iCloud, Outlook). Sincroniza as agendas
// ao abrir a tela e a cada 15 minutos; "Exportar agenda da empresa" salva um .ics para importar em outra agenda.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { TabList, TabPanel } from "@/components/shared/Tabs";
import { usePermission } from "@/hooks/usePermission";
import { useRequiredSession } from "@/hooks/useSession";
import { defaultCalendarFetcher } from "@/lib/calendar/fetcher";
import { calendarItems, exportCompanyCalendar, loadCalendarData, type CalendarActor } from "@/lib/calendar/store";
import { syncCompanySources, syncSource, SYNC_INTERVAL_MINUTES } from "@/lib/calendar/sync";
import { fetchCompanyUsers } from "@/lib/crm/queries";
import { getDb } from "@/lib/db/client";
import { emit } from "@/lib/events/bus";
import { saveBlobAs } from "@/lib/files/saveAs";
import { useLabel } from "@/lib/labels/useLabel";
import { cn } from "@/lib/utils";
import type { Role } from "@/types";
import { CalendarTab } from "../components/CalendarTab";
import { EventsTab } from "../components/EventsTab";
import { SourcesTab, type PersonOption } from "../components/SourcesTab";

type TabId = "calendario" | "agendas" | "eventos";

const TABS: readonly { id: TabId; label: string }[] = [
  { id: "calendario", label: "Calendário" },
  { id: "agendas", label: "Agendas conectadas" },
  { id: "eventos", label: "Eventos do app" },
];

/** Ao abrir a tela, pula as agendas lidas com sucesso há menos que isso (ir e voltar de tela não baixa tudo de novo). */
const OPEN_SYNC_MINUTES = 5;
const NO_EXPORT = "Seu perfil não tem permissão para exportar a agenda da empresa.";
const BUTTON = "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50";

interface Notice {
  kind: "status" | "error";
  text: string;
}

const message = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);

export default function CalendarPage() {
  const session = useRequiredSession();
  const companyId = session.company.id;
  const userId = session.user.id;
  const role = session.membership.role as Role;
  const actor = useMemo<CalendarActor>(() => ({ companyId, userId, role }), [companyId, userId, role]);
  const title = useLabel("module.calendar");
  const canCreate = usePermission("create", "calendar");
  const canEdit = usePermission("edit", "calendar");
  const canExport = usePermission("export", "calendar");
  const queryClient = useQueryClient();
  const dataKey = useMemo(() => ["calendar", companyId], [companyId]);

  const data = useQuery({ queryKey: dataKey, queryFn: async () => loadCalendarData(await getDb(), companyId) });
  const users = useQuery({ queryKey: ["calendar", companyId, "users"], queryFn: async () => fetchCompanyUsers(await getDb(), companyId) });

  const [tab, setTab] = useState<TabId>("calendario");
  const [person, setPerson] = useState("");
  const [syncing, setSyncing] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(() => queryClient.invalidateQueries({ queryKey: dataKey, exact: true }), [queryClient, dataKey]);

  /** Sincroniza uma agenda, as vencidas (olderThanMinutes) ou todas. O erro de cada agenda fica em last_error. */
  const sync = useCallback(
    async (scope: { sourceId?: string; olderThanMinutes?: number } = {}) => {
      setSyncing((count) => count + 1);
      try {
        const db = await getDb();
        if (scope.sourceId) await syncSource(db, scope.sourceId, defaultCalendarFetcher);
        else await syncCompanySources(db, companyId, defaultCalendarFetcher, { olderThanMinutes: scope.olderThanMinutes });
      } catch (error) {
        if (mounted.current) setNotice({ kind: "error", text: message(error, "Não foi possível sincronizar as agendas.") });
      } finally {
        if (mounted.current) {
          setSyncing((count) => count - 1);
          await refresh();
        }
      }
    },
    [companyId, refresh],
  );

  useEffect(() => {
    void sync({ olderThanMinutes: OPEN_SYNC_MINUTES });
    const timer = window.setInterval(() => void sync({ olderThanMinutes: OPEN_SYNC_MINUTES }), SYNC_INTERVAL_MINUTES * 60_000);
    return () => window.clearInterval(timer);
  }, [sync]);

  const people = useMemo<PersonOption[]>(
    () => (users.data ?? []).map((user) => ({ value: user.id, label: user.name })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
    [users.data],
  );
  const entries = useMemo(() => (data.data ? calendarItems(data.data, { userId: person || null }) : []), [data.data, person]);
  const sources = data.data?.sources ?? [];
  const failing = sources.filter((source) => source.last_error).length;

  async function exportFeed() {
    setExporting(true);
    setNotice(null);
    try {
      const text = await exportCompanyCalendar(await getDb(), actor);
      const saved = await saveBlobAs(new Blob([text], { type: "text/calendar;charset=utf-8" }), "agenda-da-empresa.ics", {
        title: "Exportar agenda da empresa",
        filters: [{ name: "Agenda iCal", extensions: ["ics"] }],
      });
      if (!saved) return;
      await emit({ type: "calendar.exported", companyId, actorId: userId, entityType: "company", entityId: companyId, title: "Agenda da empresa exportada (.ics)", module: "calendar" });
      setNotice({
        kind: "status",
        text: "Agenda salva. Importe o arquivo .ics no Google Agenda, iCloud ou Outlook; é uma cópia de agora, então exporte de novo quando houver mudanças.",
      });
    } catch (error) {
      setNotice({ kind: "error", text: message(error, "Não foi possível exportar a agenda.") });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        description="Ausências, reuniões e agendas conectadas por link (Google Agenda, iCloud, Outlook)."
        className="pb-0"
        actions={
          <>
            <button type="button" className={BUTTON} disabled={syncing > 0 || !sources.length} onClick={() => void sync()}>
              <RefreshCw size={14} className={cn(syncing > 0 && "animate-spin")} /> {syncing > 0 ? "Sincronizando..." : "Sincronizar agora"}
            </button>
            <button
              type="button"
              className={BUTTON}
              disabled={!canExport || exporting}
              title={canExport ? "Salva um arquivo .ics com ausências e reuniões para importar em outra agenda" : NO_EXPORT}
              onClick={() => void exportFeed()}
            >
              <Download size={14} /> Exportar agenda da empresa
            </button>
          </>
        }
      />

      {(failing > 0 || notice || data.error) && (
        <div className="space-y-1 text-sm">
          {failing > 0 && (
            <p>
              <button type="button" className="font-medium text-destructive underline-offset-2 hover:underline" onClick={() => setTab("agendas")}>
                {failing === 1 ? "1 agenda com erro" : `${failing} agendas com erro`}
              </button>{" "}
              <span className="text-muted-foreground">— o motivo aparece em Agendas conectadas; os eventos já lidos continuam no calendário.</span>
            </p>
          )}
          {data.error && <p role="alert" className="font-medium text-destructive">{message(data.error, "Não foi possível carregar o calendário.")}</p>}
          {notice &&
            (notice.kind === "error" ? (
              <p role="alert" className="font-medium text-destructive">{notice.text}</p>
            ) : (
              <p role="status" className="text-muted-foreground">{notice.text}</p>
            ))}
        </div>
      )}

      <TabList tabs={TABS} value={tab} onChange={setTab} label="Seções do calendário" idPrefix="calendario" />

      {/* As abas ficam montadas (só escondidas): trocar de aba não descarta em silêncio o rascunho das tabelas. */}
      <div hidden={tab !== "calendario"}>
        <TabPanel idPrefix="calendario" id="calendario">
          <CalendarTab
            actor={actor}
            entries={entries}
            people={people}
            person={person}
            onPersonChange={setPerson}
            canCreate={canCreate}
            canEdit={canEdit}
            onChanged={refresh}
            onEditEvents={() => setTab("eventos")}
          />
        </TabPanel>
      </div>
      <div hidden={tab !== "agendas"}>
        <TabPanel idPrefix="calendario" id="agendas">
          <SourcesTab
            actor={actor}
            sources={sources}
            people={people}
            canEdit={canEdit}
            syncing={syncing > 0}
            loading={data.isLoading}
            onRefresh={refresh}
            onSaved={() => void sync({ olderThanMinutes: OPEN_SYNC_MINUTES })}
            onSync={(sourceId) => sync({ sourceId })}
          />
        </TabPanel>
      </div>
      <div hidden={tab !== "eventos"}>
        <TabPanel idPrefix="calendario" id="eventos">
          <EventsTab actor={actor} events={data.data?.events ?? []} people={people} canEdit={canEdit} loading={data.isLoading} onRefresh={refresh} />
        </TabPanel>
      </div>
    </div>
  );
}
