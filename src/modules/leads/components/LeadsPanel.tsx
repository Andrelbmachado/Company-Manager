// Leads da prospecção numa tabela editável (Editar muda status, pacote, potencial, data de abordagem...; Adicionar
// cadastra o lead na prospecção escolhida no topo da página, ou na padrão se não houver nenhuma). Os detalhes (contato,
// converter em oportunidade, indicação) abrem num painel na própria página, abaixo da tabela.
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Info, MessageCircle, Target } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { emit } from "@/lib/events/bus";
import { useRequiredSession } from "@/hooks/useSession";
import { usePermission } from "@/hooks/usePermission";
import { EditableTable, type EditableColumn, type EditableTableChanges } from "@/components/shared/EditableTable";
import { PageToolbar } from "@/components/shared/PageToolbar";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { formatDateTime } from "@/lib/utils";
import { saveLeadRows } from "@/lib/commercial/leadEdits";
import { convertLeadToOpportunity } from "@/lib/crm/convert";
import { fetchOpportunities } from "@/lib/crm/queries";
import { InfoGrid, InfoItem, InlinePanel, ROW_ACTION, useEditActor } from "@/modules/catalog/components/inline";
import { useCurrentCampaign } from "../campaignContext";
import { ReferralBox } from "./ReferralBox";
import {
  LEAD_STATUSES,
  PRESENCE_LABELS,
  formatIsoDate,
  formatMoney,
  formatRating,
  openExternal,
  telUrl,
  whatsappUrl,
} from "@/lib/prospecting/contact";
import type { Lead, ServicePackage } from "@/types";

const selectClass = "h-9 rounded-md border bg-background px-2.5 text-sm outline-none focus:ring-2 focus:ring-ring";

/** "fechado" é cinza para tickets no StatusBadge; para leads é ganho, então vai em verde. */
export function LeadStatusBadge({ status }: { status: string }) {
  return <StatusBadge status={status} tone={status === "fechado" ? "success" : undefined} />;
}

interface LeadsPanelProps {
  leads: Lead[];
  packages: ServicePackage[];
  loading: boolean;
}

export function LeadsPanel({ leads, packages, loading }: LeadsPanelProps) {
  const session = useRequiredSession();
  const companyId = session.company.id;
  const actor = useEditActor();
  const qc = useQueryClient();
  const canEdit = usePermission("edit", "leads");
  const canCreateOpportunity = usePermission("create", "opportunities");
  const navigate = useNavigate();
  const campaign = useCurrentCampaign();
  // Mesma consulta (e chave) da lista de oportunidades do CRM: diz se o lead já virou oportunidade.
  const { data: opportunities = [] } = useQuery({
    queryKey: ["opportunities", companyId],
    queryFn: async () => fetchOpportunities(await getDb(), companyId),
    enabled: canEdit && canCreateOpportunity,
  });
  const opportunityOf = (lead: Lead) => opportunities.find((opp) => opp.lead_id === lead.id) ?? null;
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [presence, setPresence] = useState("");
  const [onlyWhatsapp, setOnlyWhatsapp] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId ? leads.find((lead) => lead.id === selectedId) ?? null : null;

  const packageNames = useMemo(() => new Map(packages.map((pkg) => [pkg.id, pkg.name])), [packages]);
  const categories = useMemo(() => [...new Set(leads.map((lead) => lead.category).filter((value): value is string => !!value))].sort((a, b) => a.localeCompare(b, "pt-BR")), [leads]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return leads.filter((lead) =>
      (!term || [lead.name, lead.category, lead.address, lead.phone, lead.business_type].some((field) => (field ?? "").toLowerCase().includes(term))) &&
      (!status || lead.status === status) &&
      (!category || lead.category === category) &&
      (!presence || lead.presence_kind === presence) &&
      (!onlyWhatsapp || !!lead.whatsapp),
    );
  }, [leads, search, status, category, presence, onlyWhatsapp]);

  // Lead → oportunidade (etapa Qualificação) no funil do CRM; converter de novo abre a mesma oportunidade.
  const convertMutation = useMutation({
    mutationFn: async (lead: Lead) => {
      const db = await getDb();
      const { opportunityId } = await convertLeadToOpportunity(db, lead.id, session.user.id);
      await emit({
        type: "lead.converted",
        companyId,
        actorId: session.user.id,
        entityType: "lead",
        entityId: lead.id,
        title: `Lead ${lead.name} convertido em oportunidade`,
        module: "leads",
        newValue: { opportunityId },
      });
      return opportunityId;
    },
    onSuccess: (opportunityId) => {
      qc.invalidateQueries({ queryKey: ["leads", companyId] });
      qc.invalidateQueries({ queryKey: ["opportunities", companyId] });
      qc.invalidateQueries({ queryKey: ["crm-activities", companyId] });
      navigate(`/crm/funil?oportunidade=${encodeURIComponent(opportunityId)}`);
    },
  });

  const columns: EditableColumn<Lead>[] = [
    { key: "priority_rank", header: "#", kind: "number", width: 60, render: (lead) => <span className="text-muted-foreground">{lead.priority_rank ?? "—"}</span> },
    {
      key: "name",
      header: "Lead",
      kind: "text",
      required: true,
      width: 220,
      render: (lead) => (
        <span className="block max-w-64">
          <span className="block truncate font-medium">{lead.name}</span>
          {lead.business_type && <span className="block truncate text-xs text-muted-foreground">{lead.business_type}</span>}
        </span>
      ),
    },
    { key: "category", header: "Categoria", kind: "text" },
    { key: "phone", header: "Telefone", kind: "phone" },
    {
      key: "whatsapp",
      header: "WhatsApp",
      kind: "phone",
      render: (lead) => {
        const wa = whatsappUrl(lead.whatsapp);
        if (!wa) return <span className="text-muted-foreground">—</span>;
        return (
          <button type="button" title="Abrir WhatsApp" aria-label={`Abrir WhatsApp de ${lead.name}`} onClick={() => void openExternal(wa)} className="inline-flex items-center gap-1 text-primary-text hover:underline">
            <MessageCircle size={15} /> {lead.whatsapp}
          </button>
        );
      },
    },
    { key: "google_rating", header: "Google", kind: "number", readOnly: true, render: (lead) => <span className="text-muted-foreground">{formatRating(lead.google_rating, lead.google_reviews)}</span> },
    {
      key: "presence_kind",
      header: "Presença online",
      kind: "select",
      options: Object.entries(PRESENCE_LABELS).map(([value, label]) => ({ value, label })),
      render: (lead) => (
        <span className={lead.presence_kind === "site_quebrado" ? "rounded-md bg-status-danger px-2 py-0.5 text-xs font-semibold text-white" : "text-muted-foreground"}>
          {lead.presence_kind ? PRESENCE_LABELS[lead.presence_kind] : "—"}
        </span>
      ),
    },
    { key: "package_id", header: "Pacote", kind: "select", options: packages.map((pkg) => ({ value: pkg.id, label: pkg.name })), render: (lead) => <span className="text-muted-foreground">{lead.package_id ? packageNames.get(lead.package_id) ?? "—" : "—"}</span> },
    { key: "estimated_revenue", header: "Potencial 1º ano", kind: "money", render: (lead) => <span className="font-medium">{formatMoney(lead.estimated_revenue)}</span> },
    { key: "outreach_date", header: "Abordar em", kind: "date", render: (lead) => <span className="text-muted-foreground">{formatIsoDate(lead.outreach_date)}</span> },
    { key: "status", header: "Status", kind: "select", required: true, options: LEAD_STATUSES.map((option) => ({ value: option.value, label: option.label })), render: (lead) => <LeadStatusBadge status={lead.status} /> },
  ];

  async function save(changes: EditableTableChanges<Lead>) {
    const before = new Map(leads.map((lead) => [lead.id, lead]));
    const result = await saveLeadRows(await getDb(), companyId, actor, changes);
    for (const patch of changes.updated) {
      const old = before.get(patch.id);
      if (!old || !result.updated.includes(patch.id)) continue;
      if (patch.status && patch.status !== old.status) {
        await emit({ type: "lead.status_changed", companyId, actorId: session.user.id, entityType: "lead", entityId: old.id, title: `Lead ${old.name}: ${old.status} → ${patch.status}`, module: "leads", oldValue: { status: old.status }, newValue: { status: patch.status } });
      } else {
        await emit({ type: "lead.updated", companyId, actorId: session.user.id, entityType: "lead", entityId: old.id, title: `Lead ${patch.name ?? old.name} alterado`, module: "leads" });
      }
    }
    for (const [index, id] of result.created.entries()) {
      await emit({ type: "lead.created", companyId, actorId: session.user.id, entityType: "lead", entityId: id, title: `Lead ${changes.created[index]?.name ?? ""} cadastrado`, module: "leads" });
    }
  }

  return (
    <div className="space-y-4">
      <PageToolbar search={search} onSearchChange={setSearch} searchPlaceholder="Buscar por nome, categoria, endereço...">
        <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filtrar por status" className={selectClass}>
          <option value="">Todos os status</option>
          {LEAD_STATUSES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filtrar por categoria" className={selectClass}>
          <option value="">Todas as categorias</option>
          {categories.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <select value={presence} onChange={(event) => setPresence(event.target.value)} aria-label="Filtrar por presença online" className={selectClass}>
          <option value="">Toda presença online</option>
          {Object.entries(PRESENCE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <label className="flex h-9 items-center gap-2 rounded-md border bg-background px-2.5 text-sm">
          <input type="checkbox" checked={onlyWhatsapp} onChange={(event) => setOnlyWhatsapp(event.target.checked)} />
          Só WhatsApp
        </label>
      </PageToolbar>

      {!loading && leads.length > 0 && <p className="text-xs text-muted-foreground">{filtered.length} de {leads.length} leads</p>}

      <EditableTable<Lead>
        resource="leads"
        title="Leads"
        label="Leads da prospecção"
        rows={filtered}
        columns={columns}
        loading={loading}
        onSave={save}
        onRefresh={() => qc.invalidateQueries({ queryKey: ["leads", companyId] })}
        newRow={() => ({ status: "novo", ...(campaign ? { campaign_id: campaign.id } : {}) })}
        emptyMessage={leads.length ? "Nenhum lead encontrado" : "Nenhum lead"}
        rowActions={(lead) => (
          <button type="button" className={ROW_ACTION} aria-label={`Detalhes de ${lead.name}`} aria-pressed={selectedId === lead.id} onClick={() => setSelectedId((current) => (current === lead.id ? null : lead.id))}>
            <Info size={13} /> Detalhes
          </button>
        )}
      />

      {selected && (
        <InlinePanel title={selected.name} subtitle={`Lead · ${selected.category ?? "sem categoria"}`} onClose={() => setSelectedId(null)}>
          <div className="space-y-6">
            <InfoGrid>
              <InfoItem label="Status" value={<LeadStatusBadge status={selected.status} />} />
              <InfoItem label="Prioridade" value={selected.priority_rank ? `#${selected.priority_rank} (dia ${selected.outreach_day} · ${formatIsoDate(selected.outreach_date)})` : null} />
              <InfoItem label="Telefone" value={selected.phone && (telUrl(selected.phone) ? <button type="button" className="text-primary-text hover:underline" onClick={() => void openExternal(telUrl(selected.phone)!)}>{selected.phone}</button> : selected.phone)} />
              <InfoItem label="WhatsApp" value={selected.whatsapp ? (whatsappUrl(selected.whatsapp) ? <button type="button" className="text-primary-text hover:underline" onClick={() => void openExternal(whatsappUrl(selected.whatsapp)!)}>{selected.whatsapp}</button> : selected.whatsapp) : "Sem celular"} />
              <InfoItem label="Nota no Google" value={formatRating(selected.google_rating, selected.google_reviews)} />
              <InfoItem label="Sem site" value={selected.sem_site ? "Sim" : "Não"} />
              <InfoItem label="Último contato" value={selected.last_contact_at ? formatDateTime(selected.last_contact_at) : null} />
              <InfoItem label="Atividade" value={selected.business_type} />
            </InfoGrid>
            <InfoGrid className="lg:grid-cols-2">
              <InfoItem label="Presença online atual" value={selected.online_presence} />
              <InfoItem label="Endereço" value={selected.address} />
            </InfoGrid>
            <InfoGrid>
              <InfoItem label="Pacote sugerido" value={selected.package_id ? packageNames.get(selected.package_id) : null} />
              <InfoItem label="Potencial 1º ano (estimativa)" value={<span className="font-semibold">{formatMoney(selected.estimated_revenue)}</span>} />
              <InfoItem label="Implantação (estimativa)" value={formatMoney(selected.estimated_setup)} />
              <InfoItem label="Mensalidade (estimativa)" value={formatMoney(selected.estimated_monthly)} />
            </InfoGrid>
            <InfoItem label="Observações" value={selected.notes} />
            {canEdit && canCreateOpportunity && (
              <div className="space-y-1.5 rounded-lg border p-3">
                <button
                  type="button"
                  onClick={() => {
                    const existing = opportunityOf(selected);
                    if (existing) navigate(`/crm/funil?oportunidade=${encodeURIComponent(existing.id)}`);
                    else convertMutation.mutate(selected);
                  }}
                  disabled={convertMutation.isPending}
                  className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  <Target size={14} />
                  {opportunityOf(selected) ? "Abrir oportunidade no funil" : "Converter em oportunidade"}
                </button>
                {convertMutation.error && <p role="alert" className="text-sm text-destructive">{convertMutation.error instanceof Error ? convertMutation.error.message : String(convertMutation.error)}</p>}
              </div>
            )}
            <ReferralBox
              key={selected.id}
              lead={selected}
              canEdit={canEdit}
              suggestions={[...new Set(leads.map((lead) => lead.name).filter((name) => name !== selected.name))].sort((a, b) => a.localeCompare(b, "pt-BR"))}
              onSaved={() => undefined}
            />
            {selected.source_url && (
              <button type="button" className="text-sm text-primary-text hover:underline" onClick={() => void openExternal(selected.source_url!)}>
                Ver no Google Maps
              </button>
            )}
          </div>
        </InlinePanel>
      )}
    </div>
  );
}
