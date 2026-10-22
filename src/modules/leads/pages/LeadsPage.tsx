import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRequiredSession } from "@/hooks/useSession";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatCard } from "@/components/shared/StatCard";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { TabList, TabPanel } from "@/components/shared/Tabs";
import { formatMoney } from "@/lib/prospecting/contact";
import {
  fetchLeads,
  fetchPackagePrices,
  fetchRevenueForecasts,
  fetchRevenueScenarios,
  fetchServicePackages,
  fetchSiteProject,
} from "@/lib/prospecting/queries";
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

const PER_DAY = 5;

export default function LeadsPage() {
  const session = useRequiredSession();
  const companyId = session.company.id;
  const [tab, setTab] = useState<TabId>("leads");

  const { data: project } = useQuery({ queryKey: ["projects", companyId, "site"], queryFn: () => fetchSiteProject(companyId) });
  const { data: leads = [], isLoading } = useQuery({ queryKey: ["leads", companyId], queryFn: () => fetchLeads(companyId) });
  const { data: packages = [] } = useQuery({ queryKey: ["service-packages", companyId], queryFn: () => fetchServicePackages(companyId) });
  const { data: prices = [] } = useQuery({ queryKey: ["package-prices", companyId], queryFn: () => fetchPackagePrices(companyId) });
  const { data: scenarios = [] } = useQuery({ queryKey: ["revenue-scenarios", companyId], queryFn: () => fetchRevenueScenarios(companyId) });
  const { data: forecasts = [] } = useQuery({ queryKey: ["revenue-forecasts", companyId], queryFn: () => fetchRevenueForecasts(companyId) });

  const broken = leads.filter((lead) => lead.presence_kind === "site_quebrado").length;
  const withWhatsapp = leads.filter((lead) => lead.whatsapp).length;
  const potential = leads.reduce((sum, lead) => sum + lead.estimated_revenue, 0);
  const count = (status: string) => leads.filter((lead) => lead.status === status).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Prospecção de Sites"
        description="Leads de Sorocaba sem site, pacotes, cronograma e previsão de receita"
        actions={project ? (
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            Projeto: <strong className="text-foreground">{project.name}</strong> <StatusBadge status={project.status} />
          </span>
        ) : undefined}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Leads" value={leads.length} hint={`${broken} com site quebrado · ${withWhatsapp} com WhatsApp`} />
        <StatCard title="Potencial 1º ano (estimativa)" value={formatMoney(potential)} hint="implantação + 12 mensalidades, preços da Proposta" />
        <StatCard title="Funil" value={`${count("abordado")} / ${count("interessado")} / ${count("fechado")}`} hint="abordados / interessados / fechados" />
        <StatCard title="Novos" value={count("novo")} hint={`${PER_DAY} abordagens por dia útil`} />
      </div>

      <div className="border-b"><TabList tabs={TABS} value={tab} onChange={setTab} label="Seções da prospecção" idPrefix="leads" /></div>

      <TabPanel idPrefix="leads" id={tab}>
      {tab === "leads" && <LeadsPanel leads={leads} packages={packages} loading={isLoading} />}
      {tab === "cronograma" && <SchedulePanel leads={leads} perDay={PER_DAY} />}
      {tab === "pacotes" && <PackagesPanel packages={packages} prices={prices} leads={leads} />}
      {tab === "indicacoes" && <ReferralPanel leads={leads} />}
      {tab === "previsao" && <ForecastPanel projectId={project?.id ?? null} scenarios={scenarios} forecasts={forecasts} leads={leads} />}
      </TabPanel>
    </div>
  );
}
