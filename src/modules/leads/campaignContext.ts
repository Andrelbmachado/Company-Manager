// Campanha de prospecção escolhida no topo da página, para os painéis da Prospecção. A tabela editável de leads
// (Tarefa 6a) deve usar o id no `newRow()` (`campaign_id`), para o lead criado ali entrar na campanha que está aberta
// (sem campanha, ele vai para a campanha padrão).
import { createContext, useContext } from "react";
import type { ProspectingCampaign } from "@/types";

export const CurrentCampaignContext = createContext<ProspectingCampaign | null>(null);

export function useCurrentCampaign(): ProspectingCampaign | null {
  return useContext(CurrentCampaignContext);
}

/** Chaves das consultas de campanha: ficam sob ["leads", empresa] e são refeitas junto com a lista de leads. */
export const campaignsQueryKey = (companyId: string) => ["leads", companyId, "campaigns"] as const;
export const campaignStatsQueryKey = (companyId: string, campaignId: string | null | undefined) => ["leads", companyId, "campaign-stats", campaignId ?? null] as const;
