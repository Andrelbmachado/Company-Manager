import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Kanban, Plus, Target } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { ImportExportButtons } from "@/components/shared/ImportExportButtons";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageToolbar } from "@/components/shared/PageToolbar";
import { StatCard } from "@/components/shared/StatCard";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { fold, isStage, OPPORTUNITY_STAGES, pipelineSummary, STAGE_LABELS } from "@/lib/crm/queries";
import { cn, formatCurrency, formatDay, todayIso } from "@/lib/utils";
import type { SavedView } from "@/types";
import { OpportunityDrawer } from "../components/OpportunityDrawer";
import { OpportunityFormDialog } from "../components/OpportunityFormDialog";
import { SavedViewsBar } from "../components/SavedViewsBar";
import { BTN_PRIMARY, BTN_SECONDARY, CARD, LINK, SELECT, TD, TH } from "../components/ui";
import { useCompanyUsers, useCrmSession, useCustomerMap, useInvalidateCrm, useOpportunities } from "../components/useCrm";

interface OpportunityFilters {
  search?: string;
  stage?: string;
  status?: string;
  ownerId?: string;
}

const MANAGERS = new Set(["ceo", "admin", "gerente"]);

function parseFilters(view: SavedView | null): OpportunityFilters {
  if (!view) return {};
  try {
    const parsed = JSON.parse(view.filters_json || "{}") as Record<string, unknown>;
    const pick = (key: string) => (typeof parsed[key] === "string" && parsed[key] ? (parsed[key] as string) : undefined);
    // "owner" é a chave antiga dos filtros de exemplo; "ownerId" a atual.
    return { search: pick("search"), stage: pick("stage"), status: pick("status"), ownerId: pick("ownerId") ?? pick("owner") };
  } catch {
    return {};
  }
}

/** Lista de oportunidades (todas as etapas), com filtros salvos e importação/exportação. O quadro fica em /crm/funil. */
export default function OpportunitiesPage() {
  const { userId, role, can } = useCrmSession();
  const invalidate = useInvalidateCrm();
  const [params, setParams] = useSearchParams();
  const { data: opportunities = [], isLoading } = useOpportunities();
  const { map: customers } = useCustomerMap();
  const { data: users = [], names } = useCompanyUsers();
  const [filters, setFilters] = useState<OpportunityFilters>({ status: "open" });
  const [creating, setCreating] = useState(false);
  const selected = params.get("oportunidade");
  const today = todayIso();
  const set = (patch: Partial<OpportunityFilters>) => setFilters((current) => ({ ...current, ...patch }));

  const filtered = useMemo(() => {
    const term = fold(filters.search?.trim());
    const owner = filters.ownerId === "me" ? userId : filters.ownerId;
    return opportunities.filter((opp) => {
      if (filters.status && opp.status !== filters.status) return false;
      if (filters.stage && isStage(filters.stage) && opp.stage !== filters.stage) return false;
      if (owner === "none" ? !!opp.owner_id : owner && opp.owner_id !== owner) return false;
      if (!term) return true;
      const customer = opp.customer_id ? customers.get(opp.customer_id)?.name : null;
      return [opp.title, customer, opp.source, opp.notes].some((field) => fold(field).includes(term));
    });
  }, [opportunities, customers, filters, userId]);
  const summary = useMemo(() => pipelineSummary(filtered), [filtered]);
  const totalValue = filtered.reduce((sum, opp) => sum + Number(opp.value ?? 0), 0);
  const weighted = OPPORTUNITY_STAGES.reduce((sum, stage) => sum + summary.byStage[stage].weighted, 0);
  const hasFilters = Object.values(filters).some(Boolean);
  const open = (id: string | null) =>
    setParams((current) => {
      const copy = new URLSearchParams(current);
      if (id) copy.set("oportunidade", id);
      else copy.delete("oportunidade");
      return copy;
    });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Oportunidades"
        description="Todas as oportunidades, abertas e fechadas"
        actions={
          <>
            <Link to="/crm/funil" className={BTN_SECONDARY}><Kanban size={14} /> Funil</Link>
            <ImportExportButtons entity="opportunities" onImported={() => invalidate("opportunities")} />
            {can("create", "opportunities") && <button type="button" onClick={() => setCreating(true)} className={BTN_PRIMARY}><Plus size={14} /> Nova oportunidade</button>}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard title="Oportunidades" value={filtered.length} />
        <StatCard title="Valor total" value={formatCurrency(totalValue)} />
        <StatCard title="Valor ponderado" value={formatCurrency(weighted)} />
      </div>

      <PageToolbar search={filters.search ?? ""} onSearchChange={(search) => set({ search })} searchPlaceholder="Buscar por título, cliente, origem...">
        <select value={filters.status ?? ""} onChange={(event) => set({ status: event.target.value || undefined })} aria-label="Filtrar por situação" className={SELECT}>
          <option value="">Abertas e fechadas</option>
          <option value="open">Abertas</option>
          <option value="won">Ganhas</option>
          <option value="lost">Perdidas</option>
        </select>
        <select value={filters.stage ?? ""} onChange={(event) => set({ stage: event.target.value || undefined })} aria-label="Filtrar por etapa" className={SELECT}>
          <option value="">Todas as etapas</option>
          {OPPORTUNITY_STAGES.map((stage) => <option key={stage} value={stage}>{STAGE_LABELS[stage]}</option>)}
        </select>
        <select value={filters.ownerId ?? ""} onChange={(event) => set({ ownerId: event.target.value || undefined })} aria-label="Filtrar por responsável" className={SELECT}>
          <option value="">Todos os responsáveis</option>
          <option value="me">Minhas</option>
          <option value="none">Sem responsável</option>
          {users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
        </select>
      </PageToolbar>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SavedViewsBar entityType="opportunity" current={filters} hasFilters={hasFilters} canShare={MANAGERS.has(role)} onApply={(view) => setFilters(parseFilters(view))} />
        {hasFilters && <button type="button" onClick={() => setFilters({})} className="text-sm text-muted-foreground hover:text-foreground">Limpar filtros</button>}
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, index) => <div key={index} className="h-12 animate-pulse rounded-lg bg-muted/30" />)}</div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={Target} title={opportunities.length ? "Nenhuma oportunidade com esses filtros" : "Nenhuma oportunidade"} description={opportunities.length ? "Ajuste os filtros." : "Crie uma oportunidade ou converta um lead da prospecção."} />
      ) : (
        <div className={cn(CARD, "overflow-x-auto")}>
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className={TH}>Oportunidade</th>
                <th className={TH}>Cliente</th>
                <th className={TH}>Etapa</th>
                <th className={cn(TH, "text-right")}>Valor</th>
                <th className={cn(TH, "text-right")}>Prob.</th>
                <th className={TH}>Fechamento</th>
                <th className={TH}>Responsável</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((opp) => {
                const customer = opp.customer_id ? customers.get(opp.customer_id) : null;
                const late = opp.status === "open" && opp.expected_close_date && opp.expected_close_date.slice(0, 10) < today;
                return (
                  <tr key={opp.id} onClick={() => open(opp.id)} className="cursor-pointer hover:bg-muted/20">
                    <td className={TD}>
                      <button type="button" className={LINK} onClick={(event) => { event.stopPropagation(); open(opp.id); }}>{opp.title}</button>
                    </td>
                    <td className={TD}>{customer ? <Link to={`/crm/clientes/${customer.id}`} onClick={(event) => event.stopPropagation()} className={LINK}>{customer.name}</Link> : <span className="text-muted-foreground">—</span>}</td>
                    <td className={TD}><StatusBadge status={opp.stage} /></td>
                    <td className={cn(TD, "text-right tabular-nums")}>{formatCurrency(Number(opp.value ?? 0))}</td>
                    <td className={cn(TD, "text-right tabular-nums")}>{opp.probability}%</td>
                    <td className={cn(TD, "whitespace-nowrap", late ? "font-semibold text-destructive" : "text-muted-foreground")}>
                      {opp.status === "open" ? formatDay(opp.expected_close_date) : formatDay(opp.closed_at)}
                    </td>
                    <td className={cn(TD, "text-muted-foreground")}>{opp.owner_id ? names.get(opp.owner_id) ?? "—" : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selected && <OpportunityDrawer opportunityId={selected} onClose={() => open(null)} />}
      {creating && <OpportunityFormDialog onClose={() => setCreating(false)} onSaved={(id) => open(id)} />}
    </div>
  );
}
