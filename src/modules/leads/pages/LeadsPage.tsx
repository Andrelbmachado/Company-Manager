import { useEffect, useMemo, useState } from "react";
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
import { packagePricesQueryKey } from "@/lib/prospecting/packages";
import { assignLeadsWithoutCampaign, campaignStats, createCampaign, ensureDefaultCampaign, listCampaigns, pickDefaultCampaign, renameCampaign } from "@/lib/prospecting/campaigns";
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
  const canWrite = canCreate || canEdit;
  const [tab, setTab] = useState<TabId>("leads");
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();

  // Lead sem campanha (importado pela tela de Importação, criado por tela antiga) vai para a campanha padrão uma vez, ao
  // abrir a página. Fica fora da consulta das campanhas de propósito: a importação desta tela refaz todas as consultas
  // antes de avisar a página, e a consulta levaria os leads recém-importados para a padrão, não para a campanha aberta.
  const [preparedFor, setPreparedFor] = useState<string | null>(null);
  const prepared = !canWrite || preparedFor === companyId;
  useEffect(() => {
    if (!canWrite) return;
    let current = true;
    void (async () => {
      try {
        await ensureDefaultCampaign(await getDb(), companyId);
      } catch {
        // Sem gravar a padrão a página ainda abre com as campanhas que já existem.
      }
      if (!current) return;
      setPreparedFor(companyId);
      await qc.invalidateQueries({ queryKey: ["leads", companyId] });
    })();
    return () => {
      current = false;
    };
  }, [canWrite, companyId, qc]);

  const campaignsQuery = useQuery({
    queryKey: campaignsQueryKey(companyId),
    queryFn: async () => listCampaigns(await getDb(), companyId),
    enabled: prepared,
  });
  const campaigns = useMemo(() => campaignsQuery.data ?? [], [campaignsQuery.data]);
  const defaultId = pickDefaultCampaign(campaigns, companyId)?.id ?? null;
  const requested = params.get(CAMPAIGN_PARAM);
  const campaign = campaigns.find((item) => item.id === requested) ?? campaigns.find((item) => item.id === defaultId) ?? null;
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
  const { data: prices = [] } = useQuery({ queryKey: packagePricesQueryKey(companyId), queryFn: () => fetchPackagePrices(companyId) });
  const { data: scenarios = [] } = useQuery({ queryKey: ["revenue-scenarios", companyId], queryFn: () => fetchRevenueScenarios(companyId) });
  const { data: stats } = useQuery({
    queryKey: campaignStatsQueryKey(companyId, campaign?.id),
    queryFn: async () => campaignStats(await getDb(), campaign!.id),
    enabled: !!campaign,
  });

  // Lead ainda sem campanha conta na padrão (o ensureDefaultCampaign ao abrir a página o grava lá).
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
  // Se a campanha aberta sumiu nesse meio-tempo, os leads sem campanha vão para a padrão.
  async function afterImport() {
    if (canWrite) {
      const db = await getDb();
      try {
        if (!campaign) throw new Error("Prospecção não encontrada.");
        await assignLeadsWithoutCampaign(db, companyId, campaign.id);
      } catch {
        await ensureDefaultCampaign(db, companyId).catch(() => undefined);
      }
    }
    await qc.invalidateQueries({ queryKey: ["leads", companyId] });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        actions={
          <>
            <CampaignBar campaigns={campaigns} selected={campaign} onSelect={selectCampaign} canCreate={canCreate} canEdit={canEdit} onCreate={create} onRename={rename} loading={campaignsQuery.isPending} />
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
        {/* Leads e Pacotes (as abas com tabela) ficam montadas, só escondidas: trocar de aba não perde em silêncio o rascunho. */}
        <div hidden={tab !== "leads"}>
          <TabPanel idPrefix="leads" id="leads">
            <LeadsPanel leads={campaignLeads} packages={packages} loading={isLoading || campaignsQuery.isPending} />
          </TabPanel>
        </div>
        {tab === "cronograma" && (
          <TabPanel idPrefix="leads" id="cronograma">
            <SchedulePanel key={campaign?.id ?? "nenhuma"} leads={campaignLeads} />
          </TabPanel>
        )}
        <div hidden={tab !== "pacotes"}>
          <TabPanel idPrefix="leads" id="pacotes">
            <PackagesPanel packages={packages} prices={prices} leads={campaignLeads} />
          </TabPanel>
        </div>
        {/* O programa de indicação conta os fechados de quem indicou em todas as prospecções. */}
        {tab === "indicacoes" && (
          <TabPanel idPrefix="leads" id="indicacoes">
            <ReferralPanel leads={leads} />
          </TabPanel>
        )}
        {tab === "previsao" && (
          <TabPanel idPrefix="leads" id="previsao">
            <ForecastPanel scenarios={scenarios} leads={campaignLeads} />
          </TabPanel>
        )}
      </CurrentCampaignContext.Provider>
    </div>
  );
}
