// Prospecção: todos os leads numa lista só (prospecção nova ou importada soma aos que já existem; a separação por
// campanha continua no banco, mas não aparece mais na tela). "Nova prospecção" é um menu: cadastrar lead na tabela,
// editar a tabela ou importar uma planilha (CSV/XLSX). Leads, cronograma, pacotes e previsão recebem todos os leads.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Plus, Upload } from "lucide-react";
import { useRequiredSession } from "@/hooks/useSession";
import { usePermission } from "@/hooks/usePermission";
import { useDismiss } from "@/app/layout/useDismiss";
import type { EditableTableController } from "@/components/shared/EditableTable";
import { ImportExportButtons } from "@/components/shared/ImportExportButtons";
import { KpiCard } from "@/components/shared/KpiCard";
import { PageHeader } from "@/components/shared/PageHeader";
import { EditIcon } from "@/components/shared/table";
import { TabList, TabPanel } from "@/components/shared/Tabs";
import { getDb } from "@/lib/db/client";
import { canImportEntity } from "@/lib/importexport/access";
import { getEntity } from "@/lib/importexport/registry";
import { useLabel } from "@/lib/labels/useLabel";
import { formatMoney } from "@/lib/prospecting/contact";
import { packagePricesQueryKey } from "@/lib/prospecting/packages";
import { ensureDefaultCampaign, listCampaigns, pickDefaultCampaign, summarizeCampaignLeads } from "@/lib/prospecting/campaigns";
import { fetchLeads, fetchPackagePrices, fetchRevenueScenarios, fetchServicePackages } from "@/lib/prospecting/queries";
import type { Role } from "@/types";
import { campaignsQueryKey, CurrentCampaignContext } from "../campaignContext";
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

const MENU_ITEM = "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent";

export default function LeadsPage() {
  const session = useRequiredSession();
  const companyId = session.company.id;
  const role = session.membership.role as Role;
  const title = useLabel("module.leads");
  const canCreate = usePermission("create", "leads");
  const canEdit = usePermission("edit", "leads");
  const canWrite = canCreate || canEdit;
  const [tab, setTab] = useState<TabId>("leads");
  const qc = useQueryClient();
  const table = useRef<EditableTableController | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  useDismiss(menu, menuOpen, () => setMenuOpen(false));
  const [importing, setImporting] = useState(false);
  const leadsEntity = getEntity("leads");
  const canImport = !!leadsEntity && canImportEntity(role, leadsEntity);

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
  // Lead novo da tabela entra na campanha padrão (a "Prospecção 1"), junto com todos os outros.
  const campaign = pickDefaultCampaign(campaignsQuery.data ?? [], companyId) ?? null;

  const { data: leads = [], isLoading } = useQuery({ queryKey: ["leads", companyId], queryFn: () => fetchLeads(companyId) });
  const { data: packages = [] } = useQuery({ queryKey: ["service-packages", companyId], queryFn: () => fetchServicePackages(companyId) });
  const { data: prices = [] } = useQuery({ queryKey: packagePricesQueryKey(companyId), queryFn: () => fetchPackagePrices(companyId) });
  const { data: scenarios = [] } = useQuery({ queryKey: ["revenue-scenarios", companyId], queryFn: () => fetchRevenueScenarios(companyId) });
  const stats = useMemo(() => summarizeCampaignLeads(leads), [leads]);

  // Leads importados sem campanha vão para a padrão: a prospecção importada soma à que já existe.
  async function afterImport() {
    if (canWrite) await ensureDefaultCampaign(await getDb(), companyId).catch(() => undefined);
    await qc.invalidateQueries({ queryKey: ["leads", companyId] });
  }

  /** Item do menu: vai para a aba Leads e dispara o comando na tabela (montada, só escondida, em outra aba). */
  function onTable(command: "add" | "edit") {
    setMenuOpen(false);
    setTab("leads");
    table.current?.[command]();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        actions={
          <>
            <div ref={menu} className="relative">
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                disabled={!canCreate && !canEdit && !canImport}
                onClick={() => setMenuOpen((open) => !open)}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus size={15} /> Nova prospecção <ChevronDown size={14} />
              </button>
              {menuOpen && (
                <div role="menu" aria-label="Nova prospecção" className="absolute right-0 top-full z-30 mt-1 w-56 rounded-lg border bg-popover p-1 text-popover-foreground shadow-xl">
                  <button type="button" role="menuitem" className={MENU_ITEM} disabled={!canCreate} title={canCreate ? undefined : "Sem permissão para cadastrar leads"} onClick={() => onTable("add")}>
                    <Plus size={15} aria-hidden="true" /> Nova prospecção
                  </button>
                  <button type="button" role="menuitem" className={MENU_ITEM} disabled={!canEdit} title={canEdit ? undefined : "Sem permissão para editar leads"} onClick={() => onTable("edit")}>
                    <EditIcon size={15} aria-hidden="true" /> Editar prospecção
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className={MENU_ITEM}
                    disabled={!canImport}
                    title={canImport ? "Planilha CSV ou Excel; os leads novos somam aos que já existem" : "Sem permissão para importar leads"}
                    onClick={() => {
                      setMenuOpen(false);
                      setImporting(true);
                    }}
                  >
                    <Upload size={15} aria-hidden="true" /> Importar prospecção
                  </button>
                </div>
              )}
            </div>
            <ImportExportButtons entity="leads" hideImportButton importOpen={importing} onImportOpenChange={setImporting} onImported={() => void afterImport()} />
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard title="Leads" value={isLoading ? "—" : stats.leads} />
        <KpiCard title="Abordados" value={isLoading ? "—" : stats.contacted} />
        <KpiCard title="Fechados" value={isLoading ? "—" : stats.won} />
        <KpiCard title="Potencial no 1º ano" value={isLoading ? "—" : formatMoney(stats.potential)} />
      </div>

      <TabList tabs={TABS} value={tab} onChange={setTab} label="Seções da prospecção" idPrefix="leads" />

      <CurrentCampaignContext.Provider value={campaign}>
        {/* Leads e Pacotes (as abas com tabela) ficam montadas, só escondidas: trocar de aba não perde em silêncio o rascunho. */}
        <div hidden={tab !== "leads"}>
          <TabPanel idPrefix="leads" id="leads">
            <LeadsPanel leads={leads} packages={packages} loading={isLoading} controller={table} />
          </TabPanel>
        </div>
        {tab === "cronograma" && (
          <TabPanel idPrefix="leads" id="cronograma">
            <SchedulePanel leads={leads} />
          </TabPanel>
        )}
        <div hidden={tab !== "pacotes"}>
          <TabPanel idPrefix="leads" id="pacotes">
            <PackagesPanel packages={packages} prices={prices} leads={leads} />
          </TabPanel>
        </div>
        {tab === "indicacoes" && (
          <TabPanel idPrefix="leads" id="indicacoes">
            <ReferralPanel leads={leads} />
          </TabPanel>
        )}
        {tab === "previsao" && (
          <TabPanel idPrefix="leads" id="previsao">
            <ForecastPanel scenarios={scenarios} leads={leads} />
          </TabPanel>
        )}
      </CurrentCampaignContext.Provider>
    </div>
  );
}
