import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Kanban } from "lucide-react";
import { ImportExportButtons } from "@/components/shared/ImportExportButtons";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageToolbar } from "@/components/shared/PageToolbar";
import { StatCard } from "@/components/shared/StatCard";
import { fold, isStage, OPPORTUNITY_STAGES, pipelineSummary, STAGE_LABELS } from "@/lib/crm/queries";
import { useLabel } from "@/lib/labels/useLabel";
import { formatCurrency } from "@/lib/utils";
import type { SavedView } from "@/types";
import { OpportunitiesTable } from "../components/OpportunitiesTable";
import { SavedViewsBar } from "../components/SavedViewsBar";
import { BTN_SECONDARY, SELECT } from "../components/ui";
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

/**
 * Lista de oportunidades (todas as etapas) numa tabela editável, com filtros salvos e importação/exportação. Os detalhes
 * (?oportunidade=) abrem num painel abaixo da tabela. O quadro fica em /crm/funil.
 */
export default function OpportunitiesPage() {
  const { userId, role } = useCrmSession();
  const title = useLabel("module.opportunities");
  const invalidate = useInvalidateCrm();
  const [params, setParams] = useSearchParams();
  const { data: opportunities = [], isLoading } = useOpportunities();
  const { map: customers } = useCustomerMap();
  const { data: users = [] } = useCompanyUsers();
  const [filters, setFilters] = useState<OpportunityFilters>({ status: "open" });
  const selected = params.get("oportunidade");
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
        title={title}
        description="Todas as oportunidades, abertas e fechadas"
        actions={
          <>
            <Link to="/crm/funil" className={BTN_SECONDARY}><Kanban size={14} /> Funil</Link>
            <ImportExportButtons entity="opportunities" onImported={() => invalidate("opportunities")} />
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

      <OpportunitiesTable
        opportunities={filtered}
        loading={isLoading}
        selectedId={selected}
        onSelect={open}
        emptyMessage={opportunities.length ? "Nenhuma oportunidade com esses filtros: ajuste os filtros." : undefined}
      />
    </div>
  );
}
