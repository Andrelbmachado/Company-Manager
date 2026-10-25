import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CopyCheck, Plus, Users } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { ImportExportButtons } from "@/components/shared/ImportExportButtons";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageToolbar } from "@/components/shared/PageToolbar";
import { StatCard } from "@/components/shared/StatCard";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { pipelineSummary } from "@/lib/crm/queries";
import { filterCustomers, parseCustomerFilters, type CustomerFilters } from "@/lib/crm/segments";
import { cn, formatCurrency } from "@/lib/utils";
import type { Tag } from "@/types";
import { OverdueFollowUps } from "../components/Activities";
import { CustomerFormDialog } from "../components/CustomerFormDialog";
import { SavedViewsBar } from "../components/SavedViewsBar";
import { TagChip } from "../components/Tags";
import { BTN_PRIMARY, BTN_SECONDARY, CARD, LINK, SELECT, TD, TH } from "../components/ui";
import { useCompanyUsers, useCrmSession, useCustomers, useInvalidateCrm, useOpportunities, useTags } from "../components/useCrm";

const MANAGERS = new Set(["ceo", "admin", "gerente"]);

/** Clientes: lista com busca, segmentos salvos, tags, indicadores do funil e follow-ups atrasados. */
export default function CrmPage() {
  const { userId, role, can } = useCrmSession();
  const navigate = useNavigate();
  const invalidate = useInvalidateCrm();
  const { data: customers = [], isLoading } = useCustomers();
  const { data: opportunities = [] } = useOpportunities(can("view", "opportunities"));
  const { tags, byEntity, byId } = useTags("customer");
  const { data: users = [], names } = useCompanyUsers();
  const [filters, setFilters] = useState<CustomerFilters>({});
  const [creating, setCreating] = useState(false);
  const [onlyMine, setOnlyMine] = useState(!MANAGERS.has(role));

  const segments = useMemo(() => [...new Set(customers.map((customer) => customer.segment).filter((value): value is string => !!value))].sort((a, b) => a.localeCompare(b, "pt-BR")), [customers]);
  const filtered = useMemo(() => filterCustomers(customers, filters, { tagsByCustomer: byEntity, userId }), [customers, filters, byEntity, userId]);
  const summary = useMemo(() => pipelineSummary(opportunities.filter((opp) => opp.status === "open")), [opportunities]);
  const hasFilters = Object.values(filters).some(Boolean);
  const set = (patch: Partial<CustomerFilters>) => setFilters((current) => ({ ...current, ...patch }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clientes"
        description="Cadastro, segmentos e acompanhamento comercial"
        actions={
          <>
            {can("edit", "customers") && (
              <Link to="/crm/duplicados" className={BTN_SECONDARY}>
                <CopyCheck size={14} /> Duplicados
              </Link>
            )}
            <ImportExportButtons entity="customers" onImported={() => invalidate("customers", "contacts")} />
            {can("create", "customers") && (
              <button type="button" onClick={() => setCreating(true)} className={BTN_PRIMARY}>
                <Plus size={14} /> Novo cliente
              </button>
            )}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Clientes ativos" value={customers.filter((customer) => customer.status === "active").length} hint={`${customers.length} no cadastro`} />
        {can("view", "opportunities") && (
          <>
            <StatCard title="Oportunidades abertas" value={summary.open.count} hint={formatCurrency(summary.open.total)} />
            <StatCard title="Valor ponderado do funil" value={formatCurrency(summary.open.weighted)} kind="text" hint="valor × probabilidade de cada oportunidade" />
          </>
        )}
        <StatCard title="Segmentos" value={segments.length} hint={segments.slice(0, 3).join(", ") || "nenhum ainda"} />
      </div>

      {can("view", "crm_activities") && (
        <div className="space-y-2">
          {MANAGERS.has(role) && (
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={onlyMine} onChange={(event) => setOnlyMine(event.target.checked)} /> Só os meus follow-ups
            </label>
          )}
          <OverdueFollowUps userId={onlyMine ? userId : null} />
        </div>
      )}

      <div className="space-y-4">
        <PageToolbar search={filters.search ?? ""} onSearchChange={(search) => set({ search })} searchPlaceholder="Buscar por nome, e-mail, CNPJ/CPF, telefone...">
          <select value={filters.segment ?? ""} onChange={(event) => set({ segment: event.target.value || undefined })} aria-label="Filtrar por segmento" className={SELECT}>
            <option value="">Todos os segmentos</option>
            {segments.map((segment) => <option key={segment} value={segment}>{segment}</option>)}
          </select>
          <select value={filters.tagId ?? ""} onChange={(event) => set({ tagId: event.target.value || undefined })} aria-label="Filtrar por tag" className={SELECT}>
            <option value="">Todas as tags</option>
            {tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
          </select>
          <select value={filters.ownerId ?? ""} onChange={(event) => set({ ownerId: event.target.value || undefined })} aria-label="Filtrar por responsável" className={SELECT}>
            <option value="">Todos os responsáveis</option>
            <option value="me">Meus clientes</option>
            <option value="none">Sem responsável</option>
            {users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
          </select>
          <select value={filters.status ?? ""} onChange={(event) => set({ status: event.target.value || undefined })} aria-label="Filtrar por situação" className={SELECT}>
            <option value="">Ativos e inativos</option>
            <option value="active">Ativos</option>
            <option value="inactive">Inativos</option>
          </select>
        </PageToolbar>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SavedViewsBar
            entityType="customer"
            current={filters}
            hasFilters={hasFilters}
            canShare={MANAGERS.has(role)}
            onApply={(view) => setFilters(view ? parseCustomerFilters(view.filters_json) : {})}
          />
          {hasFilters && (
            <button type="button" onClick={() => setFilters({})} className="text-sm text-muted-foreground hover:text-foreground">
              Limpar filtros
            </button>
          )}
        </div>

        {isLoading ? (
          <div className="space-y-2">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-12 animate-pulse rounded-lg bg-muted/30" />)}</div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Users}
            title={customers.length ? "Nenhum cliente com esses filtros" : "Nenhum cliente cadastrado"}
            description={customers.length ? "Ajuste a busca ou limpe os filtros." : "Cadastre o primeiro cliente ou importe uma planilha."}
            action={!customers.length && can("create", "customers") ? <button type="button" onClick={() => setCreating(true)} className={BTN_PRIMARY}><Plus size={14} /> Novo cliente</button> : undefined}
          />
        ) : (
          <>
            <p className="text-xs text-muted-foreground">{filtered.length} de {customers.length} clientes</p>
            <div className={cn(CARD, "overflow-x-auto")}>
              <table className="w-full text-sm">
                <thead className="bg-muted/30">
                  <tr>
                    <th className={TH}>Cliente</th>
                    <th className={TH}>Documento</th>
                    <th className={TH}>Contato</th>
                    <th className={TH}>Segmento</th>
                    <th className={TH}>Tags</th>
                    <th className={TH}>Responsável</th>
                    <th className={TH}>Situação</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.map((customer) => (
                    <tr key={customer.id} onClick={() => navigate(`/crm/clientes/${customer.id}`)} className="cursor-pointer transition-colors hover:bg-muted/20">
                      <td className={TD}>
                        <Link to={`/crm/clientes/${customer.id}`} onClick={(event) => event.stopPropagation()} className={LINK}>{customer.name}</Link>
                        {customer.trade_name && <p className="text-xs text-muted-foreground">{customer.trade_name}</p>}
                      </td>
                      <td className={cn(TD, "whitespace-nowrap text-muted-foreground")}>
                        <span className="mr-1 text-xs font-semibold">{customer.type}</span>
                        {customer.document ?? "—"}
                      </td>
                      <td className={cn(TD, "text-muted-foreground")}>
                        <p>{customer.email ?? "—"}</p>
                        {customer.phone && <p className="text-xs">{customer.phone}</p>}
                      </td>
                      <td className={cn(TD, "text-muted-foreground")}>{customer.segment ?? "—"}</td>
                      <td className={TD}>
                        <div className="flex flex-wrap gap-1">
                          {(byEntity.get(customer.id) ?? [])
                            .map((id) => byId.get(id))
                            .filter((tag): tag is Tag => !!tag)
                            .map((tag) => <TagChip key={tag.id} tag={tag} />)}
                        </div>
                      </td>
                      <td className={cn(TD, "whitespace-nowrap text-muted-foreground")}>{customer.owner_id ? names.get(customer.owner_id) ?? "—" : "—"}</td>
                      <td className={TD}><StatusBadge status={customer.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {creating && <CustomerFormDialog onClose={() => setCreating(false)} onSaved={(id) => navigate(`/crm/clientes/${id}`)} />}
    </div>
  );
}
