import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { CopyCheck, ExternalLink, UserRound } from "lucide-react";
import { EditableTable, type EditableColumn, type EditableTableChanges } from "@/components/shared/EditableTable";
import { ImportExportButtons } from "@/components/shared/ImportExportButtons";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageToolbar } from "@/components/shared/PageToolbar";
import { StatCard } from "@/components/shared/StatCard";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { saveCustomerRows } from "@/lib/commercial/crmEdits";
import { getDb } from "@/lib/db/client";
import { useLabel } from "@/lib/labels/useLabel";
import { pipelineSummary } from "@/lib/crm/queries";
import { filterCustomers, parseCustomerFilters, type CustomerFilters } from "@/lib/crm/segments";
import { cn, formatCurrency } from "@/lib/utils";
import { ROW_ACTION, refreshQueries, useEditActor } from "@/modules/catalog/components/inline";
import type { Customer, Tag } from "@/types";
import { OverdueFollowUps } from "../components/Activities";
import { SavedViewsBar } from "../components/SavedViewsBar";
import { TagChip } from "../components/Tags";
import { BTN_SECONDARY, LINK, SELECT } from "../components/ui";
import { useAudit, useCompanyUsers, useCrmSession, useCustomers, useInvalidateCrm, useOpportunities, useTags } from "../components/useCrm";

const MANAGERS = new Set(["ceo", "admin", "gerente"]);

/** Clientes: tabela editável com busca, segmentos salvos, tags, indicadores do funil e follow-ups atrasados. */
export default function CrmPage() {
  const { companyId, userId, role, can } = useCrmSession();
  const title = useLabel("module.crm");
  const actor = useEditActor();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const invalidate = useInvalidateCrm();
  const audit = useAudit();
  const { data: customers = [], isLoading } = useCustomers();
  const { data: opportunities = [] } = useOpportunities(can("view", "opportunities"));
  const { tags, byEntity, byId } = useTags("customer");
  const { data: users = [], names } = useCompanyUsers();
  const [filters, setFilters] = useState<CustomerFilters>({});
  const [created, setCreated] = useState<string | null>(null);
  const [onlyMine, setOnlyMine] = useState(!MANAGERS.has(role));

  const segments = useMemo(() => [...new Set(customers.map((customer) => customer.segment).filter((value): value is string => !!value))].sort((a, b) => a.localeCompare(b, "pt-BR")), [customers]);
  const filtered = useMemo(() => filterCustomers(customers, filters, { tagsByCustomer: byEntity, userId }), [customers, filters, byEntity, userId]);
  const summary = useMemo(() => pipelineSummary(opportunities.filter((opp) => opp.status === "open")), [opportunities]);
  const hasFilters = Object.values(filters).some(Boolean);
  const set = (patch: Partial<CustomerFilters>) => setFilters((current) => ({ ...current, ...patch }));

  const columns: EditableColumn<Customer>[] = [
    {
      key: "name",
      header: "Cliente",
      kind: "text",
      required: true,
      width: 220,
      render: (customer) => (
        <span className="block space-y-1">
          <Link to={`/crm/clientes/${customer.id}`} className={LINK}>{customer.name}</Link>
          {customer.trade_name && <span className="block text-xs text-muted-foreground">{customer.trade_name}</span>}
          {(byEntity.get(customer.id) ?? []).length > 0 && (
            <span className="flex flex-wrap gap-1">
              {(byEntity.get(customer.id) ?? [])
                .map((id) => byId.get(id))
                .filter((tag): tag is Tag => !!tag)
                .map((tag) => <TagChip key={tag.id} tag={tag} />)}
            </span>
          )}
        </span>
      ),
    },
    { key: "type", header: "Tipo", kind: "select", width: 90, options: [{ value: "PJ", label: "PJ" }, { value: "PF", label: "PF" }] },
    { key: "document", header: "CNPJ / CPF", kind: "text", render: (customer) => <span className="whitespace-nowrap text-muted-foreground">{customer.document ?? "—"}</span> },
    { key: "email", header: "E-mail", kind: "email" },
    { key: "phone", header: "Telefone", kind: "phone" },
    { key: "segment", header: "Segmento", kind: "text", placeholder: "Ex.: Saúde" },
    { key: "owner_id", header: "Responsável", kind: "select", options: users.map((user) => ({ value: user.id, label: user.name })), render: (customer) => <span className="whitespace-nowrap text-muted-foreground">{customer.owner_id ? names.get(customer.owner_id) ?? "—" : "—"}</span> },
    { key: "status", header: "Situação", kind: "select", required: true, options: [{ value: "active", label: "Ativo" }, { value: "inactive", label: "Inativo" }], render: (customer) => <StatusBadge status={customer.status} /> },
  ];

  async function save(changes: EditableTableChanges<Customer>) {
    setCreated(null);
    const result = await saveCustomerRows(await getDb(), companyId, actor, changes);
    const byCustomer = new Map(customers.map((customer) => [customer.id, customer]));
    for (const patch of changes.updated) {
      const before = byCustomer.get(patch.id);
      if (before && result.updated.includes(patch.id)) await audit("customer.updated", "customer", patch.id, `Cliente editado: ${patch.name ?? before.name}`, { oldValue: before, newValue: patch });
    }
    for (const [index, id] of result.created.entries()) await audit("customer.created", "customer", id, `Cliente criado: ${changes.created[index]?.name ?? ""}`, { newValue: changes.created[index] });
    if (result.created.length === 1) setCreated(result.created[0]!);
    invalidate("customers");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        actions={
          <>
            {can("edit", "customers") && (
              <Link to="/crm/duplicados" className={BTN_SECONDARY}>
                <CopyCheck size={14} /> Duplicados
              </Link>
            )}
            <ImportExportButtons entity="customers" onImported={() => invalidate("customers", "contacts")} />
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Clientes ativos" value={customers.filter((customer) => customer.status === "active").length} />
        {can("view", "opportunities") && (
          <>
            <StatCard title="Oportunidades abertas" value={summary.open.count} />
            <StatCard title="Valor ponderado do funil" value={formatCurrency(summary.open.weighted)} />
          </>
        )}
        <StatCard title="Segmentos" value={segments.length} />
      </div>

      {can("view", "crm_activities") && (
        <OverdueFollowUps
          userId={onlyMine ? userId : null}
          actions={
            MANAGERS.has(role) && (
              <button
                type="button"
                aria-pressed={onlyMine}
                aria-label="Só os meus follow-ups"
                title="Só os meus follow-ups"
                onClick={() => setOnlyMine((current) => !current)}
                className={cn(
                  "inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  onlyMine && "border-primary/40 bg-primary/10 text-primary-text",
                )}
              >
                <UserRound aria-hidden="true" size={16} />
              </button>
            )
          }
        />
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

        {created && (
          <p role="status" className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
            Cliente cadastrado.
            <button type="button" className="font-medium underline" onClick={() => navigate(`/crm/clientes/${created}`)}>Abrir ficha</button>
          </p>
        )}
        {!isLoading && customers.length > 0 && <p className="text-xs text-muted-foreground">{filtered.length} de {customers.length} clientes</p>}
        <EditableTable<Customer>
          resource="customers"
          title="Clientes"
          label="Clientes"
          rows={filtered}
          columns={columns}
          loading={isLoading}
          onSave={save}
          onRefresh={() => refreshQueries(qc, ["customers", "customer", "duplicates"])}
          newRow={() => ({ type: "PJ", status: "active", owner_id: userId })}
          emptyMessage={customers.length ? "Nenhum cliente com esses filtros" : "Nenhum cliente cadastrado"}
          rowActions={(customer) => (
            <button type="button" className={ROW_ACTION} aria-label={`Abrir ficha de ${customer.name}`} onClick={() => navigate(`/crm/clientes/${customer.id}`)}>
              <ExternalLink size={13} /> Ficha
            </button>
          )}
        />
      </div>
    </div>
  );
}
