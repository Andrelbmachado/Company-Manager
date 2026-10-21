import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowRightCircle, Target, TrendingUp, Trophy, UserPlus } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { EmptyState } from "@/components/shared/EmptyState";
import { KpiCard } from "@/components/shared/KpiCard";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { SearchInput, matchesSearch } from "@/components/shared/SearchInput";
import { Toolbar } from "@/components/shared/Toolbar";
import { NewButton } from "@/components/shared/NewButton";
import { ImportExportActions } from "@/components/shared/ImportExportActions";
import { EntityFormDialog } from "@/components/shared/EntityFormDialog";
import { Button } from "@/components/ui/Button";
import { useCreateEntity, useEntityList, useUpdateEntity } from "@/hooks/useEntity";
import { usePermission } from "@/hooks/usePermission";
import { LEAD_STATUS_OPTIONS, OPPORTUNITY_STAGE_OPTIONS } from "@/lib/data/entities";
import { refLabel, type Row } from "@/lib/data/repository";
import { cn, formatCurrency, formatDate } from "@/lib/utils";

type Tab = "pipeline" | "leads";

export default function OpportunitiesPage() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get("tab") === "leads" ? "leads" : "pipeline";
  const [formOpen, setFormOpen] = useState(false);

  const { data: opps = [], isLoading: loadingOpps } = useEntityList("opportunities");
  const { data: leads = [], isLoading: loadingLeads } = useEntityList("leads");

  const open = opps.filter((o) => o.status === "open");
  const pipeline = open.reduce((s, o) => s + Number(o.value ?? 0), 0);
  const weighted = open.reduce((s, o) => s + (Number(o.value ?? 0) * Number(o.probability ?? 0)) / 100, 0);
  const won = opps.filter((o) => o.stage === "ganho").reduce((s, o) => s + Number(o.value ?? 0), 0);
  const newLeads = leads.filter((l) => l.status === "novo").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Oportunidades"
        description="Leads e funil de vendas"
        actions={
          <>
            <ImportExportActions entities={["leads", "opportunities"]} />
            {tab === "leads" ? (
              <NewButton entity="leads" onClick={() => setFormOpen(true)} />
            ) : (
              <NewButton entity="opportunities" onClick={() => setFormOpen(true)} />
            )}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard title="Funil em aberto" value={formatCurrency(pipeline)} subtitle={`${open.length} oportunidades`} icon={Target} />
        <KpiCard title="Previsão ponderada" value={formatCurrency(weighted)} subtitle="valor × probabilidade" icon={TrendingUp} iconClassName="bg-indigo-50 text-indigo-600" />
        <KpiCard title="Ganhos" value={formatCurrency(won)} icon={Trophy} iconClassName="bg-emerald-50 text-emerald-600" />
        <KpiCard title="Leads novos" value={newLeads} subtitle={`${leads.length} no total`} icon={UserPlus} iconClassName="bg-blue-50 text-blue-600" />
      </div>

      <div className="flex w-fit gap-1 rounded-lg border bg-muted/40 p-1" role="tablist" aria-label="Visão">
        {([
          ["pipeline", "Funil", opps.length],
          ["leads", "Leads", leads.length],
        ] as const).map(([value, label, count]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            data-testid={`tab-${value}`}
            onClick={() => setParams(value === "leads" ? { tab: "leads" } : {}, { replace: true })}
            className={cn(
              "flex items-center gap-2 rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
              tab === value ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {label}
            <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">{count}</span>
          </button>
        ))}
      </div>

      {tab === "pipeline" ? (
        <Pipeline opps={opps} isLoading={loadingOpps} />
      ) : (
        <LeadsTable leads={leads} isLoading={loadingLeads} />
      )}

      <EntityFormDialog
        entity={tab === "leads" ? "leads" : "opportunities"}
        open={formOpen}
        onClose={() => setFormOpen(false)}
      />
    </div>
  );
}

// ── Pipeline (kanban) ─────────────────────────────────────────────

function Pipeline({ opps, isLoading }: { opps: Row[]; isLoading: boolean }) {
  const update = useUpdateEntity("opportunities");
  const canEdit = usePermission("edit", "opportunities");

  if (isLoading) {
    return (
      <div className="flex gap-3 overflow-hidden">
        {OPPORTUNITY_STAGE_OPTIONS.map((s) => (
          <div key={s.value} className="h-48 min-w-[15rem] flex-1 animate-pulse rounded-xl bg-muted/40" />
        ))}
      </div>
    );
  }
  if (!opps.length) {
    return (
      <EmptyState
        icon={Target}
        title="Nenhuma oportunidade"
        description="Crie uma oportunidade, converta um lead ou importe uma planilha."
      />
    );
  }

  return (
    <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2" data-testid="pipeline">
      {OPPORTUNITY_STAGE_OPTIONS.map((stage) => {
        const items = opps.filter((o) => o.stage === stage.value);
        const total = items.reduce((s, o) => s + Number(o.value ?? 0), 0);
        return (
          <section
            key={stage.value}
            aria-label={stage.label}
            data-stage={stage.value}
            className="flex min-w-[15rem] flex-1 shrink-0 flex-col rounded-xl border bg-muted/20"
          >
            <header className="flex items-center justify-between gap-2 border-b px-3 py-2.5">
              <StatusBadge status={stage.value} />
              <div className="text-right text-xs leading-tight">
                <div className="font-medium tabular-nums">{formatCurrency(total)}</div>
                <div className="text-muted-foreground">{items.length} {items.length === 1 ? "item" : "itens"}</div>
              </div>
            </header>
            <div className="flex flex-col gap-2 p-2">
              {items.map((o) => (
                <article
                  key={String(o.id)}
                  data-row-id={String(o.id)}
                  className="space-y-2 rounded-lg border bg-card p-3 text-sm shadow-sm"
                >
                  <p className="font-medium leading-snug">{String(o.title)}</p>
                  {refLabel(o, "customer_id") && (
                    <p className="text-xs text-muted-foreground">{refLabel(o, "customer_id")}</p>
                  )}
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium tabular-nums">{formatCurrency(Number(o.value ?? 0))}</span>
                    {o.expected_close_date ? (
                      <span className="text-muted-foreground">{formatDate(String(o.expected_close_date))}</span>
                    ) : null}
                  </div>
                  {canEdit && (
                    <select
                      aria-label="Mover para etapa"
                      data-testid="opportunity-stage"
                      value={String(o.stage)}
                      disabled={update.isPending}
                      onChange={(e) => update.mutate({ id: String(o.id), patch: { stage: e.target.value } })}
                      className="h-7 w-full rounded-md border bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring"
                    >
                      {OPPORTUNITY_STAGE_OPTIONS.map((s) => (
                        <option key={s.value} value={s.value}>Mover: {s.label}</option>
                      ))}
                    </select>
                  )}
                </article>
              ))}
              {!items.length && <p className="px-1 py-4 text-center text-xs text-muted-foreground">Vazio</p>}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// ── Leads ─────────────────────────────────────────────────────────

function LeadsTable({ leads, isLoading }: { leads: Row[]; isLoading: boolean }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const updateLead = useUpdateEntity("leads");
  const createOpp = useCreateEntity("opportunities");
  const canConvert = usePermission("create", "opportunities");

  async function convert(lead: Row) {
    await createOpp.mutateAsync([
      {
        title: String(lead.company_name || lead.name),
        stage: "qualificacao",
        lead_id: lead.id,
        notes: [lead.name, lead.email, lead.phone, lead.notes].filter(Boolean).join(" · "),
      },
    ]);
    await updateLead.mutateAsync({ id: String(lead.id), patch: { status: "convertido" } });
  }

  const filtered = leads.filter(
    (l) =>
      (status === "all" || l.status === status) &&
      matchesSearch(search, [l.name, l.email, l.phone, l.company_name, l.source])
  );

  const columns: Column<Row>[] = [
    {
      key: "name",
      header: "Lead",
      cell: (l) => (
        <div className="min-w-0">
          <p className="font-medium">{String(l.name)}</p>
          {l.position ? <p className="text-xs text-muted-foreground">{String(l.position)}</p> : null}
        </div>
      ),
    },
    { key: "company_name", header: "Empresa", cell: (l) => <span className="text-muted-foreground">{String(l.company_name ?? "—")}</span> },
    {
      key: "contact",
      header: "Contato",
      cell: (l) => (
        <div className="text-xs leading-relaxed text-muted-foreground">
          <div>{String(l.email ?? "—")}</div>
          {l.phone ? <div className="tabular-nums">{String(l.phone)}</div> : null}
        </div>
      ),
    },
    { key: "source", header: "Origem", cell: (l) => <span className="text-muted-foreground">{String(l.source ?? "—")}</span> },
    { key: "score", header: "Pontuação", align: "right", cell: (l) => <span className="tabular-nums">{Number(l.score ?? 0)}</span> },
    { key: "status", header: "Status", cell: (l) => <StatusBadge status={String(l.status)} /> },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (l) =>
        canConvert && l.status !== "convertido" && l.status !== "descartado" ? (
          <Button
            size="sm"
            variant="ghost"
            data-testid="lead-convert"
            disabled={createOpp.isPending}
            onClick={() => convert(l)}
            title="Criar oportunidade a partir deste lead"
          >
            <ArrowRightCircle size={14} />
            Converter
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-4">
      <Toolbar count={filtered.length}>
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar leads..." />
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por status">
          {[{ value: "all", label: "Todos" }, ...LEAD_STATUS_OPTIONS].map((o) => (
            <button
              key={o.value}
              type="button"
              aria-pressed={status === o.value}
              data-testid={`lead-filter-${o.value}`}
              onClick={() => setStatus(o.value)}
              className={cn(
                "h-8 rounded-full px-3 text-xs font-medium transition-colors",
                status === o.value ? "bg-primary text-primary-foreground" : "border hover:bg-muted"
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </Toolbar>
      <DataTable
        testId="leads-table"
        columns={columns}
        rows={filtered}
        getRowId={(r) => String(r.id)}
        isLoading={isLoading}
        empty={
          <EmptyState
            icon={UserPlus}
            title={leads.length ? "Nenhum lead encontrado" : "Nenhum lead ainda"}
            description={leads.length ? "Ajuste a busca ou o filtro." : "Use “Importar” para trazer seu arquivo CSV de leads."}
          />
        }
      />
    </div>
  );
}
