import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, Megaphone } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { emit } from "@/lib/events/bus";
import { useRequiredSession } from "@/hooks/useSession";
import { usePermission } from "@/hooks/usePermission";
import { DetailDrawer, DetailGrid, DetailItem } from "@/components/shared/DetailDrawer";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageToolbar } from "@/components/shared/PageToolbar";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { formatDateTime } from "@/lib/utils";
import { referralStatusFor } from "@/lib/prospecting/referral";
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
import type { Lead, LeadStatus, ServicePackage } from "@/types";

const selectClass = "h-9 rounded-md border bg-background px-2.5 text-sm outline-none focus:ring-2 focus:ring-ring";

/** "fechado" é cinza para tickets no StatusBadge; para leads é ganho, então vai em verde. */
export function LeadStatusBadge({ status }: { status: string }) {
  return <StatusBadge status={status} className={status === "fechado" ? "bg-emerald-100 text-emerald-700" : undefined} />;
}

interface LeadsPanelProps {
  leads: Lead[];
  packages: ServicePackage[];
  loading: boolean;
}

export function LeadsPanel({ leads, packages, loading }: LeadsPanelProps) {
  const session = useRequiredSession();
  const qc = useQueryClient();
  const canEdit = usePermission("edit", "leads");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [presence, setPresence] = useState("");
  const [onlyWhatsapp, setOnlyWhatsapp] = useState(false);
  const [selected, setSelected] = useState<Lead | null>(null);

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

  const statusMutation = useMutation({
    mutationFn: async ({ lead, next }: { lead: Lead; next: LeadStatus }) => {
      const db = await getDb();
      const contactedAt = next === "novo" ? null : new Date().toISOString();
      // Indicação: o benefício só passa a "concedido" quando o indicado fecha.
      const referral = referralStatusFor(next, lead.referred_by);
      await db.execute("UPDATE leads SET status=?, last_contact_at=?, referral_status=?, updated_at=datetime('now') WHERE id=?", [next, contactedAt, referral, lead.id]);
      await emit({
        type: "lead.status_changed",
        companyId: session.company.id,
        actorId: session.user.id,
        entityType: "lead",
        entityId: lead.id,
        title: `Lead ${lead.name}: ${lead.status} → ${next}`,
        module: "leads",
        oldValue: { status: lead.status },
        newValue: { status: next },
      });
      return { ...lead, status: next, last_contact_at: contactedAt, referral_status: referral };
    },
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ["leads", session.company.id] });
      setSelected((current) => (current?.id === updated.id ? updated : current));
    },
  });

  // Função (não componente) para o <select> não remontar a cada render.
  function statusControl(lead: Lead) {
    if (!canEdit) return <LeadStatusBadge status={lead.status} />;
    return (
      <select
        value={lead.status}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => statusMutation.mutate({ lead, next: event.target.value as LeadStatus })}
        aria-label={`Status de ${lead.name}`}
        className={selectClass}
      >
        {LEAD_STATUSES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        {!LEAD_STATUSES.some((option) => option.value === lead.status) && <option value={lead.status}>{lead.status}</option>}
      </select>
    );
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

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-12 animate-pulse rounded-lg bg-muted/30" />)}</div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={Megaphone} title="Nenhum lead encontrado" description={leads.length ? "Ajuste os filtros para ver mais resultados." : "Os leads de prospecção são importados no primeiro acesso de Administração, Gerência ou Comercial."} />
      ) : (
        <>
          <p className="text-xs text-muted-foreground">{filtered.length} de {leads.length} leads · ordenados por prioridade de abordagem</p>
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead className="bg-muted/30">
                <tr>
                  {["#", "Lead", "Categoria", "Contato", "Google", "Presença online", "Pacote", "Potencial 1º ano", "Abordar em", "Status"].map((heading) => (
                    <th key={heading} className="whitespace-nowrap px-3 py-3 text-left font-medium text-muted-foreground">{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((lead) => {
                  const wa = whatsappUrl(lead.whatsapp);
                  return (
                    <tr key={lead.id} onClick={() => setSelected(lead)} className="cursor-pointer transition-colors hover:bg-muted/20">
                      <td className="px-3 py-2.5 text-muted-foreground">{lead.priority_rank}</td>
                      <td className="max-w-64 px-3 py-2.5">
                        <p className="truncate font-medium">{lead.name}</p>
                        {lead.business_type && <p className="truncate text-xs text-muted-foreground">{lead.business_type}</p>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">{lead.category}</td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <span className="text-muted-foreground">{lead.phone ?? "—"}</span>
                        {wa && (
                          <button
                            type="button"
                            title="Abrir WhatsApp"
                            aria-label={`Abrir WhatsApp de ${lead.name}`}
                            onClick={(event) => { event.stopPropagation(); void openExternal(wa); }}
                            className="ml-2 inline-flex align-middle text-emerald-600 hover:text-emerald-700"
                          >
                            <MessageCircle size={15} />
                          </button>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">{formatRating(lead.google_rating, lead.google_reviews)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <span className={lead.presence_kind === "site_quebrado" ? "rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700" : "text-muted-foreground"}>
                          {lead.presence_kind ? PRESENCE_LABELS[lead.presence_kind] : "—"}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">{lead.package_id ? packageNames.get(lead.package_id) ?? "—" : "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 font-medium">{formatMoney(lead.estimated_revenue)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">{formatIsoDate(lead.outreach_date)}</td>
                      <td className="px-3 py-2.5">{statusControl(lead)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {selected && (
        <DetailDrawer title={selected.name} subtitle={`Lead · ${selected.category ?? "sem categoria"}`} onClose={() => setSelected(null)}>
          <div className="space-y-6">
            <DetailGrid>
              <DetailItem label="Status" value={statusControl(selected)} />
              <DetailItem label="Prioridade" value={selected.priority_rank ? `#${selected.priority_rank} (dia ${selected.outreach_day} · ${formatIsoDate(selected.outreach_date)})` : null} />
              <DetailItem label="Telefone" value={selected.phone && (telUrl(selected.phone) ? <button type="button" className="text-primary hover:underline" onClick={() => void openExternal(telUrl(selected.phone)!)}>{selected.phone}</button> : selected.phone)} />
              <DetailItem label="WhatsApp" value={selected.whatsapp ? <button type="button" className="text-emerald-700 hover:underline" onClick={() => void openExternal(whatsappUrl(selected.whatsapp)!)}>{selected.whatsapp}</button> : "Sem celular"} />
              <DetailItem label="Nota no Google" value={formatRating(selected.google_rating, selected.google_reviews)} />
              <DetailItem label="Sem site" value={selected.sem_site ? "Sim" : "Não"} />
              <DetailItem label="Último contato" value={selected.last_contact_at ? formatDateTime(selected.last_contact_at) : null} />
              <DetailItem label="Atividade" value={selected.business_type} />
            </DetailGrid>
            <DetailItem label="Presença online atual" value={selected.online_presence} />
            <DetailItem label="Endereço" value={selected.address} />
            <DetailGrid>
              <DetailItem label="Pacote sugerido" value={selected.package_id ? packageNames.get(selected.package_id) : null} />
              <DetailItem label="Potencial 1º ano (estimativa)" value={<span className="font-semibold">{formatMoney(selected.estimated_revenue)}</span>} />
              <DetailItem label="Implantação (estimativa)" value={formatMoney(selected.estimated_setup)} />
              <DetailItem label="Mensalidade (estimativa)" value={formatMoney(selected.estimated_monthly)} />
            </DetailGrid>
            <DetailItem label="Observações" value={selected.notes} />
            <ReferralBox
              key={selected.id}
              lead={selected}
              canEdit={canEdit}
              suggestions={[...new Set(leads.map((lead) => lead.name).filter((name) => name !== selected.name))].sort((a, b) => a.localeCompare(b, "pt-BR"))}
              onSaved={setSelected}
            />
            {selected.source_url && (
              <button type="button" className="text-sm text-primary hover:underline" onClick={() => void openExternal(selected.source_url!)}>
                Ver no Google Maps
              </button>
            )}
          </div>
        </DetailDrawer>
      )}
    </div>
  );
}
