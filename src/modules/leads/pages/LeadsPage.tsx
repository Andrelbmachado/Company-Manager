import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRequiredSession } from "@/hooks/useSession";
import { usePermission } from "@/hooks/usePermission";
import { ImportExportButtons } from "@/components/shared/ImportExportButtons";
import { KpiCard } from "@/components/shared/KpiCard";
import { PageHeader } from "@/components/shared/PageHeader";
import { TabList, TabPanel } from "@/components/shared/Tabs";
import { getDb } from "@/lib/db/client";
import { emit } from "@/lib/events/bus";
import { useLabel } from "@/lib/labels/useLabel";
import { formatMoney } from "@/lib/prospecting/contact";
import { assignLeadsWithoutCampaign, campaignStats, createCampaign, ensureDefaultCampaign, listCampaigns, renameCampaign } from "@/lib/prospecting/campaigns";
import { fetchLeads, fetchPackagePrices, fetchRevenueScenarios, fetchServicePackages } from "@/lib/prospecting/queries";
import type { Role } from "@/types";
import { campaignsQueryKey, campaignStatsQueryKey, CurrentCampaignContext } from "../campaignContext";
import { CampaignBar } from "../components/CampaignBar";
import { LeadsPanel } from "../components/LeadsPanel";
import { SchedulePanel } from "../components/SchedulePanel";
import { PackagesPanel } from "../components/PackagesPanel";
import { ForecastPanel } from "../components/ForecastPanel";
import { ReferralPanel } from "../components/ReferralPanel";

const TABS = [
  { id: "leads", label: "Leads" },
  { id: "cronograma", label: "Cronograma de abordagem" },
  { id: "pacotes", label: "Pacotes e preços" },
  { id: "previsao", label: "Previsão de receita" },
  { id: "indicacoes", label: "Indicações" },
] as const;

type TabId = (typeof TABS)[number]["id"];

/** Parâmetro da URL com a campanha aberta (sobrevive a voltar para a página). */
const CAMPAIGN_PARAM = "campanha";

export default function LeadsPage() {
  const session = useRequiredSession();
  const companyId = session.company.id;
  const role = session.membership.role as Role;
  const title = useLabel("module.leads");
  const canCreate = usePermission("create", "leads");
  const canEdit = usePermission("edit", "leads");
  const [tab, setTab] = useState<TabId>("leads");
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();

  const campaignsQuery = useQuery({
    queryKey: campaignsQueryKey(companyId),
    queryFn: async () => {
      const db = await getDb();
      // Lead sem campanha (importado pela tela de Importação, criado por tela antiga) entra na campanha padrão.
      const defaultId = canCreate || canEdit ? await ensureDefaultCampaign(db, companyId) : null;
      const list = await listCampaigns(db, companyId);
      return { list, defaultId: defaultId ?? list[0]?.id ?? null };
    },
  });
  const campaigns = useMemo(() => campaignsQuery.data?.list ?? [], [campaignsQuery.data]);
  const defaultId = campaignsQuery.data?.defaultId ?? null;
  const requested = params.get(CAMPAIGN_PARAM);
  const campaign = campaigns.find((item) => item.id === requested) ?? campaigns.find((item) => item.id === defaultId) ?? campaigns[0] ?? null;
  const selectCampaign = (id: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set(CAMPAIGN_PARAM, id);
        return next;
      },
      { replace: true },
    );

  const { data: leads = [], isLoading } = useQuery({ queryKey: ["leads", companyId], queryFn: () => fetchLeads(companyId) });
  const { data: packages = [] } = useQuery({ queryKey: ["service-packages", companyId], queryFn: () => fetchServicePackages(companyId) });
  const { data: prices = [] } = useQuery({ queryKey: ["package-prices", companyId], queryFn: () => fetchPackagePrices(companyId) });
  const { data: scenarios = [] } = useQuery({ queryKey: ["revenue-scenarios", companyId], queryFn: () => fetchRevenueScenarios(companyId) });
  const { data: stats } = useQuery({
    queryKey: campaignStatsQueryKey(companyId, campaign?.id),
    queryFn: async () => campaignStats(await getDb(), campaign!.id),
    enabled: !!campaign,
  });

  // Lead ainda sem campanha conta na padrão (o ensureDefaultCampaign acima o grava lá na próxima leitura).
  const campaignLeads = useMemo(
    () => (campaign ? leads.filter((lead) => (lead.campaign_id ?? defaultId) === campaign.id) : []),
    [leads, campaign, defaultId],
  );

  async function create(name: string) {
    const db = await getDb();
    const id = await createCampaign(db, companyId, name, { role });
    await emit({ type: "prospecting_campaign.created", companyId, actorId: session.user.id, entityType: "prospecting_campaign", entityId: id, title: `Prospecção criada: ${name.trim()}`, module: "leads" });
    await qc.invalidateQueries({ queryKey: campaignsQueryKey(companyId) });
    selectCampaign(id);
  }

  async function rename(id: string, name: string) {
    const db = await getDb();
    const before = campaigns.find((item) => item.id === id)?.name;
    await renameCampaign(db, id, name, { companyId, role });
    await emit({
      type: "prospecting_campaign.renamed",
      companyId,
      actorId: session.user.id,
      entityType: "prospecting_campaign",
      entityId: id,
      title: `Prospecção renomeada: ${before ?? ""} → ${name.trim()}`,
      module: "leads",
      oldValue: { name: before },
      newValue: { name: name.trim() },
    });
    await qc.invalidateQueries({ queryKey: campaignsQueryKey(companyId) });
  }

  // Leads novos da planilha entram na campanha aberta; os que já existiam continuam onde estavam.
  async function afterImport() {
    if (campaign && (canCreate || canEdit)) await assignLeadsWithoutCampaign(await getDb(), companyId, campaign.id);
    await qc.invalidateQueries({ queryKey: ["leads", companyId] });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        actions={
          <>
            <CampaignBar campaigns={campaigns} selected={campaign} onSelect={selectCampaign} canCreate={canCreate} canEdit={canEdit} onCreate={create} onRename={rename} loading={campaignsQuery.isLoading} />
            <ImportExportButtons entity="leads" onImported={() => void afterImport()} />
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard title="Leads" value={stats ? stats.leads : "—"} />
        <KpiCard title="Abordados" value={stats ? stats.contacted : "—"} />
        <KpiCard title="Fechados" value={stats ? stats.won : "—"} />
        <KpiCard title="Potencial no 1º ano" value={stats ? formatMoney(stats.potential) : "—"} />
      </div>

      <TabList tabs={TABS} value={tab} onChange={setTab} label="Seções da prospecção" idPrefix="leads" />

      <CurrentCampaignContext.Provider value={campaign}>
        <TabPanel idPrefix="leads" id={tab}>
          {tab === "leads" && <LeadsPanel leads={campaignLeads} packages={packages} loading={isLoading || campaignsQuery.isLoading} />}
          {tab === "cronograma" && <SchedulePanel key={campaign?.id ?? "nenhuma"} leads={campaignLeads} />}
          {tab === "pacotes" && <PackagesPanel packages={packages} prices={prices} leads={campaignLeads} />}
          {/* O programa de indicação conta os fechados de quem indicou em todas as prospecções. */}
          {tab === "indicacoes" && <ReferralPanel leads={leads} />}
          {tab === "previsao" && <ForecastPanel scenarios={scenarios} leads={campaignLeads} />}
        </TabPanel>
      </CurrentCampaignContext.Provider>
    </div>
  );
}
